import type { PersonSicht, Zuordnung } from './rechte.js';
import {
	darfEinwilligen,
	EINWILLIGUNG_TEXT,
	EINWILLIGUNG_TEXT_VERSION,
	FOTO_EINWILLIGUNG_TEXT,
	FOTO_EINWILLIGUNG_TEXT_SELBST,
	FOTO_EINWILLIGUNG_TEXT_VERSION,
	fotoEinwilligungGilt,
	hatGueltigeEinwilligung,
} from './einwilligung.js';

const JETZT = new Date('2026-10-18T12:00:00Z');

function person(id: string, aenderung: Partial<PersonSicht> = {}): PersonSicht {
	return { id, art: 'ERWACHSENER', rechte: [], geburtsdatum: null, entferntAm: null, ...aenderung };
}

const kind = person('kind', { art: 'JUNGFISCHER', geburtsdatum: new Date('2015-05-05') });
const mutter = person('mutter');
const vater = person('vater');
const zuordnungen: Zuordnung[] = [
	{ erwachsenerId: 'mutter', jungfischerId: 'kind', erziehungsberechtigt: true },
	{ erwachsenerId: 'vater', jungfischerId: 'kind', erziehungsberechtigt: true },
];
const erteiler = new Map([
	['mutter', mutter],
	['vater', vater],
]);
const gueltig = { erteiltVon: 'mutter', widerrufenAm: null };

describe('Einwilligungstext', () => {
	it('hat Version und Text', () => {
		expect(EINWILLIGUNG_TEXT_VERSION).toBe('1');
		expect(EINWILLIGUNG_TEXT.length).toBeGreaterThan(0);
	});
});

describe('hatGueltigeEinwilligung', () => {
	it('gilt, wenn ein Erziehungsberechtigter sie erteilt hat', () => {
		expect(hatGueltigeEinwilligung(kind, [gueltig], erteiler, zuordnungen, JETZT)).toBe(true);
	});

	it('gilt nicht ohne Einwilligungen oder nach Widerruf', () => {
		expect(hatGueltigeEinwilligung(kind, [], erteiler, zuordnungen, JETZT)).toBe(false);
		expect(
			hatGueltigeEinwilligung(
				kind,
				[{ erteiltVon: 'mutter', widerrufenAm: new Date('2026-09-01') }],
				erteiler,
				zuordnungen,
				JETZT,
			),
		).toBe(false);
	});

	it('gilt nicht, wenn der Erteiler entfernt ist oder fehlt', () => {
		const weg = new Map([['mutter', person('mutter', { entferntAm: new Date('2026-09-01') })]]);
		expect(hatGueltigeEinwilligung(kind, [gueltig], weg, zuordnungen, JETZT)).toBe(false);
		expect(hatGueltigeEinwilligung(kind, [gueltig], new Map(), zuordnungen, JETZT)).toBe(false);
	});

	it('gilt nicht, wenn die Zuordnung geloest oder nicht mehr erziehungsberechtigt ist', () => {
		expect(hatGueltigeEinwilligung(kind, [gueltig], erteiler, [zuordnungen[1]], JETZT)).toBe(false);
		const oma: Zuordnung[] = [{ erwachsenerId: 'mutter', jungfischerId: 'kind', erziehungsberechtigt: false }];
		expect(hatGueltigeEinwilligung(kind, [gueltig], erteiler, oma, JETZT)).toBe(false);
	});

	it('gilt nicht mehr, wenn das Kind volljaehrig geworden ist', () => {
		const gross = { ...kind, geburtsdatum: new Date('2008-03-10') };
		expect(hatGueltigeEinwilligung(gross, [gueltig], erteiler, zuordnungen, JETZT)).toBe(false);
	});

	it('genuegt mit einer gueltigen, auch wenn eine andere widerrufen ist', () => {
		const e = [
			{ erteiltVon: 'mutter', widerrufenAm: new Date('2026-09-01') },
			{ erteiltVon: 'vater', widerrufenAm: null },
		];
		expect(hatGueltigeEinwilligung(kind, e, erteiler, zuordnungen, JETZT)).toBe(true);
	});
});

