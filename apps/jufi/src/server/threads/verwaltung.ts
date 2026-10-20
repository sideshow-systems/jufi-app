import {
	antwortenUebersicht,
	hatRecht,
	istJugendleiter,
	threadDatenAus,
	verwaltungThread,
	type VerwaltungListe,
} from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { ladeBearbeitung, ladeUntergruppen } from './bearbeitung.js';
import { NICHT_GEFUNDEN } from './fehler.js';
import { ladeThread, ladeThreads, ladeThreadUmfeld } from './laden.js';

/**
 * Die lesenden Routen der Verwaltung: GET /verwaltung/threads, GET /threads/:id/bearbeitung
 * und GET /threads/:id/antworten. Alle drei sind fuer Jugendleiter da; wer sie nicht benutzen
 * darf, bekommt dieselbe 404 wie bei etwas, das es nicht gibt (Rahmen-Spec 8).
 */
export function verwaltungRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt } = deps;

	router.get(
		'/verwaltung/threads',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const umfeld = await ladeThreadUmfeld(db);
			const mich = umfeld.personen.get(person.id);
			if (!mich || !istJugendleiter(mich)) return void res.status(404).json(NICHT_GEFUNDEN);

			const [geladen, untergruppen] = await Promise.all([ladeThreads(db), ladeUntergruppen(db)]);
			const namen = new Map(untergruppen.map((g) => [g.id, g.name]));
			const zeit = jetzt();
			const liste: VerwaltungListe = {
				// Alle Threads des Vereins, auch fremde Entwuerfe und der Austausch: die Liste ist die
				// Uebersicht der Jugendleiter, bearbeiten duerfen sie nur, was darfBearbeiten sagt.
				threads: geladen.map((t) => verwaltungThread(mich, threadDatenAus(t.kopf, t.module), namen, zeit)),
				untergruppen,
				darfErstellen: hatRecht(mich, 'THREADS_ERSTELLEN') || hatRecht(mich, 'ALLE_THREADS'),
			};
			res.json(liste);
		}),
	);

	router.get(
		'/threads/:id/bearbeitung',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const umfeld = await ladeThreadUmfeld(db);
			const mich = umfeld.personen.get(person.id);
			if (!mich) return void res.status(404).json(NICHT_GEFUNDEN);
			const bearbeitung = await ladeBearbeitung(db, mich, req.params['id'] ?? '', umfeld, jetzt());
			if (!bearbeitung) return void res.status(404).json(NICHT_GEFUNDEN);
			res.json(bearbeitung);
		}),
	);

	router.get(
		'/threads/:id/antworten',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const [umfeld, geladen] = await Promise.all([ladeThreadUmfeld(db), ladeThread(db, req.params['id'] ?? '')]);
			const mich = umfeld.personen.get(person.id);
			if (!mich || !geladen) return void res.status(404).json(NICHT_GEFUNDEN);
			const uebersicht = antwortenUebersicht(mich, threadDatenAus(geladen.kopf, geladen.module), umfeld, jetzt());
			if (!uebersicht) return void res.status(404).json(NICHT_GEFUNDEN);
			res.json(uebersicht);
		}),
	);
}
