import type { FotoHochladen } from '../threads/rechte.js';

// Die Antworttypen der Datei- und Foto-Module (TP4-Spec 3). Sie stehen hier und nicht in
// threads/ansicht.ts, weil Server und Client sie auch ohne die Thread-Ansicht brauchen
// (die Mediengalerie und die Upload-Routen antworten mit denselben Zeilen). Die Zeiten
// reisen als ISO-Zeichenketten, wie in der Umfrage-Ansicht.

export interface DateiZeile {
	id: string;
	name: string;
	typ: string;
	groesse: number;
	hochgeladenAm: string;
}

// Fotos haben keinen Namen (Plan-Entscheidung 12); wer sie hochgeladen hat, steht als Anzeigename
// (absenderName) da, und darfLoeschen rechnet der Server je Person, damit der Client die
// Regel nicht aus Rechten und Ersteller nachbaut.
export interface FotoZeile {
	id: string;
	breite: number;
	hoehe: number;
	von: string;
	hochgeladenAm: string;
	darfLoeschen: boolean;
}

// Wer eine Datei hochgeladen hat, zeigt die Ansicht bewusst nicht: Dateien sind Material des
// Threads (Packliste, Plan), kein Beitrag einer Person. darfAendern gilt fuer Umbenennen und
// Loeschen und ist das Bearbeitungsrecht am Thread.
export interface DateienModulAnsicht {
	typ: 'DATEIEN';
	id: string;
	titel: string | null;
	dateien: DateiZeile[];
	darfAendern: boolean;
}

export interface FotosModulAnsicht {
	typ: 'FOTOS';
	id: string;
	titel: string | null;
	hochladen: FotoHochladen;
	fotos: FotoZeile[];
	darfHochladen: boolean;
	/** Nur fuer Personen, die hochladen duerfen: die anderen laedt der Hinweis nichts an. */
	hinweis: string | null;
}