describe('darfEinwilligen', () => {
	it('erlaubt es nur Erziehungsberechtigten', () => {
		expect(darfEinwilligen(mutter, kind, zuordnungen, JETZT)).toBe(true);
		expect(darfEinwilligen(person('oma'), kind, zuordnungen, JETZT)).toBe(false);
		const oma: Zuordnung[] = [{ erwachsenerId: 'oma', jungfischerId: 'kind', erziehungsberechtigt: false }];
		expect(darfEinwilligen(person('oma'), kind, oma, JETZT)).toBe(false);
	});
});

describe('Foto-Einwilligungstext', () => {
	it('hat Version und zwei Wortlaute, getrennt vom DSGVO-Text', () => {
		expect(FOTO_EINWILLIGUNG_TEXT_VERSION).toBe('1');
		expect(FOTO_EINWILLIGUNG_TEXT.length).toBeGreaterThan(0);
		expect(FOTO_EINWILLIGUNG_TEXT_SELBST.length).toBeGreaterThan(0);
		expect(FOTO_EINWILLIGUNG_TEXT).not.toBe(EINWILLIGUNG_TEXT);
		expect(FOTO_EINWILLIGUNG_TEXT_SELBST).not.toBe(FOTO_EINWILLIGUNG_TEXT);
	});
});

describe('fotoEinwilligungGilt', () => {
	it('gilt fuer ein Kind mit Einwilligung der Eltern, nicht nach Widerruf', () => {
		expect(fotoEinwilligungGilt(kind, [gueltig], erteiler, zuordnungen, JETZT)).toBe(true);
		expect(
			fotoEinwilligungGilt(
				kind,
				[{ erteiltVon: 'mutter', widerrufenAm: new Date('2026-09-01') }],
				erteiler,
				zuordnungen,
				JETZT,
			),
		).toBe(false);
		expect(fotoEinwilligungGilt(kind, [], erteiler, zuordnungen, JETZT)).toBe(false);
	});

	it('gilt nicht, wenn ein Erwachsener ohne Erziehungsrecht eingewilligt hat', () => {
		const oma = person('oma');
		const mitOma: Zuordnung[] = [{ erwachsenerId: 'oma', jungfischerId: 'kind', erziehungsberechtigt: false }];
		expect(
			fotoEinwilligungGilt(kind, [{ erteiltVon: 'oma', widerrufenAm: null }], new Map([['oma', oma]]), mitOma, JETZT),
		).toBe(false);
	});

	describe('ab dem 18. Geburtstag', () => {
		const eigene = { erteiltVon: 'gross', widerrufenAm: null };
		const gross = (geburtsdatum: string) =>
			person('gross', { art: 'JUNGFISCHER', geburtsdatum: new Date(geburtsdatum) });
		const mitMutter: Zuordnung[] = [{ erwachsenerId: 'mutter', jungfischerId: 'gross', erziehungsberechtigt: true }];
		const alle = (k: PersonSicht) => new Map([...erteiler, [k.id, k]]);

		it('zaehlt am Tag danach nur noch die eigene Zeile, nicht die der Eltern', () => {
			const k = gross('2008-10-17');
			expect(fotoEinwilligungGilt(k, [{ erteiltVon: 'mutter', widerrufenAm: null }], alle(k), mitMutter, JETZT)).toBe(
				false,
			);
			expect(fotoEinwilligungGilt(k, [eigene], alle(k), mitMutter, JETZT)).toBe(true);
		});

		it('gilt am Geburtstag selbst schon als volljaehrig', () => {
			const k = gross('2008-10-18');
			expect(fotoEinwilligungGilt(k, [{ erteiltVon: 'mutter', widerrufenAm: null }], alle(k), mitMutter, JETZT)).toBe(
				false,
			);
			expect(fotoEinwilligungGilt(k, [eigene], alle(k), mitMutter, JETZT)).toBe(true);
		});

		it('zaehlt am Vortag noch die Eltern', () => {
			const k = gross('2008-10-19');
			expect(fotoEinwilligungGilt(k, [{ erteiltVon: 'mutter', widerrufenAm: null }], alle(k), mitMutter, JETZT)).toBe(
				true,
			);
		});

		it('ignoriert die widerrufene eigene Zeile', () => {
			const k = gross('2008-10-17');
			expect(
				fotoEinwilligungGilt(
					k,
					[{ erteiltVon: 'gross', widerrufenAm: new Date('2026-10-01') }],
					alle(k),
					mitMutter,
					JETZT,
				),
			).toBe(false);
		});
	});
});
