import { mitAenderung, type AenderungEingabe, type VereinTx } from '@jufi/db';
import { darfEinsetzen, darfHerausnehmen, hatPlatzIn, type AutoDaten, type Richtung } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { zuVieleVersuche } from '../admin/versuche.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { liesClientId, ungueltigesFeld } from './eingabe.js';
import { abbruchAus, antworteMitFahrtAnsicht, fahrtAntwort, ladeFahrtLage, type FahrtLage } from './fahrt-gemeinsam.js';
import {
	antworteThreadFehler,
	AUTO_VOLL,
	CLIENT_ID_VERGEBEN,
	NICHT_GEFUNDEN,
	ThreadAbbruch,
	Wiederholung,
} from './fehler.js';
import { modulOrt } from './laden.js';

/*
 * Kinder in Autos einsetzen, auf "kommt selbst" setzen und herausnehmen (TP4 Etappe 4, Spec 6
 * und 8). Gebaut wie helfer.ts und autos.ts; die Gruende fuer Reihenfolge, Wiederholung,
 * Neupruefung unter der Sperre und den P2002-Zweig stehen dort und in antworten.ts. Hier nur,
 * was anders ist.
 *
 * PUT: Rate-Limit (429), autoId und clientId (400), Fahrgemeinschaft als FAHRT, Thread, Richtung
 * und Recht fuer das Kind (404; auch ein Auto, das nicht in dieser Richtung dieser Fahrgemeinschaft
 * steht), Wiederholung ueber die clientId (200 oder 409 CLIENT_ID_VERGEBEN), Entwurf, Archiv und
 * fehlende Zusage (409), schon im selben Auto (200 ohne Schreiben, Plan-Entscheidung 5), kein
 * freier Platz (409 VOLL), dann mitAenderung mit denselben Pruefungen auf dem Stand unter der Sperre.
 * Der Platz ist die eigentliche Pruefung unter der Sperre (Review Focus 1): Zwei Familien
 * bestehen beide die Vorpruefung um den letzten Platz, aber nur die erste findet ihn dort noch
 * frei. Die Wiederholung steht vor den 409, damit eine Outbox, die ein gelungenes Einsetzen
 * nach dem Archivieren wiederholt, 200 bekommt.
 *
 * Die Mitfahrt ist ein Upsert je (Fahrgemeinschaft, Richtung, Kind): Ein Wechsel des Autos
 * ueberschreibt Auto, Einsteller, clientId und Zeit, denn die Reihenfolge im Auto ist die des
 * Einsteigens. Verworfen: erst loeschen, dann anlegen -- zwei Schreibvorgaenge, in denen das
 * Kind zwischendurch fehlte, und eine zweite Zeile in der Aenderungsliste.
 *
 * DELETE: Rate-Limit, Fahrgemeinschaft und Richtung (404), dann das Recht: mit Mitfahrt
 * darfHerausnehmen, ohne sie darfEinsetzen ohne die Zusage-Pruefung (Spec 6.2: Herausnehmen geht
 * immer, auch fuer ein Kind, das inzwischen abgesagt hat). 404 und 409 ENTWURF/ARCHIVIERT stehen
 * vor dem stillen 200 ohne Mitfahrt (Entscheidung 6; das DELETE hat keine clientId, die
 * Wiederholung erkennt der Server an der fehlenden Zeile), damit dieses 200 nichts ueber eine
 * fremde Zeile verraet. Ist die Mitfahrt erst unter der Sperre weg, war ein gleichzeitiges
 * DELETE schneller: Wiederholung, auch wenn Archiv oder Entwurf inzwischen greifen.
 */

/** Was eine Mitfahrtzeile fuer die Pruefung einer Wiederholung verraten muss. */
const AUSWAHL = { modulId: true, richtung: true, kindId: true, autoId: true } as const;

type Vorhanden = { modulId: string; richtung: Richtung; kindId: string; autoId: string | null };

/** :richtung steht klein in der Adresse; jeder andere Wert gibt es nicht (404). */
function liesRichtung(wert: string | undefined): Richtung | null {
	return wert === 'hin' ? 'HIN' : wert === 'rueck' ? 'RUECK' : null;
}

function richtungAn(lage: FahrtLage, richtung: Richtung): boolean {
	return richtung === 'HIN' ? lage.modul.fahrt.hin : lage.modul.fahrt.rueck;
}

function mitfahrtVon(lage: FahrtLage, richtung: Richtung, kindId: string) {
	return lage.modul.fahrt.mitfahrten.find((m) => m.richtung === richtung && m.kindId === kindId);
}

