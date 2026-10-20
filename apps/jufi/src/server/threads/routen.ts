import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { NICHT_GEFUNDEN } from './fehler.js';
import { darfThreadSehen, ladeThreadAnsicht, setzeGelesen, type GelesenBereich } from './lesen.js';

const BEREICHE: readonly GelesenBereich[] = ['uebersicht', 'verlauf'];

/** `bis` ist ein Vereinsstand: eine ganze Zahl ab 0. Alles andere, auch ein Text wie "5", ist ungueltig. */
function liesGelesen(body: unknown): { bereich: GelesenBereich; bis: number } | null {
	if (typeof body !== 'object' || body === null) return null;
	const { bereich, bis } = body as { bereich?: unknown; bis?: unknown };
	if (typeof bereich !== 'string' || !(BEREICHE as readonly string[]).includes(bereich)) return null;
	if (typeof bis !== 'number' || !Number.isSafeInteger(bis) || bis < 0) return null;
	return { bereich: bereich as GelesenBereich, bis };
}

/**
 * Lesende Thread-Routen und der Gelesen-Stand. Die schreibenden Routen (Nachrichten,
 * Antworten) kommen in Task 6 und 7 dazu. Alle haengen direkt am Router: routenAus lehnt
 * Unter-Router ab.
 */
export function threadRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt } = deps;

	router.get(
		'/threads/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person, zugang } = mitgliedKontext(res);
			const ansicht = await ladeThreadAnsicht(
				db,
				verein.id,
				person,
				zugang.angelegtAm,
				req.params['id'] ?? '',
				jetzt(),
			);
			// Unbekannt und unsichtbar sind dieselbe Antwort (Rahmen-Spec 8).
			if (!ansicht) return void res.status(404).json(NICHT_GEFUNDEN);
			res.json(ansicht);
		}),
	);

	router.put(
		'/threads/:id/gelesen',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person, zugang } = mitgliedKontext(res);
			// Der Koerper wird zuerst geprueft: die 400 haengt nicht vom Thread ab und verraet
			// ueber ihn nichts.
			const eingabe = liesGelesen(req.body);
			if (!eingabe) return void res.status(400).json({ fehler: 'Ungültige Anfrage' });
			const threadId = req.params['id'] ?? '';
			if (!(await darfThreadSehen(db, person.id, threadId))) return void res.status(404).json(NICHT_GEFUNDEN);
			await setzeGelesen(db, verein.id, person.id, zugang.angelegtAm, threadId, eingabe.bereich, eingabe.bis, jetzt());
			res.status(204).end();
		}),
	);
}
