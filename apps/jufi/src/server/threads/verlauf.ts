import { mitAenderung, type VereinDb } from '@jufi/db';
import {
	darfLoeschenNachricht,
	schreibSperre,
	siehtThread,
	threadDatenAus,
	verlaufAnsicht,
	type ThreadPerson,
	type Umfeld,
	type VerlaufAnsicht,
	type VerlaufEintragDaten,
} from '@jufi/domain';
import type { Router } from 'express';
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
	NICHT_GEFUNDEN,
	NUR_AUSHANG,
	ThreadAbbruch,
	Wiederholung,
	type Antwortkoerper,
} from './fehler.js';
import { ladeThread, ladeThreadUmfeld, type GeladenerThread } from './laden.js';

const SEITE = 50;
const MAX_ZEICHEN = 2000;

/** Was verlaufAnsicht braucht, dazu der Thread fuer die Pruefung einer Wiederholung. */
const AUSWAHL = {
	id: true,
	threadId: true,
	art: true,
	autorId: true,
	text: true,
	systemArt: true,
	systemDaten: true,
	stand: true,
	angelegtAm: true,
	geloeschtAm: true,
	geloeschtVonId: true,
} as const;

type Eintrag = VerlaufEintragDaten & { threadId: string };

const SPERRE_ANTWORT: Record<'ENTWURF' | 'NUR_AUSHANG' | 'ARCHIVIERT', Antwortkoerper> = {
	ENTWURF,
	NUR_AUSHANG,
	ARCHIVIERT,
};

/**
 * Ein einzelnes UTF-16-Surrogat ohne Partner. Im u-Modus verbindet der Ausdruck gueltige
 * Paare zu einem Code-Point, uebrig bleiben nur die verwaisten Haelften. Verworfen:
 * String.prototype.isWellFormed -- gleichwertig, aber erst ES2024, und das Projekt
 * uebersetzt gegen die Typen von ES2022.
 */
const EINZELNES_SURROGAT = /\p{Cs}/u;

/**
 * Text und clientId einer neuen Nachricht, oder das Feld, an dem es scheitert. Gezaehlt
 * wird in Code-Points wie char_length im CHECK verlauf_text, gespeichert ohne Leerraum an
 * den Enden. Verworfen: text.length -- ein Emoji zaehlte doppelt, und 1500 Emoji stiessen
 * an eine Grenze, die die Datenbank gar nicht zieht.
 *
 * Ein verwaistes Surrogat (JSON erlaubt "\ud800") ist kein Zeichen: Beim Schreiben als
 * UTF-8 wuerde es still zu U+FFFD, gespeichert stuende also etwas anderes als gesendet.
 */
function liesNachricht(body: unknown): { text: string; clientId: string } | { feld: string } {
	const { text, clientId } = (typeof body === 'object' && body !== null ? body : {}) as {
		text?: unknown;
		clientId?: unknown;
	};
	const gekuerzt = typeof text === 'string' ? text.trim() : '';
	const zeichen = [...gekuerzt].length;
	if (zeichen < 1 || zeichen > MAX_ZEICHEN || EINZELNES_SURROGAT.test(gekuerzt)) return { feld: 'text' };
	const id = liesClientId(clientId);
	if (id === null) return { feld: 'clientId' };
	return { text: gekuerzt, clientId: id };
}

interface ThreadLage {
	mich: ThreadPerson;
	thread: GeladenerThread;
	umfeld: Umfeld;
}

/**
 * Thread, Umfeld und die eigene Person darin; null, wenn es den Thread im Verein nicht
 * gibt oder die Person nicht (mehr) im Umfeld steht. Ob sie ihn sehen oder darin schreiben
 * darf, entscheidet die Route: Lesen und Loeschen fragen siehtThread, Schreiben schreibSperre.
 */
async function ladeLage(db: VereinDb, personId: string, threadId: string): Promise<ThreadLage | null> {
	const [umfeld, thread] = await Promise.all([ladeThreadUmfeld(db), ladeThread(db, threadId)]);
	const mich = umfeld.personen.get(personId);
	return thread && mich ? { mich, thread, umfeld } : null;
}

/**
 * Was eine vorhandene clientId bedeutet: dieselbe Nachricht noch einmal (gleicher Absender,
 * gleicher Thread) oder eine fremde. Zurueckgegeben, damit dieselbe Entscheidung vor, in und
 * nach der Transaktion gilt; in der Transaktion wird das Ergebnis geworfen und rollt den
 * Stand zurueck.
 */
