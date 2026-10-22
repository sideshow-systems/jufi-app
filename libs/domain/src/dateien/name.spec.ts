import { bereinigeDateiname, ohneEndung, passendeEndung, pruefeDateiname } from './name.js';

describe('bereinigeDateiname', () => {
	it('behaelt nur den Teil nach dem letzten Schraegstrich', () => {
		expect(bereinigeDateiname('..%2F..%2Fetc%2Fpasswd')).toBe('passwd');
		expect(bereinigeDateiname('C%3A%5Cfoto%5Cbild.png')).toBe('bild.png');
	});

	it('entfernt Anfuehrungszeichen', () => {
		expect(bereinigeDateiname('Anmeldung%20%22Zeltlager%22%202027.pdf')).toBe('Anmeldung Zeltlager 2027.pdf');
	});

	it('laesst Umlaute und Emoji stehen', () => {
		expect(bereinigeDateiname('%C3%9Cbersicht%20%F0%9F%8E%A3.docx')).toBe('Übersicht 🎣.docx');
	});

	it('macht aus einem Zeilenumbruch ein Leerzeichen', () => {
		expect(bereinigeDateiname('a%0Ab.pdf')).toBe('a b.pdf');
		expect(bereinigeDateiname('a%09%09%20b.pdf')).toBe('a b.pdf');
	});

	it('wirft sonstige Steuerzeichen weg', () => {
		expect(bereinigeDateiname('a%00b%7Fc.pdf')).toBe('abc.pdf');
	});

	it('kuerzt lange Namen auf 120 Zeichen und behaelt die Endung', () => {
		const name = bereinigeDateiname('a'.repeat(300) + '.pdf');
		expect(name).toHaveLength(120);
		expect(name?.endsWith('.pdf')).toBe(true);
	});

	it('kuerzt nach Codepoints, nicht nach UTF-16-Einheiten', () => {
		const name = bereinigeDateiname(encodeURIComponent('🎣'.repeat(200) + '.pdf'));
		expect(Array.from(name ?? '')).toHaveLength(120);
		expect(name?.endsWith('🎣.pdf')).toBe(true);
	});

	it('kuerzt einen Namen ohne brauchbare Endung ganz', () => {
		expect(Array.from(bereinigeDateiname('b'.repeat(300)) ?? '')).toHaveLength(120);
	});

	it('gibt null bei ungueltiger Kodierung, leerem oder fehlendem Namen', () => {
		expect(bereinigeDateiname('%E0%A4%A')).toBeNull();
		expect(bereinigeDateiname('%20%20')).toBeNull();
		expect(bereinigeDateiname('')).toBeNull();
		expect(bereinigeDateiname(undefined)).toBeNull();
		expect(bereinigeDateiname('ordner%2F')).toBeNull();
	});
});

describe('ohneEndung', () => {
	it('schneidet die letzte Endung ab', () => {
		expect(ohneEndung('Anmeldung Zeltlager 2027.pdf')).toBe('Anmeldung Zeltlager 2027');
		expect(ohneEndung('plan.v2.docx')).toBe('plan.v2');
	});

	it('laesst Namen ohne Endung und Punkt-Dateien in Ruhe', () => {
		expect(ohneEndung('Satzung')).toBe('Satzung');
		expect(ohneEndung('.gitignore')).toBe('.gitignore');
		expect(ohneEndung('Version 1.2 Entwurf')).toBe('Version 1.2 Entwurf');
	});
});

describe('unsichtbare Formatzeichen', () => {
	it('fallen aus dem Dateinamen, auch das Umdrehen der Schreibrichtung', () => {
		expect(bereinigeDateiname('a%E2%80%AEfdp.exe')).toBe('afdp.exe');
	});
});

describe('pruefeDateiname', () => {
	it('saeubert wie bereinigeDateiname, ohne zu dekodieren', () => {
		expect(pruefeDateiname('  Pack\nliste.pdf ')).toEqual({ ok: true, name: 'Pack liste.pdf' });
		expect(pruefeDateiname('100%.pdf')).toEqual({ ok: true, name: '100%.pdf' });
		expect(pruefeDateiname('a\u202Eb.pdf')).toEqual({ ok: true, name: 'ab.pdf' });
		expect(pruefeDateiname('../x/Plan.pdf')).toEqual({ ok: true, name: 'Plan.pdf' });
	});

	it('lehnt einen leeren Namen ab', () => {
		expect(pruefeDateiname('')).toMatchObject({ ok: false });
		expect(pruefeDateiname(' \u200B ')).toMatchObject({ ok: false });
	});
});

describe('passendeEndung', () => {
	it('ersetzt die Endung eines anderen bekannten Typs', () => {
		expect(passendeEndung('x.pdf', 'image/png')).toBe('x.png');
	});

	it('haengt an, wenn keine Endung da ist oder sie unbekannt ist', () => {
		expect(passendeEndung('Packliste', 'application/pdf')).toBe('Packliste.pdf');
		expect(passendeEndung('Bericht.final', 'application/pdf')).toBe('Bericht.final.pdf');
		expect(passendeEndung('Version 1.2 Entwurf', 'application/pdf')).toBe('Version 1.2 Entwurf.pdf');
	});

	it('laesst eine passende Endung stehen, auch in anderer Schreibweise', () => {
		expect(passendeEndung('Foto.JPEG', 'image/jpeg')).toBe('Foto.JPEG');
		expect(passendeEndung('Foto.jpg', 'image/jpeg')).toBe('Foto.jpg');
		expect(passendeEndung('Foto.Png', 'image/png')).toBe('Foto.Png');
	});

	it('kennt die Office- und OpenDocument-Endungen', () => {
		expect(
			passendeEndung('Liste.xlsx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
		).toBe('Liste.docx');
		expect(passendeEndung('Brief', 'application/vnd.oasis.opendocument.text')).toBe('Brief.odt');
		expect(passendeEndung('Bild.webp', 'image/webp')).toBe('Bild.webp');
	});

	it('kuerzt den Stamm auf hoechstens 120 Zeichen', () => {
		const r = passendeEndung('a'.repeat(118) + '.docx', 'application/pdf');
		expect(r).toHaveLength(120);
		expect(r.endsWith('.pdf')).toBe(true);
		expect(r.startsWith('a'.repeat(116))).toBe(true);
	});

	it('kuerzt nach Codepoints', () => {
		const r = passendeEndung('🎣'.repeat(118), 'application/pdf');
		expect(Array.from(r)).toHaveLength(120);
		expect(r.endsWith('.pdf')).toBe(true);
	});
});
