import type { TerminDaten } from '../module/termin/termin.js';
import type { ModulDaten } from './ansicht.js';
import { passtZuSuche, threadListe, type ListenThread } from './liste.js';
import { threadSegment } from './pfad.js';
import type { NeuAenderung } from './start.js';
import type { ThreadKopf, UmfrageDaten } from './typen.js';
import { bowlingUmfeld, JETZT, kopf } from './testhilfe.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;

const ZUGANG = new Date('2026-10-01T00:00:00Z');

function termin(daten: Partial<TerminDaten> = {}): TerminDaten {
	return {
		modulId: 'm-termin',
		startDatum: '2026-10-24',
		endDatum: null,
		beginn: '15:00',
		ende: null,
		ort: null,
		treffpunkt: null,
		...daten,
	};
}

const terminModul = (daten: Partial<TerminDaten> = {}): ModulDaten => ({
	typ: 'TERMIN',
	id: 'm-termin',
	titel: null,
	termin: termin(daten),
});
const infoModul = (text: string): ModulDaten => ({ typ: 'INFO', id: 'm-info', titel: null, text });

const umfrage: UmfrageDaten = {
	modulId: 'm-umfrage',
	frage: 'Kommst du zum Pizzaessen?',
	einheit: 'JUNGFISCHER',
	mehrfach: false,
	teilnahme: true,
	vielleicht: true,
	frist: null,
	ergebnisse: 'ALLE',
	optionen: [],
	antworten: [],
};
const umfrageModul: ModulDaten = { typ: 'UMFRAGE', id: 'm-umfrage', titel: null, umfrage };

function listenThread(
	k: Partial<ThreadKopf>,
	module: ModulDaten[] = [],
	rest: Partial<ListenThread> = {},
): ListenThread {
	return {
		kopf: kopf(k),
		module,
		letzteAktivitaetAm: new Date('2026-10-21T10:00:00Z'),
		gelesenBis: 4,
		aenderungen: [],
		...rest,
	};
}

const fremd = (stand = 5, art: NeuAenderung['art'] = 'THREAD'): NeuAenderung => ({
	stand,
	art,
	urheberId: 'thomas',
	angelegtAm: new Date('2026-10-21T11:00:00Z'),
});

const AUSTAUSCH = listenThread({
	id: 'austausch',
	art: 'JUGENDSPRECHER_AUSTAUSCH',
	titel: 'Jugendsprecher-Austausch',
	modus: 'CHAT',
	rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER',
	angepinnt: true,
	erstelltVonId: null,
});

describe('passtZuSuche', () => {
	const bowling = kopf();

	it('findet den Titel ohne Beachtung der Gross- und Kleinschreibung', () => {
		expect(passtZuSuche(bowling, [], 'bowling')).toBe(true);
		expect(passtZuSuche(bowling, [], 'BOWL')).toBe(true);
	});

	it('findet den Info-Text auch mit Umlaut in Grossbuchstaben', () => {
		expect(passtZuSuche(kopf({ titel: 'Zeltlager' }), [infoModul('Wir übernachten im Zelt')], 'ÜBERNACHTEN')).toBe(
			true,
		);
	});

	it('findet den Ort eines Termins', () => {
		expect(passtZuSuche(bowling, [terminModul({ ort: 'Bowlingcenter Glonn' })], 'glonn')).toBe(true);
	});

	it('nimmt Prozentzeichen woertlich', () => {
		expect(passtZuSuche(kopf({ titel: '100% Spaß' }), [], '100%')).toBe(true);
		expect(passtZuSuche(kopf({ titel: '1000 Spaß' }), [], '100%')).toBe(false);
	});

	it('nimmt den Unterstrich woertlich', () => {
		expect(passtZuSuche(kopf({ titel: 'Unter_strich' }), [], '_')).toBe(true);
		expect(passtZuSuche(kopf({ titel: 'Ohne Strich' }), [], '_')).toBe(false);
	});

	it('sucht nicht in der Frage einer Umfrage', () => {
		expect(passtZuSuche(bowling, [umfrageModul], 'pizza')).toBe(false);
	});

	it('gleicht zerlegte und zusammengesetzte Zeichen an (NFC)', () => {
		expect(passtZuSuche(kopf({ titel: 'Café' }), [], 'Café')).toBe(true);
		expect(passtZuSuche(kopf({ titel: 'Café' }), [], 'Café')).toBe(true);
	});
});

