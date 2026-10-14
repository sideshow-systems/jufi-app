import { describe, expect, it } from 'vitest';
import { einladungsMail, resetMail } from './texte.js';

const T = { vorname: 'Mia', anzeigename: 'Jungfischer Test', link: 'https://jufi.test/einladung/abc' };

describe('resetMail', () => {
	it('nennt Vornamen, Link, die eine Stunde und den Hinweis fuer Unbeteiligte', () => {
		const { betreff, text } = resetMail(T);
		expect(betreff).toContain('Jungfischer Test');
		expect(text).toContain('Mia');
		expect(text).toContain(T.link);
		expect(text).toContain('1 Stunde');
		expect(text).toContain('Falls du das nicht warst, ignoriere diese Mail');
	});
});

describe('einladungsMail', () => {
	it('nutzt fuer die Einladung den Leitungstext', () => {
		const { text, betreff } = einladungsMail({ ...T, art: 'einladung' });
		expect(text).toContain('als Leitung von „Jungfischer Test“');
		expect(text).toContain(T.link);
		expect(betreff).toContain('Jungfischer Test');
	});

	it('nutzt fuer den Notfall-Link den Notfalltext und warnt vor dem Loeschen', () => {
		const { text, betreff } = einladungsMail({ ...T, art: 'notfall' });
		expect(text).toContain('angemeldeten Geräte');
		expect(text).toContain(T.link);
		expect(betreff).not.toBe(einladungsMail({ ...T, art: 'einladung' }).betreff);
	});
});
