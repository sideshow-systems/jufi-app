import type { PersonSicht, Zuordnung } from './rechte.js';
import {
	beziehungVorbelegung,
	darfPersonSehen,
	einsichtIn,
	istDoppelt,
	pruefeGeburtsdatum,
	pruefeName,
	sichtbarePersonen,
	warnhinweise,
} from './personen.js';

const JETZT = new Date('2026-10-18T12:00:00Z');

function person(id: string, aenderung: Partial<PersonSicht> = {}): PersonSicht {
	return { id, art: 'ERWACHSENER', rechte: [], geburtsdatum: null, entferntAm: null, ...aenderung };
}

function kind(id: string, geburtsdatum: Date | null = new Date('2015-05-05'), aenderung: Partial<PersonSicht> = {}) {
	return person(id, { art: 'JUNGFISCHER', geburtsdatum, ...aenderung });
}

function z(erwachsenerId: string, jungfischerId: string, erziehungsberechtigt = true): Zuordnung {
	return { erwachsenerId, jungfischerId, erziehungsberechtigt };
}

const verwalter = person('verwalter', { rechte: ['MITGLIEDER', 'ANTWORTEN_DETAIL'] });
const betreuer = person('betreuer', { rechte: ['ANTWORTEN_DETAIL'] });
const mutter = person('mutter');
const oma = person('oma');
const kindA = kind('kindA');
const kindB = kind('kindB');
const zuordnungen = [z('mutter', 'kindA'), z('oma', 'kindA', false), z('mutter2', 'kindB')];

describe('einsichtIn', () => {
	it('gibt dem Verwalter bei allen VOLL', () => {
		for (const p of [betreuer, mutter, kindA, kindB]) {
			expect(einsichtIn(verwalter, p, zuordnungen)).toBe('VOLL');
		}
	});

	it('gibt dem Betreuer bei allen LESEN', () => {
		for (const p of [verwalter, mutter, kindA, kindB]) {
			expect(einsichtIn(betreuer, p, zuordnungen)).toBe('LESEN');
		}
	});

	it('zeigt der Mutter sich und ihr Kind voll, die Leitung nur mit Namen, fremde Kinder nicht', () => {
		expect(einsichtIn(mutter, mutter, zuordnungen)).toBe('VOLL');
		expect(einsichtIn(mutter, kindA, zuordnungen)).toBe('VOLL');
		expect(einsichtIn(mutter, verwalter, zuordnungen)).toBe('NAME');
		expect(einsichtIn(mutter, kindB, zuordnungen)).toBeNull();
	});

	it('zeigt der Grossmutter das Kind trotz fehlender Erziehungsberechtigung', () => {
		expect(einsichtIn(oma, kindA, zuordnungen)).toBe('VOLL');
	});

	it('zeigt dem Jungfischer sich, seine Familie und die Jugendleiter, nicht die Geschwister', () => {
		expect(einsichtIn(kindA, kindA, zuordnungen)).toBe('VOLL');
		expect(einsichtIn(kindA, mutter, zuordnungen)).toBe('VOLL');
		expect(einsichtIn(kindA, betreuer, zuordnungen)).toBe('NAME');
		const geschwister = kind('kindA2');
		const mitGeschwister = [...zuordnungen, z('mutter', 'kindA2')];
		expect(einsichtIn(kindA, geschwister, mitGeschwister)).toBeNull();
	});

	it('macht Entfernte fuer jeden unsichtbar, auch fuer sie selbst', () => {
		const weg = person('weg', { entferntAm: new Date('2026-01-01') });
		for (const b of [verwalter, betreuer, mutter, weg]) {
			expect(einsichtIn(b, weg, zuordnungen)).toBeNull();
			expect(darfPersonSehen(b, weg, zuordnungen)).toBe(false);
		}
	});
});

describe('sichtbarePersonen', () => {
	it('liefert nur Sichtbare mit ihrer Einsicht', () => {
		const r = sichtbarePersonen(mutter, [mutter, kindA, kindB, verwalter], zuordnungen);
		expect(r.map((e) => [e.person.id, e.einsicht])).toEqual([
			['mutter', 'VOLL'],
			['kindA', 'VOLL'],
			['verwalter', 'NAME'],
		]);
	});
});

describe('pruefeName', () => {
	it('verlangt 1 bis 60 Zeichen nach dem Trimmen', () => {
		expect(pruefeName('Anna')).toBe(true);
		expect(pruefeName('  ')).toBe(false);
		expect(pruefeName('')).toBe(false);
		expect(pruefeName('a'.repeat(60))).toBe(true);
		expect(pruefeName('a'.repeat(61))).toBe(false);
		expect(pruefeName(' ' + 'a'.repeat(60) + ' ')).toBe(true);
	});
});

