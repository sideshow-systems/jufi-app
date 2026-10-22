import { terminZeit, type TerminDaten } from '../module/termin/termin.js';
import { bowlingUmfeld, JETZT, kopf } from './testhilfe.js';
import { linkTeile, MODUS_TEXT, systemSatz, verlaufAnsicht, type VerlaufEintragDaten } from './verlauf.js';

const umfeld = bowlingUmfeld();

const termin: TerminDaten = {
	modulId: 'm',
	startDatum: '2026-10-24',
	endDatum: null,
	beginn: null,
	ende: null,
	ort: null,
	treffpunkt: null,
};

describe('systemSatz', () => {
	it('meldet die Veroeffentlichung', () => {
		expect(systemSatz('VEROEFFENTLICHT', {}, 'Thomas K.', umfeld)).toBe('Thomas K. hat den Thread veröffentlicht');
	});

	it('nennt beim Termin dieselbe Zeitangabe wie die Karte', () => {
		expect(systemSatz('TERMIN_GEAENDERT', { termin }, 'Thomas K.', umfeld)).toBe(
			`Thomas K. hat den Termin auf ${terminZeit(termin)} verschoben`,
		);
	});

	it('braucht fuer den Termin keine modulId', () => {
		const { modulId: _weg, ...ohneModul } = termin;
		expect(systemSatz('TERMIN_GEAENDERT', { termin: ohneModul }, 'Thomas K.', umfeld)).toBe(
			`Thomas K. hat den Termin auf ${terminZeit(termin)} verschoben`,
		);
	});

	it('nennt bei der Frist den Berliner Zeitpunkt in voller Form', () => {
		const daten = { frage: 'Kommst du mit?', frist: '2026-10-22T16:00:00.000Z' };
		expect(systemSatz('FRIST_GEAENDERT', daten, 'Thomas K.', umfeld)).toBe(
			'Thomas K. hat die Frist für „Kommst du mit?“ auf Do 22.10. 18:00 gesetzt',
		);
	});

	it('meldet eine aufgehobene Frist', () => {
		expect(systemSatz('FRIST_GEAENDERT', { frage: 'Kommst du mit?', frist: null }, 'Thomas K.', umfeld)).toBe(
			'Thomas K. hat die Frist für „Kommst du mit?“ aufgehoben',
		);
	});

	it('nennt beim Modus den Anzeigetext', () => {
		expect(systemSatz('MODUS_GEAENDERT', { modus: 'AUSHANG' }, 'Thomas K.', umfeld)).toBe(
			'Thomas K. hat den Modus auf „Nur Aushang“ gestellt',
		);
	});

	it('faellt bei unlesbaren Daten auf den allgemeinen Satz zurueck', () => {
		const allgemein = 'Thomas K. hat den Thread geändert';
		expect(systemSatz('TERMIN_GEAENDERT', null, 'Thomas K.', umfeld)).toBe(allgemein);
		expect(systemSatz('TERMIN_GEAENDERT', { termin: 3 }, 'Thomas K.', umfeld)).toBe(allgemein);
		expect(systemSatz('TERMIN_GEAENDERT', { termin: { ...termin, beginn: '25:00' } }, 'Thomas K.', umfeld)).toBe(
			allgemein,
		);
		expect(systemSatz('TERMIN_GEAENDERT', { termin: { ...termin, startDatum: 'morgen' } }, 'Thomas K.', umfeld)).toBe(
			allgemein,
		);
		expect(systemSatz('MODUS_GEAENDERT', { modus: 'X' }, 'Thomas K.', umfeld)).toBe(allgemein);
		expect(systemSatz('MODUS_GEAENDERT', { modus: 'toString' }, 'Thomas K.', umfeld)).toBe(allgemein);
		expect(systemSatz('FRIST_GEAENDERT', { frage: 'Q', frist: 'bald' }, 'Thomas K.', umfeld)).toBe(allgemein);
		expect(systemSatz('FRIST_GEAENDERT', { frist: null }, 'Thomas K.', umfeld)).toBe(allgemein);
	});
});