/**
 * Die 404 des Einsetzens, an einer Stelle fuer vor und unter der Sperre: eine Richtung, die die
 * Fahrgemeinschaft nicht hat, kein Recht fuer das Kind und ein Auto, das nicht in dieser Richtung
 * dieser Fahrgemeinschaft steht. Alle sehen gleich aus (Rahmen-Spec 8). Liefert das Auto mit.
 */
function sichtPruefung(
	lage: FahrtLage,
	richtung: Richtung,
	kindId: string,
	autoId: string | null,
	zeit: Date,
): ThreadAbbruch | { auto: AutoDaten | null } {
	const nichtDa = new ThreadAbbruch(404, NICHT_GEFUNDEN);
	if (!richtungAn(lage, richtung)) return nichtDa;
	if (darfEinsetzen(lage.mich, kindId, lage.daten, lage.umfeld, zeit) === 'NICHT_GEFUNDEN') return nichtDa;
	if (autoId === null) return { auto: null };
	const auto = lage.modul.fahrt.autos.find((a) => a.id === autoId && a.richtung === richtung);
	return auto ? { auto } : nichtDa;
}

/**
 * Die 409 des Einsetzens: Entwurf, Archiv und fehlende Zusage aus den Regeln, dann "sitzt schon
 * dort" (kein Fehler, aber nichts zu schreiben) und der Platz. Das Kind, das schon im Auto sitzt,
 * besteht den Platz ohnehin (hatPlatzIn), steht aber vor ihm, damit die Stille nicht von der
 * Auslastung abhaengt.
 */
function konfliktPruefung(
	lage: FahrtLage,
	richtung: Richtung,
	kindId: string,
	auto: AutoDaten | null,
	zeit: Date,
): ThreadAbbruch | 'SCHON_DA' | null {
	const ende = abbruchAus(darfEinsetzen(lage.mich, kindId, lage.daten, lage.umfeld, zeit));
	if (ende) return ende;
	const vorhanden = mitfahrtVon(lage, richtung, kindId);
	if (vorhanden && (vorhanden.autoId ?? null) === (auto?.id ?? null)) return 'SCHON_DA';
	if (auto && !hatPlatzIn(auto, lage.modul.fahrt, kindId)) return new ThreadAbbruch(409, AUTO_VOLL);
	return null;
}

/**
 * Das Recht am DELETE vor der Sperre, wenn es die Mitfahrt gibt: die Leitung, der Fahrer des
 * Autos und wer fuer das Kind handelt (darfHerausnehmen). Ohne Mitfahrt gilt darfEinsetzen ohne die
 * Zusage-Pruefung: Wer ein nicht mehr betrachtetes Kind nicht einsetzen duerfte, darf es
 * trotzdem herausnehmen, und wer es nicht fuehren darf, bekommt 404.
 */
function herausnehmPruefung(
	lage: FahrtLage,
	richtung: Richtung,
	kindId: string,
	zeit: Date,
): ThreadAbbruch | 'KEINE_MITFAHRT' | null {
	if (!richtungAn(lage, richtung)) return new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const mitfahrt = mitfahrtVon(lage, richtung, kindId);
	if (mitfahrt)
		return abbruchAus(darfHerausnehmen(lage.mich, mitfahrt, lage.modul.fahrt, lage.daten, lage.umfeld, zeit));
	const erlaubnis = darfEinsetzen(lage.mich, kindId, lage.daten, lage.umfeld, zeit);
	return abbruchAus(erlaubnis === 'NICHT_DABEI' ? 'ERLAUBT' : erlaubnis) ?? 'KEINE_MITFAHRT';
}

/**
 * Wie urteil in helfer.ts: dasselbe Modul, dieselbe Richtung, dasselbe Kind und dasselbe Auto ist
 * eine Wiederholung, alles andere eine fremde clientId. Weil der Upsert die clientId
 * ueberschreibt, erkennt der Server eine Wiederholung nur, solange niemand die Zeile seither
 * geaendert hat.
 */
function urteil(
	vorhanden: Vorhanden,
	modulId: string,
	richtung: Richtung,
	kindId: string,
	autoId: string | null,
): Wiederholung<null> | ThreadAbbruch {
	const dieselbe =
		vorhanden.modulId === modulId &&
		vorhanden.richtung === richtung &&
		vorhanden.kindId === kindId &&
		vorhanden.autoId === autoId;
	return dieselbe ? new Wiederholung(null) : new ThreadAbbruch(409, CLIENT_ID_VERGEBEN);
}