describe('pruefeGeburtsdatum', () => {
	it('lehnt Zukunft und Zeit vor 1900 ab', () => {
		expect(pruefeGeburtsdatum(new Date('2015-05-05'), JETZT)).toBe(true);
		expect(pruefeGeburtsdatum(new Date('2026-10-19'), JETZT)).toBe(false);
		expect(pruefeGeburtsdatum(new Date('1899-12-31'), JETZT)).toBe(false);
		expect(pruefeGeburtsdatum(new Date('1900-01-01'), JETZT)).toBe(true);
		expect(pruefeGeburtsdatum(new Date('nope'), JETZT)).toBe(false);
	});
});

describe('istDoppelt', () => {
	const a = { vorname: 'Anna', nachname: 'Meier', geburtsdatum: new Date('2015-05-05') };

	it('ignoriert Gross-/Kleinschreibung und Raender', () => {
		expect(istDoppelt(a, { vorname: ' anna ', nachname: 'MEIER', geburtsdatum: new Date('2015-05-05') })).toBe(true);
	});

	it('unterscheidet bei anderem Geburtsdatum oder Namen', () => {
		expect(istDoppelt(a, { ...a, geburtsdatum: new Date('2015-05-06') })).toBe(false);
		expect(istDoppelt(a, { ...a, nachname: 'Maier' })).toBe(false);
	});

	it('zaehlt zwei fehlende Geburtsdaten als gleich, eines nicht', () => {
		const e = { vorname: 'Anna', nachname: 'Meier', geburtsdatum: null };
		expect(istDoppelt(e, { ...e })).toBe(true);
		expect(istDoppelt(e, a)).toBe(false);
	});
});

describe('beziehungVorbelegung', () => {
	it.each([
		['MUTTER', true],
		['VATER', true],
		['PFLEGEPERSON', true],
		['GROSSMUTTER', false],
		['GROSSVATER', false],
		['TANTE', false],
		['ONKEL', false],
		['GESCHWISTER', false],
		['ANDERE', false],
	] as const)('%s -> %s', (b, erwartet) => {
		expect(beziehungVorbelegung(b)).toBe(erwartet);
	});
});

describe('warnhinweise', () => {
	const basis = {
		person: kindA,
		zuordnungen: [z('mutter', 'kindA')],
		hatGueltigeEinwilligung: true,
		offeneEinladungAblauf: null,
		einladungsmailGescheitert: false,
		volljaehrigGeprueftAm: null,
	};

	it('warnt bei einem versorgten Kind nicht', () => {
		expect(warnhinweise(basis, JETZT)).toEqual([]);
	});

	it('warnt bei Jungfischer ohne erziehungsberechtigte Familie', () => {
		expect(warnhinweise({ ...basis, zuordnungen: [] }, JETZT)).toEqual([{ art: 'OHNE_FAMILIE' }]);
		expect(warnhinweise({ ...basis, zuordnungen: [z('oma', 'kindA', false)] }, JETZT)).toEqual([
			{ art: 'OHNE_FAMILIE' },
		]);
		expect(warnhinweise({ ...basis, person: mutter, zuordnungen: [] }, JETZT)).toEqual([]);
	});

	it('warnt bei fehlender Einwilligung nur Minderjaehrige', () => {
		expect(warnhinweise({ ...basis, hatGueltigeEinwilligung: false }, JETZT)).toEqual([{ art: 'EINWILLIGUNG_FEHLT' }]);
		expect(warnhinweise({ ...basis, person: mutter, hatGueltigeEinwilligung: false }, JETZT)).toEqual([]);
	});

	it('nennt offene Einladung und gescheiterte Mail', () => {
		const ablauf = new Date('2026-11-01');
		expect(warnhinweise({ ...basis, offeneEinladungAblauf: ablauf }, JETZT)).toEqual([
			{ art: 'EINLADUNG_OFFEN', ablauf },
		]);
		expect(warnhinweise({ ...basis, einladungsmailGescheitert: true }, JETZT)).toEqual([
			{ art: 'MAIL_NICHT_ZUGESTELLT' },
		]);
	});

	it('meldet Volljaehrigkeit mit dem 18. Geburtstag, bis sie geprueft ist', () => {
		const alt = kind('alt', new Date('2008-03-10'));
		const e = { ...basis, person: alt, zuordnungen: [z('mutter', 'alt')], hatGueltigeEinwilligung: false };
		expect(warnhinweise(e, JETZT)).toEqual([
			{ art: 'OHNE_FAMILIE' },
			{ art: 'VOLLJAEHRIG', seit: new Date('2026-03-10') },
		]);
		expect(warnhinweise({ ...e, volljaehrigGeprueftAm: new Date('2026-04-01') }, JETZT)).toEqual([
			{ art: 'OHNE_FAMILIE' },
		]);
	});
});
