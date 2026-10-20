import type { TerminDaten } from '../module/termin/termin.js';
import { istArchiviert } from './archiv.js';
import { kopf } from './testhilfe.js';

function termin(startDatum: string, endDatum: string | null = null): TerminDaten {
	return { modulId: `m-${startDatum}`, startDatum, endDatum, beginn: null, ende: null, ort: null, treffpunkt: null };
}

const archiviert = (k = kopf(), termine: TerminDaten[] = [], jetzt = '2026-10-22T10:00:00Z') =>
	istArchiviert(k, termine, new Date(jetzt));

describe('istArchiviert', () => {
	it('archiviert einen Termin am Samstag 17.10. ab Samstag 24.10., 00:00 Uhr Berlin', () => {
		const t = [termin('2026-10-17')];
		expect(archiviert(kopf(), t, '2026-10-23T21:59:59Z')).toBe(false);
		expect(archiviert(kopf(), t, '2026-10-23T22:00:00Z')).toBe(true);
	});

	it('rechnet die Grenze fuer Sonntag 18.10. ueber die Zeitumstellung am 25.10. richtig', () => {
		const t = [termin('2026-10-18')];
		expect(archiviert(kopf(), t, '2026-10-24T21:59:59Z')).toBe(false);
		expect(archiviert(kopf(), t, '2026-10-24T22:00:00Z')).toBe(true);
	});

	it('nimmt bei einem mehrtaegigen Termin 23.-25.10. den letzten Tag und die Winterzeit', () => {
		const t = [termin('2026-10-23', '2026-10-25')];
		expect(archiviert(kopf(), t, '2026-10-31T22:59:59Z')).toBe(false);
		expect(archiviert(kopf(), t, '2026-10-31T23:00:00Z')).toBe(true);
	});

	it('laesst bei zwei Terminen den spaeteren zaehlen', () => {
		const t = [termin('2026-10-10'), termin('2026-10-17')];
		expect(archiviert(kopf(), t, '2026-10-23T21:59:59Z')).toBe(false);
		expect(archiviert(kopf(), t, '2026-10-23T22:00:00Z')).toBe(true);
	});

	it('archiviert bei ARCHIVIERT auch mit kuenftigem Termin', () => {
		expect(archiviert(kopf({ archivModus: 'ARCHIVIERT' }), [termin('2026-12-01')])).toBe(true);
	});

	it('haelt bei AKTIV_HALTEN einen alten Termin aktiv', () => {
		expect(archiviert(kopf({ archivModus: 'AKTIV_HALTEN' }), [termin('2026-01-01')])).toBe(false);
	});

	it('haelt einen angepinnten Thread aktiv', () => {
		expect(archiviert(kopf({ angepinnt: true }), [termin('2026-01-01')])).toBe(false);
	});

	it('haelt den Austausch aktiv', () => {
		expect(archiviert(kopf({ art: 'JUGENDSPRECHER_AUSTAUSCH' }), [termin('2026-01-01')])).toBe(false);
	});

	it('haelt einen Thread ohne Termin aktiv', () => {
		expect(archiviert(kopf(), [])).toBe(false);
	});

	it('laesst ARCHIVIERT vor Anpinnen und Austausch gelten', () => {
		expect(archiviert(kopf({ archivModus: 'ARCHIVIERT', angepinnt: true }))).toBe(true);
		expect(archiviert(kopf({ archivModus: 'ARCHIVIERT', art: 'JUGENDSPRECHER_AUSTAUSCH' }))).toBe(true);
	});
});
