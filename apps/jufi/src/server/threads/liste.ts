import {
	istArchiviert,
	monatAus,
	siehtThread,
	startAnsicht,
	termineImMonat,
	threadDatenAus,
	threadListe,
	threadSegment,
	type ListenThread,
	type StartAnsicht,
	type StartThread,
	type TerminEintrag,
	type TerminZeile,
	type ThreadListe,
} from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { ungueltigesFeld } from './eingabe.js';
import { NICHT_GEFUNDEN } from './fehler.js';
import { ladeNeuKandidaten, ladeThreads, ladeThreadUmfeld, type GeladenerThread, type NeuKandidaten } from './laden.js';

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
 * Der Monat der Anfrage: undefined, wenn er fehlt, kein Text ist (etwa weil der Parameter
 * wiederholt wurde) oder nicht 'JJJJ-MM' ist. Anders als die Suche ist er Pflicht: Ein
 * Kalender ohne Monat hat nichts zu zeigen, und "der aktuelle Monat" wuerde die Uhr des
 * Servers an die Stelle der Adresse setzen, die der Client geteilt und wieder geoeffnet haben will.
 */
function liesMonat(wert: unknown): { jahr: number; monat: number } | undefined {
	return typeof wert === 'string' ? (monatAus(wert) ?? undefined) : undefined;
}

/**
 * Ein geladener Thread mit den Kandidaten, die die Domaene fuer "neu" braucht. Eigene
 * Funktion, weil Liste und Start dieselbe Zuordnung brauchen und sie sonst an zwei Stellen
 * stuende; ohne Kandidaten (kein Eintrag) gilt: nie gelesen, nichts Neues.
 */
function alsListenThread(t: GeladenerThread, kandidaten: NeuKandidaten | undefined): ListenThread {
	return {
		kopf: t.kopf,
		module: t.module,
		letzteAktivitaetAm: t.letzteAktivitaetAm,
		gelesenBis: kandidaten?.gelesenBis ?? null,
		aenderungen: kandidaten?.aenderungen ?? [],
	};
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
			const threads = sichtbar.map((t) => alsListenThread(t, kandidaten.get(t.kopf.id)));
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

	/**
	 * GET /start: die drei Bloecke der Startseite in einer Antwort (Plan-Entscheidung 13).
	 * Verworfen: drei Routen, jede luede dieselben Threads. Was in welchem Block steht,
	 * entscheidet startAnsicht; die Route waehlt nur vor, fuer welche Threads sie Kandidaten
	 * laedt (sichtbar, veroeffentlicht, nicht archiviert, die Menge, die die Domaene ohnehin
	 * allein gelten laesst), damit Entwuerfe, Archiv und Jugendleiter-Threads keine Abfrage
	 * kosten. Die Regel bleibt in der Domaene: Wuerde die Vorauswahl einmal weiter, bliebe
	 * die Antwort richtig. Rein lesend.
	 */
	router.get(
		'/start',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { db } = vereinsKontext(res);
			const { person, zugang } = mitgliedKontext(res);
			const jetztWert = jetzt();
			const [umfeld, geladen] = await Promise.all([ladeThreadUmfeld(db), ladeThreads(db)]);
			const mich = umfeld.personen.get(person.id);
			if (!mich) return void res.status(404).json(NICHT_GEFUNDEN);

			const aktiv = geladen.filter(
				(t) =>
					t.kopf.veroeffentlichtAm !== null &&
					siehtThread(mich, t.kopf, umfeld) &&
					!istArchiviert(t.kopf, threadDatenAus(t.kopf, t.module).termine, jetztWert),
			);
			// Mit Nachrichten: Die Kurzangabe "2 neue Kommentare" braucht die ungelesenen Eintraege des Verlaufs.
			const kandidaten = await ladeNeuKandidaten(
				db,
				person.id,
				zugang.angelegtAm,
				aktiv.map((t) => t.kopf.id),
				true,
			);
			const threads = aktiv.map((t): StartThread => {
				const k = kandidaten.get(t.kopf.id);
				return {
					...alsListenThread(t, k),
					verlaufGelesenBis: k?.verlaufGelesenBis ?? null,
					nachrichten: k?.nachrichten ?? [],
				};
			});
			const start: StartAnsicht = startAnsicht({
				ich: mich,
				threads,
				umfeld,
				zugangSeit: zugang.angelegtAm,
				jetzt: jetztWert,
			});
			res.json(start);
		}),
	);

	/**
	 * GET /termine?monat=JJJJ-MM: die Termine, die den Monat beruehren, fuer die Kalenderseite.
	 * Veroeffentlicht und sichtbar, aber auch archivierte Threads (Plan-Entscheidung 6): ein
	 * vergangener Monat soll seine Termine behalten, und ein Termin ist nach der Karenz
	 * archiviert, also immer genau dann, wenn er vorbei ist. Keine Entwuerfe, auch nicht fuer
	 * Jugendleiter: der Kalender zeigt, was stattfindet. Die Auswahl ist ein Filter und eine
	 * Abbildung ohne eigene Regel, deshalb steht sie hier und nicht in der Domaene; Sichtbarkeit
	 * und Monat entscheiden siehtThread und termineImMonat. Der Monat wird vor jedem Laden geprueft.
	 */
	router.get(
		'/termine',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const monat = liesMonat(req.query['monat']);
			if (!monat) return void res.status(400).json(ungueltigesFeld('monat'));

			const { db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const [umfeld, geladen] = await Promise.all([ladeThreadUmfeld(db), ladeThreads(db)]);
			const mich = umfeld.personen.get(person.id);
			if (!mich) return void res.status(404).json(NICHT_GEFUNDEN);

			const eintraege: TerminEintrag[] = geladen
				.filter((t) => t.kopf.veroeffentlichtAm !== null && siehtThread(mich, t.kopf, umfeld))
				.flatMap((t) =>
					threadDatenAus(t.kopf, t.module).termine.map((termin) => ({
						threadId: t.kopf.id,
						titel: t.kopf.titel,
						termin,
					})),
				);
			const termine = termineImMonat(eintraege, monat.jahr, monat.monat).map((e): TerminZeile => ({
				threadId: e.threadId,
				segment: threadSegment(e.threadId, e.titel),
				titel: e.titel,
				termin: e.termin,
			}));
			res.json({ termine });
		}),
	);
}