describe('systemSatz: AUTO_ZURUECKGEZOGEN', () => {
	const allgemein = 'Thomas K. hat den Thread geändert';
	const satz = (daten: unknown) => systemSatz('AUTO_ZURUECKGEZOGEN', daten, 'Sandra M.', umfeld);

	it('nennt Fahrer, Richtung und zwei Kinder mit "brauchen"', () => {
		expect(satz({ fahrerId: 'sandra', richtung: 'HIN', kindIds: ['lena', 'max'] })).toBe(
			'Auto von Sandra M. (Hinfahrt) zurückgezogen – Lena M. und Max M. brauchen wieder eine Mitfahrt.',
		);
	});

	it('sagt bei einem Kind "braucht" und bei der Rueckfahrt Rueckfahrt', () => {
		expect(satz({ fahrerId: 'sandra', richtung: 'RUECK', kindIds: ['lena'] })).toBe(
			'Auto von Sandra M. (Rückfahrt) zurückgezogen – Lena M. braucht wieder eine Mitfahrt.',
		);
	});

	it('zaehlt drei Kinder mit Komma und "und" auf', () => {
		expect(satz({ fahrerId: 'sandra', richtung: 'HIN', kindIds: ['lena', 'max', 'tim'] })).toBe(
			'Auto von Sandra M. (Hinfahrt) zurückgezogen – Lena M., Max M. und Tim S. brauchen wieder eine Mitfahrt.',
		);
	});

	it('nennt den Fahrer mit Kurznamen, nicht mit der Beziehung', () => {
		expect(satz({ fahrerId: 'sandra', richtung: 'HIN', kindIds: ['lena'] })).not.toContain('Mutter');
	});

	it('nennt Unbekannte ehemaliges Mitglied, Fahrer wie Kind', () => {
		expect(satz({ fahrerId: 'mia', richtung: 'HIN', kindIds: ['mia'] })).toBe(
			'Auto von ehemaliges Mitglied (Hinfahrt) zurückgezogen – ehemaliges Mitglied braucht wieder eine Mitfahrt.',
		);
	});

	it('faellt bei unlesbaren Daten auf den allgemeinen Satz zurueck', () => {
		const handelnd = (daten: unknown) => systemSatz('AUTO_ZURUECKGEZOGEN', daten, 'Thomas K.', umfeld);
		expect(handelnd(null)).toBe(allgemein);
		expect(handelnd({})).toBe(allgemein);
		expect(handelnd({ fahrerId: 'sandra', richtung: 'SEITWAERTS', kindIds: ['lena'] })).toBe(allgemein);
		expect(handelnd({ fahrerId: 3, richtung: 'HIN', kindIds: ['lena'] })).toBe(allgemein);
		expect(handelnd({ fahrerId: 'sandra', richtung: 'HIN', kindIds: 'lena' })).toBe(allgemein);
		expect(handelnd({ fahrerId: 'sandra', richtung: 'HIN', kindIds: [1] })).toBe(allgemein);
		expect(handelnd({ fahrerId: 'sandra', richtung: 'HIN', kindIds: [] })).toBe(allgemein);
	});
});

describe('MODUS_TEXT', () => {
	it('hat die festen Anzeigetexte', () => {
		expect(MODUS_TEXT).toEqual({
			AUSHANG: 'Nur Aushang',
			KOMMENTARE: 'Aushang + Kommentare',
			CHAT: 'Offener Chat',
		});
	});
});

describe('linkTeile', () => {
	it('macht aus einer Web-Adresse einen Link und laesst abschliessende Satzzeichen im Text', () => {
		expect(linkTeile('Treffpunkt: https://example.org/karte. Danke')).toEqual([
			{ art: 'text', text: 'Treffpunkt: ' },
			{ art: 'link', text: 'https://example.org/karte', href: 'https://example.org/karte' },
			{ art: 'text', text: '. Danke' },
		]);
		expect(linkTeile('(siehe http://example.org/a)')).toEqual([
			{ art: 'text', text: '(siehe ' },
			{ art: 'link', text: 'http://example.org/a', href: 'http://example.org/a' },
			{ art: 'text', text: ')' },
		]);
	});

	it('erkennt mehrere Links und einen Link am Anfang oder Ende', () => {
		expect(linkTeile('https://a.de und https://b.de')).toEqual([
			{ art: 'link', text: 'https://a.de', href: 'https://a.de' },
			{ art: 'text', text: ' und ' },
			{ art: 'link', text: 'https://b.de', href: 'https://b.de' },
		]);
	});

	it('laesst andere Schemata und nackte Adressen als Text', () => {
		for (const text of ['javascript:alert(1)', 'www.example.org', 'mailto:a@example.org', 'https://', 'https://.']) {
			expect(linkTeile(text)).toEqual([{ art: 'text', text }]);
		}
	});

	it('liefert ohne Link einen Textteil und fuer leeren Text nichts', () => {
		expect(linkTeile('Nur Text')).toEqual([{ art: 'text', text: 'Nur Text' }]);
		expect(linkTeile('')).toEqual([]);
	});

	it('gibt fremden Text unveraendert zurueck, er wird nie zu HTML', () => {
		const text = '<script>alert(1)</script> <img src=x onerror=alert(1)>';
		expect(linkTeile(text)).toEqual([{ art: 'text', text }]);
	});
});

