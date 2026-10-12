import type { TerminModul } from '../daten/typen';
import { alsIcs, berlinNachUtc, googleLink, kalenderEintrag } from './kalender';

const t = (x: Partial<TerminModul>): TerminModul => ({ id: 'm1', typ: 'termin', von: '2026-10-17', ort: 'X', ...x });
const L = 'https://example.test/entwurf/glonntal/t/2-bowling/m/m1';

describe('Kalender', () => {
	it('bildet die vier Regeln der Spec 3.3 ab', () => {
		expect(
			kalenderEintrag(t({ von: '2026-10-23', bis: '2026-10-25', endeZeit: '12:00' }), 'Zeltlager', L),
		).toMatchObject({ ganztaegig: true, beginn: '2026-10-23', ende: '2026-10-26' });
		expect(kalenderEintrag(t({ beginnZeit: '14:00', endeZeit: '17:00' }), 'B', L)).toMatchObject({
			ganztaegig: false,
			beginn: '2026-10-17T14:00',
			ende: '2026-10-17T17:00',
		});
		expect(kalenderEintrag(t({ beginnZeit: '23:30' }), 'B', L)).toMatchObject({ ende: '2026-10-18T00:30' });
		expect(kalenderEintrag(t({ von: '2026-10-23', bis: '2026-10-25', beginnZeit: '17:00' }), 'B', L)).toMatchObject({
			ende: '2026-10-26T00:00',
		});
	});
	it('setzt Titel aus Thread und Modul und schreibt Hinweise in die Beschreibung', () => {
		const e = kalenderEintrag(
			t({ titel: 'Vortreffen', beginnZeit: '17:00', treffpunkt: 'Parkplatz' }),
			'⛺ Zeltlager 2027',
			L,
		);
		expect(e.titel).toBe('⛺ Zeltlager 2027 · Vortreffen');
		expect(e.beschreibung).toBe(`Treffpunkt: Parkplatz\nEnde offen\n${L}`);
		expect(kalenderEintrag(t({ endeZeit: '12:00' }), 'B', L).beschreibung).toBe(`Ende 12:00\n${L}`);
	});
	it('rechnet Berliner Zeit unabhaengig von der Browser-Zeitzone nach UTC', () => {
		expect(berlinNachUtc('2026-10-17T14:00')).toBe('20261017T120000Z');
		expect(berlinNachUtc('2026-10-25T12:00')).toBe('20261025T110000Z');
		expect(berlinNachUtc('2026-12-18T18:00')).toBe('20261218T170000Z');
		expect(berlinNachUtc('2027-03-28T12:00')).toBe('20270328T100000Z');
	});
	it('schreibt eine gueltige .ics-Datei', () => {
		const ics = alsIcs(
			kalenderEintrag(t({ beginnZeit: '14:00', endeZeit: '17:00' }), 'Bowling', L),
			'glonntal-m1@jufi-app.de',
			new Date(Date.UTC(2026, 9, 11, 8, 0)),
		);
		expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
		expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(ics).toContain('\r\nUID:glonntal-m1@jufi-app.de\r\n');
		expect(ics).toContain('\r\nDTSTAMP:20261011T080000Z\r\n');
		expect(ics).toContain('\r\nDTSTART:20261017T120000Z\r\nDTEND:20261017T150000Z\r\n');
	});
	it('schreibt ganztaegige Eintraege als Datum mit exklusivem Ende', () => {
		const ics = alsIcs(kalenderEintrag(t({ von: '2026-10-23', bis: '2026-10-25' }), 'Z', L), 'u', new Date(0));
		expect(ics).toContain('\r\nDTSTART;VALUE=DATE:20261023\r\nDTEND;VALUE=DATE:20261026\r\n');
	});
	it('maskiert Sonderzeichen und faltet lange Zeilen nach 75 Bytes ohne Zeichen zu zerreissen', () => {
		const lang = 'Grillen; Kuchen, Getränke \\ 🎣 '.repeat(6);
		const ics = alsIcs({ ...kalenderEintrag(t({}), lang, L), ort: 'A,B;C' }, 'u', new Date(0));
		expect(ics).toContain('LOCATION:A\\,B\\;C');
		const zeilen = ics.split('\r\n');
		expect(zeilen.every((z) => new TextEncoder().encode(z).length <= 75)).toBe(true);
		expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:Grillen\\; Kuchen\\, Getränke \\\\ 🎣');
		expect(ics).not.toContain('�');
	});
	it('baut den Google-Link mit Berliner Zeitzone', () => {
		const u = new URL(
			googleLink(
				kalenderEintrag(t({ beginnZeit: '14:00', endeZeit: '17:00', ort: 'Hegen & Pflegen' }), 'Bowling & Pizza', L),
			),
		);
		expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
		expect(u.searchParams.get('action')).toBe('TEMPLATE');
		expect(u.searchParams.get('text')).toBe('Bowling & Pizza');
		expect(u.searchParams.get('dates')).toBe('20261017T140000/20261017T170000');
		expect(u.searchParams.get('ctz')).toBe('Europe/Berlin');
		expect(u.searchParams.get('location')).toBe('Hegen & Pflegen');
		expect(googleLink(kalenderEintrag(t({}), 'A', L))).toContain('dates=20261017/20261018');
	});
});
