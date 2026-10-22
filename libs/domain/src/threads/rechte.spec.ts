import type { TerminDaten } from '../module/termin/termin.js';
import type { ThreadKopf } from './typen.js';
import {
	darfArchivieren,
	darfBearbeiten,
	darfFotoLoeschen,
	darfFotosHochladen,
	darfLoeschen,
	darfLoeschenNachricht,
	darfSchreiben,
	schreibSperre,
} from './rechte.js';
import { bowlingUmfeld, JETZT, kopf, MIA } from './testhilfe.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;
const austausch = () => kopf({ art: 'JUGENDSPRECHER_AUSTAUSCH', rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER' });
const vonPetra = () => kopf({ erstelltVonId: 'petra' });
const alterTermin: TerminDaten = {
	modulId: 'm1',
	startDatum: '2026-10-01',
	endDatum: null,
	beginn: null,
	ende: null,
	ort: null,
	treffpunkt: null,
};

describe('darfBearbeiten', () => {
	it('erlaubt Thomas fremde und eigene Threads', () => {
		expect(darfBearbeiten(person('thomas'), vonPetra())).toBe(true);
		expect(darfBearbeiten(person('thomas'), kopf())).toBe(true);
	});

	it('erlaubt Petra nur eigene Threads', () => {
		expect(darfBearbeiten(person('petra'), vonPetra())).toBe(true);
		expect(darfBearbeiten(person('petra'), kopf())).toBe(false);
	});

	it('verweigert Bea und Sandra, auch beim eigenen Eintrag als Ersteller', () => {
		expect(darfBearbeiten(person('bea'), kopf())).toBe(false);
		expect(darfBearbeiten(person('sandra'), kopf())).toBe(false);
		expect(darfBearbeiten(person('sandra'), kopf({ erstelltVonId: 'sandra' }))).toBe(false);
		expect(darfBearbeiten(person('bea'), kopf({ erstelltVonId: 'bea' }))).toBe(false);
	});

	it('laesst den Austausch nur mit Alle Threads bearbeiten zu', () => {
		expect(darfBearbeiten(person('thomas'), austausch())).toBe(true);
		expect(darfBearbeiten(person('petra'), austausch())).toBe(false);
		expect(darfBearbeiten(person('petra'), { ...austausch(), erstelltVonId: 'petra' })).toBe(false);
	});

	it('verweigert Entfernten alles, auch mit Rechten', () => {
		const entfernt = { ...person('thomas'), entferntAm: new Date('2026-09-01T00:00:00Z') };
		expect(darfBearbeiten(entfernt, kopf())).toBe(false);
		expect(darfBearbeiten({ ...MIA, rechte: ['THREADS_ERSTELLEN'] }, kopf({ erstelltVonId: 'mia' }))).toBe(false);
	});
});

describe('darfArchivieren', () => {
	it('folgt darfBearbeiten', () => {
		expect(darfArchivieren(person('thomas'), kopf())).toBe(true);
		expect(darfArchivieren(person('petra'), vonPetra())).toBe(true);
		expect(darfArchivieren(person('petra'), kopf())).toBe(false);
		expect(darfArchivieren(person('sandra'), kopf())).toBe(false);
	});

	it('verweigert beim Austausch auch Thomas', () => {
		expect(darfArchivieren(person('thomas'), austausch())).toBe(false);
	});
});

describe('darfLoeschen', () => {
	const leer = { antworten: 0, nachrichten: 0 };

	it('erlaubt Thomas einen Thread ohne Antworten und Nachrichten', () => {
		expect(darfLoeschen(person('thomas'), kopf(), leer)).toBe(true);
	});

	it('verweigert mit einer Antwort oder einer Nachricht', () => {
		expect(darfLoeschen(person('thomas'), kopf(), { antworten: 1, nachrichten: 0 })).toBe(false);
		expect(darfLoeschen(person('thomas'), kopf(), { antworten: 0, nachrichten: 1 })).toBe(false);
	});

	it('verweigert beim Austausch', () => {
		expect(darfLoeschen(person('thomas'), austausch(), leer)).toBe(false);
	});

	it('verweigert, wer nicht bearbeiten darf', () => {
		expect(darfLoeschen(person('petra'), kopf(), leer)).toBe(false);
		expect(darfLoeschen(person('petra'), vonPetra(), leer)).toBe(true);
	});
});

describe('darfSchreiben', () => {
	const schreiben = (id: string, k: ThreadKopf = kopf(), termine: TerminDaten[] = []) =>
		darfSchreiben(person(id), k, umfeld, termine, JETZT);

	it('erlaubt Sandra in Kommentaren und im Chat', () => {
		expect(schreiben('sandra')).toBe(true);
		expect(schreiben('sandra', kopf({ modus: 'CHAT' }))).toBe(true);
	});

	it('verweigert Sandra im Aushang', () => {
		expect(schreiben('sandra', kopf({ modus: 'AUSHANG' }))).toBe(false);
	});

	it('verweigert im Entwurf, auch Thomas', () => {
		const entwurf = kopf({ veroeffentlichtAm: null });
		expect(schreiben('thomas', entwurf)).toBe(false);
		expect(schreiben('sandra', entwurf)).toBe(false);
	});

	it('verweigert in archivierten Threads, auch Thomas', () => {
		const archiviert = kopf({ archivModus: 'ARCHIVIERT' });
		expect(schreiben('sandra', archiviert)).toBe(false);
		expect(schreiben('thomas', archiviert)).toBe(false);
		expect(schreiben('sandra', kopf(), [alterTermin])).toBe(false);
	});

	it('verweigert, wer den Thread nicht sieht', () => {
		expect(schreiben('peter', kopf({ alleUntergruppen: false, untergruppenIds: ['klein'] }))).toBe(false);
		expect(schreiben('sandra', kopf({ rollenfilter: 'NUR_JUGENDLEITER' }))).toBe(false);
	});
});

describe('schreibSperre', () => {
	const sperre = (id: string, k: ThreadKopf = kopf(), termine: TerminDaten[] = []) =>
		schreibSperre(person(id), k, umfeld, termine, JETZT);

	it('nennt den Grund, der zuerst zutrifft', () => {
		expect(sperre('sandra', kopf({ rollenfilter: 'NUR_JUGENDLEITER' }))).toBe('NICHT_GEFUNDEN');
		expect(sperre('thomas', kopf({ veroeffentlichtAm: null }))).toBe('ENTWURF');
		expect(sperre('thomas', kopf({ modus: 'AUSHANG' }))).toBe('NUR_AUSHANG');
		expect(sperre('thomas', kopf({ archivModus: 'ARCHIVIERT' }))).toBe('ARCHIVIERT');
		expect(sperre('sandra')).toBeNull();
	});

	it('gibt bei mehreren Gruenden den ersten', () => {
		const alles = kopf({ veroeffentlichtAm: null, modus: 'AUSHANG', archivModus: 'ARCHIVIERT' });
		expect(sperre('thomas', alles)).toBe('ENTWURF');
		expect(sperre('thomas', kopf({ modus: 'AUSHANG', archivModus: 'ARCHIVIERT' }))).toBe('NUR_AUSHANG');
		// Wer den Thread nicht sieht, erfaehrt auch von Entwurf und Aushang nichts.
		expect(sperre('sandra', kopf({ rollenfilter: 'NUR_JUGENDLEITER', veroeffentlichtAm: null }))).toBe(
			'NICHT_GEFUNDEN',
		);
	});

	it('sperrt ueber den letzten Termin im Archiv', () => {
		expect(sperre('sandra', kopf(), [alterTermin])).toBe('ARCHIVIERT');
	});
});

describe('darfLoeschenNachricht', () => {
	const nachricht = (autorId: string | null, daten = {}) => ({
		autorId,
		art: 'NACHRICHT' as const,
		geloeschtAm: null,
		...daten,
	});

	it('erlaubt Sandra die eigene, nicht die fremde Nachricht', () => {
		expect(darfLoeschenNachricht(person('sandra'), nachricht('sandra'), kopf())).toBe(true);
		expect(darfLoeschenNachricht(person('sandra'), nachricht('peter'), kopf())).toBe(false);
	});

	it('erlaubt Thomas die fremde Nachricht', () => {
		expect(darfLoeschenNachricht(person('thomas'), nachricht('sandra'), kopf())).toBe(true);
	});

	it('verweigert Petra fremde Nachrichten in fremden Threads, erlaubt sie im eigenen', () => {
		expect(darfLoeschenNachricht(person('petra'), nachricht('sandra'), kopf())).toBe(false);
		expect(darfLoeschenNachricht(person('petra'), nachricht('sandra'), vonPetra())).toBe(true);
	});

	it('verweigert Systemeintraege, auch Thomas', () => {
		expect(darfLoeschenNachricht(person('thomas'), nachricht(null, { art: 'SYSTEM' }), kopf())).toBe(false);
		expect(darfLoeschenNachricht(person('thomas'), nachricht('thomas', { art: 'SYSTEM' }), kopf())).toBe(false);
	});

	it('verweigert schon geloeschte Nachrichten', () => {
		const geloescht = nachricht('sandra', { geloeschtAm: new Date('2026-10-21T12:00:00Z') });
		expect(darfLoeschenNachricht(person('sandra'), geloescht, kopf())).toBe(false);
		expect(darfLoeschenNachricht(person('thomas'), geloescht, kopf())).toBe(false);
	});

	it('verweigert fremde Nachrichten im Austausch ohne Recht, erlaubt die eigene', () => {
		expect(darfLoeschenNachricht(person('lena'), nachricht('lena'), austausch())).toBe(true);
		expect(darfLoeschenNachricht(person('lena'), nachricht('jonas'), austausch())).toBe(false);
	});

	it('verweigert dem eigenen Autor, wenn er entfernt wurde', () => {
		const entfernt = { ...person('sandra'), entferntAm: new Date('2026-09-01T00:00:00Z') };
		expect(darfLoeschenNachricht(entfernt, nachricht('sandra'), kopf())).toBe(false);
	});
});

describe('darfFotosHochladen', () => {
	const e = { umfeld, termine: [] as TerminDaten[], jetzt: JETZT };
	const entwurf = () => kopf({ veroeffentlichtAm: null });

	it('erlaubt Bearbeitern immer, auch im Entwurf und im Archiv', () => {
		expect(darfFotosHochladen(person('thomas'), kopf(), 'JUGENDLEITER', e)).toBe(true);
		expect(darfFotosHochladen(person('thomas'), entwurf(), 'JUGENDLEITER', e)).toBe(true);
		expect(darfFotosHochladen(person('thomas'), kopf(), 'JUGENDLEITER', { ...e, termine: [alterTermin] })).toBe(true);
		expect(darfFotosHochladen(person('petra'), vonPetra(), 'JUGENDLEITER', { ...e, termine: [alterTermin] })).toBe(
			true,
		);
	});

	it('verweigert Lesern bei Nur Jugendleiter', () => {
		expect(darfFotosHochladen(person('sandra'), kopf(), 'JUGENDLEITER', e)).toBe(false);
	});

	it('erlaubt Lesern bei Alle, ausser im Archiv und im Entwurf', () => {
		expect(darfFotosHochladen(person('sandra'), kopf(), 'ALLE', e)).toBe(true);
		expect(darfFotosHochladen(person('sandra'), kopf(), 'ALLE', { ...e, termine: [alterTermin] })).toBe(false);
		expect(darfFotosHochladen(person('sandra'), entwurf(), 'ALLE', e)).toBe(false);
	});

	it('verweigert dem, der den Thread nicht sieht, auch bei Alle', () => {
		const nurKlein = kopf({ alleUntergruppen: false, untergruppenIds: ['klein'], rollenfilter: 'NUR_FAMILIE' });
		expect(darfFotosHochladen(person('sandra'), nurKlein, 'ALLE', e)).toBe(true);
		expect(darfFotosHochladen(person('peter'), nurKlein, 'ALLE', e)).toBe(false);
	});

	it('verweigert Entfernten', () => {
		expect(
			darfFotosHochladen({ ...person('sandra'), entferntAm: new Date('2026-09-01T00:00:00Z') }, kopf(), 'ALLE', e),
		).toBe(false);
	});
});

describe('darfFotoLoeschen', () => {
	it('erlaubt das eigene Foto', () => {
		expect(darfFotoLoeschen(person('sandra'), kopf(), 'sandra')).toBe(true);
	});

	it('verweigert dem Leser ein fremdes Foto', () => {
		expect(darfFotoLoeschen(person('sandra'), kopf(), 'hans')).toBe(false);
	});

	it('erlaubt dem Bearbeiter ein fremdes Foto', () => {
		expect(darfFotoLoeschen(person('thomas'), kopf(), 'sandra')).toBe(true);
		expect(darfFotoLoeschen(person('petra'), vonPetra(), 'sandra')).toBe(true);
		expect(darfFotoLoeschen(person('petra'), kopf(), 'sandra')).toBe(false);
	});
});
