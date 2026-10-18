import type { PersonSicht, Zuordnung } from './rechte.js';
import {
	darfEinwilligen,
	EINWILLIGUNG_TEXT,
	EINWILLIGUNG_TEXT_VERSION,
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
