import { sperreVereinszeile } from '@jufi/db';
import {
	darfEinwilligen,
	darfFuerKindHandeln,
	EINWILLIGUNG_TEXT_VERSION,
	istErziehungsberechtigt,
	istVolljaehrig,
} from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';
import { alsSicht } from './verwaltung.js';
import {
	Abbruch,
	EINWILLIGUNG_FEHLT,
	entzieheZugang,
	entzieheZugangWennUngueltig,
	erzeugeEinladungFuerKind,
	hatEinwilligung,
	type Transaktion,
} from './zugang.js';

const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

/**
 * Ob der Angemeldete fuer dieses Kind einwilligen und den Zugang steuern darf, mit allem
 * frisch gelesen. Wird unter sperreVereinszeile aufgerufen: ob die Aktion angenommen
 * wird, haengt an Handelndem, Kind und Zuordnungen, und jedes davon kann eine gleichzeitige
 * Anfrage aendern (Familie loesen, Entfernen, Einloesen -- wie in rechte.ts). Die Vorab-
 * Pruefung aus der Sitzung zaehlt nicht.
 *
 * darfEinwilligen schliesst Entfernte, Nicht-Erziehungsberechtigte und Volljaehrige aus
 * (Spec 5.6): fuer all das ist das Kind "nicht gefunden" (404, Rahmen-Spec 8). Verworfen:
 * nur darfFuerKindHandeln zu verlangen -- die Grossmutter duerfte dann den Zugang
 * des Enkels steuern, und das volljaehrig gewordene Kind stuende weiter unter der Mutter.
 */
async function ladeErziehungsberechtigt(tx: Transaktion, handelndenId: string, kindId: string, zeit: Date) {
	const [ich, kind] = await Promise.all([
		tx.person.findFirst({ where: { id: handelndenId, art: 'ERWACHSENER', entferntAm: null } }),
		tx.person.findFirst({
			where: { id: kindId, art: 'JUNGFISCHER', entferntAm: null },
			include: { zugang: { select: { id: true } } },
		}),
	]);
	if (!ich || !kind) throw new Abbruch(404, NICHT_GEFUNDEN);
	const zuordnungen = await tx.bezugsperson.findMany({ where: { jungfischerId: kind.id } });
	if (!darfEinwilligen(alsSicht(ich), alsSicht(kind), zuordnungen, zeit)) throw new Abbruch(404, NICHT_GEFUNDEN);
	return { ich, kind };
}

function lesBoolean(body: unknown, feld: string): boolean {
	const wert = ((body ?? {}) as Record<string, unknown>)[feld];
	if (typeof wert !== 'boolean') throw new Abbruch(400, { fehler: 'Ja oder nein erwartet', feld });
	return wert;
}

