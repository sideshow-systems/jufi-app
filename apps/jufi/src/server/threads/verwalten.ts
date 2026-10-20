import { mitAenderung, type AenderungEingabe, type VereinTx } from '@jufi/db';
import {
	darfArchivieren,
	darfBearbeiten,
	darfLoeschen,
	istArchiviert,
	siehtThread,
	threadDatenAus,
	verwaltungThread,
	type ThreadPerson,
} from '@jufi/domain';
import type { Request, Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { ladeBearbeitung, ladeUntergruppen, loeschZaehler } from './bearbeitung.js';
import { ungueltigesFeld } from './eingabe.js';
import {
	amFeld,
	antworteThreadFehler,
	AUSTAUSCH,
	KEINE_ZIELGRUPPE,
	NICHT_GEFUNDEN,
	NICHT_LOESCHBAR,
	ThreadAbbruch,
	Wiederholung,
} from './fehler.js';
import { ladeThread, ladeThreadUmfeld, type GeladenerThread } from './laden.js';
import { ichUnterSperre } from './schreiben.js';

/** Was die Arbeit unter der Sperre sieht: die Person und den Thread, beide erst nach der Sperre geladen. */
interface Lage {
	tx: VereinTx;
	ich: ThreadPerson;
	alt: GeladenerThread;
	stand: number;
	zeit: Date;
}

type Arbeit = (lage: Lage) => Promise<AenderungEingabe[]>;

/** Der boolesche Schalter `feld` des Koerpers, oder null, wenn er fehlt oder kein Boolean ist. */
function liesSchalter(body: unknown, feld: string): boolean | null {
	const wert = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[feld] : undefined;
	return typeof wert === 'boolean' ? wert : null;
}

const aenderung = (threadId: string, art: AenderungEingabe['art'], objektId = threadId): AenderungEingabe => ({
	threadId,
	art,
	objektId,
});

/**
 * Der gemeinsame Ablauf der vier Routen (Plan-Entscheidung 3): Wer den Thread nicht bearbeiten
 * darf, bekommt vorab ohne Sperre die 404 und verbraucht keinen Stand; entschieden wird erst
 * in `arbeit`, in der Arbeit von mitAenderung, nachdem die Vereinszeile gesperrt ist und
 * Person und Thread dort neu geladen sind. Zwischen Vorpruefung und Sperre kann jemand
 * antworten, den Editor speichern oder das Recht verlieren, und nur der Stand unter der
 * Sperre gilt. Verworfen: ladeLage einmal vorab und darauf entscheiden -- dann liefe die
 * Loeschbarkeit gegen einen Stand, den eine gleichzeitige Antwort schon ueberholt hat.
 *
 * Eine Wiederholung (der gewuenschte Zustand ist schon da) wirft `arbeit` als
 * Wiederholung: Sie rollt den vergebenen Stand zurueck, und die Route antwortet wie nach
 * einem Erfolg, nur ohne Stand und ohne Aenderung. Verworfen: 409 -- ein Doppelklick oder
 * ein zweites Geraet soll keinen Fehler zeigen, wenn das Ergebnis stimmt.
 *
 * `ohneAntwort`: Nach dem Loeschen gibt es keinen Thread mehr, den ladeBearbeitung laden
 * koennte; die Route antwortet dann 204.
 */
function verwalte(deps: VolleAppDeps, req: Request, res: Response, arbeit: Arbeit, ohneAntwort = false): Promise<void> {
	const { jetzt } = deps;
	return (async () => {
		const { verein, db } = vereinsKontext(res);
		const { person } = mitgliedKontext(res);
		const threadId = req.params['id'] ?? '';

		const [umfeld, vorab] = await Promise.all([ladeThreadUmfeld(db), ladeThread(db, threadId)]);
		const mich = umfeld.personen.get(person.id);
		if (!mich || !vorab || !siehtThread(mich, vorab.kopf, umfeld) || !darfBearbeiten(mich, vorab.kopf)) {
			return void res.status(404).json(NICHT_GEFUNDEN);
		}

		const zeit = jetzt();
		let ich: ThreadPerson;
		try {
			({ ergebnis: ich } = await db.$transaction((tx) =>
				mitAenderung(tx, verein.id, person.id, zeit, async (stand) => {
					const [ichJetzt, alt] = await Promise.all([ichUnterSperre(tx, person.id), ladeThread(tx, threadId)]);
					if (!ichJetzt || !alt || !darfBearbeiten(ichJetzt, alt.kopf)) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
					try {
						return { ergebnis: ichJetzt, aenderungen: await arbeit({ tx, ich: ichJetzt, alt, stand, zeit }) };
					} catch (error) {
						// Die Wiederholung braucht die Person fuer die Antwort; sie reist im Fehler mit.
						if (error instanceof Wiederholung) throw new Wiederholung(ichJetzt);
						throw error;
					}
				}),
			));
		} catch (error) {
			if (!(error instanceof Wiederholung)) return void antworteThreadFehler(res, error);
			ich = error.vorhanden as ThreadPerson;
		}

		if (ohneAntwort) return void res.status(204).end();
		const bearbeitung = await ladeBearbeitung(db, ich, threadId, umfeld, zeit);
		if (!bearbeitung) return void res.status(404).json(NICHT_GEFUNDEN);
		res.json(bearbeitung);
	})();
}

/**
 * Die Wiederholung, die `arbeit` wirft; die Person traegt verwalte nach. Eigene Funktion
 * statt `new Wiederholung(null)` an jeder Stelle: So steht an einem Ort, dass der Wert hier
 * nur ein Platzhalter ist.
 */
const wiederholung = () => new Wiederholung<null>(null);

/**
 * POST /threads/:id/veroeffentlichen, PUT /threads/:id/archiv, PUT /threads/:id/angepinnt und
 * DELETE /threads/:id (Spec 3.6, 3.7, 3.5; Plan-Entscheidungen 3, 4, 5, 7, 9).
 */
export function verwaltenRouten(router: Router, deps: VolleAppDeps): void {
	router.post(
		'/threads/:id/veroeffentlichen',
		brauchtMitglied,
		asynchron((req, res) =>
			verwalte(deps, req, res, async ({ tx, ich, alt, stand, zeit }) => {
				const threadId = alt.kopf.id;
				if (alt.kopf.veroeffentlichtAm !== null) throw wiederholung();
				// Dieselbe Regel wie die Liste der Verwaltung ("Keine Zielgruppe mehr"). Verworfen: sie
				// hier noch einmal herleiten -- Liste und Veroeffentlichen liefen auseinander.
				const namen = new Map((await ladeUntergruppen(tx)).map((g) => [g.id, g.name]));
				const zeile = verwaltungThread(ich, threadDatenAus(alt.kopf, alt.module), namen, zeit);
				if (zeile.keineZielgruppe) throw new ThreadAbbruch(409, amFeld(KEINE_ZIELGRUPPE, { feld: 'zielgruppe' }));

				await tx.thread.update({ where: { id: threadId }, data: { veroeffentlichtAm: zeit } });
				const eintrag = await tx.verlaufEintrag.create({
					data: {
						threadId,
						art: 'SYSTEM',
						autorId: ich.id,
						systemArt: 'VEROEFFENTLICHT',
						systemDaten: {},
						stand,
						angelegtAm: zeit,
					},
					select: { id: true },
				});
				return [
					aenderung(threadId, 'THREAD'),
					aenderung(threadId, 'SICHTBARKEIT'),
					aenderung(threadId, 'VERLAUF', eintrag.id),
				];
			}),
		),
	);

	router.put(
		'/threads/:id/archiv',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const gewuenscht = liesSchalter(req.body, 'archiviert');
			if (gewuenscht === null) return void res.status(400).json(ungueltigesFeld('archiviert'));
			return verwalte(deps, req, res, async ({ tx, ich, alt, zeit }) => {
				const threadId = alt.kopf.id;
				// Der Austausch wandert nie ins Archiv (darfArchivieren); wer ihn bearbeiten darf, bekommt
				// den Konflikt statt der 404. Vor der Wiederholung: "nicht archiviert" am Austausch ist
				// kein Erfolg, sondern ein Antrag, den es nicht gibt.
				if (!darfArchivieren(ich, alt.kopf)) throw new ThreadAbbruch(409, AUSTAUSCH);
				// Der Zustand, den der Leser sieht (inklusive Datumsregel), nicht der gespeicherte Modus:
				// Ein Thread, den die Termine schon archiviert haben, ist fuer "archivieren" eine
				// Wiederholung, und "wiederherstellen" setzt AKTIV_HALTEN, das die Datumsregel schlaegt.
				if (istArchiviert(alt.kopf, threadDatenAus(alt.kopf, alt.module).termine, zeit) === gewuenscht) {
					throw wiederholung();
				}
				await tx.thread.update({
					where: { id: threadId },
					data: { archivModus: gewuenscht ? 'ARCHIVIERT' : 'AKTIV_HALTEN' },
				});
				return [aenderung(threadId, 'LISTE')];
			});
		}),
	);

	router.put(
		'/threads/:id/angepinnt',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const gewuenscht = liesSchalter(req.body, 'angepinnt');
			if (gewuenscht === null) return void res.status(400).json(ungueltigesFeld('angepinnt'));
			return verwalte(deps, req, res, async ({ tx, alt }) => {
				const threadId = alt.kopf.id;
				if (alt.kopf.angepinnt === gewuenscht) throw wiederholung();
				await tx.thread.update({ where: { id: threadId }, data: { angepinnt: gewuenscht } });
				return [aenderung(threadId, 'LISTE')];
			});
		}),
	);

	router.delete(
		'/threads/:id',
		brauchtMitglied,
		asynchron((req, res) =>
			verwalte(
				deps,
				req,
				res,
				async ({ tx, ich, alt }) => {
					const threadId = alt.kopf.id;
					if (alt.kopf.art === 'JUGENDSPRECHER_AUSTAUSCH') throw new ThreadAbbruch(409, AUSTAUSCH);
					// Gezaehlt nach der Sperre (Entscheidung 3): Eine Antwort oder Nachricht, die zwischen
					// Vorpruefung und Sperre entsteht, ist hier schon sichtbar; die Fremdschluessel ohne
					// Kaskade haetten sie sonst erst als P2003 und damit als 404 gemeldet.
					const zaehler = await loeschZaehler(tx, threadDatenAus(alt.kopf, alt.module));
					if (!darfLoeschen(ich, alt.kopf, zaehler)) throw new ThreadAbbruch(409, NICHT_LOESCHBAR);
					await tx.thread.delete({ where: { id: threadId } });
					// GELOESCHT mit der ID des Threads, der nach dieser Transaktion nicht mehr existiert:
					// threadId und objektId sind absichtlich keine Fremdschluessel (Spec 2.6), und
					// mitAenderung fasst fuer GELOESCHT keinen Thread an (OHNE_AKTIVITAET). Verworfen:
					// threadId null -- ein Client, der nach Thread filtert, fuende die Loeschung nicht.
					return [aenderung(threadId, 'GELOESCHT')];
				},
				true,
			),
		),
	);
}
