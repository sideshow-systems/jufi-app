import { mitAenderung, type AenderungEingabe, type Prisma, type VereinTx } from '@jufi/db';
import {
	darfAnbieten,
	darfAutoAendern,
	GRENZEN,
	pruefeAuto,
	type AutoDaten,
	type AutoEingabe,
	type Richtung,
} from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { zuVieleVersuche } from '../admin/versuche.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { liesClientId, ungueltigesFeld } from './eingabe.js';
import {
	abbruchAus,
	antworteMitFahrtAnsicht,
	autoOrt,
	fahrtAntwort,
	ladeFahrtLage,
	type FahrtLage,
} from './fahrt-gemeinsam.js';
import {
	antworteThreadFehler,
	AUTO_SCHON_DA,
	AUTOS_VOLL,
	CLIENT_ID_VERGEBEN,
	NICHT_GEFUNDEN,
	plaetzeBelegt,
	ThreadAbbruch,
	Wiederholung,
} from './fehler.js';
import { modulOrt } from './laden.js';

/*
 * Autos anbieten, aendern und zurueckziehen (TP4 Etappe 4, Spec 6 und 8). Gebaut wie helfer.ts;
 * die Gruende fuer Reihenfolge, Wiederholung, Neupruefung unter der Sperre und den P2002-Zweig
 * stehen dort und in antworten.ts. Hier nur, was anders ist.
 *
 * POST: Rate-Limit (429), Auto, Richtung und clientId (400), Modul als FAHRT, Thread und Recht
 * (404, auch fuer eine abgeschaltete Richtung), Wiederholung ueber die clientId (201 wird 200,
 * oder 409 CLIENT_ID_VERGEBEN), Entwurf und Archiv (409), eigenes Auto in der Richtung und
 * Hoechstzahl (409), dann mitAenderung mit denselben Pruefungen auf dem Stand unter der Sperre.
 * Die Wiederholung steht vor den 409: Das Auto der ersten Anfrage steht schon, sonst bekaeme
 * jede Wiederholung AUTO_SCHON_DA (Plan-Entscheidung 1).
 *
 * PUT: Rate-Limit, Auto (400), Auto und Recht (404), Entwurf und Archiv (409), weniger Plaetze
 * als Mitfahrer (409 PLAETZE), ohne Aenderung 200 ohne Schreiben (Entscheidung 2: der Koerper
 * setzt Werte, eine Wiederholung setzt dieselben), sonst mitAenderung mit Neupruefung.
 *
 * DELETE: wie PUT bis zu den 409, dann mitAenderung. Ein unbekanntes Auto ist 404, auch beim
 * zweiten DELETE (Entscheidung 3). Die Mitfahrten loescht die Route ausdruecklich vor dem Auto
 * (das Schema kaskadiert nicht, die Kinder gingen sonst still mit), und sassen Kinder darin,
 * schreibt sie in derselben Transaktion den Systemeintrag (Entscheidungen 4 und 12).
 */

/** Was eine Autozeile fuer die Pruefung einer Wiederholung verraten muss. */
const AUSWAHL = { modulId: true, fahrerId: true, richtung: true } as const;

type Vorhanden = { modulId: string; fahrerId: string; richtung: Richtung };

function richtungAn(lage: FahrtLage, richtung: Richtung): boolean {
	return richtung === 'HIN' ? lage.modul.fahrt.hin : lage.modul.fahrt.rueck;
}

/**
 * Die 404 des Anbietens, an einer Stelle fuer vor und unter der Sperre: kein Recht, nicht
 * sichtbar oder eine Richtung, die die Fahrgemeinschaft nicht hat. Alle drei sehen gleich aus
 * (Rahmen-Spec 8).
 */
function sichtPruefung(lage: FahrtLage, richtung: Richtung, zeit: Date): ThreadAbbruch | null {
	const erlaubnis = darfAnbieten(lage.mich, lage.daten, lage.umfeld, zeit);
	if (erlaubnis === 'NICHT_GEFUNDEN' || !richtungAn(lage, richtung)) return new ThreadAbbruch(404, NICHT_GEFUNDEN);
	return null;
}