export function jungfischerRouten(router: Router, deps: Pick<VolleAppDeps, 'jetzt' | 'umgebung'>): void {
	const { jetzt, umgebung } = deps;

	/** Gemeinsamer Rahmen der Schreib-Routen: Sperre, Entscheidung, Abbruch als Antwort. */
	async function unterSperre<T>(
		res: Parameters<typeof vereinsKontext>[0],
		arbeit: (tx: Transaktion, verein: { slug: string; anzeigename: string }) => Promise<T>,
	): Promise<{ status: number; antwort: object } | { ok: T }> {
		const { verein, db } = vereinsKontext(res);
		try {
			return {
				ok: await db.$transaction(async (tx) => {
					await sperreVereinszeile(tx, verein.id);
					// Erneut gelesen: der Slug steht im Link, und der Admin kann ihn zwischen vereinAusSlug
					// und der Sperre korrigiert oder den Verein gesperrt haben.
					const stand = await tx.verein.findFirst({ select: { slug: true, anzeigename: true, status: true } });
					if (!stand || stand.status !== 'AKTIV') throw new Abbruch(404, NICHT_GEFUNDEN);
					return arbeit(tx, stand);
				}),
			};
		} catch (error) {
			if (error instanceof Abbruch) return { status: error.status, antwort: error.antwort };
			throw error;
		}
	}

	router.get(
		'/meine-jungfischer',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { person: ich } = mitgliedKontext(res);
			const { db } = vereinsKontext(res);
			const zeit = jetzt();
			// Eine Transaktion, damit hatEinwilligung dieselbe Frage stellt wie beim Schreiben.
			const kinder = await db.$transaction(async (tx) => {
				const eigene = await tx.bezugsperson.findMany({
					where: { erwachsenerId: ich.id, jungfischer: { entferntAm: null, art: 'JUNGFISCHER' } },
					include: {
						jungfischer: { include: { zugang: { select: { id: true } } } },
					},
				});
				const ergebnis = [];
				for (const z of eigene) {
					const kind = z.jungfischer;
					if (!darfFuerKindHandeln(alsSicht(ich), alsSicht(kind), [z])) continue;
					const [familie, gruppen] = await Promise.all([
						tx.bezugsperson.findMany({
							where: { jungfischerId: kind.id, erwachsener: { entferntAm: null } },
							include: { erwachsener: { select: { vorname: true, nachname: true } } },
							orderBy: [{ angelegtAm: 'asc' }, { id: 'asc' }],
						}),
						tx.untergruppeMitglied.findMany({
							where: { personId: kind.id },
							select: { untergruppe: { select: { id: true, name: true } } },
						}),
					]);
					// Feld fuer Feld aufgebaut: keine E-Mail und keine Rechte fremder Familienmitglieder.
					ergebnis.push({
						id: kind.id,
						vorname: kind.vorname,
						nachname: kind.nachname,
						jugendsprecher: kind.jugendsprecher,
						untergruppen: gruppen.map((g) => g.untergruppe).sort((a, b) => a.name.localeCompare(b.name, 'de')),
						familie: familie.map((f) => ({
							vorname: f.erwachsener.vorname,
							nachname: f.erwachsener.nachname,
							beziehung: f.beziehung,
							beziehungFreitext: f.beziehungFreitext,
						})),
						zugang: {
							erlaubt: kind.zugangErlaubt,
							vorhanden: kind.zugang !== null,
							einwilligungGueltig: await hatEinwilligung(tx, kind, zeit),
						},
						ichBinErziehungsberechtigt: istErziehungsberechtigt(z, alsSicht(kind), zeit),
						volljaehrig: istVolljaehrig(kind, zeit),
					});
				}
				return ergebnis.sort(
					(a, b) => a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de'),
				);
			});
			res.json({ kinder });
		}),
	);

	router.post(
		'/meine-jungfischer/:kindId/zugang',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			const kindId = req.params['kindId'] ?? '';
			const zeit = jetzt();
			const r = await unterSperre(res, async (tx) => {
				const { kind } = await ladeErziehungsberechtigt(tx, handelnder.id, kindId, zeit);
				const erlaubt = lesBoolean(req.body, 'erlaubt');
				if (!erlaubt) {
					await entzieheZugang(tx, kind.id);
				} else {
					if (!(await hatEinwilligung(tx, kind, zeit))) throw new Abbruch(409, EINWILLIGUNG_FEHLT);
					await tx.person.update({ where: { id: kind.id }, data: { zugangErlaubt: true } });
				}
				return { erlaubt };
			});
			if ('ok' in r) return void res.json(r.ok);
			res.status(r.status).json(r.antwort);
		}),
	);

	router.post(
		'/meine-jungfischer/:kindId/einladung',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			const kindId = req.params['kindId'] ?? '';
			const zeit = jetzt();
			const r = await unterSperre(res, async (tx, stand) => {
				const { ich, kind } = await ladeErziehungsberechtigt(tx, handelnder.id, kindId, zeit);
				// Das Kind hat meist keine Adresse und die Familie reicht den Link selbst weiter: keine Mail.
				return erzeugeEinladungFuerKind(tx, { ich, ziel: kind, stand, mail: false, zeit, basisUrl: umgebung.basisUrl });
			});
			if ('ok' in r) return void res.status(201).json(r.ok);
			res.status(r.status).json(r.antwort);
		}),
	);

	router.post(
		'/meine-jungfischer/:kindId/einwilligung',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			const kindId = req.params['kindId'] ?? '';
			const zeit = jetzt();
			const r = await unterSperre(res, async (tx) => {
				const { ich, kind } = await ladeErziehungsberechtigt(tx, handelnder.id, kindId, zeit);
				const erteilen = lesBoolean(req.body, 'erteilen');
				if (erteilen) {
					// Eine offene reicht: ein zweiter Klick soll keine zweite Zeile als Nachweis erzeugen.
					const offen = await tx.einwilligung.count({
						where: { jungfischerId: kind.id, erteiltVon: ich.id, widerrufenAm: null },
					});
					if (offen === 0) {
						await tx.einwilligung.create({
							data: {
								jungfischerId: kind.id,
								erteiltVon: ich.id,
								art: 'DSGVO_ART8',
								textVersion: EINWILLIGUNG_TEXT_VERSION,
								erteiltAm: zeit,
							},
						});
					}
				} else {
					// Nur die eigenen: die Einwilligung des Vaters widerruft die Mutter nicht. Die Zeilen
					// bleiben als Nachweis stehen, verworfen: sie zu loeschen.
					await tx.einwilligung.updateMany({
						where: { jungfischerId: kind.id, erteiltVon: ich.id, widerrufenAm: null },
						data: { widerrufenAm: zeit },
					});
					await entzieheZugangWennUngueltig(tx, kind, zeit);
				}
				return { erteilt: erteilen };
			});
			if ('ok' in r) return void res.json(r.ok);
			res.status(r.status).json(r.antwort);
		}),
	);
}
