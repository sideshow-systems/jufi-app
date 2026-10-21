import { mitAenderung, type AenderungEingabe, type VereinTx } from '@jufi/db';
import { darfAntworten, umfrageAnsicht, type ModulDaten, type UmfrageAnsicht, type UmfrageDaten } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { zuVieleVersuche } from '../admin/versuche.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { liesClientId, ungueltigesFeld } from './eingabe.js';
import {
	antworteThreadFehler,
	CLIENT_ID_VERGEBEN,
	ENTWURF,
	FRIST_ABGELAUFEN,
	NICHT_GEFUNDEN,
	ThreadAbbruch,
	Wiederholung,
} from './fehler.js';
import { ladeThread, ladeThreadUmfeld, ladeVereinsstand, modulOrt } from './laden.js';

/**
 * Obergrenze der Eintraege in optionIds, geprueft noch vor der Umfrage. Mehr Optionen
 * hat keine Umfrage, die der Editor anlegt; die Grenze haelt eine boeswillig lange Liste
 * von der Datenbank fern, bevor irgendetwas geladen wird.
 */
const MAX_OPTIONEN = 20;

type Umfrage = Extract<ModulDaten, { typ: 'UMFRAGE' }>;

/** Was eine Antwortzeile fuer die Pruefung einer Wiederholung verraten muss. */
const AUSWAHL = { umfrageId: true, fuerId: true, vonId: true } as const;

type Vorhanden = { umfrageId: string; fuerId: string; vonId: string };

/**
 * Die Form des Koerpers, oder das Feld, an dem es scheitert. Leer, zu lang, kein Text oder
 * doppelt ist ohne Blick auf die Umfrage falsch und wird deshalb hier entschieden; ob die
 * IDs zur Umfrage gehoeren, erst nach der 404 (sonst verriete die 400 deren Optionen).
 * Feldname "optionen" wie in der Oberflaeche, nicht "optionIds": der Client markiert
 * damit die Auswahl, nicht ein Datenfeld.
 */
function liesAntwort(body: unknown): { optionIds: string[]; clientId: string } | { feld: string } {
	const { optionIds, clientId } = (typeof body === 'object' && body !== null ? body : {}) as {
		optionIds?: unknown;
		clientId?: unknown;
	};
	if (
		!Array.isArray(optionIds) ||
		optionIds.length === 0 ||
		optionIds.length > MAX_OPTIONEN ||
		!optionIds.every((id): id is string => typeof id === 'string') ||
		new Set(optionIds).size !== optionIds.length
	) {
		return { feld: 'optionen' };
	}
	const id = liesClientId(clientId);
	if (id === null) return { feld: 'clientId' };
	return { optionIds, clientId: id };
}

/**
 * Was eine vorhandene clientId bedeutet: dieselbe Antwort noch einmal (gleiche Person,
 * gleiche Umfrage, gleiche Zeile) oder eine fremde. Wie in verlauf.ts gilt dieselbe
 * Entscheidung vor, in und nach der Transaktion.
 *
 * Die clientId haengt an der Zeile und wird bei jeder Aenderung ueberschrieben: Eine
 * Wiederholung erkennt der Server nur, solange niemand die Zeile seither geaendert hat.
 * Verworfen: alle clientIds einer Zeile aufheben -- eine eigene Tabelle nur fuer den
 * seltenen Fall, dass die Outbox eine Antwort wiederholt, nachdem jemand anderes fuer
 * dasselbe Kind schon neu geantwortet hat.
 */
function urteil(
	vorhanden: Vorhanden,
	personId: string,
	umfrageId: string,
	fuerId: string,
): Wiederholung<null> | ThreadAbbruch {
	const dieselbe = vorhanden.vonId === personId && vorhanden.umfrageId === umfrageId && vorhanden.fuerId === fuerId;
	return dieselbe ? new Wiederholung(null) : new ThreadAbbruch(409, CLIENT_ID_VERGEBEN);
}

/**
 * Ob die IDs zur Umfrage passen: Eine ID einer anderen Umfrage, auch "vielleicht" bei
 * abgeschaltetem Vielleicht, steht nicht in ihren Optionen, und mehrere gehen nur bei
 * "mehrfach". Die Datenbank faende das ueber den Fremdschluessel auch, aber erst als P2003
 * und damit als 404. Eine Stelle fuer die Pruefung vor und in der Transaktion.
 */
function passtZurUmfrage(umfrage: UmfrageDaten, optionIds: readonly string[]): boolean {
	const optionen = new Set(umfrage.optionen.map((o) => o.id));
	return optionIds.every((id) => optionen.has(id)) && (umfrage.mehrfach || optionIds.length <= 1);
}