/** Die 409 des Anbietens: Entwurf, Archiv, eigenes Auto und Hoechstzahl, in dieser Reihenfolge. */
function konfliktPruefung(lage: FahrtLage, richtung: Richtung, personId: string, zeit: Date): ThreadAbbruch | null {
	const ende = abbruchAus(darfAnbieten(lage.mich, lage.daten, lage.umfeld, zeit));
	if (ende) return ende;
	const autos = lage.modul.fahrt.autos.filter((a) => a.richtung === richtung);
	if (autos.some((a) => a.fahrerId === personId)) return new ThreadAbbruch(409, AUTO_SCHON_DA);
	if (autos.length >= GRENZEN.autosJeRichtung) return new ThreadAbbruch(409, AUTOS_VOLL);
	return null;
}

/**
 * Die Pruefung am vorhandenen Auto, an einer Stelle fuer PUT und DELETE, vor und unter der
 * Sperre: Recht (404) vor Entwurf und Archiv (409). Ein Auto, das nicht in der Fahrgemeinschaft
 * steht, ist 404.
 */
function autoPruefung(lage: FahrtLage, autoId: string, zeit: Date): AutoDaten | ThreadAbbruch {
	const auto = lage.modul.fahrt.autos.find((a) => a.id === autoId);
	if (!auto) return new ThreadAbbruch(404, NICHT_GEFUNDEN);
	return abbruchAus(darfAutoAendern(lage.mich, auto, lage.daten, lage.umfeld, zeit)) ?? auto;
}

/** Die Zahl der Kinder im Auto gegen die neuen Plaetze (Review Focus 4); Kinder, die nicht mehr betrachtet werden, zaehlen. */
function plaetzePruefung(lage: FahrtLage, autoId: string, plaetze: number): ThreadAbbruch | null {
	const drin = lage.modul.fahrt.mitfahrten.filter((m) => m.autoId === autoId).length;
	return plaetze < drin ? new ThreadAbbruch(409, plaetzeBelegt(drin)) : null;
}

function unveraendert(alt: AutoDaten, neu: AutoEingabe): boolean {
	return (
		alt.plaetze === neu.plaetze &&
		alt.abfahrtTag === neu.abfahrtTag &&
		alt.abfahrtZeit === neu.abfahrtZeit &&
		alt.ort === neu.ort &&
		alt.notiz === neu.notiz
	);
}

/**
 * Wie urteil in helfer.ts: dieselbe Person, Fahrgemeinschaft und Richtung ist eine
 * Wiederholung, alles andere eine fremde clientId.
 */
function urteil(
	vorhanden: Vorhanden,
	personId: string,
	modulId: string,
	richtung: Richtung,
): Wiederholung<null> | ThreadAbbruch {
	const dieselbe = vorhanden.fahrerId === personId && vorhanden.modulId === modulId && vorhanden.richtung === richtung;
	return dieselbe ? new Wiederholung(null) : new ThreadAbbruch(409, CLIENT_ID_VERGEBEN);
}

/** Die Felder einer Autozeile; der Tag als UTC-Mitternacht, wie laden.ts ihn zurueckwandelt (@db.Date). */
function zeilenFelder(auto: AutoEingabe) {
	return {
		plaetze: auto.plaetze,
		abfahrtTag: auto.abfahrtTag ? new Date(auto.abfahrtTag) : null,
		abfahrtZeit: auto.abfahrtZeit,
		ort: auto.ort,
		notiz: auto.notiz,
	};
}

