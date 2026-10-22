import type { DateiDaten, FotoDaten, ModulDaten } from '../threads/ansicht.js';
import { nachAktivitaet } from '../threads/start.js';
import type { ThreadKopf } from '../threads/typen.js';
import type { DateiZeile } from './module.js';

// "A", "A und B", "A, B und C": Die Aufzaehlung der deutschen Saetze. Ohne Kuerzung; wer ab
// einer Grenze kuerzen will (kinderListe in threads/namen.ts, namenListe in threads/teilen.ts),
// hat ein anderes Ergebnis und behaelt seine eigene Funktion.
export function undListe(teile: readonly string[]): string {
	if (teile.length <= 1) return teile.join('');
	return `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`;
}

export type MedienZahl = { fotos: number; dateien: number; personen: number };

// Der Stand "nichts da": ein Thread oder Modul ohne Fotos und Dateien. Eine Konstante statt des
// Literals an jeder Stelle, damit die Zahlen nicht auseinanderlaufen, wenn ein Feld dazukommt.
export const KEINE_MEDIEN: MedienZahl = { fotos: 0, dateien: 0, personen: 0 };

const mal = (n: number, einzahl: string, mehrzahl: string): string => `${n} ${n === 1 ? einzahl : mehrzahl}`;

// Die Zahlen fuer die Rueckfrage im Editor ("Beim Speichern loescht das ..."). null, wenn
// nichts da ist: Dann gibt es nichts zu bestaetigen. Die Personen stehen nur bei den Fotos,
// weil "Dateien von 2 Personen" niemanden etwas fragt; wer eine Datei hochgeladen hat,
// ist fuer die Entscheidung unwichtig, wessen Gesicht auf einem Foto ist, nicht.
export function medienZahlText(z: MedienZahl): string | null {
	const fotos = z.fotos > 0 ? `${mal(z.fotos, 'Foto', 'Fotos')} von ${mal(z.personen, 'Person', 'Personen')}` : null;
	const dateien = z.dateien > 0 ? mal(z.dateien, 'Datei', 'Dateien') : null;
	if (fotos && dateien) return `${fotos} und ${dateien}`;
	return fotos ?? dateien;
}

// Die Grenzen eines Medienblocks (Plan, Medienblock): Die Seite ist eine Uebersicht, kein zweiter
// Thread. Wer mehr will, geht ueber "Zum Thread" dorthin, wo alle Fotos und Dateien stehen.
export const MEDIEN_VORSCHAU_MAX = 6;
export const MEDIEN_DATEIEN_MAX = 10;

// Ein Thread der Mediengalerie: Die Fotos und Dateien eines Threads in Kurzform. `fotos` zaehlt alle,
// `vorschau` nennt nur die IDs der neuesten; die Bilder holt der Client ueber die Vorschau-Route.
export interface MedienBlock {
	threadId: string;
	segment: string;
	titel: string;
	archiviert: boolean;
	fotos: number;
	vorschau: string[];
	dateien: DateiZeile[];
	weitereDateien: number;
}

export interface MedienAntwort {
	bloecke: MedienBlock[];
}

// Was medienBloecke je Thread braucht. Segment und Archivstatus kommen vom Aufrufer: Beide haengen
// an Regeln, die die Thread-Liste schon hat (threadSegment, istArchiviert mit Terminen und Uhr),
// und die Galerie soll sie nicht ein zweites Mal rechnen, sonst zeigt sie ein anderes Archiv als die Liste.
export interface MedienThread {
	kopf: ThreadKopf;
	segment: string;
	archiviert: boolean;
	letzteAktivitaetAm: Date;
	module: readonly ModulDaten[];
}

const zeitUndId = (a: { hochgeladenAm: Date; id: string }, b: { hochgeladenAm: Date; id: string }): number =>
	a.hochgeladenAm.getTime() - b.hochgeladenAm.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function dateiZeile(d: DateiDaten): DateiZeile {
	return { id: d.id, name: d.name, typ: d.typ, groesse: d.groesse, hochgeladenAm: d.hochgeladenAm.toISOString() };
}

// Die Mediengalerie (TP4-Spec 3.1): ein Block je Thread mit Fotos oder Dateien, nach letzter Aktivitaet
// wie die Thread-Liste (gleiche Ordnung, nachAktivitaet). Welche Threads die Person sehen darf, ist
// Sache des Aufrufers (siehtThread, nur veroeffentlicht); hier wird nur zusammengefasst.
// Die Vorschau sind die neuesten Fotos, weil das Neue das ist, wofuer man nachschaut; die Dateien
// dagegen in der Reihenfolge des Moduls, weil dort der Ersteller sie geordnet hat (Packliste vor
// Nachtrag). Verworfen: die Fotos nach Modul zu reihen -- bei zwei Foto-Modulen zeigte die Vorschau
// dann die Bilder des ersten, auch wenn im zweiten die neuen liegen.
export function medienBloecke(threads: readonly MedienThread[]): MedienBlock[] {
	const bloecke: MedienBlock[] = [];
	for (const t of [...threads].sort(nachAktivitaet)) {
		const fotos: FotoDaten[] = [];
		const dateien: DateiDaten[] = [];
		for (const m of t.module) {
			if (m.typ === 'FOTOS') fotos.push(...m.fotos);
			if (m.typ === 'DATEIEN') dateien.push(...[...m.dateien].sort(zeitUndId));
		}
		if (fotos.length === 0 && dateien.length === 0) continue;
		bloecke.push({
			threadId: t.kopf.id,
			segment: t.segment,
			titel: t.kopf.titel,
			archiviert: t.archiviert,
			fotos: fotos.length,
			vorschau: fotos
				.sort((a, b) => -zeitUndId(a, b))
				.slice(0, MEDIEN_VORSCHAU_MAX)
				.map((f) => f.id),
			dateien: dateien.slice(0, MEDIEN_DATEIEN_MAX).map(dateiZeile),
			weitereDateien: Math.max(0, dateien.length - MEDIEN_DATEIEN_MAX),
		});
	}
	return bloecke;
}
