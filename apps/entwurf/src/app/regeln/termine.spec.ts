import { erzeugeBeispieldaten, M, P, T } from '../daten/beispieldaten';
import type { TerminModul } from '../daten/typen';
import { jetzt as jetztVon } from '../daten/zeit';
import { istArchiviert, naechsteTermine, neuigkeiten, termineImMonat, termineVon } from './termine';
import { threadVon } from './testhilfe';

const stand = erzeugeBeispieldaten('2026-10-11');
const jetzt = jetztVon('2026-10-11', new Date(2026, 9, 11, 10, 0));
const plusTage = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Beispielstand, in dem der Orga-Thread (sieht Thomas) nur diesen einen Termin hat. */
function mitTermin(m: Partial<TerminModul> & { id: string; von: string }) {
	const termin: TerminModul = { typ: 'termin', ort: 'Vereinsheim', ...m };
	return {
		...stand,
		threads: stand.threads.map((t) => (t.id === T.orga ? { ...t, module: [termin] } : t)),
	};
}
const ids = (e: { modul: { id: string } }[]) => e.map((x) => x.modul.id);

describe('istArchiviert', () => {
	it('archiviert eine Woche nach dem letzten Termin', () => {
		const hege = threadVon(stand, T.hegefischen);
		expect(istArchiviert(hege, jetzt)).toBe(false);
		expect(istArchiviert(hege, plusTage(jetzt, 3))).toBe(true);
	});

	it('beachtet die manuelle Archivierung', () => {
		expect(istArchiviert(threadVon(stand, T.koenigsfischen), jetzt)).toBe(true);
	});

	it('laesst Threads mit kuenftigem Termin und ohne Termin aktiv', () => {
		expect(istArchiviert(threadVon(stand, T.infos), jetzt)).toBe(false);
		expect(istArchiviert(threadVon(stand, T.orga), plusTage(jetzt, 365))).toBe(false);
	});
});

describe('Mehrtaegige Termine', () => {
	it('zeigt einen laufenden mehrtaegigen Termin unter "Als Naechstes" bis zu seinem Ende', () => {
		const s = mitTermin({ id: 'm-lauf', von: '2026-10-16', bis: '2026-10-18', beginnZeit: '17:00', endeZeit: '12:00' });
		expect(ids(naechsteTermine(s, P.thomas, new Date(2026, 9, 17, 10, 0), 50))).toContain('m-lauf');
		expect(ids(naechsteTermine(s, P.thomas, new Date(2026, 9, 18, 12, 1), 50))).not.toContain('m-lauf');
	});

	it('fuehrt einen Termin ueber die Monatsgrenze in beiden Monaten', () => {
		const s = mitTermin({ id: 'm-grenze', von: '2026-10-30', bis: '2026-11-01' });
		expect(ids(termineImMonat(s, P.thomas, 2026, 9))).toContain('m-grenze');
		expect(ids(termineImMonat(s, P.thomas, 2026, 10))).toContain('m-grenze');
		expect(ids(termineImMonat(s, P.thomas, 2026, 11))).not.toContain('m-grenze');
	});

	it('archiviert eine Woche nach dem letzten Tag', () => {
		const s = mitTermin({ id: 'm-alt', von: '2026-10-01', bis: '2026-10-03' });
		const orga = threadVon(s, T.orga);
		expect(istArchiviert(orga, new Date(2026, 9, 10, 23, 0))).toBe(false);
		expect(istArchiviert(orga, new Date(2026, 9, 11, 0, 1))).toBe(true);
	});
});

describe('Termine', () => {
	it('beginnt "Als Naechstes" mit der Gruppenstunde', () => {
		const naechste = naechsteTermine(stand, P.sandra, jetzt, 3);
		expect(naechste).toHaveLength(3);
		expect(naechste[0].modul.id).toBe(M.gruppenstunde);
		expect(naechste[1].threadId).toBe(T.bowling);
	});

	it('zeigt nur Termine sichtbarer Threads', () => {
		expect(termineVon(stand, P.lena).some((e) => e.threadId === T.herbstfest)).toBe(false);
		expect(termineVon(stand, P.sandra).some((e) => e.threadId === T.herbstfest)).toBe(true);
	});

	it('sammelt die Termine eines Monats', () => {
		const oktober = termineImMonat(stand, P.thomas, 2026, 9).map((e) => e.threadId);
		expect(oktober).toEqual(expect.arrayContaining([T.infos, T.bowling, T.hegefischen, T.zeltlager]));
		// Der Aufbau am 31.10. gehoert in den Oktober, das Fest selbst am 1.11. nicht.
		const herbst = termineImMonat(stand, P.thomas, 2026, 9).filter((e) => e.threadId === T.herbstfest);
		expect(herbst.map((e) => e.modul.titel)).toEqual(['Aufbau']);
	});
});

describe('neuigkeiten', () => {
	it('meldet sichtbare Threads mit Aktivitaet seit dem letzten Besuch', () => {
		const neu = neuigkeiten(stand, P.sandra, stand.letzterBesuch[P.sandra]);
		expect(neu.map((n) => n.threadId)).toEqual([T.zeltlager, T.bowling, T.herbstfest]);
		expect(neu[0].text).toBe('3 neue Nachrichten');
		expect(neu[1].text).toBe('2 neue Kommentare');
		expect(neuigkeiten(stand, P.thomas, stand.letzterBesuch[P.thomas]).map((n) => n.threadId)).toContain(T.orga);
	});

	it('zaehlt eigene Nachrichten und Antworten nicht als neu', () => {
		const seit = stand.letzterBesuch[P.sandra];
		const eigen = { id: 'v-eigen', art: 'nachricht' as const, von: P.sandra, text: 'Hallo', zeit: '2026-10-11T09:00' };
		const mitEigenem = {
			...stand,
			threads: stand.threads.map((t) =>
				t.id === T.infos || t.id === T.bowling
					? { ...t, verlauf: [...t.verlauf, eigen], letzteAktivitaet: eigen.zeit, letzteAktivitaetVon: P.sandra }
					: t,
			),
		};
		const neu = neuigkeiten(mitEigenem, P.sandra, seit);
		expect(neu.map((n) => n.threadId)).not.toContain(T.infos);
		expect(neu.find((n) => n.threadId === T.bowling)?.text).toBe('2 neue Kommentare');
		expect(neuigkeiten(mitEigenem, P.thomas, stand.letzterBesuch[P.thomas]).map((n) => n.threadId)).toContain(T.infos);
	});
});
