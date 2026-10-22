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
