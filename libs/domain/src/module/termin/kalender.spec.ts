import { describe, expect, it } from 'vitest';
import { alsIcs, googleKalenderLink, kalenderEintrag } from './kalender.js';
import type { TerminDaten } from './termin.js';

const LINK = 'https://jufi-app.de/fischer/t/abc/m/mod1';

function termin(aenderung: Partial<TerminDaten> = {}): TerminDaten {
	return {
		modulId: 'mod1',
		startDatum: '2026-10-24',
		endDatum: null,
		beginn: null,
		ende: null,
		ort: null,
		treffpunkt: null,
		...aenderung,
	};
}

describe('kalenderEintrag', () => {
	it('ohne Beginn ist der Eintrag ganztaegig, das Ende exklusiv, die Endezeit steht in der Beschreibung', () => {
		const e = kalenderEintrag(
			termin({ startDatum: '2026-10-23', endDatum: '2026-10-25', ende: '12:00' }),
			'Zeltlager 2027',
			null,
			LINK,
		);
		expect(e.ganztaegig).toBe(true);
		expect(e.beginn).toBe('2026-10-23');
		expect(e.ende).toBe('2026-10-26');
		expect(e.beschreibung).toContain('Ende 12:00');
	});

	it('ganztaegig und eintaegig endet am Folgetag', () => {
		const e = kalenderEintrag(termin(), 'Bowling', null, LINK);
		expect(e.ganztaegig).toBe(true);
		expect(e.beginn).toBe('2026-10-24');
		expect(e.ende).toBe('2026-10-25');
		expect(e.beschreibung).not.toContain('Ende');
	});

	it('mit Beginn und Ende gilt Berliner Zeit, als UTC angegeben', () => {
		const e = kalenderEintrag(termin({ beginn: '14:00', ende: '17:00' }), 'Bowling', null, LINK);
		expect(e.ganztaegig).toBe(false);
		expect(e.beginn).toBe('2026-10-24T12:00:00.000Z');
		expect(e.ende).toBe('2026-10-24T15:00:00.000Z');
	});

	it('eintaegig nur mit Beginn dauert eine Stunde und sagt es', () => {
		const e = kalenderEintrag(termin({ beginn: '14:00' }), 'Bowling', null, LINK);
		expect(e.beginn).toBe('2026-10-24T12:00:00.000Z');
		expect(e.ende).toBe('2026-10-24T13:00:00.000Z');
		expect(e.beschreibung).toContain('Ende offen');
	});

	it('mehrtaegig mit Beginn ohne Ende reicht bis Mitternacht Berlin, auch ueber die Zeitumstellung', () => {
		const e = kalenderEintrag(
			termin({ startDatum: '2026-10-23', endDatum: '2026-10-25', beginn: '17:00' }),
			'Zeltlager 2027',
			null,
			LINK,
		);
		expect(e.beginn).toBe('2026-10-23T15:00:00.000Z');
		expect(e.ende).toBe('2026-10-25T23:00:00.000Z');
		expect(e.beschreibung).not.toContain('Ende offen');
	});

	it('der Titel haengt den Modultitel an, sonst bleibt es der Thread-Titel', () => {
		expect(kalenderEintrag(termin(), 'Zeltlager 2027', 'Vortreffen', LINK).titel).toBe('Zeltlager 2027 · Vortreffen');
		expect(kalenderEintrag(termin(), 'Zeltlager 2027', null, LINK).titel).toBe('Zeltlager 2027');
		expect(kalenderEintrag(termin(), 'Zeltlager 2027', '', LINK).titel).toBe('Zeltlager 2027');
	});

	it('Beschreibung hat Treffpunkt und Link, sonst nichts; der Ort kommt aus dem Termin', () => {
		const e = kalenderEintrag(
			termin({ beginn: '14:00', ende: '17:00', treffpunkt: 'Vor dem Bootshaus', ort: 'Bowlingcenter' }),
			'Bowling',
			null,
			LINK,
		);
		expect(e.beschreibung).toBe(`Treffpunkt: Vor dem Bootshaus\n${LINK}`);
		expect(e.ort).toBe('Bowlingcenter');
	});

	it('ohne Treffpunkt und Ort bleibt nur der Link und der Ort ist null', () => {
		const e = kalenderEintrag(termin({ beginn: '14:00', ende: '17:00' }), 'Bowling', null, LINK);
		expect(e.beschreibung).toBe(LINK);
		expect(e.ort).toBeNull();
	});
});

