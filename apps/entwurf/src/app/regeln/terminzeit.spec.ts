import type { TerminModul } from '../daten/typen';
import { beginnIso, endeIso, istMehrtaegig, tagPlus, terminFehler, terminZeit } from './terminzeit';

const t = (x: Partial<TerminModul>): TerminModul => ({ id: 'm', typ: 'termin', von: '2026-10-17', ort: 'X', ...x });

describe('terminZeit', () => {
	it('zeigt die Formen der Spec 3.1', () => {
		expect(terminZeit(t({}))).toBe('Sa 17.10. · ganztägig');
		expect(terminZeit(t({ beginnZeit: '14:00', endeZeit: '17:00' }))).toBe('Sa 17.10. · 14:00–17:00');
		expect(terminZeit(t({ beginnZeit: '14:00' }))).toBe('Sa 17.10. · 14:00');
		expect(terminZeit(t({ von: '2026-10-23', bis: '2026-10-25' }))).toBe('Fr 23.10. – So 25.10.');
		expect(terminZeit(t({ von: '2026-10-23', bis: '2026-10-25', beginnZeit: '17:00', endeZeit: '12:00' }))).toBe(
			'Fr 23.10. 17:00 – So 25.10. 12:00',
		);
		expect(terminZeit(t({ von: '2026-10-23', bis: '2026-10-25', endeZeit: '12:00' }))).toBe(
			'Fr 23.10. – So 25.10. 12:00',
		);
	});

	it('behandelt bis gleich von als eintaegig', () => {
		const m = t({ bis: '2026-10-17', beginnZeit: '14:00', endeZeit: '17:00' });
		expect(terminZeit(m)).toBe('Sa 17.10. · 14:00–17:00');
		expect(istMehrtaegig(m)).toBe(false);
	});
});

describe('Beginn und Ende', () => {
	it('liefert Beginn und Ende als lokale Zeitpunkte', () => {
		expect(beginnIso(t({}))).toBe('2026-10-17T00:00');
		expect(beginnIso(t({ beginnZeit: '14:00' }))).toBe('2026-10-17T14:00');
		expect(endeIso(t({}))).toBe('2026-10-18T00:00');
		expect(endeIso(t({ bis: '2026-10-31', endeZeit: '12:00' }))).toBe('2026-10-31T12:00');
		expect(tagPlus('2026-12-31', 1)).toBe('2027-01-01');
		expect(istMehrtaegig(t({ bis: '2026-10-18' }))).toBe(true);
	});
});

describe('terminFehler', () => {
	it('meldet ein Enddatum vor dem Startdatum', () => {
		expect(terminFehler(t({ von: '2026-10-25', bis: '2026-10-23' }))).toBe('Das Enddatum liegt vor dem Startdatum.');
	});

	it('meldet an einem Tag ein Ende vor dem Beginn', () => {
		expect(terminFehler(t({ beginnZeit: '17:00', endeZeit: '12:00' }))).toBe('Das Ende liegt vor dem Beginn.');
	});

	it('laesst gueltige Formen durch', () => {
		expect(terminFehler(t({ bis: '2026-10-17', beginnZeit: '14:00', endeZeit: '17:00' }))).toBeNull();
		expect(terminFehler(t({ endeZeit: '12:00' }))).toBeNull();
		expect(
			terminFehler(t({ von: '2026-10-23', bis: '2026-10-25', beginnZeit: '17:00', endeZeit: '12:00' })),
		).toBeNull();
	});
});