describe('threadListe', () => {
	const liste = (ich: string, threads: ListenThread[], extra: Partial<Parameters<typeof threadListe>[0]> = {}) =>
		threadListe({
			ich: person(ich),
			threads,
			umfeld,
			zugangSeit: ZUGANG,
			suche: null,
			mitArchiv: false,
			jetzt: JETZT,
			...extra,
		});
	const ids = (l: ReturnType<typeof threadListe>) => l.threads.map((t) => t.id);

	const NUR_LEITER = listenThread({ id: 'intern', titel: 'Intern', rollenfilter: 'NUR_JUGENDLEITER' });
	const ENTWURF = listenThread({ id: 'entwurf', titel: 'Plan', veroeffentlichtAm: null });

	describe('Sichtbarkeit', () => {
		const alle = [listenThread({}), AUSTAUSCH, NUR_LEITER, ENTWURF];

		it('zeigt Sandra weder Austausch noch Jugendleiter-Thread noch Entwurf', () => {
			expect(ids(liste('sandra', alle))).toEqual(['bowling']);
		});

		it('zeigt Thomas den Entwurf mit entwurf: true', () => {
			const thomas = liste('thomas', alle);
			expect(ids(thomas).sort()).toEqual(['austausch', 'bowling', 'entwurf', 'intern']);
			expect(thomas.threads.find((t) => t.id === 'entwurf')?.entwurf).toBe(true);
			expect(thomas.threads.find((t) => t.id === 'bowling')?.entwurf).toBe(false);
		});

		it('zeigt Lena den Austausch angepinnt', () => {
			const lena = liste('lena', alle);
			expect(lena.threads.find((t) => t.id === 'austausch')?.angepinnt).toBe(true);
			expect(ids(lena)).not.toContain('intern');
		});
	});

	it('ordnet nach letzter Aktivitaet absteigend, bei Gleichstand nach ID', () => {
		const spaet = new Date('2026-10-21T18:00:00Z');
		const gleich = new Date('2026-10-20T08:00:00Z');
		const l = liste('thomas', [
			listenThread({ id: 'b', titel: 'B' }, [], { letzteAktivitaetAm: gleich }),
			listenThread({ id: 'a', titel: 'A' }, [], { letzteAktivitaetAm: gleich }),
			listenThread({ id: 'z', titel: 'Z' }, [], { letzteAktivitaetAm: spaet }),
		]);
		expect(ids(l)).toEqual(['z', 'a', 'b']);
	});

	describe('Archiv', () => {
		const alt = listenThread({ id: 'alt', titel: 'Alt' }, [terminModul({ startDatum: '2026-10-10' })]);
		const neu = listenThread({ id: 'neu', titel: 'Neu' });

		it('markiert einen alten Termin als archiviert', () => {
			const l = liste('thomas', [alt], { mitArchiv: true });
			expect(l.threads[0].archiviert).toBe(true);
		});

		it('laesst ihn ohne mitArchiv weg und zaehlt ihn', () => {
			const l = liste('thomas', [alt, neu]);
			expect(ids(l)).toEqual(['neu']);
			expect(l.archiv).toBe(1);
		});

		it('liefert ihn mit mitArchiv und zaehlt ihn weiter', () => {
			const l = liste('thomas', [alt, neu], { mitArchiv: true });
			expect(ids(l).sort()).toEqual(['alt', 'neu']);
			expect(l.archiv).toBe(1);
		});
	});

	describe('neu', () => {
		it('ist neu bei fremder THREAD-Aenderung ueber dem Gelesen-Stand', () => {
			const l = liste('sandra', [listenThread({}, [], { aenderungen: [fremd()] })]);
			expect(l.threads[0].neu).toBe(true);
		});

		it('ist nicht neu bei nur einer LISTE-Aenderung', () => {
			const l = liste('sandra', [listenThread({}, [], { aenderungen: [fremd(5, 'LISTE')] })]);
			expect(l.threads[0].neu).toBe(false);
		});

		it('ist archiviert nie neu', () => {
			const l = liste('sandra', [listenThread({ archivModus: 'ARCHIVIERT' }, [], { aenderungen: [fremd()] })], {
				mitArchiv: true,
			});
			expect(l.threads[0].archiviert).toBe(true);
			expect(l.threads[0].neu).toBe(false);
		});

		it('nutzt ohne Gelesen-Stand den Zugang', () => {
			const l = liste('sandra', [listenThread({}, [], { gelesenBis: null })]);
			expect(l.threads[0].neu).toBe(true);
		});
	});

	describe('Suche', () => {
		const bowling = listenThread({ id: 'bowling', titel: '🎳 Bowling' });
		const zelt = listenThread({ id: 'zelt', titel: 'Zeltlager' });
		const altBowling = listenThread({ id: 'alt-bowling', titel: 'Bowling im Sommer' }, [
			terminModul({ startDatum: '2026-06-01' }),
		]);
		const altZelt = listenThread({ id: 'alt-zelt', titel: 'Zelten' }, [terminModul({ startDatum: '2026-06-01' })]);

		it('laesst nur passende Threads uebrig und zaehlt nur passende archivierte', () => {
			const l = liste('thomas', [bowling, zelt, altBowling, altZelt], { suche: 'bowl' });
			expect(ids(l)).toEqual(['bowling']);
			expect(l.archiv).toBe(1);
		});

		it('findet archivierte Treffer mit mitArchiv', () => {
			const l = liste('thomas', [bowling, zelt, altBowling, altZelt], { suche: 'bowl', mitArchiv: true });
			expect(ids(l).sort()).toEqual(['alt-bowling', 'bowling']);
		});

		it('behandelt nur Leerraum wie keine Suche', () => {
			const alle = [bowling, zelt];
			expect(liste('thomas', alle, { suche: '   ' })).toEqual(liste('thomas', alle, { suche: null }));
		});

		it('trimmt die Suche', () => {
			expect(ids(liste('thomas', [bowling, zelt], { suche: '  bowl ' }))).toEqual(['bowling']);
		});
	});

	describe('Zeile', () => {
		it('traegt Segment und Titel', () => {
			const l = liste('thomas', [listenThread({ id: 'bowling', titel: '🎳 Bowling' })]);
			expect(l.threads[0].segment).toBe(threadSegment('bowling', '🎳 Bowling'));
			expect(l.threads[0].titel).toBe('🎳 Bowling');
		});

		it('nennt als naechsten Termin den laufenden oder kuenftigen, sonst null', () => {
			const mehrere = listenThread({}, [
				terminModul({ modulId: 'a', startDatum: '2026-10-20', beginn: null, endDatum: '2026-10-22' }),
				terminModul({ modulId: 'b', startDatum: '2026-10-28', beginn: '16:00' }),
			]);
			const ohne = listenThread({ id: 'ohne', titel: 'Ohne' });
			const l = liste('thomas', [mehrere, ohne]);
			const zeile = (id: string) => l.threads.find((t) => t.id === id)!;
			expect(zeile('bowling').naechsterTermin).toBe('Di 20.10. – Do 22.10.');
			expect(zeile('ohne').naechsterTermin).toBeNull();
		});
	});
});