describe('alsIcs', () => {
	const jetzt = new Date('2026-10-20T08:30:15.000Z');

	it('ganztaegig mit DATE-Werten, CRLF und fester UID', () => {
		const e = kalenderEintrag(termin({ startDatum: '2026-10-23', endDatum: '2026-10-25' }), 'Zeltlager', null, LINK);
		const ics = alsIcs(e, 'mod1@jufi-app.de', jetzt);
		expect(ics.endsWith('\r\n')).toBe(true);
		expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
		const zeilen = ics.split('\r\n');
		expect(zeilen[0]).toBe('BEGIN:VCALENDAR');
		expect(zeilen).toContain('UID:mod1@jufi-app.de');
		expect(zeilen).toContain('DTSTART;VALUE=DATE:20261023');
		expect(zeilen).toContain('DTEND;VALUE=DATE:20261026');
		expect(zeilen).toContain('DTSTAMP:20261020T083015Z');
		expect(zeilen).toContain('END:VCALENDAR');
	});

	it('mit Uhrzeit als UTC', () => {
		const e = kalenderEintrag(termin({ beginn: '14:00', ende: '17:00' }), 'Bowling', null, LINK);
		const zeilen = alsIcs(e, 'mod1@jufi-app.de', jetzt).split('\r\n');
		expect(zeilen).toContain('DTSTART:20261024T120000Z');
		expect(zeilen).toContain('DTEND:20261024T150000Z');
	});

	it('maskiert Komma, Semikolon, Backslash und Zeilenumbruch in Texten', () => {
		const e = kalenderEintrag(
			termin({ beginn: '14:00', ort: 'Halle 1, Hof; hinten\\links', treffpunkt: 'Tor' }),
			'A, B; C',
			null,
			LINK,
		);
		// Entfaltet, weil die lange Beschreibung gefaltet wird.
		const ics = alsIcs(e, 'mod1@jufi-app.de', jetzt).replace(/\r\n /g, '');
		expect(ics).toContain('SUMMARY:A\\, B\; C\r\n');
		expect(ics).toContain('LOCATION:Halle 1\\, Hof\; hinten\\\\links\r\n');
		expect(ics).toContain('DESCRIPTION:Treffpunkt: Tor\\nEnde offen\\n' + LINK);
	});

	it('laesst LOCATION ohne Ort weg', () => {
		const e = kalenderEintrag(termin(), 'Bowling', null, LINK);
		expect(alsIcs(e, 'mod1@jufi-app.de', jetzt)).not.toContain('LOCATION');
	});

	it('faltet lange Zeilen auf 75 Byte an Code-Point-Grenzen', () => {
		const titel = 'ü'.repeat(40);
		const e = kalenderEintrag(termin(), titel, null, LINK);
		const ics = alsIcs(e, 'mod1@jufi-app.de', jetzt);
		const zeilen = ics.split('\r\n');
		for (const zeile of zeilen) expect(new TextEncoder().encode(zeile).length).toBeLessThanOrEqual(75);
		// Entfaltet (CRLF plus Leerzeichen entfernen) steht der Titel unversehrt da.
		expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${titel}\r\n`);
		expect(zeilen.some((z) => z.startsWith(' '))).toBe(true);
	});

	it('zerreisst kein Emoji', () => {
		const e = kalenderEintrag(termin(), '🎣'.repeat(30), null, LINK);
		const ics = alsIcs(e, 'mod1@jufi-app.de', jetzt);
		expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${'🎣'.repeat(30)}\r\n`);
		for (const zeile of ics.split('\r\n')) expect(new TextEncoder().encode(zeile).length).toBeLessThanOrEqual(75);
	});
});

describe('googleKalenderLink', () => {
	it('nimmt Berliner Wandzeit und ctz', () => {
		const e = kalenderEintrag(termin({ beginn: '14:00', ende: '17:00' }), 'Bowling', null, LINK);
		const link = googleKalenderLink(e);
		expect(link.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&')).toBe(true);
		expect(link).toContain('ctz=Europe/Berlin');
		expect(link).toContain('dates=20261024T140000/20261024T170000');
	});

	it('ganztaegig nur mit Datum', () => {
		const e = kalenderEintrag(termin({ startDatum: '2026-10-23', endDatum: '2026-10-25' }), 'Zeltlager', null, LINK);
		expect(googleKalenderLink(e)).toContain('dates=20261023/20261026');
	});

	it('Wandzeit stimmt auch ueber die Zeitumstellung', () => {
		const e = kalenderEintrag(
			termin({ startDatum: '2026-10-23', endDatum: '2026-10-25', beginn: '17:00' }),
			'Zeltlager',
			null,
			LINK,
		);
		expect(googleKalenderLink(e)).toContain('dates=20261023T170000/20261026T000000');
	});

	it('kodiert Text, Beschreibung und Ort', () => {
		const e = kalenderEintrag(
			termin({ beginn: '14:00', ort: 'Café & Bar', treffpunkt: 'Tor' }),
			'Zeltlager 2027',
			'Vortreffen',
			LINK,
		);
		const link = googleKalenderLink(e);
		expect(link).toContain(`text=${encodeURIComponent('Zeltlager 2027 · Vortreffen')}`);
		expect(link).toContain(`location=${encodeURIComponent('Café & Bar')}`);
		expect(link).toContain(`details=${encodeURIComponent(e.beschreibung)}`);
	});

	it('laesst location ohne Ort weg', () => {
		const e = kalenderEintrag(termin(), 'Bowling', null, LINK);
		expect(googleKalenderLink(e)).not.toContain('location=');
	});
});
