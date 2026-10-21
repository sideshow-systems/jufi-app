import { siehtThread, threadListe, type ListenThread, type ThreadListe } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { ungueltigesFeld } from './eingabe.js';
import { NICHT_GEFUNDEN } from './fehler.js';
import { ladeNeuKandidaten, ladeThreads, ladeThreadUmfeld } from './laden.js';

const SUCHE_MAX = 100;

/**
 * Der Suchtext der Anfrage: null ohne Suche, sonst die Zeichenkette; undefined, wenn er
 * ungueltig ist (kein Text, etwa weil der Parameter wiederholt wurde, oder laenger als
 * SUCHE_MAX Zeichen). Gemessen wird der getrimmte Text, wie ihn threadListe benutzt: Ein
 * Leerzeichen am Rand einer Eingabe mit 100 Zeichen soll keine 400 machen.
 */
function liesSuche(wert: unknown): string | null | undefined {
	if (wert === undefined) return null;
	if (typeof wert !== 'string' || [...wert.trim()].length > SUCHE_MAX) return undefined;
	return wert;
}

/**
 * GET /threads?suche=&archiv=1: die Thread-Liste der Person (Spec 6.5). Was sie sieht, ob
 * ein Thread neu ist, was zur Suche passt und was archiviert ist, entscheidet threadListe;
 * die Route laedt nur und verwirft nichts selbst. Rein lesend: kein Gelesen-Stand, keine Aenderung.
 */
export function listeRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt } = deps;

	router.get(
		'/threads',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const suche = liesSuche(req.query['suche']);
			if (suche === undefined) return void res.status(400).json(ungueltigesFeld('suche'));
			const mitArchiv = req.query['archiv'] === '1';

			const { db } = vereinsKontext(res);
			const { person, zugang } = mitgliedKontext(res);
			const [umfeld, geladen] = await Promise.all([ladeThreadUmfeld(db), ladeThreads(db)]);
			const mich = umfeld.personen.get(person.id);
			if (!mich) return void res.status(404).json(NICHT_GEFUNDEN);

			// Kandidaten nur fuer Threads, die die Person sieht: Aenderungen an Entwuerfen und
			// Jugendleiter-Threads, die sie nie zu Gesicht bekommt, brauchen keine Abfrage. Die
			// Sichtbarkeit entscheidet siehtThread, dieselbe Regel, die threadListe danach noch
			// einmal anlegt; die Route hat keine eigene.
			const sichtbar = geladen.filter((t) => siehtThread(mich, t.kopf, umfeld));
			const kandidaten = await ladeNeuKandidaten(
				db,
				person.id,
				zugang.angelegtAm,
				sichtbar.map((t) => t.kopf.id),
				false,
			);
			const threads: ListenThread[] = sichtbar.map((t) => ({
				kopf: t.kopf,
				module: t.module,
				letzteAktivitaetAm: t.letzteAktivitaetAm,
				gelesenBis: kandidaten.get(t.kopf.id)?.gelesenBis ?? null,
				aenderungen: kandidaten.get(t.kopf.id)?.aenderungen ?? [],
			}));
			const liste: ThreadListe = threadListe({
				ich: mich,
				threads,
				umfeld,
				zugangSeit: zugang.angelegtAm,
				suche,
				mitArchiv,
				jetzt: jetzt(),
			});
			res.json(liste);
		}),
	);
}
