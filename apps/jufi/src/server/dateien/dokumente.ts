import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { sperreVereinszeile, type VereinDb, type VereinTx } from '@jufi/db';
import {
	bereinigeDateiname,
	erkenneTyp,
	FEHLER_TEXT,
	GRENZE_BYTES,
	hatRecht,
	istJugendleiter,
	kontingentReicht,
	MB,
	ohneEndung,
	pruefeDokumentTitel,
	pruefeKategorieName,
	sortiereDokumente,
	speicherText,
	type DokumentAnsicht,
	type DokumenteAntwort,
	type SpeicherAntwort,
} from '@jufi/domain';
import type { RequestHandler, Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { statt404 } from '../mitglieder/verwaltung.js';
import { vereinsKontext } from '../verein.js';
import { nimmUpload } from './hochladen.js';
import { loescheDateien } from './loeschen.js';
import { dateiSchluessel } from './speicher.js';

/**
 * Was die Dateien des Vereins zusammen wiegen. Eine Summe ueber Datei.groesse statt eines
 * mitgefuehrten Zaehlers am Verein: Ein Zaehler muesste mit jedem Anlegen, Ersetzen und
 * Loeschen mitwandern und liefe bei einem vergessenen Pfad still auseinander.
 *
 * _sum bei einem Int liefert Prisma als number; es ueberlaeuft nicht bei 2^31 (der Test mit 100
 * Dateien zu je 25 MB sichert das). Verworfen: $queryRaw -- vereinDb sperrt Rohabfragen, weil
 * sie den eingesetzten Verein umgingen.
 */
export async function verbrauchBytes(db: VereinDb | VereinTx): Promise<number> {
	const summe = await db.datei.aggregate({ _sum: { groesse: true } });
	return summe._sum.groesse ?? 0;
}

/**
 * Ende einer Transaktion mit Status und Antwort. In der Transaktion geworfen, damit Prisma
 * zuruecknimmt, was bis dahin geschrieben wurde; ein Rueckgabewert liesse es stehen.
 */
class Abbruch extends Error {
	constructor(
		readonly status: number,
		readonly antwort: object,
	) {
		super('Abgebrochen');
	}
}

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

/**
 * Antwort, bevor der Koerper eines Uploads gelesen ist. Connection: close, weil ein
 * ungelesener Koerper die Verbindung fuer die naechste Anfrage verdirbt (hochladen.ts).
 */
function fruehAntwort(res: Response, status: number, antwort: object): void {
	res.set('Connection', 'close').status(status).json(antwort);
}

function kontingentFehler(belegtBytes: number, grenzeMb: number): { fehler: string; code: 'KONTINGENT' } {
	return {
		fehler: FEHLER_TEXT.KONTINGENT(speicherText(belegtBytes), speicherText(grenzeMb * MB)),
		code: 'KONTINGENT',
	};
}

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

/** Ein Upload nach den Schritten 2 bis 7 der Spec; Schritt 8 (die Datenbank) macht der Aufrufer. */
interface Hochgeladen {
	dateiId: string;
	name: string;
	typ: string;
	bytes: number;
	sha256: string;
}

/**
 * Keine dieser Routen meldet nach dem Commit an deps.bus: Dokumente haben kein Live (TP4-Spec 3.1)
 * und schreiben keine Aenderung; die Liste laedt beim Oeffnen der Seite neu. Verworfen: ein Signal
 * "dokumente" -- ein Abonnent, den keine Oberflaeche braucht, und ein Zaehler mehr am Verein.
 */
export function dokumentRouten(router: Router, deps: VolleAppDeps): void {
	/**
	 * Der gemeinsame Teil von POST /dokumente und PUT /dokumente/:id/datei. `freiBytes` ist, was
	 * das Ersetzen an alten Bytes freigibt (0 beim Anlegen): Ein Verein an der Grenze soll eine Datei
	 * durch eine gleich grosse tauschen koennen. Die Schreibfunktion laeuft unter der Vereinssperre.
	 *
	 * Fuer die Pruefung vor dem Koerper steht die Schaetzung aus Content-Length: Sie erspart das
	 * Hochladen von 25 MB in einen vollen Verein. Verbindlich ist erst die zweite Pruefung in der
	 * Transaktion, weil zwei Uploads, die einzeln passen, zusammen nicht passen muessen.
	 */
	async function nimmDatei(
		req: Parameters<typeof nimmUpload>[0],
		res: Response,
		erfolgsStatus: 200 | 201,
		freiBytes: number,
		schreibe: (tx: VereinTx, e: Hochgeladen & { jetzt: Date }) => Promise<DokumentAnsicht>,
	): Promise<void> {
		const { verein, db } = vereinsKontext(res);
		const { person } = mitgliedKontext(res);

		const wartezeit = deps.uploadFenster.pruefe(person.id);
		if (wartezeit > 0) {
			res.set('Retry-After', String(Math.ceil(wartezeit / 1000)));
			return fruehAntwort(res, 429, { fehler: 'Zu viele Uploads. Bitte warte einen Moment.' });
		}

		const name = bereinigeDateiname(req.header('x-dateiname'));
		if (name === null) return fruehAntwort(res, 400, { fehler: 'Dateiname fehlt' });

		const laenge = req.header('content-length');
		const geschaetzt = laenge !== undefined && /^\d+$/u.test(laenge) ? Number(laenge) : 0;
		const belegt = await verbrauchBytes(db);
		if (
			!kontingentReicht({
				verbrauchBytes: belegt - freiBytes,
				grenzeMb: verein.speicherGrenzeMb,
				zusatzBytes: geschaetzt,
			})
		) {
			return fruehAntwort(res, 413, kontingentFehler(belegt, verein.speicherGrenzeMb));
		}

		const upload = await nimmUpload(req, { speicher: deps.dateiSpeicher, maxBytes: GRENZE_BYTES.DATEI });
		if (!upload.ok) {
			return upload.status === 411
				? fruehAntwort(res, 411, { fehler: 'Die Größe der Datei fehlt' })
				: fruehAntwort(res, 413, { fehler: FEHLER_TEXT.GROESSE.DATEI, code: 'GROESSE' });
		}

		const typ = erkenneTyp(upload.kopf, name, 'DATEI');
		if (!typ.ok) {
			await rm(upload.tempPfad, { force: true });
			return void res
				.status(415)
				.json({ fehler: typ.grund === 'HEIC' ? FEHLER_TEXT.HEIC : FEHLER_TEXT.TYP.DATEI, code: typ.grund });
		}

		// Die ID steht vor der Zeile fest, weil die Bytes vorher abgelegt werden: Eine Zeile ohne
		// Bytes waere ein Dokument, das sich nicht oeffnen laesst; Bytes ohne Zeile raeumt der
		// Aufraeumer als Waise weg. Verworfen: erst die Zeile, dann die Bytes -- ein Abbruch dazwischen
		// hinterliesse genau das Dokument, das sich nicht oeffnen laesst.
		const dateiId = randomUUID();
		try {
			await deps.dateiSpeicher.uebernimm(upload.tempPfad, dateiSchluessel(verein.id, dateiId));
		} catch (fehler) {
			await rm(upload.tempPfad, { force: true });
			throw fehler;
		}

		const jetzt = deps.jetzt();
		try {
			const antwort = await db.$transaction(async (tx) => {
				await sperreVereinszeile(tx, verein.id);
				return schreibe(tx, { dateiId, name, typ: typ.typ, bytes: upload.bytes, sha256: upload.sha256, jetzt });
			});
			res.status(erfolgsStatus).json(antwort);
		} catch (fehler) {
			if (fehler instanceof Abbruch) return void res.status(fehler.status).json(fehler.antwort);
			throw fehler;
		}
	}

	/** Prueft das Kontingent unter der Sperre und wirft Abbruch(413), wenn die Datei nicht mehr passt. */
	async function pruefeKontingent(tx: VereinTx, vereinId: string, bytes: number, freiBytes: number): Promise<void> {
		// Die Grenze neu lesen: Der Plattform-Admin kann sie zwischen dem Laden des Vereins und hier geaendert haben.
		const { speicherGrenzeMb } = await tx.verein.findUniqueOrThrow({
			where: { id: vereinId },
			select: { speicherGrenzeMb: true },
		});
		const belegt = await verbrauchBytes(tx);
		if (!kontingentReicht({ verbrauchBytes: belegt - freiBytes, grenzeMb: speicherGrenzeMb, zusatzBytes: bytes })) {
			// Die Bytes liegen schon im Speicher und bleiben dort als Waise fuer den Aufraeumer: sie
			// hier zu loeschen waere ein Schreibzugriff auf die Platte mitten in der Sperre.
			throw new Abbruch(413, kontingentFehler(belegt, speicherGrenzeMb));
		}
	}

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
			const { verein, db } = vereinsKontext(res);
			const kategorieId = req.query['kategorie'];
			const kategorie =
				typeof kategorieId === 'string'
					? await db.dokumentKategorie.findFirst({ where: { id: kategorieId }, select: { id: true } })
					: null;
			if (!kategorie) {
				res.set('Connection', 'close');
				return statt404(res);
			}
			await nimmDatei(req, res, 201, 0, async (tx, e) => {
				// Die Kategorie kann zwischen dem Pruefen oben und der Sperre geloescht worden sein.
				if (!(await tx.dokumentKategorie.findFirst({ where: { id: kategorie.id }, select: { id: true } }))) {
					throw new Abbruch(404, NICHT_GEFUNDEN);
				}
				await pruefeKontingent(tx, verein.id, e.bytes, 0);
				// Der Titel ist der Name ohne Endung; faellt dabei etwas Unbrauchbares heraus (der Name
				// "x .pdf" haette ein Leerzeichen am Ende, das der CHECK der Datenbank ablehnt), hilft der
				// Standardtitel mehr als ein Fehler, den die Person nicht beheben kann.
				const titel = pruefeDokumentTitel(ohneEndung(e.name));
				const dokument = await tx.dokument.create({
					data: { kategorieId: kategorie.id, titel: titel.ok ? titel.titel : 'Dokument', angelegtAm: e.jetzt },
					select: { id: true, titel: true },
				});
				const datei = await tx.datei.create({
					data: {
						id: e.dateiId,
						art: 'DATEI',
						dokumentId: dokument.id,
						name: e.name,
						typ: e.typ,
						groesse: e.bytes,
						sha256: e.sha256,
						vonId: mitgliedKontext(res).person.id,
						hochgeladenAm: e.jetzt,
					},
					select: DATEI_FELDER,
				});
				return ansicht(dokument, datei);
			});
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
			const frei = dokument.dateien.reduce((summe, d) => summe + d.groesse, 0);
			await nimmDatei(req, res, 200, frei, async (tx, e) => {
				const aktuell = await tx.dokument.findFirst({
					where: { id: dokument.id },
					select: { id: true, titel: true, dateien: { select: { id: true, art: true, groesse: true } } },
				});
				if (!aktuell) throw new Abbruch(404, NICHT_GEFUNDEN);
				await pruefeKontingent(
					tx,
					verein.id,
					e.bytes,
					aktuell.dateien.reduce((summe, d) => summe + d.groesse, 0),
				);
				// Erst die alte Datei: Der Index laesst nur eine Datei je Dokument zu. Die alte ID liefert
				// danach 404, die neue Bytes; die alten Bytes liegen bis zum Aufraeumer noch da.
				await loescheDateien(tx, verein.id, aktuell.dateien, e.jetzt);
				const datei = await tx.datei.create({
					data: {
						id: e.dateiId,
						art: 'DATEI',
						dokumentId: aktuell.id,
						name: e.name,
						typ: e.typ,
						groesse: e.bytes,
						sha256: e.sha256,
						vonId: mitgliedKontext(res).person.id,
						hochgeladenAm: e.jetzt,
					},
					select: DATEI_FELDER,
				});
				return ansicht(aktuell, datei);
			});
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
				if (fehler instanceof Abbruch) return void res.status(fehler.status).json(fehler.antwort);
				throw fehler;
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
				if (fehler instanceof Abbruch) return void res.status(fehler.status).json(fehler.antwort);
				throw fehler;
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
				if (fehler instanceof Abbruch) return void res.status(fehler.status).json(fehler.antwort);
				throw fehler;
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
				if (fehler instanceof Abbruch) return void res.status(fehler.status).json(fehler.antwort);
				throw fehler;
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
				if (fehler instanceof Abbruch) return void res.status(fehler.status).json(fehler.antwort);
				throw fehler;
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
