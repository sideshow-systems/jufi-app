import type { PrismaClient } from '@jufi/db';
import { dateiSchluessel, type DateiSpeicher } from './speicher.js';

const STUNDE_MS = 60 * 60 * 1000;
/** So lange liegen Bytes nach dem Loeschen noch da (Spec 2.7) und so alt muss eine Waise sein. */
export const DATEI_FRIST_MS = 24 * STUNDE_MS;
/** Temp-Dateien eines laufenden Uploads sind nach einer Stunde laengst fertig oder tot. */
export const TEMP_FRIST_MS = STUNDE_MS;
/** Wie viele Schluessel eine Abfrage auf einmal prueft; eine je Datei waere eine Anfrageflut. */
const PAKET = 500;

const VORSCHAU = '.vorschau';

export interface DateienBilanz {
	geloescht: number;
	waisen: number;
	temp: number;
	fehlend: number;
}

function fehlerName(fehler: unknown): string {
	// Nur der Name (Spec 4.4): Die Meldung einer Stoerung kann Pfade oder die DATABASE_URL tragen.
	return fehler instanceof Error ? fehler.name : typeof fehler;
}

/** Vereins- und Datei-ID aus einem Schluessel `<verein>/<datei>[.vorschau]`, oder null. */
function zerlege(schluessel: string): { vereinId: string; dateiId: string } | null {
	const teile = schluessel.split('/');
	if (teile.length !== 2 || !teile[0] || !teile[1]) return null;
	const dateiId = teile[1].endsWith(VORSCHAU) ? teile[1].slice(0, -VORSCHAU.length) : teile[1];
	return dateiId === '' ? null : { vereinId: teile[0], dateiId };
}

/**
 * Raeumt die Dateien plattformweit auf, ueber den schlichten Client: Die Fristen gelten fuer
 * alle Vereine gleich, und vereinDb setzte einen Verein voraus. Die Reihenfolge ist Absicht:
 *
 * 1. Die Loeschliste zuerst, weil sie der geplante Weg ist; Bytes vor Zeile, damit ein Abbruch
 *    dazwischen den Eintrag stehen laesst und der naechste Lauf es wiederholt (loesche ist
 *    wiederholbar).
 * 2. Waisen: Bytes ohne Zeile und ohne Listeneintrag, die ein Fehlerpfad (Abbruch zwischen
 *    uebernimm und Insert, Rollback) hinterlassen hat. Erst nach 24 Stunden, damit ein Upload,
 *    der zwischen uebernimm und Commit steckt, nicht seine eigenen Bytes verliert.
 * 3. Temp-Dateien.
 * 4. Zeilen ohne Bytes werden nur gemeldet, nie geloescht: Das ist ein Datenverlust, den ein
 *    Mensch ansehen muss (Restore aus der Sicherung), und eine geloeschte Zeile verwischte ihn.
 *    Der Zeitpunkt der Liste kann vor einem Upload liegen, dessen Zeile bis zur Abfrage da ist;
 *    das ergibt hoechstens eine falsche Meldung, keinen Schaden.
 */
export async function raeumeDateienAuf(
	prisma: PrismaClient,
	speicher: DateiSpeicher,
	jetzt: Date,
): Promise<DateienBilanz> {
	const bilanz: DateienBilanz = { geloescht: 0, waisen: 0, temp: 0, fehlend: 0 };

	// 1. Loeschliste
	const faellig = await prisma.dateiLoeschung.findMany({
		where: { geloeschtAm: { lt: new Date(jetzt.getTime() - DATEI_FRIST_MS) } },
		select: { schluessel: true },
	});
	for (const { schluessel } of faellig) {
		try {
			await speicher.loesche(schluessel);
			await prisma.dateiLoeschung.deleteMany({ where: { schluessel } });
			bilanz.geloescht++;
		} catch (fehler) {
			// Ein Eintrag, der nicht geht, soll die anderen und die Schritte danach nicht blockieren.
			console.error(`Aufraeumen: Loeschliste ${schluessel} gescheitert (${fehlerName(fehler)})`);
		}
	}

	// 2. Waisen. Die Liste wird dabei fuer Schritt 4 gemerkt.
	const vorhanden = new Set<string>();
	const kandidaten: string[] = [];
	const waisenGrenze = jetzt.getTime() - DATEI_FRIST_MS;
	for await (const { schluessel, geaendertAm } of speicher.liste()) {
		vorhanden.add(schluessel);
		if (geaendertAm.getTime() < waisenGrenze) kandidaten.push(schluessel);
	}
	for (let von = 0; von < kandidaten.length; von += PAKET) {
		const paket = kandidaten.slice(von, von + PAKET);
		const ids = new Set<string>();
		for (const schluessel of paket) {
			const teile = zerlege(schluessel);
			if (teile) ids.add(teile.dateiId);
		}
		const zeilen = await prisma.datei.findMany({
			where: { id: { in: [...ids] } },
			select: { id: true, vereinId: true },
		});
		const gebraucht = new Set(zeilen.map((z) => dateiSchluessel(z.vereinId, z.id)));
		const gemerkt = new Set(
			(
				await prisma.dateiLoeschung.findMany({ where: { schluessel: { in: paket } }, select: { schluessel: true } })
			).map((z) => z.schluessel),
		);
		for (const schluessel of paket) {
			const teile = zerlege(schluessel);
			// Ein Schluessel, der keiner ist (fremde Datei im Volume), bleibt: Der Aufraeumer loescht
			// nur, was er als seine Waise erkennt.
			if (!teile) continue;
			if (gebraucht.has(dateiSchluessel(teile.vereinId, teile.dateiId)) || gemerkt.has(schluessel)) continue;
			await speicher.loesche(schluessel);
			bilanz.waisen++;
		}
	}

	// 3. Temp-Dateien
	bilanz.temp = await speicher.raeumeTempAuf(new Date(jetzt.getTime() - TEMP_FRIST_MS));

	// 4. Zeilen ohne Bytes
	const zeilen = await prisma.datei.findMany({ select: { id: true, vereinId: true } });
	bilanz.fehlend = zeilen.filter((z) => !vorhanden.has(dateiSchluessel(z.vereinId, z.id))).length;
	if (bilanz.fehlend > 0) {
		console.error(`Aufraeumen: ${bilanz.fehlend} Dateien ohne Bytes im Speicher (Restore pruefen)`);
	}

	return bilanz;
}