describe('verlaufAnsicht', () => {
	const umfeld = bowlingUmfeld();
	const person = (id: string) => umfeld.personen.get(id)!;
	const eintrag = (daten: Partial<VerlaufEintragDaten> = {}): VerlaufEintragDaten => ({
		id: 'e1',
		art: 'NACHRICHT',
		autorId: 'sandra',
		text: 'Wir sind dabei',
		systemArt: null,
		systemDaten: null,
		stand: 7,
		angelegtAm: new Date('2026-10-22T08:30:00Z'),
		geloeschtAm: null,
		geloeschtVonId: null,
		...daten,
	});

	it('zeigt Thomas die Nachricht Sandras mit Beziehung und Loeschrecht der Moderation', () => {
		expect(verlaufAnsicht(person('thomas'), kopf(), eintrag(), umfeld)).toEqual({
			id: 'e1',
			art: 'NACHRICHT',
			text: 'Wir sind dabei',
			absender: 'Sandra M. (Mutter von Lena und Max)',
			eigen: false,
			angelegtAm: '2026-10-22T08:30:00.000Z',
			stand: 7,
			geloescht: null,
			darfLoeschen: true,
		});
	});

	it('kennzeichnet die eigene Nachricht und verweigert fremden Familien das Loeschen', () => {
		const sandra = verlaufAnsicht(person('sandra'), kopf(), eintrag(), umfeld);
		expect(sandra.eigen).toBe(true);
		expect(sandra.darfLoeschen).toBe(true);
		const hans = verlaufAnsicht(person('hans'), kopf(), eintrag(), umfeld);
		expect(hans.eigen).toBe(false);
		expect(hans.darfLoeschen).toBe(false);
	});

	it('nennt den Grund einer Loeschung und blendet den Text aus', () => {
		const selbst = verlaufAnsicht(
			person('hans'),
			kopf(),
			eintrag({ geloeschtAm: JETZT, geloeschtVonId: 'sandra' }),
			umfeld,
		);
		expect(selbst).toMatchObject({ geloescht: 'SELBST', text: null, darfLoeschen: false });
		const moderation = verlaufAnsicht(
			person('thomas'),
			kopf(),
			eintrag({ geloeschtAm: JETZT, geloeschtVonId: 'thomas' }),
			umfeld,
		);
		expect(moderation).toMatchObject({ geloescht: 'MODERATION', text: null, darfLoeschen: false });
	});

	it('liest eine Loeschung ohne bekannten Urheber als Moderation', () => {
		const a = verlaufAnsicht(person('hans'), kopf(), eintrag({ geloeschtAm: JETZT, geloeschtVonId: null }), umfeld);
		expect(a.geloescht).toBe('MODERATION');
	});

	it('macht aus einem Systemeintrag den Satz mit dem Kurznamen des Autors', () => {
		const a = verlaufAnsicht(
			person('sandra'),
			kopf(),
			eintrag({ art: 'SYSTEM', autorId: 'thomas', text: null, systemArt: 'VEROEFFENTLICHT', systemDaten: {} }),
			umfeld,
		);
		expect(a).toMatchObject({
			art: 'SYSTEM',
			text: 'Thomas K. hat den Thread veröffentlicht',
			absender: null,
			eigen: false,
			darfLoeschen: false,
		});
	});

	it('schreibt fuer einen entfernten Autor "Ein ehemaliges Mitglied" mit grossem Anfang', () => {
		const a = verlaufAnsicht(
			person('sandra'),
			kopf(),
			eintrag({ art: 'SYSTEM', autorId: 'mia', text: null, systemArt: 'VEROEFFENTLICHT', systemDaten: {} }),
			umfeld,
		);
		expect(a.text).toBe('Ein ehemaliges Mitglied hat den Thread veröffentlicht');
		const ohneAutor = verlaufAnsicht(
			person('sandra'),
			kopf(),
			eintrag({ art: 'SYSTEM', autorId: null, text: null, systemArt: 'VEROEFFENTLICHT', systemDaten: {} }),
			umfeld,
		);
		expect(ohneAutor.text).toBe('Ein ehemaliges Mitglied hat den Thread veröffentlicht');
	});

	it('gibt den Zeitpunkt als ISO-Text', () => {
		expect(verlaufAnsicht(person('thomas'), kopf(), eintrag(), umfeld).angelegtAm).toBe('2026-10-22T08:30:00.000Z');
	});
});
