import type { DateiDaten, FotoDaten, ModulDaten } from '../threads/ansicht.js';
import type { ThreadKopf } from '../threads/typen.js';
import { medienBloecke, medienZahlText, undListe } from './medien.js';

describe('undListe', () => {
	it('verbindet null bis drei Teile', () => {
		expect(undListe([])).toBe('');
		expect(undListe(['A'])).toBe('A');
		expect(undListe(['A', 'B'])).toBe('A und B');
		expect(undListe(['A', 'B', 'C'])).toBe('A, B und C');
	});
});

describe('medienZahlText', () => {
	it('nennt Fotos mit Personen', () => {
		expect(medienZahlText({ fotos: 3, dateien: 0, personen: 2 })).toBe('3 Fotos von 2 Personen');
		expect(medienZahlText({ fotos: 1, dateien: 0, personen: 1 })).toBe('1 Foto von 1 Person');
	});

	it('haengt Dateien an', () => {
		expect(medienZahlText({ fotos: 3, dateien: 2, personen: 2 })).toBe('3 Fotos von 2 Personen und 2 Dateien');
		expect(medienZahlText({ fotos: 1, dateien: 1, personen: 1 })).toBe('1 Foto von 1 Person und 1 Datei');
	});

	it('nennt nur Dateien ohne Personen', () => {
		expect(medienZahlText({ fotos: 0, dateien: 2, personen: 0 })).toBe('2 Dateien');
		expect(medienZahlText({ fotos: 0, dateien: 1, personen: 0 })).toBe('1 Datei');
	});

	it('ist null, wenn nichts da ist', () => {
		expect(medienZahlText({ fotos: 0, dateien: 0, personen: 0 })).toBeNull();
	});
});

describe('medienBloecke', () => {
	const kopf = (id: string, titel = `Thread ${id}`): ThreadKopf => ({
		id,
		art: 'NORMAL',
		titel,
		modus: 'KOMMENTARE',
		rollenfilter: 'JUNGFISCHER_FAMILIE',
		alleUntergruppen: true,
		untergruppenIds: [],
		angepinnt: false,
		archivModus: 'AUTOMATISCH',
		veroeffentlichtAm: new Date('2026-01-01T00:00:00Z'),
		erstelltVonId: 'p-1',
	});
	const tag = (n: number) => new Date(Date.UTC(2026, 5, n, 12));
	const foto = (id: string, n: number): FotoDaten => ({
		id,
		breite: 800,
		hoehe: 600,
		vonId: 'p-1',
		hochgeladenAm: tag(n),
	});
	const datei = (id: string, n: number): DateiDaten => ({
		id,
		name: `${id}.pdf`,
		typ: 'application/pdf',
		groesse: 1000,
		vonId: 'p-1',
		hochgeladenAm: tag(n),
	});
	const fotos = (id: string, ...f: FotoDaten[]): ModulDaten => ({
		typ: 'FOTOS',
		id,
		titel: null,
		hochladen: 'JUGENDLEITER',
		fotos: f,
	});
	const dateien = (id: string, ...d: DateiDaten[]): ModulDaten => ({ typ: 'DATEIEN', id, titel: null, dateien: d });
	const thread = (id: string, aktivitaet: number, module: ModulDaten[], archiviert = false) => ({
		kopf: kopf(id),
		segment: `${id}-segment`,
		archiviert,
		letzteAktivitaetAm: tag(aktivitaet),
		module,
	});

	it('sortiert nach letzter Aktivitaet, neueste zuerst, und uebernimmt Titel, Segment und Archiv', () => {
		const bloecke = medienBloecke([
			thread('alt', 1, [fotos('m1', foto('f1', 1))], true),
			thread('neu', 9, [fotos('m2', foto('f2', 1))]),
			thread('mitte', 5, [dateien('m3', datei('d1', 1))]),
		]);

		expect(bloecke.map((b) => b.threadId)).toEqual(['neu', 'mitte', 'alt']);
		expect(bloecke[2]).toMatchObject({ titel: 'Thread alt', segment: 'alt-segment', archiviert: true });
		expect(bloecke[0].archiviert).toBe(false);
	});

	it('ordnet gleiche Aktivitaet nach Thread-ID, damit die Reihenfolge nicht vom Zufall abhaengt', () => {
		const bloecke = medienBloecke([
			thread('b', 5, [fotos('m1', foto('f1', 1))]),
			thread('a', 5, [fotos('m2', foto('f2', 1))]),
		]);

		expect(bloecke.map((b) => b.threadId)).toEqual(['a', 'b']);
	});

	it('zeigt von 8 Fotos die 6 neuesten, neueste zuerst, und zaehlt alle 8', () => {
		const acht = Array.from({ length: 8 }, (_, i) => foto(`f${i + 1}`, i + 1));
		const [block] = medienBloecke([thread('t', 1, [fotos('m', ...acht)])]);

		expect(block.fotos).toBe(8);
		expect(block.vorschau).toEqual(['f8', 'f7', 'f6', 'f5', 'f4', 'f3']);
	});

	it('nimmt die neuesten Fotos ueber alle Foto-Module', () => {
		const [block] = medienBloecke([
			thread('t', 1, [fotos('m1', foto('a1', 1), foto('a2', 7)), fotos('m2', foto('b1', 5), foto('b2', 9))]),
		]);

		expect(block.fotos).toBe(4);
		expect(block.vorschau).toEqual(['b2', 'a2', 'b1', 'a1']);
	});

	it('zeigt von 13 Dateien die ersten 10 und zaehlt 3 weitere', () => {
		const dreizehn = Array.from({ length: 13 }, (_, i) => datei(`d${i + 1}`, i + 1));
		const [block] = medienBloecke([thread('t', 1, [dateien('m', ...dreizehn)])]);

		expect(block.dateien.map((d) => d.id)).toEqual(dreizehn.slice(0, 10).map((d) => d.id));
		expect(block.weitereDateien).toBe(3);
	});

	it('reiht die Dateien nach Modul und darin nach Hochladezeit und gibt sie als Zeilen mit ISO-Zeit', () => {
		const [block] = medienBloecke([
			thread('t', 1, [dateien('m1', datei('b', 4), datei('a', 2)), dateien('m2', datei('c', 1))]),
		]);

		expect(block.dateien.map((d) => d.id)).toEqual(['a', 'b', 'c']);
		expect(block.dateien[0]).toEqual({
			id: 'a',
			name: 'a.pdf',
			typ: 'application/pdf',
			groesse: 1000,
			hochgeladenAm: '2026-06-02T12:00:00.000Z',
		});
		expect(block.weitereDateien).toBe(0);
	});

	it('laesst Threads ohne Fotos und Dateien weg, auch mit leeren Medien-Modulen oder nur einem Info-Modul', () => {
		const bloecke = medienBloecke([
			thread('info', 9, [{ typ: 'INFO', id: 'm1', titel: null, text: 'Hallo' }]),
			thread('leer', 8, [fotos('m2'), dateien('m3')]),
			thread('ohne', 7, []),
			thread('mit', 1, [fotos('m4', foto('f', 1))]),
		]);

		expect(bloecke.map((b) => b.threadId)).toEqual(['mit']);
	});

	it('zaehlt bei einem Thread mit nur Dateien keine Fotos und hat keine Vorschau', () => {
		const [block] = medienBloecke([thread('t', 1, [dateien('m', datei('d', 1))])]);

		expect(block).toMatchObject({ fotos: 0, vorschau: [], weitereDateien: 0 });
	});
});