/**
 * Das Einsetzen unter der Sperre (innerhalb von mitAenderung): erst die clientId, dann alles
 * neu laden und 404, 409, "sitzt schon dort" und Platz wiederholen, dann schreiben. Ist das Kind
 * unter der Sperre schon im Auto (eine gleichzeitige Anfrage mit anderer clientId war schneller),
 * endet es als Wiederholung: Sie rollt den vergebenen Stand zurueck, und die Route antwortet 200
 * wie bei "nichts geaendert". Eine inzwischen entfernte Fahrgemeinschaft oder ein zurueckgezogenes
 * Auto ist 404 aus der Pruefung, kein P2003. `autoId: null` heisst "kommt selbst".
 *
 * autoId steht nur in der unchecked-Form im Upsert (nie `auto: { connect }`): null waere sonst
 * ein Abwaehlen der Relation, und der Verbund-Fremdschluessel ueber Verein, Modul und Richtung
 * lieferte die Pruefung, dass das Auto zur Fahrgemeinschaft und Richtung gehoert, ohnehin.
 */
export async function schreibeMitfahrt(
	tx: VereinTx,
	eingabe: {
		personId: string;
		threadId: string;
		modulId: string;
		richtung: Richtung;
		kindId: string;
		autoId: string | null;
		clientId: string;
		zeit: Date;
	},
): Promise<{ ergebnis: null; aenderungen: readonly AenderungEingabe[] }> {
	const { personId, threadId, modulId, richtung, kindId, autoId, clientId, zeit } = eingabe;
	const vorhanden = await tx.mitfahrt.findFirst({ where: { clientId }, select: AUSWAHL });
	if (vorhanden) throw urteil(vorhanden, modulId, richtung, kindId, autoId);

	const lage = await ladeFahrtLage(tx, personId, threadId, modulId);
	if (!lage) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const sicht = sichtPruefung(lage, richtung, kindId, autoId, zeit);
	if (sicht instanceof ThreadAbbruch) throw sicht;
	const konflikt = konfliktPruefung(lage, richtung, kindId, sicht.auto, zeit);
	if (konflikt === 'SCHON_DA') throw new Wiederholung(null);
	if (konflikt) throw konflikt;

	await tx.mitfahrt.upsert({
		where: { modulId_richtung_kindId: { modulId, richtung, kindId } },
		create: { modulId, richtung, kindId, autoId, vonId: personId, eingetragenAm: zeit, clientId },
		update: { autoId, vonId: personId, clientId, eingetragenAm: zeit },
		select: { id: true },
	});
	return { ergebnis: null, aenderungen: [{ threadId, art: 'ANTWORT' as const, objektId: modulId }] };
}

/**
 * Das Herausnehmen unter der Sperre. Ist die Mitfahrt inzwischen weg, endet es als Wiederholung,
 * auch wenn Archiv oder Entwurf inzwischen greifen (wie loescheEintrag in helfer.ts); sonst gilt
 * darfHerausnehmen auf dem neuen Stand: Zuordnung und Archiv koennen sich dazwischen geaendert
 * haben.
 */
export async function loescheMitfahrt(
	tx: VereinTx,
	eingabe: {
		personId: string;
		threadId: string;
		modulId: string;
		richtung: Richtung;
		kindId: string;
		zeit: Date;
	},
): Promise<{ ergebnis: null; aenderungen: readonly AenderungEingabe[] }> {
	const { personId, threadId, modulId, richtung, kindId, zeit } = eingabe;
	const lage = await ladeFahrtLage(tx, personId, threadId, modulId);
	if (!lage || !richtungAn(lage, richtung)) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const mitfahrt = mitfahrtVon(lage, richtung, kindId);
	if (!mitfahrt) throw new Wiederholung(null);
	const ende = abbruchAus(darfHerausnehmen(lage.mich, mitfahrt, lage.modul.fahrt, lage.daten, lage.umfeld, zeit));
	if (ende) throw ende;

	await tx.mitfahrt.delete({ where: { modulId_richtung_kindId: { modulId, richtung, kindId } }, select: { id: true } });
	return { ergebnis: null, aenderungen: [{ threadId, art: 'ANTWORT' as const, objektId: modulId }] };
}

/** autoId (Zeichenkette oder null) und clientId des Koerpers, oder das Feld, an dem es scheitert. */
function liesEinsetzen(body: unknown): { autoId: string | null; clientId: string } | { feld: string } {
	const { autoId, clientId } = (typeof body === 'object' && body !== null ? body : {}) as {
		autoId?: unknown;
		clientId?: unknown;
	};
	if (autoId !== null && (typeof autoId !== 'string' || autoId === '')) return { feld: 'autoId' };
	const id = liesClientId(clientId);
	if (id === null) return { feld: 'clientId' };
	return { autoId, clientId: id };
}