/**
 * Die Arbeit des Antwortens, innerhalb von mitAenderung (die Vereinszeile ist dann gesperrt).
 * Reihenfolge wie bei schreibeNachricht (verlauf.ts): erst die clientId (eine Wiederholung
 * bleibt 200, auch nach der Frist, Spec 4.2), dann Thread, Umfrage und Umfeld neu laden und
 * die Pruefungen der Route wiederholen, dann schreiben. Der Editor kann zwischen Pruefung
 * und Schreiben Zielgruppe, Einheit, Optionen, Frist und Archiv aendern und Familien und
 * Untergruppen verschieben sich in der Verwaltung; ob die Person noch fuer das Kind
 * antworten darf, entscheidet darfAntworten auf dem neuen Stand (Plan-Entscheidung 3).
 * Verworfen: nur die Person unter der Sperre laden -- "ist fuerId noch gefragt" haengt an
 * Zuordnungen und Untergruppen, nicht nur an den Rechten der Person. Preis: das ganze Umfeld
 * des Vereins unter der Sperre, wie bei schreibeNachricht.
 *
 * Die Optionen werden gegen die frisch geladene Umfrage geprueft: Eine Option, die der
 * Editor inzwischen entfernte, waere sonst ein P2003 und damit eine 404 statt einer 400.
 * Fehler werden geworfen, damit mitAenderung den Stand zurueckrollt.
 */
export async function schreibeAntwort(
	tx: VereinTx,
	eingabe: {
		personId: string;
		threadId: string;
		modulId: string;
		fuerId: string;
		optionIds: readonly string[];
		clientId: string;
		zeit: Date;
	},
	stand: number,
): Promise<{ ergebnis: null; aenderungen: readonly AenderungEingabe[] }> {
	const { personId, threadId, modulId, fuerId, optionIds, clientId, zeit } = eingabe;
	const vorhanden = await tx.umfrageAntwort.findFirst({ where: { clientId }, select: AUSWAHL });
	if (vorhanden) throw urteil(vorhanden, personId, modulId, fuerId);

	const [umfeld, thread] = await Promise.all([ladeThreadUmfeld(tx), ladeThread(tx, threadId)]);
	const mich = umfeld.personen.get(personId);
	const modul = thread?.module.find((m): m is Umfrage => m.typ === 'UMFRAGE' && m.id === modulId);
	if (!thread || !mich || !modul) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const erlaubnis = darfAntworten(mich, fuerId, modul.umfrage, thread.kopf, umfeld, zeit);
	if (erlaubnis === 'NICHT_GEFUNDEN') throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	if (erlaubnis === 'ENTWURF') throw new ThreadAbbruch(409, ENTWURF);
	if (erlaubnis === 'FRIST_ABGELAUFEN') throw new ThreadAbbruch(410, FRIST_ABGELAUFEN);
	if (!passtZurUmfrage(modul.umfrage, optionIds)) throw new ThreadAbbruch(400, ungueltigesFeld('optionen'));

	// Eine Zeile je Gefragtem: Wer zuletzt antwortet, gilt, auch wenn es eine andere
	// Bezugsperson ist (die Zeile nennt dann sie). Die Optionen werden ersetzt statt
	// abgeglichen -- bei hoechstens 20 Optionen ist das einfacher und genauso korrekt.
	const antwort = await tx.umfrageAntwort.upsert({
		where: { umfrageId_fuerId: { umfrageId: modulId, fuerId } },
		create: { umfrageId: modulId, fuerId, vonId: personId, abgegebenAm: zeit, clientId },
		update: { vonId: personId, abgegebenAm: zeit, clientId },
		select: { id: true },
	});
	await tx.umfrageAntwortOption.deleteMany({ where: { antwortId: antwort.id } });
	await tx.umfrageAntwortOption.createMany({
		data: optionIds.map((optionId) => ({ umfrageId: modulId, antwortId: antwort.id, optionId })),
	});
	return { ergebnis: null, aenderungen: [{ threadId, art: 'ANTWORT' as const, objektId: antwort.id }] };
}

