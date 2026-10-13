import { EINLADUNG_GUELTIG_MS, EINRICHTUNG_GUELTIG_MS, einladungsAblauf, RESET_GUELTIG_MS } from './einladung.js';

describe('einladungsAblauf', () => {
	const jetzt = new Date('2026-10-13T10:00:00Z');

	it('laesst eine Einladung 14 Tage gelten', () => {
		expect(einladungsAblauf('EINLADUNG', jetzt)).toEqual(new Date('2026-10-27T10:00:00Z'));
	});

	it('laesst einen Reset eine Stunde gelten', () => {
		expect(einladungsAblauf('RESET', jetzt)).toEqual(new Date('2026-10-13T11:00:00Z'));
	});

	it('veraendert das uebergebene Datum nicht', () => {
		einladungsAblauf('EINLADUNG', jetzt);
		expect(jetzt).toEqual(new Date('2026-10-13T10:00:00Z'));
	});

	it('nennt die Dauern', () => {
		expect(EINLADUNG_GUELTIG_MS).toBe(14 * 24 * 60 * 60 * 1000);
		expect(RESET_GUELTIG_MS).toBe(60 * 60 * 1000);
		expect(EINRICHTUNG_GUELTIG_MS).toBe(60 * 60 * 1000);
	});
});
