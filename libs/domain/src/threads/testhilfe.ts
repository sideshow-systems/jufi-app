// Nur fuer Tests (nicht in index.ts exportiert): ein erfundener Verein, an dem die
// Regeln der Threads gemeinsam geprueft werden. IDs sind die Vornamen in Kleinbuchstaben,
// damit Erwartungen im Test ohne Nachschlagen lesbar bleiben.
import type { RechtName } from '../rechte.js';
import { ALLE_RECHTE } from '../rechte.js';
import { baueUmfeld } from './umfeld.js';
import type { Bezug, ThreadKopf, ThreadPerson, Umfeld } from './typen.js';

export const JETZT = new Date('2026-10-22T10:00:00Z');

function erwachsener(vorname: string, nachname: string, rechte: readonly RechtName[] = []): ThreadPerson {
	return {
		id: vorname.toLowerCase(),
		art: 'ERWACHSENER',
		rechte,
		geburtsdatum: null,
		entferntAm: null,
		vorname,
		nachname,
		jugendsprecher: false,
	};
}

function jungfischer(
	vorname: string,
	nachname: string,
	geburtsdatum: string,
	aenderung: Partial<ThreadPerson> = {},
): ThreadPerson {
	return {
		id: vorname.toLowerCase(),
		art: 'JUNGFISCHER',
		rechte: [],
		geburtsdatum: new Date(geburtsdatum),
		entferntAm: null,
		vorname,
		nachname,
		jugendsprecher: false,
		...aenderung,
	};
}

// Mia ist entfernt: bowlingUmfeld() laesst sie weg, wie ladeUmfeld es tut. Das Objekt
// ist hier einzeln erreichbar, weil "Mia sieht nichts" die Person direkt uebergibt.
export const MIA = jungfischer('Mia', 'Kunz', '2012-02-02', { entferntAm: new Date('2026-09-01T00:00:00Z') });

const PERSONEN: readonly ThreadPerson[] = [
	erwachsener('Thomas', 'Keller', ALLE_RECHTE),
	erwachsener('Petra', 'Lang', ['THREADS_ERSTELLEN']),
	erwachsener('Bea', 'Roth', ['ANTWORTEN_DETAIL']),
	erwachsener('Sandra', 'Maier'),
	erwachsener('Hans', 'Maier'),
	erwachsener('Peter', 'Vogt'),
	jungfischer('Lena', 'Maier', '2013-03-01', { jugendsprecher: true }),
	jungfischer('Max', 'Maier', '2016-06-01'),
	jungfischer('Jonas', 'Keller', '2011-01-01'),
	jungfischer('Tim', 'Sommer', '2012-05-05'),
	jungfischer('Paul', 'Vogt', '2008-01-01'),
	MIA,
];

function bezug(
	erwachsenerId: string,
	jungfischerId: string,
	beziehung: Bezug['beziehung'],
	erziehungsberechtigt = true,
): Bezug {
	return { erwachsenerId, jungfischerId, erziehungsberechtigt, beziehung, beziehungFreitext: null };
}

export function bowlingUmfeld(): Umfeld {
	return baueUmfeld(
		PERSONEN,
		[
			bezug('thomas', 'jonas', 'VATER'),
			bezug('sandra', 'lena', 'MUTTER'),
			bezug('sandra', 'max', 'MUTTER'),
			bezug('hans', 'max', 'GROSSVATER', false),
			bezug('peter', 'paul', 'VATER'),
		],
		[
			{ personId: 'lena', untergruppeId: 'gross' },
			{ personId: 'max', untergruppeId: 'klein' },
			{ personId: 'jonas', untergruppeId: 'gross' },
			{ personId: 'tim', untergruppeId: 'gross' },
			{ personId: 'paul', untergruppeId: 'gross' },
			{ personId: 'mia', untergruppeId: 'gross' },
		],
	);
}

// Der Bowling-Thread als Vorgabe; "veroeffentlicht am Vortag" liegt vor JETZT.
export function kopf(daten: Partial<ThreadKopf> = {}): ThreadKopf {
	return {
		id: 'bowling',
		art: 'NORMAL',
		titel: '🎳 Bowling',
		modus: 'KOMMENTARE',
		rollenfilter: 'JUNGFISCHER_FAMILIE',
		alleUntergruppen: true,
		untergruppenIds: [],
		angepinnt: false,
		archivModus: 'AUTOMATISCH',
		veroeffentlichtAm: new Date('2026-10-21T10:00:00Z'),
		erstelltVonId: 'thomas',
		...daten,
	};
}