function urteil(vorhanden: Eintrag, personId: string, threadId: string): Wiederholung<Eintrag> | ThreadAbbruch {
	const dieselbe = vorhanden.art === 'NACHRICHT' && vorhanden.autorId === personId && vorhanden.threadId === threadId;
	return dieselbe ? new Wiederholung(vorhanden) : new ThreadAbbruch(409, CLIENT_ID_VERGEBEN);
}

/** GET/POST /threads/:id/verlauf und DELETE /verlauf/:eintragId. */
export function verlaufRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, nachrichtenFenster } = deps;

	router.get(
		'/threads/:id/verlauf',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const threadId = req.params['id'] ?? '';
			const u = await ladeLage(db, person.id, threadId);
			if (!u || !siehtThread(u.mich, u.thread.kopf, u.umfeld)) return void res.status(404).json(NICHT_GEFUNDEN);

			// Seiten haengen an einem Eintrag, nicht an einer Nummer: kommt oben etwas dazu,
			// rutscht nichts doppelt auf die naechste Seite. Ein vor aus einem anderen Thread
			// ist hier "unbekannt", sonst liesse sich fremder Verlauf an einem eigenen Thread
			// abzaehlen.
			const vorWert = req.query['vor'];
			let vor: { id: string; stand: number } | null = null;
			if (vorWert !== undefined) {
				vor =
					typeof vorWert === 'string'
						? await db.verlaufEintrag.findFirst({ where: { id: vorWert, threadId }, select: { id: true, stand: true } })
						: null;
				if (!vor) return void res.status(404).json(NICHT_GEFUNDEN);
			}

			// (stand, id) statt nur stand: Eintraege eines Standes (mehrere Zeilen einer
			// Aenderung) haetten sonst keine feste Reihenfolge, und an der Seitengrenze fiele
			// einer heraus oder kaeme doppelt. Einer mehr als die Seite verraet, ob es weitergeht,
			// ohne eigene Zaehlabfrage.
			const zeilen = await db.verlaufEintrag.findMany({
				where: {
					threadId,
					...(vor ? { OR: [{ stand: { lt: vor.stand } }, { stand: vor.stand, id: { lt: vor.id } }] } : {}),
				},
				orderBy: [{ stand: 'desc' }, { id: 'desc' }],
				take: SEITE + 1,
				select: AUSWAHL,
			});
			const eintraege: VerlaufAnsicht[] = zeilen
				.slice(0, SEITE)
				.map((e) => verlaufAnsicht(u.mich, u.thread.kopf, e, u.umfeld));
			res.json({ eintraege, weitere: zeilen.length > SEITE });
		}),
	);

	router.post(
		'/threads/:id/verlauf',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			// Vor dem ersten await, damit gleichzeitige Anfragen das Fenster nicht unterlaufen
			// (wie reserviere). Auch eine Wiederholung zaehlt: der Server weiss vorher nicht,
			// dass es eine ist, und ein Client, der in der Schleife wiederholt, soll ebenso bremsen.
			const warten = nachrichtenFenster.pruefe(`${verein.id}:${person.id}`);
			if (warten > 0) return void zuVieleVersuche(res, warten);
			// Der Koerper vor dem Thread: die 400 verraet ueber den Thread nichts.
			const eingabe = liesNachricht(req.body);
			if ('feld' in eingabe) return void res.status(400).json(ungueltigesFeld(eingabe.feld));

			const zeit = jetzt();
			const threadId = req.params['id'] ?? '';
			const u = await ladeLage(db, person.id, threadId);
			if (!u) return void res.status(404).json(NICHT_GEFUNDEN);
			const sperre = schreibSperre(
				u.mich,
				u.thread.kopf,
				u.umfeld,
				threadDatenAus(u.thread.kopf, u.thread.module).termine,
				zeit,
			);
			if (sperre === 'NICHT_GEFUNDEN') return void res.status(404).json(NICHT_GEFUNDEN);

			const antwort = (e: Eintrag) => ({ eintrag: verlaufAnsicht(u.mich, u.thread.kopf, e, u.umfeld), stand: e.stand });
			const suche = () => db.verlaufEintrag.findFirst({ where: { clientId: eingabe.clientId }, select: AUSWAHL });

			// Vorab ohne Transaktion: die haeufigste Wiederholung (das Netz brach nach dem
			// Commit ab) kostet so weder Sperre noch Stand. Entscheidend ist erst die Suche
			// unter der Sperre (Entscheidung 2), denn zwei gleichzeitige Anfragen laufen beide
			// an dieser vorbei. Sie steht nach der 404, damit eine fremde clientId nichts ueber
			// einen unsichtbaren Thread verraet, aber vor Entwurf, Modus und Archiv: Eine
			// gespeicherte Nachricht, deren Rueckmeldung unterwegs verloren ging, wird sonst zur
			// 409, wenn die Outbox sie nach dem Archivieren wiederholt, und der Client haelt sie
			// fuer gescheitert. Verworfen: die Suche erst hinter den 409 -- dann scheiterte genau die
			// Wiederholung, fuer die es die clientId gibt.
			const vorab = await suche();
			if (vorab) {
				const ende = urteil(vorab, person.id, threadId);
				if (ende instanceof Wiederholung) return void res.status(200).json(antwort(vorab));
				return void antworteThreadFehler(res, ende);
			}
			if (sperre) return void res.status(409).json(SPERRE_ANTWORT[sperre]);

			let fehler: unknown;
			try {
				const { ergebnis } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, async (stand) => {
						const vorhanden = await tx.verlaufEintrag.findFirst({
							where: { clientId: eingabe.clientId },
							select: AUSWAHL,
						});
						if (vorhanden) throw urteil(vorhanden, person.id, threadId);
						const eintrag = await tx.verlaufEintrag.create({
							data: {
								threadId,
								art: 'NACHRICHT',
								autorId: person.id,
								text: eingabe.text,
								stand,
								angelegtAm: zeit,
								clientId: eingabe.clientId,
							},
							select: AUSWAHL,
						});
						return { ergebnis: eintrag, aenderungen: [{ threadId, art: 'VERLAUF' as const, objektId: eintrag.id }] };
					}),
				);
				return void res.status(201).json(antwort(ergebnis));
			} catch (error) {
				fehler = error;
			}

			// P2002 auf (vereinId, clientId), den einzigen weiteren Unique-Index der Tabelle:
			// Ein Schreiber ohne die Sperre war schneller. Dann gilt dasselbe Urteil wie unter
			// der Sperre; findet sich die Zeile nicht, bleibt es beim urspruenglichen Fehler.
			if ((fehler as { code?: unknown } | null)?.code === 'P2002') {
				const vorhanden = await suche();
				if (vorhanden) fehler = urteil(vorhanden, person.id, threadId);
			}
			if (fehler instanceof Wiederholung) return void res.status(200).json(antwort(fehler.vorhanden as Eintrag));
			antworteThreadFehler(res, fehler);
		}),
	);

	router.delete(
		'/verlauf/:eintragId',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const eintragId = req.params['eintragId'] ?? '';
			const eintrag = await db.verlaufEintrag.findUnique({
				where: { id: eintragId },
				select: { threadId: true, art: true, autorId: true, geloeschtAm: true },
			});
			if (!eintrag) return void res.status(404).json(NICHT_GEFUNDEN);
			const u = await ladeLage(db, person.id, eintrag.threadId);
			if (!u || !siehtThread(u.mich, u.thread.kopf, u.umfeld)) return void res.status(404).json(NICHT_GEFUNDEN);
			// Gefragt wird, ob die Person die Nachricht loeschen duerfte, stuende sie noch:
			// darfLoeschenNachricht verneint fuer eine geloeschte, das zweite Loeschen ist aber
			// eine Wiederholung und kein Verbot. Wer nie loeschen durfte, bekommt weiter 404
			// und erfaehrt nicht, dass die Nachricht schon weg ist. Keine schreibSperre: die
			// eigene Nachricht darf auch im Archiv weg (darfLoeschenNachricht).
			if (!darfLoeschenNachricht(u.mich, { ...eintrag, geloeschtAm: null }, u.thread.kopf)) {
				return void res.status(404).json(NICHT_GEFUNDEN);
			}
			if (eintrag.geloeschtAm) return void res.status(204).end();

			const zeit = jetzt();
			try {
				await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, async () => {
						// Bedingt auf "noch nicht geloescht" und unter der Sperre: Von zwei gleichzeitigen
						// Loeschungen findet die zweite nichts mehr und rollt ihren Stand zurueck.
						// Verworfen: die Vorabpruefung oben genuegen zu lassen -- beide liefen an ihr vorbei.
						const { count } = await tx.verlaufEintrag.updateMany({
							where: { id: eintragId, geloeschtAm: null },
							data: { text: null, geloeschtAm: zeit, geloeschtVonId: person.id },
						});
						if (count === 0) throw new Wiederholung(null);
						// VERLAUF statt GELOESCHT (Entscheidung 9): die Zeile bleibt stehen, und das
						// Loeschen zaehlt als Aktivitaet des Threads.
						return {
							ergebnis: null,
							aenderungen: [{ threadId: eintrag.threadId, art: 'VERLAUF' as const, objektId: eintragId }],
						};
					}),
				);
			} catch (error) {
				if (!(error instanceof Wiederholung)) return void antworteThreadFehler(res, error);
			}
			res.status(204).end();
		}),
	);
}
