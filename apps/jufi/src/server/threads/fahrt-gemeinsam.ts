import type { VereinDb, VereinTx } from '@jufi/db';
import {
	fahrtAnsicht,
	threadDatenAus,
	type FahrtErlaubnis,
	type FahrtModulAnsicht,
	type ModulDaten,
	type ThreadDaten,
	type ThreadPerson,
	type Umfeld,
} from '@jufi/domain';
import type { Response } from 'express';
import { antworteThreadFehler, ARCHIVIERT, ENTWURF, NICHT_DABEI, NICHT_GEFUNDEN, ThreadAbbruch } from './fehler.js';
import { ladeThread, ladeThreadUmfeld, ladeVereinsstand } from './laden.js';

/*
 * Was die Routen der Fahrgemeinschaft gemeinsam brauchen (autos.ts, mitfahrten.ts): den Stand
 * laden, auf dem die Regeln entscheiden, die Erlaubnis in die Antwort uebersetzen und die
 * Ansicht senden. Gebaut wie ladeLage und ansicht in helfer.ts; die Gruende stehen dort.
 */

export type FahrtModulDaten = Extract<ModulDaten, { typ: 'FAHRT' }>;

/**
 * Alles, worauf die Regeln schauen, an einer Stelle geladen: vor der Sperre aus vereinDb, unter
 * ihr aus der Transaktion. null heisst "nicht (mehr) da" und wird ueberall zur 404. Verworfen:
 * unter der Sperre nur Auto oder Mitfahrt neu lesen -- ob die Person noch fahren oder einsetzen
 * darf, haengt an Zielgruppe, Familie und Zusage (helfer.ts, ladeLage).
 */
export interface FahrtLage {
	mich: ThreadPerson;
	umfeld: Umfeld;
	daten: ThreadDaten;
	modul: FahrtModulDaten;
}

export async function ladeFahrtLage(
	db: VereinDb | VereinTx,
	personId: string,
	threadId: string,
	modulId: string,
): Promise<FahrtLage | null> {
	const [umfeld, thread] = await Promise.all([ladeThreadUmfeld(db), ladeThread(db, threadId)]);
	const mich = umfeld.personen.get(personId);
	const modul = thread?.module.find((m): m is FahrtModulDaten => m.typ === 'FAHRT' && m.id === modulId);
	if (!thread || !mich || !modul) return null;
	return { mich, umfeld, daten: threadDatenAus(thread.kopf, thread.module), modul };
}

/**
 * Zu welcher Fahrgemeinschaft und welchem Thread ein Auto gehoert; null, wenn es im Verein kein
 * solches Auto gibt. Die Routen /autos/:id kennen nur das Auto (wie positionOrt fuer die
 * Helferliste); die threadId steht an der Fahrgemeinschaft, ein Weg in einen fremden Verein
 * fuehrt ueber vereinDb und die zusammengesetzten Fremdschluessel nicht.
 */
export async function autoOrt(
	db: VereinDb | VereinTx,
	autoId: string,
): Promise<{ modulId: string; threadId: string } | null> {
	const auto = await db.auto.findUnique({
		where: { id: autoId },
		select: { modulId: true, modul: { select: { threadId: true } } },
	});
	return auto ? { modulId: auto.modulId, threadId: auto.modul.threadId } : null;
}

/**
 * Die Antwort zu einer Erlaubnis der Regeln, an einer Stelle fuer vor und unter der Sperre.
 * ARCHIVIERT ist die vorhandene 409 des Archivs, ENTWURF die des Entwurfs.
 */
export function abbruchAus(erlaubnis: FahrtErlaubnis): ThreadAbbruch | null {
	switch (erlaubnis) {
		case 'NICHT_GEFUNDEN':
			return new ThreadAbbruch(404, NICHT_GEFUNDEN);
		case 'ENTWURF':
			return new ThreadAbbruch(409, ENTWURF);
		case 'ARCHIVIERT':
			return new ThreadAbbruch(409, ARCHIVIERT);
		case 'NICHT_DABEI':
			return new ThreadAbbruch(409, NICHT_DABEI);
		case 'ERLAUBT':
			return null;
	}
}

/**
 * Die Fahrgemeinschaft, wie die Person sie jetzt sieht, und der Stand, bis zu dem sie geladen ist
 * (wie ansicht in helfer.ts: ohne `stand` wird er vor den Daten gelesen). Person und Umfeld bleiben
 * die von vor dem Schreiben. Fehlt das Modul, ist das ein echtes Rennen (der Editor entfernte die
 * Fahrgemeinschaft zwischen Schreiben und Lesen), also 404 und kein Error.
 */
export async function fahrtAntwort(
	db: VereinDb,
	vereinId: string,
	lage: FahrtLage,
	zeit: Date,
	stand?: number,
): Promise<{ modul: FahrtModulAnsicht; stand: number }> {
	const geladenBis = stand ?? (await ladeVereinsstand(db, vereinId));
	const neu = await ladeThread(db, lage.daten.kopf.id);
	const modul = neu?.module.find((m): m is FahrtModulDaten => m.typ === 'FAHRT' && m.id === lage.modul.id);
	if (!neu || !modul) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
	const daten = threadDatenAus(neu.kopf, neu.module);
	return { modul: fahrtAnsicht(lage.mich, modul, daten, lage.umfeld, zeit), stand: geladenBis };
}

/** Sendet das Ergebnis von `laden` mit dem Status; scheitert es, die Antwort zum Fehler. */
export async function antworteMitFahrtAnsicht(
	res: Response,
	status: 200 | 201,
	laden: () => Promise<{ modul: FahrtModulAnsicht; stand: number }>,
): Promise<void> {
	try {
		res.status(status).json(await laden());
	} catch (error) {
		antworteThreadFehler(res, error);
	}
}
