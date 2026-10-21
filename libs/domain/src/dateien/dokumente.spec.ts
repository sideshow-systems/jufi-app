import { pruefeDokumentTitel, pruefeKategorieName, sortiereDokumente, STANDARD_KATEGORIEN } from './dokumente.js';

describe('pruefeKategorieName', () => {
	it('trimmt den Namen', () => {
		expect(pruefeKategorieName('  Für Eltern ')).toEqual({ ok: true, name: 'Für Eltern' });
	});

	it('lehnt leere und zu lange Namen ab', () => {
		expect(pruefeKategorieName('   ')).toMatchObject({ ok: false });
		expect(pruefeKategorieName('a'.repeat(41))).toMatchObject({ ok: false });
		expect(pruefeKategorieName('a'.repeat(40))).toEqual({ ok: true, name: 'a'.repeat(40) });
	});

	it('zaehlt Codepoints, nicht UTF-16-Einheiten', () => {
		expect(pruefeKategorieName('🎣'.repeat(40))).toMatchObject({ ok: true });
		expect(pruefeKategorieName('🎣'.repeat(41))).toMatchObject({ ok: false });
	});
});

describe('pruefeDokumentTitel', () => {
	it('trimmt den Titel', () => {
		expect(pruefeDokumentTitel(' Satzung ')).toEqual({ ok: true, titel: 'Satzung' });
	});

	it('erlaubt bis 120 Zeichen', () => {
		expect(pruefeDokumentTitel('a'.repeat(120))).toMatchObject({ ok: true });
		expect(pruefeDokumentTitel('a'.repeat(121))).toMatchObject({ ok: false });
		expect(pruefeDokumentTitel('')).toMatchObject({ ok: false });
	});

	it('nennt den Grund im Klartext', () => {
		const leer = pruefeDokumentTitel('');
		expect(leer.ok ? '' : leer.fehler).toMatch(/Titel/);
	});
});

describe('sortiereDokumente', () => {
	it('sortiert nach Titel, deutsch und ohne Rücksicht auf Groß- und Kleinschreibung', () => {
		const liste = [{ titel: 'Zeltlager' }, { titel: 'Ärzte' }, { titel: 'anmeldung' }];
		expect(sortiereDokumente(liste).map((d) => d.titel)).toEqual(['anmeldung', 'Ärzte', 'Zeltlager']);
	});

	it('veraendert die Eingabe nicht', () => {
		const liste = [{ titel: 'b' }, { titel: 'a' }];
		sortiereDokumente(liste);
		expect(liste.map((d) => d.titel)).toEqual(['b', 'a']);
	});
});

describe('STANDARD_KATEGORIEN', () => {
	it('hat die Reihenfolge der Spec', () => {
		expect([...STANDARD_KATEGORIEN]).toEqual(['Ordnungen', 'Merkblätter', 'Formulare']);
	});
});
