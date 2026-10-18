import { sperreVereinszeile } from '@jufi/db';
import { beziehungVorbelegung, hatRecht, istJugendleiter, type Beziehung } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron, text } from '../admin/asynchron.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';
import { statt404 } from './verwaltung.js';
import { entzieheZugangWennUngueltig } from './zugang.js';

const BEZIEHUNGEN: readonly Beziehung[] = [
	'MUTTER',
	'VATER',
	'GROSSMUTTER',
	'GROSSVATER',
	'TANTE',
	'ONKEL',
	'GESCHWISTER',
	'PFLEGEPERSON',
	'ANDERE',
];
const FREITEXT_MAX = 100;

/** Ende einer Entscheidung unter der Sperre; innerhalb der Transaktion geworfen, damit nichts halb bleibt. */
class Abbruch extends Error {
	constructor(
		readonly status: number,
		readonly antwort: object,
	) {
		super('Familie abgebrochen');
	}
}
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

function ungueltig(fehler: string, feld: string): Abbruch {
	return new Abbruch(400, { fehler, feld });
}

export function familieRouten(router: Router, deps: VolleAppDeps): void {
	router.put(
		'/personen/:jungfischerId/familie/:erwachsenerId',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			if (!hatRecht(handelnder, 'MITGLIEDER')) return statt404(res);
			const { verein, db } = vereinsKontext(res);
			const kindId = req.params['jungfischerId'] ?? '';
			const erwId = req.params['erwachsenerId'] ?? '';
			const body = (req.body ?? {}) as Record<string, unknown>;
			try {
				const antwort = await db.$transaction(async (tx) => {
					// Angenommen oder nicht haengt an Rechten und Entfernt-Stand beider Personen; die
					// Sperre haelt gleichzeitiges Entfernen oder Rechtevergeben an, bis hier fertig ist.
					await sperreVereinszeile(tx, verein.id);
					const [kind, erw] = await Promise.all([
						tx.person.findFirst({ where: { id: kindId, art: 'JUNGFISCHER', entferntAm: null } }),
						tx.person.findFirst({ where: { id: erwId, art: 'ERWACHSENER', entferntAm: null } }),
					]);
					// Eine Person mit Rechten verknuepft nur, wer Rechte verwalten darf; 404 statt 403,
					// sonst verriete die Antwort, wer Jugendleiter ist (wie PATCH /personen/:id).
					if (!kind || !erw || (istJugendleiter(erw) && !hatRecht(handelnder, 'JUGENDLEITER_RECHTE'))) {
						throw new Abbruch(404, NICHT_GEFUNDEN);
					}

					const beziehung = body['beziehung'];
					if (typeof beziehung !== 'string' || !BEZIEHUNGEN.includes(beziehung as Beziehung)) {
						throw ungueltig('Bitte eine Beziehung wählen', 'beziehung');
					}
					const art = beziehung as Beziehung;
					// Wie der CHECK bezugsperson_freitext: Freitext genau bei ANDERE, dort Pflicht. Bei
					// anderen Beziehungen wird ein mitgeschickter Freitext verworfen statt abgelehnt, damit
					// ein Formular, das beim Umschalten den alten Text stehen laesst, nicht scheitert.
					const roh = text(body['beziehungFreitext']).trim();
					if (art === 'ANDERE' && (roh === '' || roh.length > FREITEXT_MAX)) {
						throw ungueltig(`Bitte die Beziehung beschreiben (1 bis ${FREITEXT_MAX} Zeichen)`, 'beziehungFreitext');
					}
					const beziehungFreitext = art === 'ANDERE' ? roh : null;

					const angabe = body['erziehungsberechtigt'];
					if (angabe !== undefined && typeof angabe !== 'boolean') {
						throw ungueltig('Ja oder nein erwartet', 'erziehungsberechtigt');
					}
					const erziehungsberechtigt = angabe ?? beziehungVorbelegung(art);

					// Find-then-write unter der Sperre statt upsert: die Sperre serialisiert ohnehin, und
					// upsert ueber den zusammengesetzten Unique-Schluessel kennt vereinDb nicht.
					const vorhanden = await tx.bezugsperson.findFirst({ where: { erwachsenerId: erwId, jungfischerId: kindId } });
					const daten = { beziehung: art, beziehungFreitext, erziehungsberechtigt };
					if (vorhanden) {
						await tx.bezugsperson.update({ where: { id: vorhanden.id }, data: daten });
					} else {
						await tx.bezugsperson.create({ data: { erwachsenerId: erwId, jungfischerId: kindId, ...daten } });
					}
					// Ein Wechsel von true auf false nimmt dem Kind womoeglich die Einwilligung.
					if (vorhanden?.erziehungsberechtigt && !erziehungsberechtigt) {
						await entzieheZugangWennUngueltig(tx, kind, deps.jetzt());
					}
					return { erziehungsberechtigt };
				});
				res.json(antwort);
			} catch (error) {
				if (error instanceof Abbruch) return void res.status(error.status).json(error.antwort);
				throw error;
			}
		}),
	);

	router.delete(
		'/personen/:jungfischerId/familie/:erwachsenerId',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			if (!hatRecht(handelnder, 'MITGLIEDER')) return statt404(res);
			const { verein, db } = vereinsKontext(res);
			const kindId = req.params['jungfischerId'] ?? '';
			const erwId = req.params['erwachsenerId'] ?? '';
			try {
				await db.$transaction(async (tx) => {
					await sperreVereinszeile(tx, verein.id);
					const [kind, erw] = await Promise.all([
						tx.person.findFirst({ where: { id: kindId, art: 'JUNGFISCHER', entferntAm: null } }),
						tx.person.findFirst({ where: { id: erwId, art: 'ERWACHSENER', entferntAm: null } }),
					]);
					if (!kind || !erw || (istJugendleiter(erw) && !hatRecht(handelnder, 'JUGENDLEITER_RECHTE'))) {
						throw new Abbruch(404, NICHT_GEFUNDEN);
					}
					// Idempotent: deleteMany meldet auch "nichts da" ohne Fehler.
					const geloest = await tx.bezugsperson.deleteMany({ where: { erwachsenerId: erwId, jungfischerId: kindId } });
					if (geloest.count > 0) await entzieheZugangWennUngueltig(tx, kind, deps.jetzt());
				});
				res.status(204).end();
			} catch (error) {
				if (error instanceof Abbruch) return void res.status(error.status).json(error.antwort);
				throw error;
			}
		}),
	);
}