/**
 * Das Anbieten unter der Sperre (innerhalb von mitAenderung): erst die clientId, dann alles neu
 * laden und Sicht, Konflikte und Hoechstzahl wiederholen, dann schreiben. Zwei Anfragen derselben
 * Person bestehen beide die Vorpruefung, aber nur die erste findet unter der Sperre noch kein
 * Auto von ihr. Das Modul, das inzwischen entfernt wurde, ist 404 aus ladeFahrtLage, kein P2003.
 * Die Aenderung nennt das Modul, nicht die Zeile (Plan-Entscheidung 12).
 */
export async function schreibeAuto(
	tx: VereinTx,
	eingabe: {
		personId: string;
		threadId: string;
		modulId: string;
		richtung: Richtung;
		auto: AutoEingabe;
		clientId: string;
		zeit: Date;
	},
): Promise<{ ergebnis: null; aenderungen: readonly AenderungEingabe[] }> {
	const { personId, threadId, modulId, richtung, auto, clientId, zeit } = eingabe;
	const vorhanden = await tx.auto.findFirst({ where: { clientId }, select: AUSWAHL });
	if (vorhanden) throw urteil(vorhanden, personId, modulId, richtung);

	const lage = await ladeFahrtLage(tx, personId, threadId, modulId);
	if (!lage) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const ende = sichtPruefung(lage, richtung, zeit) ?? konfliktPruefung(lage, richtung, personId, zeit);
	if (ende) throw ende;

	await tx.auto.create({
		data: { modulId, fahrerId: personId, richtung, ...zeilenFelder(auto), angelegtAm: zeit, clientId },
		select: { id: true },
	});
	return { ergebnis: null, aenderungen: [{ threadId, art: 'ANTWORT' as const, objektId: modulId }] };
}

/**
 * Das Aendern unter der Sperre. Dieselbe Pruefung wie vor der Sperre auf dem neuen Stand: Zuordnung,
 * Archiv und Mitfahrer koennen sich dazwischen geaendert haben. Ist inzwischen nichts mehr zu
 * aendern (ein gleichzeitiges PUT mit denselben Werten war schneller), endet es als Wiederholung:
 * Sie rollt den vergebenen Stand zurueck, und die Route antwortet 200 wie bei "nichts geaendert".
 */
export async function aendereAuto(
	tx: VereinTx,
	eingabe: {
		personId: string;
		threadId: string;
		modulId: string;
		autoId: string;
		auto: AutoEingabe;
		zeit: Date;
	},
): Promise<{ ergebnis: null; aenderungen: readonly AenderungEingabe[] }> {
	const { personId, threadId, modulId, autoId, auto, zeit } = eingabe;
	const lage = await ladeFahrtLage(tx, personId, threadId, modulId);
	if (!lage) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const alt = autoPruefung(lage, autoId, zeit);
	if (alt instanceof ThreadAbbruch) throw alt;
	const zuWenig = plaetzePruefung(lage, autoId, auto.plaetze);
	if (zuWenig) throw zuWenig;
	if (unveraendert(alt, auto)) throw new Wiederholung(null);

	await tx.auto.update({ where: { id: autoId }, data: zeilenFelder(auto), select: { id: true } });
	return { ergebnis: null, aenderungen: [{ threadId, art: 'ANTWORT' as const, objektId: modulId }] };
}

/**
 * Das Zurueckziehen unter der Sperre. Ist das Auto inzwischen weg, ist es 404 wie beim zweiten
 * DELETE (Entscheidung 3). Die Kinder fuer den Systemeintrag stehen in der Reihenfolge des
 * Einsteigens in der Lage (laden.ts sortiert nach eingetragenAm). Einen Entwurf erreicht dieser
 * Weg nicht (autoPruefung lehnt ihn mit 409 ab), darum gibt es hier anders als in schreiben.ts
 * keine Sonderregel fuer den Verlauf im Entwurf.
 */
