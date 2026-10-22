import { mitAenderung, type AenderungEingabe, type VereinDb, type VereinTx } from '@jufi/db';
import {
	darfAustragen,
	darfEintragen,
	hatPlatzFuer,
	helferAnsicht,
	pruefeNotiz,
	threadDatenAus,
	type EintragErlaubnis,
	type HelferModulAnsicht,
	type HelferPositionDaten,
	type ModulDaten,
	type ThreadDaten,
	type ThreadPerson,
	type Umfeld,
} from '@jufi/domain';
import type { Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { zuVieleVersuche } from '../admin/versuche.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { liesClientId, ungueltigesFeld } from './eingabe.js';
import {
	antworteThreadFehler,
	ARCHIVIERT,
	CLIENT_ID_VERGEBEN,
	ENTWURF,
	FRIST_ABGELAUFEN,
	NICHT_GEFUNDEN,
	ThreadAbbruch,
	VOLL,
	Wiederholung,
} from './fehler.js';
import { ladeThread, ladeThreadUmfeld, ladeVereinsstand, positionOrt } from './laden.js';

/*
 * Ein- und Austragen in der Helferliste (TP4 Etappe 3, Spec 5.2 und 8). Gebaut wie
 * PUT /umfragen/:modulId/antworten/:fuerId in antworten.ts; die Gruende fuer Reihenfolge,
 * Wiederholung, Neupruefung unter der Sperre und den P2002-Zweig stehen dort.
 *
 * PUT: Rate-Limit (429), Notiz und clientId (400), Position, Thread und darfEintragen (404),
 * Wiederholung ueber die clientId (200 oder 409 CLIENT_ID_VERGEBEN), Entwurf und Archiv (409),
 * Frist (410), freier Platz (409 VOLL), dann mitAenderung mit denselben Pruefungen auf dem
 * Stand unter der Sperre, nach dem Commit der Bus.
 *
 * DELETE: Rate-Limit, 404, 409/410 wie beim PUT; ohne Eintrag 200 ohne Schreiben
 * (Plan-Entscheidung 4: das DELETE hat keine clientId, die Wiederholung erkennt der Server am
 * fehlenden Eintrag), sonst mitAenderung mit Neupruefung.
 */

type Helfer = Extract<ModulDaten, { typ: 'HELFER' }>;

/** Was eine Eintragszeile fuer die Pruefung einer Wiederholung verraten muss. */
const AUSWAHL = { positionId: true, fuerId: true, vonId: true } as const;

type Vorhanden = { positionId: string; fuerId: string; vonId: string };

/**
 * Alles, worauf die Regeln schauen, an einer Stelle geladen: vor der Sperre aus vereinDb, unter
 * ihr aus der Transaktion. Der Thread kommt ueber die threadId aus positionOrt, das Modul ueber
 * die Position: Eine Position wandert nicht zwischen Listen, sie kann nur verschwinden. null
 * heisst "nicht (mehr) da" und wird ueberall zur 404. Verworfen: unter der Sperre nur die
 * Position neu lesen -- ob fuerId noch gefragt ist, haengt an Zielgruppe, Einheit und Familien
 * (antworten.ts, schreibeAntwort).
 */
interface Lage {
	mich: ThreadPerson;
	umfeld: Umfeld;
	daten: ThreadDaten;
	modul: Helfer;
	position: HelferPositionDaten;
}

async function ladeLage(
	db: VereinDb | VereinTx,
	personId: string,
	threadId: string,
	positionId: string,
): Promise<Lage | null> {
	const [umfeld, thread] = await Promise.all([ladeThreadUmfeld(db), ladeThread(db, threadId)]);
	const mich = umfeld.personen.get(personId);
	if (!thread || !mich) return null;
	for (const modul of thread.module) {
		if (modul.typ !== 'HELFER') continue;
		const position = modul.helfer.positionen.find((p) => p.id === positionId);
		if (position) return { mich, umfeld, daten: threadDatenAus(thread.kopf, thread.module), modul, position };
	}
	return null;
}

/** Wer fuer fuerId ein- oder austragen darf: mit Eintrag darfAustragen (Plan-Entscheidung 2), ohne darfEintragen. */
function austragErlaubnis(lage: Lage, fuerId: string, zeit: Date): EintragErlaubnis {
	const { mich, modul, daten, umfeld, position } = lage;
	const eintrag = position.eintraege.find((e) => e.fuerId === fuerId);
	return eintrag
		? darfAustragen(mich, eintrag, modul.helfer, daten, umfeld, zeit)
		: darfEintragen(mich, fuerId, modul.helfer, daten, umfeld, zeit);
}

/**
 * Die Antwort zu einer Erlaubnis, an einer Stelle fuer vor und unter der Sperre. ARCHIVIERT ist
 * die vorhandene 409 des Archivs (Plan-Entscheidung 3), keine eigene.
 */
function abbruch(erlaubnis: EintragErlaubnis): ThreadAbbruch | null {
	switch (erlaubnis) {
		case 'NICHT_GEFUNDEN':
			return new ThreadAbbruch(404, NICHT_GEFUNDEN);
		case 'ENTWURF':
			return new ThreadAbbruch(409, ENTWURF);
		case 'ARCHIVIERT':
			return new ThreadAbbruch(409, ARCHIVIERT);
		case 'FRIST_ABGELAUFEN':
			return new ThreadAbbruch(410, FRIST_ABGELAUFEN);
		case 'ERLAUBT':
			return null;
	}
}

/**
 * Wie urteil in antworten.ts: dieselbe Person, Position und Zeile ist eine Wiederholung, alles
 * andere eine fremde clientId. Weil der Upsert die clientId ueberschreibt (Plan-Entscheidung 5),
 * erkennt der Server eine Wiederholung nur, solange niemand die Zeile seither geaendert hat.
 */
function urteil(
	vorhanden: Vorhanden,
	personId: string,
	positionId: string,
	fuerId: string,
): Wiederholung<null> | ThreadAbbruch {
	const dieselbe = vorhanden.vonId === personId && vorhanden.positionId === positionId && vorhanden.fuerId === fuerId;
	return dieselbe ? new Wiederholung(null) : new ThreadAbbruch(409, CLIENT_ID_VERGEBEN);
}

/**
 * Das Eintragen unter der Sperre (innerhalb von mitAenderung). Reihenfolge und Grund wie
 * schreibeAntwort: erst die clientId, dann alles neu laden und darfEintragen und hatPlatzFuer
 * wiederholen, dann schreiben. Der Platz ist hier die eigentliche Pruefung (Review Focus 1):
 * Zwei Familien bestehen beide die Vorpruefung um den letzten Platz, aber nur die erste findet
 * ihn unter der Sperre noch frei. Eine inzwischen entfernte Position ist eine 404 aus ladeLage,
 * kein P2003.
 *
 * Ein Upsert je (positionId, fuerId) (Plan-Entscheidung 5): Eine geaenderte Notiz ueberschreibt
 * notiz, vonId und clientId; eingetragenAm bleibt, denn die Reihenfolge in der Position ist die
 * der Anmeldung. Die Aenderung nennt das Modul, nicht die Zeile (Plan-Entscheidung 6).
 */
export async function schreibeEintrag(
	tx: VereinTx,
	eingabe: {
		personId: string;
		threadId: string;
		positionId: string;
		fuerId: string;
		notiz: string | null;
		clientId: string;
		zeit: Date;
	},
): Promise<{ ergebnis: null; aenderungen: readonly AenderungEingabe[] }> {
	const { personId, threadId, positionId, fuerId, notiz, clientId, zeit } = eingabe;
	const vorhanden = await tx.helferEintrag.findFirst({ where: { clientId }, select: AUSWAHL });
	if (vorhanden) throw urteil(vorhanden, personId, positionId, fuerId);

	const lage = await ladeLage(tx, personId, threadId, positionId);
	if (!lage) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const ende = abbruch(darfEintragen(lage.mich, fuerId, lage.modul.helfer, lage.daten, lage.umfeld, zeit));
	if (ende) throw ende;
	if (!hatPlatzFuer(lage.position, fuerId)) throw new ThreadAbbruch(409, VOLL);

	await tx.helferEintrag.upsert({
		where: { positionId_fuerId: { positionId, fuerId } },
		create: { positionId, fuerId, vonId: personId, notiz, eingetragenAm: zeit, clientId },
		update: { vonId: personId, notiz, clientId },
		select: { id: true },
	});
	return { ergebnis: null, aenderungen: [{ threadId, art: 'ANTWORT' as const, objektId: lage.modul.id }] };
}

/**
 * Das Austragen unter der Sperre. Dieselbe Erlaubnis wie vor der Sperre (austragErlaubnis), auf
 * dem neuen Stand: Frist, Archiv und Zuordnung koennen sich dazwischen geaendert haben. Ist der
 * Eintrag inzwischen weg (ein gleichzeitiges DELETE war schneller), endet es als Wiederholung:
 * Sie rollt den vergebenen Stand zurueck, und die Route antwortet 200 wie beim fehlenden Eintrag
 * vor der Sperre (Plan-Entscheidung 4), wie DELETE /verlauf/:eintragId (fehler.ts).
 */
export async function loescheEintrag(
	tx: VereinTx,
	eingabe: { personId: string; threadId: string; positionId: string; fuerId: string; zeit: Date },
): Promise<{ ergebnis: null; aenderungen: readonly AenderungEingabe[] }> {
	const { personId, threadId, positionId, fuerId, zeit } = eingabe;
	const lage = await ladeLage(tx, personId, threadId, positionId);
	if (!lage) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const ende = abbruch(austragErlaubnis(lage, fuerId, zeit));
	if (ende) throw ende;
	if (!lage.position.eintraege.some((e) => e.fuerId === fuerId)) throw new Wiederholung(null);

	await tx.helferEintrag.delete({ where: { positionId_fuerId: { positionId, fuerId } }, select: { id: true } });
	return { ergebnis: null, aenderungen: [{ threadId, art: 'ANTWORT' as const, objektId: lage.modul.id }] };
}

/** Die Notiz und clientId des Koerpers, oder das Feld, an dem es scheitert. */
function liesEintrag(body: unknown): { notiz: string | null; clientId: string } | { feld: string } {
	const { notiz, clientId } = (typeof body === 'object' && body !== null ? body : {}) as {
		notiz?: unknown;
		clientId?: unknown;
	};
	const geprueft = pruefeNotiz(notiz);
	if (!geprueft.ok) return { feld: 'notiz' };
	const id = liesClientId(clientId);
	if (id === null) return { feld: 'clientId' };
	return { notiz: geprueft.notiz, clientId: id };
}

/** PUT und DELETE /helfer/:positionId/eintraege/:fuerId. */
export function helferRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, antwortenFenster, bus } = deps;

	/**
	 * Die Liste, wie die Person sie jetzt sieht, und der Stand, bis zu dem sie geladen ist (wie
	 * ansicht in antworten.ts). Person und Umfeld bleiben die von vor dem Schreiben. Fehlt die
	 * Liste, ist das nach einem PUT unmoeglich (der Eintrag haelt die Position, NoAction), nach
	 * einem DELETE aber ein echtes Rennen: Ohne Eintraege darf der Editor die Liste entfernen.
	 * Darum 404 wie fuer alles, was nicht mehr da ist. Verworfen: ein Error wie in antworten.ts
	 * -- er machte aus einem erfolgreichen Austragen eine 500.
	 */
	async function ansicht(
		db: VereinDb,
		vereinId: string,
		lage: Lage,
		zeit: Date,
		stand?: number,
	): Promise<{ modul: HelferModulAnsicht; stand: number }> {
		const geladenBis = stand ?? (await ladeVereinsstand(db, vereinId));
		const neu = await ladeThread(db, lage.daten.kopf.id);
		const modul = neu?.module.find((m): m is Helfer => m.typ === 'HELFER' && m.id === lage.modul.id);
		if (!neu || !modul) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
		const daten = threadDatenAus(neu.kopf, neu.module);
		return { modul: helferAnsicht(lage.mich, modul, daten, lage.umfeld, zeit), stand: geladenBis };
	}

	/** 200 mit der Ansicht; scheitert sie, die Antwort zum Fehler. */
	async function antworteMitAnsicht(res: Response, laden: () => Promise<unknown>): Promise<void> {
		try {
			res.status(200).json(await laden());
		} catch (error) {
			antworteThreadFehler(res, error);
		}
	}

	router.put(
		'/helfer/:positionId/eintraege/:fuerId',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const warten = antwortenFenster.pruefe(`${verein.id}:${person.id}`);
			if (warten > 0) return void zuVieleVersuche(res, warten);
			const eingabe = liesEintrag(req.body);
			if ('feld' in eingabe) return void res.status(400).json(ungueltigesFeld(eingabe.feld));

			const zeit = jetzt();
			const positionId = req.params['positionId'] ?? '';
			const fuerId = req.params['fuerId'] ?? '';
			const ort = await positionOrt(db, positionId);
			if (!ort) return void res.status(404).json(NICHT_GEFUNDEN);
			const { threadId } = ort;
			const lage = await ladeLage(db, person.id, threadId, positionId);
			if (!lage) return void res.status(404).json(NICHT_GEFUNDEN);
			const erlaubnis = darfEintragen(lage.mich, fuerId, lage.modul.helfer, lage.daten, lage.umfeld, zeit);
			if (erlaubnis === 'NICHT_GEFUNDEN') return void res.status(404).json(NICHT_GEFUNDEN);

			const suche = () => db.helferEintrag.findFirst({ where: { clientId: eingabe.clientId }, select: AUSWAHL });
			// Nach der 404 und vor Entwurf, Archiv, Frist und Platz, wie in antworten.ts: Eine
			// gespeicherte Eintragung bleibt 200, auch wenn die Outbox sie nach der Frist oder in
			// einer inzwischen vollen Position wiederholt.
			const vorab = await suche();
			if (vorab) {
				const ende = urteil(vorab, person.id, positionId, fuerId);
				if (ende instanceof Wiederholung) return antworteMitAnsicht(res, () => ansicht(db, verein.id, lage, zeit));
				return void antworteThreadFehler(res, ende);
			}
			const ende = abbruch(erlaubnis);
			if (ende) return void antworteThreadFehler(res, ende);
			if (!hatPlatzFuer(lage.position, fuerId)) return void res.status(409).json(VOLL);

			let fehler: unknown;
			try {
				const { stand, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, () =>
						schreibeEintrag(tx, {
							personId: person.id,
							threadId,
							positionId,
							fuerId,
							notiz: eingabe.notiz,
							clientId: eingabe.clientId,
							zeit,
						}),
					),
				);
				bus.melde({ typ: 'aenderung', vereinId: verein.id, stand, aenderungen, eintraege: [] });
				return void res.status(200).json(await ansicht(db, verein.id, lage, zeit, stand));
			} catch (error) {
				fehler = error;
			}

			// P2002 wie in antworten.ts. Ein eigener Zweig fuer (positionId, fuerId) fehlt mit
			// Absicht: Alle Schreiber laufen unter der Vereinssperre, der Upsert sieht die Zeile also
			// immer, und ein Konflikt dort waere ein Fehler, den niemand still schlucken soll.
			if ((fehler as { code?: unknown } | null)?.code === 'P2002') {
				const vorhanden = await suche();
				if (vorhanden) fehler = urteil(vorhanden, person.id, positionId, fuerId);
			}
			if (fehler instanceof Wiederholung) return antworteMitAnsicht(res, () => ansicht(db, verein.id, lage, zeit));
			antworteThreadFehler(res, fehler);
		}),
	);

	router.delete(
		'/helfer/:positionId/eintraege/:fuerId',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			// Dasselbe Fenster wie das Eintragen: Ein- und Austragen im Wechsel ist dieselbe Last
			// fuer Datenbank und Bus wie wiederholtes Eintragen.
			const warten = antwortenFenster.pruefe(`${verein.id}:${person.id}`);
			if (warten > 0) return void zuVieleVersuche(res, warten);

			const zeit = jetzt();
			const positionId = req.params['positionId'] ?? '';
			const fuerId = req.params['fuerId'] ?? '';
			const ort = await positionOrt(db, positionId);
			if (!ort) return void res.status(404).json(NICHT_GEFUNDEN);
			const { threadId } = ort;
			const lage = await ladeLage(db, person.id, threadId, positionId);
			if (!lage) return void res.status(404).json(NICHT_GEFUNDEN);
			// Auch ohne Eintrag erst 404, 409 und 410: Ein stilles 200 verriete sonst, dass es fuer
			// eine fremde Zeile nichts auszutragen gibt.
			const ende = abbruch(austragErlaubnis(lage, fuerId, zeit));
			if (ende) return void antworteThreadFehler(res, ende);
			if (!lage.position.eintraege.some((e) => e.fuerId === fuerId)) {
				return antworteMitAnsicht(res, () => ansicht(db, verein.id, lage, zeit));
			}

			let fehler: unknown;
			try {
				const { stand, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, () =>
						loescheEintrag(tx, { personId: person.id, threadId, positionId, fuerId, zeit }),
					),
				);
				bus.melde({ typ: 'aenderung', vereinId: verein.id, stand, aenderungen, eintraege: [] });
				return void res.status(200).json(await ansicht(db, verein.id, lage, zeit, stand));
			} catch (error) {
				fehler = error;
			}
			if (fehler instanceof Wiederholung) return antworteMitAnsicht(res, () => ansicht(db, verein.id, lage, zeit));
			antworteThreadFehler(res, fehler);
		}),
	);
}