/** PUT /umfragen/:modulId/antworten/:fuerId. */
export function antwortenRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, antwortenFenster, bus } = deps;

	router.put(
		'/umfragen/:modulId/antworten/:fuerId',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			// Vor dem ersten await und auch fuer Wiederholungen, aus denselben Gruenden wie
			// beim Schreiben einer Nachricht (verlauf.ts).
			const warten = antwortenFenster.pruefe(`${verein.id}:${person.id}`);
			if (warten > 0) return void zuVieleVersuche(res, warten);
			const eingabe = liesAntwort(req.body);
			if ('feld' in eingabe) return void res.status(400).json(ungueltigesFeld(eingabe.feld));

			const zeit = jetzt();
			const modulId = req.params['modulId'] ?? '';
			const fuerId = req.params['fuerId'] ?? '';
			const ort = await modulOrt(db, modulId);
			// Info und Termin sind fuer diese Route "unbekannt": eine andere Antwort verriete,
			// dass es unter der ID ein Modul gibt.
			if (!ort || ort.typ !== 'UMFRAGE') return void res.status(404).json(NICHT_GEFUNDEN);
			const { threadId } = ort;
			const [umfeld, thread] = await Promise.all([ladeThreadUmfeld(db), ladeThread(db, threadId)]);
			const mich = umfeld.personen.get(person.id);
			const modul = thread?.module.find((m): m is Umfrage => m.typ === 'UMFRAGE' && m.id === modulId);
			if (!thread || !mich || !modul) return void res.status(404).json(NICHT_GEFUNDEN);

			// darfAntworten prueft zuerst Sichtbarkeit und "fuerId ist gefragt" und erst dann
			// Entwurf und Frist; NICHT_GEFUNDEN deckt also beides ab. Verworfen: gefragte hier
			// noch einmal aufzurufen -- dieselbe Regel stuende an zwei Stellen.
			const erlaubnis = darfAntworten(mich, fuerId, modul.umfrage, thread.kopf, umfeld, zeit);
			if (erlaubnis === 'NICHT_GEFUNDEN') return void res.status(404).json(NICHT_GEFUNDEN);

			const suche = () => db.umfrageAntwort.findFirst({ where: { clientId: eingabe.clientId }, select: AUSWAHL });
			/**
			 * Die Umfrage, wie die Person sie jetzt sieht, und der Stand, bis zu dem sie geladen
			 * ist: nach dem Schreiben der eigene Stand, bei einer Wiederholung der des Vereins,
			 * gelesen vor der Umfrage (siehe ladeVereinsstand). Umfeld und Person bleiben die
			 * von oben, eine Antwort aendert an ihnen nichts.
			 */
			const ansicht = async (stand?: number): Promise<{ modul: UmfrageAnsicht; stand: number }> => {
				const geladenBis = stand ?? (await ladeVereinsstand(db, verein.id));
				const neu = await ladeThread(db, threadId);
				const umfrage = neu?.module.find((m): m is Umfrage => m.typ === 'UMFRAGE' && m.id === modulId);
				// Eine Umfrage mit Antwort laesst sich nicht loeschen (NoAction auf
				// UmfrageAntwort.umfrage): fehlt sie hier, sind die Daten kaputt.
				if (!neu || !umfrage) throw new Error('Umfrage nach dem Antworten nicht mehr da');
				return { modul: umfrageAnsicht(mich, umfrage, neu.kopf, umfeld, zeit), stand: geladenBis };
			};

			// Die Wiederholung vor Entwurf und Frist (Entscheidung 2): Eine gespeicherte Antwort,
			// deren Rueckmeldung unterwegs verloren ging, waere sonst eine 410, wenn die Outbox
			// sie nach der Frist wiederholt, und der Client hielte sie fuer gescheitert. Nach der
			// 404, damit eine clientId nichts ueber eine unsichtbare Umfrage verraet. Verworfen:
			// die Suche erst hinter Entwurf und Frist -- dann scheiterte genau die Wiederholung,
			// fuer die es die clientId gibt.
			const vorab = await suche();
			if (vorab) {
				const ende = urteil(vorab, person.id, modulId, fuerId);
				if (ende instanceof Wiederholung) return void res.status(200).json(await ansicht());
				return void antworteThreadFehler(res, ende);
			}
			if (erlaubnis === 'ENTWURF') return void res.status(409).json(ENTWURF);
			if (erlaubnis === 'FRIST_ABGELAUFEN') return void res.status(410).json(FRIST_ABGELAUFEN);

			if (!passtZurUmfrage(modul.umfrage, eingabe.optionIds))
				return void res.status(400).json(ungueltigesFeld('optionen'));

			let fehler: unknown;
			try {
				const { stand, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, (stand) =>
						schreibeAntwort(
							tx,
							{
								personId: person.id,
								threadId,
								modulId,
								fuerId,
								optionIds: eingabe.optionIds,
								clientId: eingabe.clientId,
								zeit,
							},
							stand,
						),
					),
				);
				// Nach dem Commit und vor der Ansicht: Die Antwort ist gespeichert, auch wenn das
				// Laden der Ansicht scheitert, und andere Geraete sollen davon erfahren.
				bus.melde({ typ: 'aenderung', vereinId: verein.id, stand, aenderungen, eintraege: [] });
				return void res.status(200).json(await ansicht(stand));
			} catch (error) {
				fehler = error;
			}

			// P2002 auf (vereinId, clientId) oder (umfrageId, fuerId): Ein Schreiber ohne die
			// Sperre war schneller. Wie in verlauf.ts gilt dann dasselbe Urteil wie unter der
			// Sperre; findet sich die clientId nicht, bleibt es beim urspruenglichen Fehler.
			if ((fehler as { code?: unknown } | null)?.code === 'P2002') {
				const vorhanden = await suche();
				if (vorhanden) fehler = urteil(vorhanden, person.id, modulId, fuerId);
			}
			if (fehler instanceof Wiederholung) return void res.status(200).json(await ansicht());
			antworteThreadFehler(res, fehler);
		}),
	);
}