/** PUT und DELETE /fahrten/:modulId/:richtung/:kindId. */
export function mitfahrtRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, antwortenFenster, bus } = deps;

	router.put(
		'/fahrten/:modulId/:richtung/:kindId',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const warten = antwortenFenster.pruefe(`${verein.id}:${person.id}`);
			if (warten > 0) return void zuVieleVersuche(res, warten);
			const eingabe = liesEinsetzen(req.body);
			if ('feld' in eingabe) return void res.status(400).json(ungueltigesFeld(eingabe.feld));
			const { autoId, clientId } = eingabe;

			const zeit = jetzt();
			const richtung = liesRichtung(req.params['richtung']);
			if (!richtung) return void res.status(404).json(NICHT_GEFUNDEN);
			const modulId = req.params['modulId'] ?? '';
			const kindId = req.params['kindId'] ?? '';
			const ort = await modulOrt(db, modulId);
			if (!ort || ort.typ !== 'FAHRT') return void res.status(404).json(NICHT_GEFUNDEN);
			const { threadId } = ort;
			const lage = await ladeFahrtLage(db, person.id, threadId, modulId);
			if (!lage) return void res.status(404).json(NICHT_GEFUNDEN);
			const sicht = sichtPruefung(lage, richtung, kindId, autoId, zeit);
			if (sicht instanceof ThreadAbbruch) return void antworteThreadFehler(res, sicht);

			const suche = () => db.mitfahrt.findFirst({ where: { clientId }, select: AUSWAHL });
			// Nach der 404 und vor Entwurf, Archiv, Zusage und Platz (Kopfkommentar).
			const vorab = await suche();
			if (vorab) {
				const ende = urteil(vorab, modulId, richtung, kindId, autoId);
				if (ende instanceof Wiederholung) {
					return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit));
				}
				return void antworteThreadFehler(res, ende);
			}
			const konflikt = konfliktPruefung(lage, richtung, kindId, sicht.auto, zeit);
			if (konflikt === 'SCHON_DA') {
				return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit));
			}
			if (konflikt) return void antworteThreadFehler(res, konflikt);

			let fehler: unknown;
			try {
				const { stand, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, () =>
						schreibeMitfahrt(tx, { personId: person.id, threadId, modulId, richtung, kindId, autoId, clientId, zeit }),
					),
				);
				bus.melde({ typ: 'aenderung', vereinId: verein.id, stand, aenderungen, eintraege: [] });
				return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit, stand));
			} catch (error) {
				fehler = error;
			}

			// P2002 wie in helfer.ts: Alle Schreiber laufen unter der Vereinssperre, ein Konflikt auf
			// (Modul, Richtung, Kind) waere darum ein Fehler, den niemand still schlucken soll; nur die
			// clientId kann zwischen Suche und Sperre vergeben worden sein.
			if ((fehler as { code?: unknown } | null)?.code === 'P2002') {
				const vorhanden = await suche();
				if (vorhanden) fehler = urteil(vorhanden, modulId, richtung, kindId, autoId);
			}
			if (fehler instanceof Wiederholung) {
				return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit));
			}
			antworteThreadFehler(res, fehler);
		}),
	);

	router.delete(
		'/fahrten/:modulId/:richtung/:kindId',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			// Dasselbe Fenster wie das Einsetzen: Einsetzen und Herausnehmen im Wechsel ist dieselbe
			// Last fuer Datenbank und Bus.
			const warten = antwortenFenster.pruefe(`${verein.id}:${person.id}`);
			if (warten > 0) return void zuVieleVersuche(res, warten);

			const zeit = jetzt();
			const richtung = liesRichtung(req.params['richtung']);
			if (!richtung) return void res.status(404).json(NICHT_GEFUNDEN);
			const modulId = req.params['modulId'] ?? '';
			const kindId = req.params['kindId'] ?? '';
			const ort = await modulOrt(db, modulId);
			if (!ort || ort.typ !== 'FAHRT') return void res.status(404).json(NICHT_GEFUNDEN);
			const { threadId } = ort;
			const lage = await ladeFahrtLage(db, person.id, threadId, modulId);
			if (!lage) return void res.status(404).json(NICHT_GEFUNDEN);
			const pruefung = herausnehmPruefung(lage, richtung, kindId, zeit);
			if (pruefung === 'KEINE_MITFAHRT') {
				return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit));
			}
			if (pruefung) return void antworteThreadFehler(res, pruefung);

			let fehler: unknown;
			try {
				const { stand, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, () =>
						loescheMitfahrt(tx, { personId: person.id, threadId, modulId, richtung, kindId, zeit }),
					),
				);
				bus.melde({ typ: 'aenderung', vereinId: verein.id, stand, aenderungen, eintraege: [] });
				return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit, stand));
			} catch (error) {
				fehler = error;
			}
			if (fehler instanceof Wiederholung) {
				return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit));
			}
			antworteThreadFehler(res, fehler);
		}),
	);
}
