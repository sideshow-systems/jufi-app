import { sperreVereinszeile, type VereinTx } from '@jufi/db';
import {
	bereinigeDateiname,
	hatRecht,
	istJugendleiter,
	ohneEndung,
	pruefeDokumentTitel,
	pruefeKategorieName,
	sortiereDokumente,
	type DokumentAnsicht,
	type DokumenteAntwort,
	type SpeicherAntwort,
} from '@jufi/domain';
import type { RequestHandler, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { statt404 } from '../mitglieder/verwaltung.js';
import { vereinsKontext } from '../verein.js';
import { Abbruch, antworteBeiAbbruch, nimmDatei, verbrauchBytes, type NeueDatei } from './annehmen.js';
import { loescheDateien } from './loeschen.js';

/** Steht ein Text so in der Datenbank oder wuerde sie ihn ablehnen (0x00) bzw. verfaelschen (halbe Surrogate). */
const UNZULAESSIG = /[\p{Cc}\p{Surrogate}]/u;

const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

/**
 * Das Recht DOKUMENTE, vor allem anderen: Wer es nicht hat, bekommt 404 und erfaehrt nicht,
 * dass es die Route gibt (Rahmen-Spec 8). Bei den Uploads steht das vor jedem Lesen des
 * Koerpers; fruehAntwort setzt dort Connection: close, weil der Koerper ungelesen bleibt.
 */
const brauchtDokumente: RequestHandler = (_req, res, next) => {
	if (!hatRecht(mitgliedKontext(res).person, 'DOKUMENTE')) return statt404(res);
	next();
};

const brauchtDokumenteVorUpload: RequestHandler = (_req, res, next) => {
	if (!hatRecht(mitgliedKontext(res).person, 'DOKUMENTE')) {
		res.set('Connection', 'close');
		return statt404(res);
	}
	next();
};

interface DateiZeile {
	id: string;
	typ: string;
	groesse: number;
	name: string;
	hochgeladenAm: Date;
}

function ansicht(dokument: { id: string; titel: string }, datei: DateiZeile): DokumentAnsicht {
	return {
		id: dokument.id,
		titel: dokument.titel,
		dateiId: datei.id,
		typ: datei.typ,
		groesse: datei.groesse,
		name: datei.name,
		hochgeladenAm: datei.hochgeladenAm.toISOString(),
	};
}

const DATEI_FELDER = { id: true, typ: true, groesse: true, name: true, hochgeladenAm: true } as const;

/** Die Zeile zu einer angenommenen Datei eines Dokuments; die Bytes liegen schon (nimmDatei). */
function legeDateiAn(tx: VereinTx, e: NeueDatei, dokumentId: string, vonId: string, jetzt: Date): Promise<DateiZeile> {
	return tx.datei.create({
		data: {
			id: e.id,
			art: 'DATEI',
			dokumentId,
			name: e.name,
			typ: e.typ,
			groesse: e.groesse,
			sha256: e.sha256,
			vonId,
			hochgeladenAm: jetzt,
		},
		select: DATEI_FELDER,
	});
}

/**
 * Ein Text-Feld des Bodys, geprueft auf das, was die Regeln in libs/domain nicht kennen: Etwas
 * anderes als Text und Zeichen, die die Datenbank ablehnt oder verfaelscht. Ein Zeilenumbruch im
 * Titel ginge durch die Regel und die Datenbank, brachte aber jede Liste durcheinander; ein 0x00
 * lehnte Postgres mit einem Fehler ab, der als 500 endete.
 */
function textFeld(roh: unknown): { ok: true; text: string } | { ok: false; fehler: string } {
	if (typeof roh !== 'string') return { ok: false, fehler: 'Bitte einen Text angeben' };
	if (UNZULAESSIG.test(roh)) return { ok: false, fehler: 'Der Text darf keine Steuerzeichen enthalten' };
	return { ok: true, text: roh };
}

function pruefeTitel(roh: unknown): { ok: true; titel: string } | { ok: false; fehler: string } {
	const text = textFeld(roh);
	return text.ok ? pruefeDokumentTitel(text.text) : text;
}

function pruefeName(body: unknown): { ok: true; name: string } | { ok: false; fehler: string } {
	const text = textFeld(koerper(body)?.['name']);
	return text.ok ? pruefeKategorieName(text.text) : text;
}

function koerper(body: unknown): Record<string, unknown> | null {
	return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/**
 * Keine dieser Routen meldet nach dem Commit an deps.bus: Dokumente haben kein Live (TP4-Spec 3.1)
 * und schreiben keine Aenderung; die Liste laedt beim Oeffnen der Seite neu. Verworfen: ein Signal
 * "dokumente" -- ein Abonnent, den keine Oberflaeche braucht, und ein Zaehler mehr am Verein.
 */
export function dokumentRouten(router: Router, deps: VolleAppDeps): void {
	router.get(
		'/dokumente',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { db } = vereinsKontext(res);
			const darfPflegen = hatRecht(mitgliedKontext(res).person, 'DOKUMENTE');
			const kategorien = await db.dokumentKategorie.findMany({
				orderBy: { position: 'asc' },
				include: { dokumente: { include: { dateien: { select: DATEI_FELDER, take: 1 } } } },
			});
			const antwort: DokumenteAntwort = {
				darfPflegen,
				kategorien: kategorien
					.map((k) => ({
						id: k.id,
						name: k.name,
						dokumente: sortiereDokumente(k.dokumente.flatMap((d) => (d.dateien[0] ? [ansicht(d, d.dateien[0])] : []))),
					}))
					// Eine leere Kategorie ist fuer alle ausser den Pflegenden ein Rauschen ohne Inhalt.
					.filter((k) => darfPflegen || k.dokumente.length > 0),
			};
			res.json(antwort);
		}),
	);

	router.post(
		'/dokumente',
		brauchtMitglied,
		brauchtDokumenteVorUpload,
		asynchron(async (req, res) => {
			const { db } = vereinsKontext(res);
			const kategorieId = req.query['kategorie'];
			const kategorie =
				typeof kategorieId === 'string'
					? await db.dokumentKategorie.findFirst({ where: { id: kategorieId }, select: { id: true } })
					: null;
			if (!kategorie) {
				res.set('Connection', 'close');
				return statt404(res);
			}
			const ergebnis = await nimmDatei(req, res, deps, {
				art: 'DATEI',
				name: bereinigeDateiname(req.header('x-dateiname')),
				freiBytes: 0,
				schreibe: async (tx, e) => {
					// Die Kategorie kann zwischen dem Pruefen oben und der Sperre geloescht worden sein.
					if (!(await tx.dokumentKategorie.findFirst({ where: { id: kategorie.id }, select: { id: true } }))) {
						throw new Abbruch(404, NICHT_GEFUNDEN);
					}
					// Der Titel ist der Name ohne Endung; faellt dabei etwas Unbrauchbares heraus (der Name
					// "x .pdf" haette ein Leerzeichen am Ende, das der CHECK der Datenbank ablehnt), hilft der
					// Standardtitel mehr als ein Fehler, den die Person nicht beheben kann.
					const titel = pruefeDokumentTitel(ohneEndung(e.name));
					const jetzt = deps.jetzt();
					const dokument = await tx.dokument.create({
						data: { kategorieId: kategorie.id, titel: titel.ok ? titel.titel : 'Dokument', angelegtAm: jetzt },
						select: { id: true, titel: true },
					});
					return ansicht(dokument, await legeDateiAn(tx, e, dokument.id, mitgliedKontext(res).person.id, jetzt));
				},
			});
			if (ergebnis.ok) res.status(201).json(ergebnis.wert);
		}),
	);

	router.put(
		'/dokumente/:id/datei',
		brauchtMitglied,
		brauchtDokumenteVorUpload,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const dokument = await db.dokument.findFirst({
				where: { id: req.params['id'] ?? '' },
				select: { id: true, dateien: { select: { groesse: true } } },
			});
			if (!dokument) {
				res.set('Connection', 'close');
				return statt404(res);
			}
			// Was die alte Datei freigibt, so wie es vor dem Koerper aussah; nimmDatei rechnet das
			// Kontingent unter der Sperre damit. Ersetzen zwei Anfragen dasselbe Dokument gleichzeitig,
			// gibt die zweite in Wahrheit die Datei der ersten frei; die Abweichung ist der Groessenunterschied
			// zweier Fassungen eines Dokuments. Verworfen: die Freigabe als Funktion unter der Sperre
			// nachzurechnen -- eine zweite Form von freiBytes nur fuer dieses Rennen.
			const frei = dokument.dateien.reduce((summe, d) => summe + d.groesse, 0);
			const ergebnis = await nimmDatei(req, res, deps, {
				art: 'DATEI',
				name: bereinigeDateiname(req.header('x-dateiname')),
				freiBytes: frei,
				schreibe: async (tx, e) => {
					const aktuell = await tx.dokument.findFirst({
						where: { id: dokument.id },
						select: { id: true, titel: true, dateien: { select: { id: true, art: true } } },
					});
					if (!aktuell) throw new Abbruch(404, NICHT_GEFUNDEN);
					const jetzt = deps.jetzt();
					// Erst die alte Datei: Der Index laesst nur eine Datei je Dokument zu. Die alte ID liefert
					// danach 404, die neue Bytes; die alten Bytes liegen bis zum Aufraeumer noch da.
					await loescheDateien(tx, verein.id, aktuell.dateien, jetzt);
					return ansicht(aktuell, await legeDateiAn(tx, e, aktuell.id, mitgliedKontext(res).person.id, jetzt));
				},
			});
			if (ergebnis.ok) res.status(200).json(ergebnis.wert);
		}),
	);

	router.put(
		'/dokumente/:id',
		brauchtMitglied,
		brauchtDokumente,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const roh = koerper(req.body);
			if (!roh) return void res.status(400).json({ fehler: 'Ungültige Anfrage', feld: 'body' });
			for (const schluessel of Object.keys(roh)) {
				if (schluessel !== 'titel' && schluessel !== 'kategorieId') {
					return void res.status(400).json({ fehler: 'Dieses Feld lässt sich nicht ändern', feld: schluessel });
				}
			}
			let titel: string | undefined;
			if ('titel' in roh) {
				const r = pruefeTitel(roh['titel']);
				if (!r.ok) return void res.status(400).json({ fehler: r.fehler, feld: 'titel' });
				titel = r.titel;
			}
			const kategorieId = roh['kategorieId'];
			if ('kategorieId' in roh && typeof kategorieId !== 'string') {
				return void res.status(400).json({ fehler: 'Ungültige Kategorie', feld: 'kategorieId' });
			}

			try {
				const antwort = await db.$transaction(async (tx) => {
					// Unter der Sperre, weil das Loeschen einer Kategorie "leer" und das Verschieben hierher
					// nacheinander entscheiden muessen; ohne sie loeste der Fremdschluessel beim Verschieben in eine
					// eben geloeschte Kategorie ein 500 aus.
					await sperreVereinszeile(tx, verein.id);
					const dokument = await tx.dokument.findFirst({
						where: { id: req.params['id'] ?? '' },
						select: { id: true, dateien: { select: DATEI_FELDER, take: 1 } },
					});
					const datei = dokument?.dateien[0];
					if (!dokument || !datei) throw new Abbruch(404, NICHT_GEFUNDEN);
					if (typeof kategorieId === 'string') {
						if (!(await tx.dokumentKategorie.findFirst({ where: { id: kategorieId }, select: { id: true } }))) {
							throw new Abbruch(404, NICHT_GEFUNDEN);
						}
					}
					const neu = await tx.dokument.update({
						where: { id: dokument.id },
						data: { titel, kategorieId: typeof kategorieId === 'string' ? kategorieId : undefined },
						select: { id: true, titel: true },
					});
					return ansicht(neu, datei);
				});
				res.json(antwort);
			} catch (fehler) {
				if (!antworteBeiAbbruch(res, fehler)) throw fehler;
			}
		}),
	);

	router.delete(
		'/dokumente/:id',
		brauchtMitglied,
		brauchtDokumente,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const jetzt = deps.jetzt();
			const geloescht = await db.$transaction(async (tx) => {
				await sperreVereinszeile(tx, verein.id);
				const dokument = await tx.dokument.findFirst({
					where: { id: req.params['id'] ?? '' },
					select: { id: true, dateien: { select: { id: true, art: true } } },
				});
				if (!dokument) return false;
				// Die Dateien zuerst: Der Fremdschluessel verweist mit NoAction auf das Dokument.
				await loescheDateien(tx, verein.id, dokument.dateien, jetzt);
				await tx.dokument.delete({ where: { id: dokument.id } });
				return true;
			});
			if (!geloescht) return statt404(res);
			res.status(204).end();
		}),
	);

	router.post(
		'/dokument-kategorien',
		brauchtMitglied,
		brauchtDokumente,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const name = pruefeName(req.body);
			if (!name.ok) return void res.status(400).json({ fehler: name.fehler, feld: 'name' });
			try {
				const kategorie = await db.$transaction(async (tx) => {
					// Unter der Sperre, damit zwei gleichzeitige Anlegen nicht dieselbe Position bekommen und
					// die Pruefung auf den Namen und das Anlegen nacheinander laufen.
					await sperreVereinszeile(tx, verein.id);
					if (await tx.dokumentKategorie.findFirst({ where: { name: name.name }, select: { id: true } })) {
						throw new Abbruch(409, DOPPELT);
					}
					const ende = await tx.dokumentKategorie.aggregate({ _max: { position: true } });
					return tx.dokumentKategorie.create({
						data: { name: name.name, position: (ende._max.position ?? -1) + 1 },
						select: { id: true, name: true },
					});
				});
				res.status(201).json(kategorie);
			} catch (fehler) {
				if (!antworteBeiAbbruch(res, fehler)) throw fehler;
			}
		}),
	);

	// Vor /dokument-kategorien/:id, sonst naehme die Route "reihenfolge" als Kennung.
	router.put(
		'/dokument-kategorien/reihenfolge',
		brauchtMitglied,
		brauchtDokumente,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const ids = koerper(req.body)?.['ids'];
			if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) {
				return void res.status(400).json({ fehler: 'Ungültige Reihenfolge', feld: 'ids' });
			}
			try {
				await db.$transaction(async (tx) => {
					await sperreVereinszeile(tx, verein.id);
					const vorhanden = await tx.dokumentKategorie.findMany({ select: { id: true } });
					// Genau alle, jede einmal: Eine fehlende oder fremde ID hiesse, dass der Client eine
					// veraltete Liste kennt, und die Positionen wuerden still lueckenhaft oder doppelt.
					if (
						ids.length !== vorhanden.length ||
						new Set(ids).size !== ids.length ||
						!vorhanden.every((k) => ids.includes(k.id))
					) {
						throw new Abbruch(400, { fehler: 'Die Reihenfolge muss alle Kategorien enthalten', feld: 'ids' });
					}
					for (const [position, id] of ids.entries()) {
						await tx.dokumentKategorie.update({ where: { id }, data: { position } });
					}
				});
				res.status(204).end();
			} catch (fehler) {
				if (!antworteBeiAbbruch(res, fehler)) throw fehler;
			}
		}),
	);

	router.put(
		'/dokument-kategorien/:id',
		brauchtMitglied,
		brauchtDokumente,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const name = pruefeName(req.body);
			if (!name.ok) return void res.status(400).json({ fehler: name.fehler, feld: 'name' });
			try {
				const kategorie = await db.$transaction(async (tx) => {
					await sperreVereinszeile(tx, verein.id);
					const id = req.params['id'] ?? '';
					if (!(await tx.dokumentKategorie.findFirst({ where: { id }, select: { id: true } }))) {
						throw new Abbruch(404, NICHT_GEFUNDEN);
					}
					if (
						await tx.dokumentKategorie.findFirst({ where: { name: name.name, id: { not: id } }, select: { id: true } })
					) {
						throw new Abbruch(409, DOPPELT);
					}
					return tx.dokumentKategorie.update({
						where: { id },
						data: { name: name.name },
						select: { id: true, name: true },
					});
				});
				res.json(kategorie);
			} catch (fehler) {
				if (!antworteBeiAbbruch(res, fehler)) throw fehler;
			}
		}),
	);

	router.delete(
		'/dokument-kategorien/:id',
		brauchtMitglied,
		brauchtDokumente,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			try {
				await db.$transaction(async (tx) => {
					// Dieselbe Sperre wie beim Hochladen und Verschieben: "leer" gilt nur, solange
					// kein Dokument gleichzeitig hineinkommt.
					await sperreVereinszeile(tx, verein.id);
					const id = req.params['id'] ?? '';
					if (!(await tx.dokumentKategorie.findFirst({ where: { id }, select: { id: true } }))) {
						throw new Abbruch(404, NICHT_GEFUNDEN);
					}
					if ((await tx.dokument.count({ where: { kategorieId: id } })) > 0) {
						throw new Abbruch(409, { fehler: 'Die Kategorie ist nicht leer' });
					}
					await tx.dokumentKategorie.delete({ where: { id } });
				});
				res.status(204).end();
			} catch (fehler) {
				if (!antworteBeiAbbruch(res, fehler)) throw fehler;
			}
		}),
	);
}

const DOPPELT = { fehler: 'Diese Kategorie gibt es schon' };

/**
 * Verbrauch und Grenze des Vereins, fuer die Verwaltung. Nur mit irgendeinem Recht: Wer keines hat,
 * hat dort nichts zu suchen, und 404 verraet nicht, dass es die Seite gibt.
 */
export function speicherRoute(router: Router, _deps: VolleAppDeps): void {
	router.get(
		'/speicher',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			if (!istJugendleiter(mitgliedKontext(res).person)) return statt404(res);
			const { verein, db } = vereinsKontext(res);
			const antwort: SpeicherAntwort = { verbrauchBytes: await verbrauchBytes(db), grenzeMb: verein.speicherGrenzeMb };
			res.json(antwort);
		}),
	);
}