export async function loescheAuto(
	tx: VereinTx,
	eingabe: {
		personId: string;
		threadId: string;
		modulId: string;
		autoId: string;
		stand: number;
		zeit: Date;
	},
): Promise<{ ergebnis: null; aenderungen: readonly AenderungEingabe[] }> {
	const { personId, threadId, modulId, autoId, stand, zeit } = eingabe;
	const lage = await ladeFahrtLage(tx, personId, threadId, modulId);
	if (!lage) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const auto = autoPruefung(lage, autoId, zeit);
	if (auto instanceof ThreadAbbruch) throw auto;
	const kindIds = lage.modul.fahrt.mitfahrten.filter((m) => m.autoId === autoId).map((m) => m.kindId);

	await tx.mitfahrt.deleteMany({ where: { autoId } });
	await tx.auto.delete({ where: { id: autoId }, select: { id: true } });
	const aenderungen: AenderungEingabe[] = [{ threadId, art: 'ANTWORT', objektId: modulId }];
	if (kindIds.length > 0) {
		const daten: Prisma.InputJsonObject = { fahrerId: auto.fahrerId, richtung: auto.richtung, kindIds };
		const eintrag = await tx.verlaufEintrag.create({
			data: {
				threadId,
				art: 'SYSTEM',
				autorId: personId,
				systemArt: 'AUTO_ZURUECKGEZOGEN',
				systemDaten: daten,
				stand,
				angelegtAm: zeit,
			},
			select: { id: true },
		});
		aenderungen.push({ threadId, art: 'VERLAUF', objektId: eintrag.id });
	}
	return { ergebnis: null, aenderungen };
}

/** Das Formular und die Richtung des Koerpers, oder das Feld, an dem es scheitert (Reihenfolge wie im Brief). */
function liesAnbieten(body: unknown): { auto: AutoEingabe; richtung: Richtung; clientId: string } | { feld: string } {
	const geprueft = pruefeAuto(body);
	if (!geprueft.ok) return { feld: geprueft.feld };
	const { richtung, clientId } = (typeof body === 'object' && body !== null ? body : {}) as {
		richtung?: unknown;
		clientId?: unknown;
	};
	if (richtung !== 'HIN' && richtung !== 'RUECK') return { feld: 'richtung' };
	const id = liesClientId(clientId);
	if (id === null) return { feld: 'clientId' };
	return { auto: geprueft.auto, richtung, clientId: id };
}

