import type { Person, VereinDb } from '@jufi/db';
import { siehtThread, threadAnsicht, type ThreadAnsicht } from '@jufi/domain';
import { ladeThread, ladeThreadUmfeld, ladeVereinsstand } from './laden.js';

export type GelesenBereich = 'uebersicht' | 'verlauf';

/**
 * Die Ansicht eines Threads fuer eine Person, oder null, wenn sie ihn nicht sehen darf
 * oder es ihn nicht gibt (die Route macht daraus dieselbe 404).
 *
 * Der Vereinsstand wird zuerst gelesen, alles andere danach: Unter READ COMMITTED ist,
 * was spaeter geladen wird, mindestens so neu wie dieser Stand (siehe ladeVereinsstand).
 * Die Abfragen danach laufen nebeneinander, weil jede nur den bereits gelesenen Stand
 * voraussetzt.
 *
 * Fuer den Zaehler laden wir nur Nachrichten ueber dem Gelesen-Stand; ohne Zeile alle,
 * die Entscheidung "ab dem Zugang" trifft die Domaene. Verworfen: hier schon nach
 * Zugangszeit filtern -- die Regel stuende an zwei Stellen und liefe auseinander.
 */
export async function ladeThreadAnsicht(
	db: VereinDb,
	vereinId: string,
	ich: Person,
	zugangSeit: Date,
	threadId: string,
	jetzt: Date,
): Promise<ThreadAnsicht | null> {
	const stand = await ladeVereinsstand(db, vereinId);
	const [umfeld, geladen, gelesen, verlaufEintraege] = await Promise.all([
		ladeThreadUmfeld(db),
		ladeThread(db, threadId),
		db.gelesenStand.findUnique({
			where: { personId_threadId: { personId: ich.id, threadId } },
			select: { verlaufGelesenBis: true },
		}),
		db.verlaufEintrag.count({ where: { threadId } }),
	]);
	if (!geladen) return null;
	const mich = umfeld.personen.get(ich.id);
	if (!mich) return null;

	const nachrichten = await db.verlaufEintrag.findMany({
		where: {
			threadId,
			art: 'NACHRICHT',
			...(gelesen ? { stand: { gt: gelesen.verlaufGelesenBis } } : {}),
		},
		select: { art: true, stand: true, autorId: true, angelegtAm: true, geloeschtAm: true },
	});

	return threadAnsicht({
		ich: mich,
		kopf: geladen.kopf,
		module: geladen.module,
		umfeld,
		stand,
		verlaufEintraege,
		nachrichten,
		zugangSeit,
		verlaufGelesenBis: gelesen?.verlaufGelesenBis ?? null,
		jetzt,
	});
}

/**
 * Ob die Person den Thread sehen darf. Dieselbe Regel wie in der Ansicht (siehtThread,
 * ebenfalls mit der Person aus dem Umfeld), nur ohne Verlauf und Zaehler. Verworfen:
 * dafuer die ganze Ansicht zu berechnen -- das Oeffnen eines Threads ruft das hier bei
 * jedem Wechsel des Reiters auf.
 */
export async function darfThreadSehen(db: VereinDb, personId: string, threadId: string): Promise<boolean> {
	const [umfeld, geladen] = await Promise.all([ladeThreadUmfeld(db), ladeThread(db, threadId)]);
	const mich = umfeld.personen.get(personId);
	return geladen !== null && mich !== undefined && siehtThread(mich, geladen.kopf, umfeld);
}

function istEindeutigVerletzt(error: unknown): boolean {
	return (error as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Setzt den Gelesen-Stand hoch: `max(alt, min(bis, aktueller Stand))`. Der Aufrufer hat
 * schon geprueft, dass die Person den Thread sieht.
 *
 * - Die Kappung auf den Vereinsstand verhindert, dass ein Client etwas als gelesen
 *   markiert, das es noch gar nicht gibt (und spaeter nie als "neu" erschiene).
 * - `lt` im updateMany macht den Stand monoton: ein langsames Geraet setzt ihn nicht zurueck,
 *   und zwei gleichzeitige Aufrufe enden beim groesseren Wert, ohne zu lesen und zu schreiben.
 * - Legt `uebersicht` die Zeile an, steht `verlaufGelesenBis` auf dem letzten Eintrag vor
 *   dem Zugang. Verworfen: 0 -- sobald die Zeile da ist, zaehlt der Zaehler nach Stand statt
 *   nach Zugangszeit, und alles, was vor dem Zugang geschrieben wurde, galte als ungelesen.
 *   Danach fasst `uebersicht` das Feld nie mehr an: wer nur die Karten gesehen hat, hat den
 *   Verlauf nicht gelesen.
 * - Der erste Aufruf legt per upsert an; zwei gleichzeitige erste Aufrufe koennen beide
 *   an der Vorabsuche vorbei in den Unique-Index laufen (P2002), dann genuegt ein zweiter
 *   Durchlauf, der die Zeile findet.
 *
 * Kein mitAenderung (Plan-Entscheidung 1): Das Oeffnen eines Threads soll weder den
 * Aenderungsstand erhoehen noch die Aktivitaet des Threads.
 */
export async function setzeGelesen(
	db: VereinDb,
	vereinId: string,
	personId: string,
	zugangSeit: Date,
	threadId: string,
	bereich: GelesenBereich,
	bis: number,
	jetzt: Date,
): Promise<void> {
	const stand = await ladeVereinsstand(db, vereinId);
	const neu = Math.min(bis, stand);
	const where = { personId_threadId: { personId, threadId } };

	const vorhanden = await db.gelesenStand.findUnique({ where, select: { personId: true } });
	if (!vorhanden) {
		let verlaufStart = neu;
		if (bereich === 'uebersicht') {
			const davor = await db.verlaufEintrag.aggregate({
				where: { threadId, angelegtAm: { lt: zugangSeit } },
				_max: { stand: true },
			});
			verlaufStart = davor._max.stand ?? 0;
		}
		for (let versuch = 1; ; versuch++) {
			try {
				await db.gelesenStand.upsert({
					where,
					create: { personId, threadId, gelesenBis: neu, verlaufGelesenBis: verlaufStart, gelesenAm: jetzt },
					update: {},
				});
				break;
			} catch (error) {
				if (versuch < 2 && istEindeutigVerletzt(error)) continue;
				throw error;
			}
		}
	}

	await db.gelesenStand.updateMany({
		where: { personId, threadId, gelesenBis: { lt: neu } },
		data: { gelesenBis: neu, gelesenAm: jetzt },
	});
	if (bereich === 'verlauf') {
		await db.gelesenStand.updateMany({
			where: { personId, threadId, verlaufGelesenBis: { lt: neu } },
			data: { verlaufGelesenBis: neu, gelesenAm: jetzt },
		});
	}
}
