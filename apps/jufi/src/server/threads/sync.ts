import { syncAntwort, type SyncAntwort } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { ungueltigesFeld } from './eingabe.js';
import { NICHT_GEFUNDEN } from './fehler.js';
import { ladeKoepfe, ladeThreadUmfeld, ladeVereinsstand } from './laden.js';

/**
 * Groesster Stand, den die Datenbank kennt: Aenderung.stand und Verein.aenderungsstand sind
 * INT4, ein Vergleich mit mehr wirft in Prisma ("Value out of range") und wuerde 500.
 */
const STAND_MAX = 2_147_483_647;

/**
 * Der Stand, ab dem der Client wissen will, was sich geaendert hat: null ohne Parameter,
 * undefined, wenn er ungueltig ist. Gueltig sind nur Ziffern, die eine Zahl bis STAND_MAX
 * ergeben: parseInt und Number nahmen auch "1.5abc", "1e3" oder " 7" an. Die Grenze ist die
 * Spalte der Datenbank, nicht die sichere ganze Zahl von JavaScript; kein echter Client kann
 * einen groesseren Stand halten. Verworfen: auf STAND_MAX kappen -- Unsinn bekaeme dann die
 * Antwort "vollstaendig" statt eines Fehlers. Ein wiederholter Parameter kommt als Array an
 * und ist damit kein Text.
 */
function liesSeit(wert: unknown): number | null | undefined {
	if (wert === undefined) return null;
	if (typeof wert !== 'string' || !/^\d+$/.test(wert)) return undefined;
	const zahl = Number(wert);
	return zahl <= STAND_MAX ? zahl : undefined;
}

/**
 * GET /sync?seit=n: was sich seit dem Stand n fuer die Person geaendert hat (Plan-Entscheidung 6).
 * Die Route sammelt nur die Eingaben, die Entscheidung trifft syncAntwort: Welche Threads
 * seit n angefasst wurden, ob die Person sie sieht, und ob die Luecke im Verlauf ein
 * vollstaendiges Neuladen verlangt. Rein lesend: kein Gelesen-Stand, keine Aenderung.
 *
 * Der Vereinsstand wird zuerst gelesen (siehe ladeVereinsstand): Was danach geladen wird,
 * ist mindestens so neu wie er, ein Client, der ihn als gesehen uebernimmt, hat also keine
 * Aenderung uebersprungen. Dass die Antwort Aenderungen enthalten kann, die juenger sind als
 * ihr Stand, kostet hoechstens eine ueberfluessige Meldung beim naechsten Sync, nie eine verpasste.
 */
export function syncRouten(router: Router, _deps: VolleAppDeps): void {
	router.get(
		'/sync',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const seit = liesSeit(req.query['seit']);
			if (seit === undefined) return void res.status(400).json(ungueltigesFeld('seit'));

			const { db, verein } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const stand = await ladeVereinsstand(db, verein.id);

			// Ohne seit antwortet syncAntwort ohnehin vollstaendig: Dann braucht es keine Abfrage der Aenderungen.
			const [geaendert, aelteste, umfeld] = await Promise.all([
				seit === null
					? []
					: db.aenderung.findMany({
							where: { stand: { gt: seit } },
							select: { threadId: true },
							distinct: ['threadId'],
						}),
				db.aenderung.aggregate({ _min: { stand: true } }),
				ladeThreadUmfeld(db),
			]);
			const mich = umfeld.personen.get(person.id);
			if (!mich) return void res.status(404).json(NICHT_GEFUNDEN);

			const threadIds = geaendert.map((z) => z.threadId);
			const koepfe = await ladeKoepfe(
				db,
				threadIds.filter((id): id is string => id !== null),
			);
			const antwort: SyncAntwort = syncAntwort({
				ich: mich,
				umfeld,
				koepfe,
				seit,
				stand,
				aeltesterStand: aelteste._min.stand,
				threadIds,
			});
			res.json(antwort);
		}),
	);
}