/** POST /fahrten/:modulId/autos sowie PUT und DELETE /autos/:id. */
export function autoRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, antwortenFenster, bus } = deps;

	router.post(
		'/fahrten/:modulId/autos',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const warten = antwortenFenster.pruefe(`${verein.id}:${person.id}`);
			if (warten > 0) return void zuVieleVersuche(res, warten);
			const eingabe = liesAnbieten(req.body);
			if ('feld' in eingabe) return void res.status(400).json(ungueltigesFeld(eingabe.feld));
			const { auto, richtung, clientId } = eingabe;

			const zeit = jetzt();
			const modulId = req.params['modulId'] ?? '';
			const ort = await modulOrt(db, modulId);
			if (!ort || ort.typ !== 'FAHRT') return void res.status(404).json(NICHT_GEFUNDEN);
			const { threadId } = ort;
			const lage = await ladeFahrtLage(db, person.id, threadId, modulId);
			if (!lage) return void res.status(404).json(NICHT_GEFUNDEN);
			const nichtDa = sichtPruefung(lage, richtung, zeit);
			if (nichtDa) return void antworteThreadFehler(res, nichtDa);

			const suche = () => db.auto.findFirst({ where: { clientId }, select: AUSWAHL });
			// Nach der 404 und vor Entwurf, Archiv und den Konflikten (Kopfkommentar): Ein gespeichertes
			// Auto bleibt 200, auch wenn die Outbox es nach dem Archivieren wiederholt.
			const vorab = await suche();
			if (vorab) {
				const ende = urteil(vorab, person.id, modulId, richtung);
				if (ende instanceof Wiederholung) {
					return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit));
				}
				return void antworteThreadFehler(res, ende);
			}
			const ende = konfliktPruefung(lage, richtung, person.id, zeit);
			if (ende) return void antworteThreadFehler(res, ende);

			let fehler: unknown;
			try {
				const { stand, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, () =>
						schreibeAuto(tx, { personId: person.id, threadId, modulId, richtung, auto, clientId, zeit }),
					),
				);
				bus.melde({ typ: 'aenderung', vereinId: verein.id, stand, aenderungen, eintraege: [] });
				return antworteMitFahrtAnsicht(res, 201, () => fahrtAntwort(db, verein.id, lage, zeit, stand));
			} catch (error) {
				fehler = error;
			}

			// P2002 wie in helfer.ts: Alle Schreiber laufen unter der Vereinssperre, ein Konflikt auf
			// (Modul, Fahrer, Richtung) waere darum ein Fehler, den niemand still schlucken soll; nur die
			// clientId kann zwischen Suche und Sperre vergeben worden sein.
			if ((fehler as { code?: unknown } | null)?.code === 'P2002') {
				const vorhanden = await suche();
				if (vorhanden) fehler = urteil(vorhanden, person.id, modulId, richtung);
			}
			if (fehler instanceof Wiederholung) {
				return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit));
			}
			antworteThreadFehler(res, fehler);
		}),
	);

	router.put(
		'/autos/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const warten = antwortenFenster.pruefe(`${verein.id}:${person.id}`);
			if (warten > 0) return void zuVieleVersuche(res, warten);
			const geprueft = pruefeAuto(req.body);
			if (!geprueft.ok) return void res.status(400).json(ungueltigesFeld(geprueft.feld));
			const { auto } = geprueft;

			const zeit = jetzt();
			const autoId = req.params['id'] ?? '';
			const ort = await autoOrt(db, autoId);
			if (!ort) return void res.status(404).json(NICHT_GEFUNDEN);
			const { threadId, modulId } = ort;
			const lage = await ladeFahrtLage(db, person.id, threadId, modulId);
			if (!lage) return void res.status(404).json(NICHT_GEFUNDEN);
			const alt = autoPruefung(lage, autoId, zeit);
			if (alt instanceof ThreadAbbruch) return void antworteThreadFehler(res, alt);
			const zuWenig = plaetzePruefung(lage, autoId, auto.plaetze);
			if (zuWenig) return void antworteThreadFehler(res, zuWenig);
			if (unveraendert(alt, auto)) {
				return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit));
			}

			let fehler: unknown;
			try {
				const { stand, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, () =>
						aendereAuto(tx, { personId: person.id, threadId, modulId, autoId, auto, zeit }),
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

	router.delete(
		'/autos/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			// Dasselbe Fenster wie Anbieten und Aendern: Anbieten und Zurueckziehen im Wechsel ist
			// dieselbe Last fuer Datenbank und Bus.
			const warten = antwortenFenster.pruefe(`${verein.id}:${person.id}`);
			if (warten > 0) return void zuVieleVersuche(res, warten);

			const zeit = jetzt();
			const autoId = req.params['id'] ?? '';
			const ort = await autoOrt(db, autoId);
			if (!ort) return void res.status(404).json(NICHT_GEFUNDEN);
			const { threadId, modulId } = ort;
			const lage = await ladeFahrtLage(db, person.id, threadId, modulId);
			if (!lage) return void res.status(404).json(NICHT_GEFUNDEN);
			const auto = autoPruefung(lage, autoId, zeit);
			if (auto instanceof ThreadAbbruch) return void antworteThreadFehler(res, auto);

			let fehler: unknown;
			try {
				const { stand, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, (neuerStand) =>
						loescheAuto(tx, { personId: person.id, threadId, modulId, autoId, stand: neuerStand, zeit }),
					),
				);
				bus.melde({ typ: 'aenderung', vereinId: verein.id, stand, aenderungen, eintraege: [] });
				return antworteMitFahrtAnsicht(res, 200, () => fahrtAntwort(db, verein.id, lage, zeit, stand));
			} catch (error) {
				fehler = error;
			}
			antworteThreadFehler(res, fehler);
		}),
	);
}
