import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type { Ansprechpartner, KindAnsicht, PersonListe, Warnhinweis } from './mitglieder-api';
import { wartet, zugangsstand } from './start';

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

const ICH = {
	person: { id: 'p-1', vorname: 'Flo', nachname: 'Muster', art: 'ERWACHSENER', rechte: [] as string[] },
	kennung: 'flo@example.org',
	passkeys: [],
	hatPasswort: true,
	hatKinder: false,
	totp: { moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 },
};

const ANSPRECHPARTNER: Ansprechpartner[] = [
	{ id: 'a1', vorname: 'Gerda', nachname: 'Bach' },
	{ id: 'a2', vorname: 'Hans', nachname: 'Weiher' },
];

function kind(zusatz: Partial<KindAnsicht> = {}): KindAnsicht {
	return {
		id: 'k1',
		vorname: 'Lena',
		nachname: 'Muster',
		jugendsprecher: false,
		untergruppen: [],
		familie: [{ vorname: 'Flo', nachname: 'Muster', beziehung: 'MUTTER', beziehungFreitext: null }],
		zugang: { erlaubt: true, vorhanden: true, einwilligungGueltig: true },
		ichBinErziehungsberechtigt: true,
		volljaehrig: false,
		...zusatz,
	};
}

function person(id: string, name: string, warnhinweise: Warnhinweis[] = []): PersonListe {
	return { id, art: 'ERWACHSENER', vorname: name, nachname: 'Beispiel', warnhinweise };
}

const OFFEN: Warnhinweis = { art: 'EINLADUNG_OFFEN', ablauf: '2026-11-01T10:00:00.000Z' };
const OHNE_FAMILIE: Warnhinweis = { art: 'OHNE_FAMILIE' };

/** Was die Seiten des Starts vom Server bekommen; ein Error steht fuer fehlendes Netz. */
interface Aufbau {
	ich?: { hatKinder?: boolean; person?: { rechte?: string[] } };
	verein?: object | Error;
	ansprechpartner?: Ansprechpartner[] | Error;
	kinder?: KindAnsicht[] | Error;
	personen?: PersonListe[] | Error;
}

describe('Start', () => {
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [
				provideRouter(routes, withComponentInputBinding()),
				provideHttpClient(withFetch()),
				provideHttpClientTesting(),
			],
		});
		http = TestBed.inject(HttpTestingController);
		document.documentElement.removeAttribute('style');
		document.title = 'JuFi App';
	});

	afterEach(() => http.verify());

	function ichMit(a: Aufbau['ich'] = {}) {
		return { ...ICH, ...a, person: { ...ICH.person, ...a?.person } };
	}

	function antworte(url: string, inhalt: object | Error): void {
		const anfrage = http.expectOne(url);
		if (inhalt instanceof Error) anfrage.error(new ProgressEvent('error'));
		else anfrage.flush(inhalt);
	}

	/**
	 * Die Startseite liegt hinter dem Waechter: erst fragt er GET /ich, dann laedt die Seite ihre
	 * Abschnitte. Die Antworten der Abschnitte kommen vor der des Vereins, weil ein unbekannter
	 * Verein die Seite abbaut und eine dann offene Anfrage als abgebrochen zaehlte.
	 * Anfragen, die der Aufbau nicht vorsieht, duerfen gar nicht erst gestellt werden.
	 */
	async function oeffneStart(a: Aufbau = {}): Promise<{ harness: RouterTestingHarness; seite: HTMLElement }> {
		const ich = ichMit(a.ich);
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo');
		await vi.waitFor(() => http.expectOne('/demo/api/v1/ich').flush(ich));
		await navigation;
		await vi.waitFor(() => antworte('/demo/api/v1/ansprechpartner', toBody(a)));
		if (ich.hatKinder) {
			await vi.waitFor(() =>
				antworte('/demo/api/v1/meine-jungfischer', a.kinder instanceof Error ? a.kinder : { kinder: a.kinder ?? [] }),
			);
		} else {
			http.expectNone('/demo/api/v1/meine-jungfischer');
		}
		if (ich.person.rechte.includes('MITGLIEDER')) {
			await vi.waitFor(() =>
				antworte('/demo/api/v1/personen', a.personen instanceof Error ? a.personen : { personen: a.personen ?? [] }),
			);
		} else {
			http.expectNone('/demo/api/v1/personen');
		}
		antworte('/demo/api/v1/verein', a.verein ?? VEREIN);
		await harness.fixture.whenStable();
		harness.detectChanges();
		return { harness, seite: harness.routeNativeElement as HTMLElement };
	}

	function toBody(a: Aufbau): object | Error {
		return a.ansprechpartner instanceof Error
			? a.ansprechpartner
			: { ansprechpartner: a.ansprechpartner ?? ANSPRECHPARTNER };
	}

	const text = (e: HTMLElement) => e.textContent?.replace(/\s+/g, ' ') ?? '';

	function abschnitt(seite: HTMLElement, titel: string): HTMLElement | undefined {
		return [...seite.querySelectorAll<HTMLElement>('jf-abschnitt')].find(
			(e) => e.querySelector('h2')?.textContent?.trim() === titel,
		);
	}

	describe('Begruessung', () => {
		it('zeigt Hallo, den Vornamen und darunter den Anzeigenamen des Vereins', async () => {
			const { seite } = await oeffneStart();

			expect(seite.querySelector('h1')?.textContent?.trim()).toBe('Hallo Flo');
			const verein = [...seite.querySelectorAll('p')].find((p) => p.textContent?.trim() === 'Jungfischer Demo');
			expect(verein).toBeTruthy();
		});

		it('zeigt ohne Logo das Abzeichen mit den Initialen', async () => {
			const ohne = await oeffneStart();
			expect(ohne.seite.querySelector('.abzeichen')?.textContent?.trim()).toBe('JD');
		});

		it('zeigt mit Logo das Bild in 64 px statt des Abzeichens', async () => {
			const { seite } = await oeffneStart({
				verein: { ...VEREIN, hatLogo: true, logoStand: '2026-10-01T10:00:00.000Z' },
			});

			const bild = seite.querySelector<HTMLImageElement>('jf-karte img');
			expect(bild?.getAttribute('src')).toBe('/demo/api/v1/verein/logo?v=2026-10-01T10%3A00%3A00.000Z');
			expect(bild?.getAttribute('width')).toBe('64');
			expect(seite.querySelector('jf-karte .abzeichen')).toBeNull();
		});

		it('setzt Vereinsfarbe und Seitentitel', async () => {
			await oeffneStart();

			expect(document.documentElement.style.getPropertyValue('--akzent-hell')).not.toBe('');
			expect(document.title).toBe('Jungfischer Demo');
		});
	});

	describe('Deine Jungfischer', () => {
		it('zeigt einer Mutter mit einem Kind die Karte mit Zugangsstand, die Ansprechpartner und keine Verwaltung', async () => {
			const { seite } = await oeffneStart({
				ich: { hatKinder: true },
				kinder: [kind({ untergruppen: [{ id: 'u1', name: 'Hechte' }] })],
			});

			expect(seite.querySelector('h1')?.textContent?.trim()).toBe('Hallo Flo');
			const kinder = abschnitt(seite, 'Deine Jungfischer');
			expect(kinder).toBeTruthy();
			expect(text(kinder as HTMLElement)).toContain('Lena Muster');
			expect(text(kinder as HTMLElement)).toContain('Hechte');
			expect(text(kinder as HTMLElement)).toContain('Eigener Zugang eingerichtet');
			expect(text(abschnitt(seite, 'Ansprechpartner') as HTMLElement)).toContain('Gerda Bach');
			expect(text(abschnitt(seite, 'Ansprechpartner') as HTMLElement)).toContain('Hans Weiher');
			expect(abschnitt(seite, 'In der Verwaltung warten')).toBeUndefined();
			// oeffneStart prueft mit expectNone, dass es keine Anfrage an /personen gab.
		});

		it('verlinkt jede Kind-Karte nach meine-jungfischer', async () => {
			const { seite } = await oeffneStart({
				ich: { hatKinder: true },
				kinder: [kind(), kind({ id: 'k2', vorname: 'Tom' })],
			});

			const links = [...seite.querySelectorAll<HTMLAnchorElement>('a[href="/demo/meine-jungfischer"]')];
			expect(links.length).toBe(2);
			expect(links[1].textContent).toContain('Tom');
		});

		it('nennt Jugendsprecher/in nur bei Bedarf', async () => {
			const { seite } = await oeffneStart({
				ich: { hatKinder: true },
				kinder: [kind({ jugendsprecher: true }), kind({ id: 'k2', vorname: 'Tom' })],
			});

			const karten = [...seite.querySelectorAll<HTMLElement>('a[href="/demo/meine-jungfischer"]')];
			expect(text(karten[0])).toContain('Jugendsprecher/in');
			expect(text(karten[1])).not.toContain('Jugendsprecher/in');
		});

		it('fragt ohne Kinder nicht nach /meine-jungfischer und zeigt den Abschnitt nicht', async () => {
			const { seite } = await oeffneStart();

			expect(abschnitt(seite, 'Deine Jungfischer')).toBeUndefined();
			// Die Pruefung selbst steht in oeffneStart (expectNone).
		});
	});

	describe('zugangsstand', () => {
		it.each([
			[{ erlaubt: true, vorhanden: true, einwilligungGueltig: true }, 'Eigener Zugang eingerichtet'],
			[{ erlaubt: true, vorhanden: false, einwilligungGueltig: true }, 'Zugang erlaubt, noch nicht eingerichtet'],
			[{ erlaubt: false, vorhanden: false, einwilligungGueltig: false }, 'Ohne eigenen Zugang'],
			// Nach einem Entzug bleibt ein alter Zugang womoeglich bestehen, darf aber nicht als eingerichtet gelten.
			[{ erlaubt: false, vorhanden: true, einwilligungGueltig: true }, 'Ohne eigenen Zugang'],
		])('%o ist %s', (zugang, erwartet) => {
			expect(zugangsstand(zugang)).toBe(erwartet);
		});
	});

	describe('In der Verwaltung warten', () => {
		const LEITUNG = { person: { rechte: ['MITGLIEDER'] } };

		it('zeigt einer Leitung die Zahlen 2 und 1 und den Link zur Verwaltung', async () => {
			const { seite } = await oeffneStart({
				ich: LEITUNG,
				personen: [
					person('e1', 'Anna', [OFFEN]),
					person('e2', 'Bernd', [OFFEN]),
					person('e3', 'Clara', [OHNE_FAMILIE]),
					person('e4', 'Dora'),
				],
			});

			const verwaltung = abschnitt(seite, 'In der Verwaltung warten') as HTMLElement;
			expect(text(verwaltung)).toContain('2 offene Einladungen');
			expect(text(verwaltung)).toContain('1 Person mit Hinweis');
			expect(text(verwaltung)).toContain('Clara Beispiel');
			expect(text(verwaltung)).toContain('Ohne erziehungsberechtigte Familie');
			expect(text(verwaltung)).not.toContain('Dora');
			expect(verwaltung.querySelector('a[href="/demo/verwaltung"]')?.textContent).toContain('Zur Verwaltung');
		});

		it('schreibt die Einzahl, und eine Zeile mit 0 entfaellt', async () => {
			const { seite } = await oeffneStart({ ich: LEITUNG, personen: [person('e1', 'Anna', [OFFEN])] });

			const verwaltung = text(abschnitt(seite, 'In der Verwaltung warten') as HTMLElement);
			expect(verwaltung).toContain('1 offene Einladung');
			expect(verwaltung).not.toContain('1 offene Einladungen');
			expect(verwaltung).not.toContain('Person mit Hinweis');
			expect(verwaltung).not.toContain('Personen mit Hinweis');
		});

		it('nennt hoechstens fuenf Namen, aber zaehlt alle', async () => {
			const personen = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => person(`e-${n}`, n, [OHNE_FAMILIE]));
			const { seite } = await oeffneStart({ ich: LEITUNG, personen });

			const verwaltung = abschnitt(seite, 'In der Verwaltung warten') as HTMLElement;
			expect(text(verwaltung)).toContain('7 Personen mit Hinweis');
			expect(verwaltung.querySelectorAll('li').length).toBe(5);
		});

		it('sagt, dass nichts wartet, wenn alles erledigt ist', async () => {
			const { seite } = await oeffneStart({ ich: LEITUNG, personen: [person('e1', 'Anna')] });

			const verwaltung = text(abschnitt(seite, 'In der Verwaltung warten') as HTMLElement);
			expect(verwaltung).toContain('Gerade wartet nichts.');
			expect(verwaltung).toContain('Zur Verwaltung');
		});

		// Betreuer lesen die Liste, sehen aber keine Warnhinweise und koennen nichts davon erledigen (Plan-Entscheidung 7).
		it('zeigt einem Betreuer mit nur ANTWORTEN_DETAIL keinen Abschnitt und fragt nicht nach /personen', async () => {
			const { seite } = await oeffneStart({ ich: { person: { rechte: ['ANTWORTEN_DETAIL'] } } });

			expect(abschnitt(seite, 'In der Verwaltung warten')).toBeUndefined();
			expect(seite.querySelector('a[href="/demo/verwaltung"]')).toBeNull();
		});
	});

	describe('wartet', () => {
		it('zaehlt offene Einladungen und Personen mit einem anderen Hinweis', () => {
			const ergebnis = wartet([
				person('e1', 'Anna', [OFFEN]),
				person('e2', 'Bernd', [OFFEN, OHNE_FAMILIE]),
				person('e3', 'Clara', [{ art: 'EINWILLIGUNG_FEHLT' }]),
				person('e4', 'Dora'),
			]);

			expect(ergebnis.offeneEinladungen).toBe(2);
			expect(ergebnis.mitHinweis.map((p) => p.id)).toEqual(['e2', 'e3']);
		});

		it('ist bei einer leeren Liste und bei Personen ohne warnhinweise leer', () => {
			expect(wartet([])).toEqual({ offeneEinladungen: 0, mitHinweis: [] });
			const ohne: PersonListe = { id: 'x', art: 'ERWACHSENER', vorname: 'X', nachname: 'Y' };
			expect(wartet([ohne])).toEqual({ offeneEinladungen: 0, mitHinweis: [] });
		});
	});

	describe('Ansprechpartner', () => {
		it('zeigt die Namen als Liste', async () => {
			const { seite } = await oeffneStart();

			const eintraege = [...(abschnitt(seite, 'Ansprechpartner') as HTMLElement).querySelectorAll('li')];
			expect(eintraege.map((li) => li.textContent?.trim())).toEqual(['Gerda Bach', 'Hans Weiher']);
		});

		it('zeigt bei einem Fehler nur in diesem Abschnitt die Meldung, der Rest steht', async () => {
			const { seite } = await oeffneStart({
				ich: { hatKinder: true },
				kinder: [kind()],
				ansprechpartner: new Error('netz'),
			});

			expect(text(abschnitt(seite, 'Ansprechpartner') as HTMLElement)).toContain(
				'Keine Verbindung – nochmal versuchen',
			);
			expect(seite.querySelector('h1')?.textContent?.trim()).toBe('Hallo Flo');
			expect(text(abschnitt(seite, 'Deine Jungfischer') as HTMLElement)).toContain('Lena Muster');
			expect(text(abschnitt(seite, 'Deine Jungfischer') as HTMLElement)).not.toContain('Keine Verbindung');
		});

		it('laedt auf Wunsch neu', async () => {
			const { harness, seite } = await oeffneStart({ ansprechpartner: new Error('netz') });

			seite.querySelector<HTMLButtonElement>('jf-abschnitt button')?.click();
			await vi.waitFor(() => antworte('/demo/api/v1/ansprechpartner', { ansprechpartner: ANSPRECHPARTNER }));
			await harness.fixture.whenStable();
			harness.detectChanges();

			expect(text(abschnitt(seite, 'Ansprechpartner') as HTMLElement)).toContain('Gerda Bach');
		});
	});

	describe('Fehler anderer Abschnitte', () => {
		it('trifft bei einem Fehler der Kinder nur Deine Jungfischer', async () => {
			const { seite } = await oeffneStart({ ich: { hatKinder: true }, kinder: new Error('netz') });

			expect(text(abschnitt(seite, 'Deine Jungfischer') as HTMLElement)).toContain(
				'Keine Verbindung – nochmal versuchen',
			);
			expect(text(abschnitt(seite, 'Ansprechpartner') as HTMLElement)).toContain('Gerda Bach');
		});

		it('trifft bei einem Fehler der Personenliste nur den Verwaltungsabschnitt', async () => {
			const { seite } = await oeffneStart({ ich: { person: { rechte: ['MITGLIEDER'] } }, personen: new Error('netz') });

			expect(text(abschnitt(seite, 'In der Verwaltung warten') as HTMLElement)).toContain(
				'Keine Verbindung – nochmal versuchen',
			);
			expect(text(abschnitt(seite, 'Ansprechpartner') as HTMLElement)).toContain('Gerda Bach');
		});
	});

	describe('Ladezustand und leere Listen', () => {
		it('zeigt in jedem Abschnitt Wird geladen, solange die Antwort fehlt', async () => {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo');
			await vi.waitFor(() =>
				http.expectOne('/demo/api/v1/ich').flush(ichMit({ hatKinder: true, person: { rechte: ['MITGLIEDER'] } })),
			);
			await navigation;
			harness.detectChanges();
			const seite = harness.routeNativeElement as HTMLElement;

			for (const titel of ['Deine Jungfischer', 'In der Verwaltung warten', 'Ansprechpartner']) {
				expect(text(abschnitt(seite, titel) as HTMLElement)).toContain('Wird geladen …');
			}

			await vi.waitFor(() => antworte('/demo/api/v1/ansprechpartner', { ansprechpartner: [] }));
			await vi.waitFor(() => antworte('/demo/api/v1/meine-jungfischer', { kinder: [] }));
			await vi.waitFor(() => antworte('/demo/api/v1/personen', { personen: [] }));
			antworte('/demo/api/v1/verein', VEREIN);
			await harness.fixture.whenStable();
			harness.detectChanges();

			expect(text(seite)).not.toContain('Wird geladen');
		});

		it('sagt bei leeren Listen, dass niemand eingetragen ist', async () => {
			const { seite } = await oeffneStart({ ich: { hatKinder: true }, kinder: [], ansprechpartner: [] });

			expect(text(abschnitt(seite, 'Ansprechpartner') as HTMLElement)).toContain('Noch niemand eingetragen.');
			expect(text(abschnitt(seite, 'Deine Jungfischer') as HTMLElement)).toContain(
				'Es sind keine Jungfischer mit dir verbunden.',
			);
		});
	});

	describe('abgelaufene Sitzung', () => {
		it('navigiert bei zwei 401, die sich ueberschneiden, genau einmal und zeigt keinen Fehlerblock', async () => {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo');
			await vi.waitFor(() => http.expectOne('/demo/api/v1/ich').flush(ichMit({ hatKinder: true })));
			await navigation;
			// Die Navigation bleibt offen, bis der zweite Abschnitt gescheitert ist: genau die Ueberschneidung.
			let beende: (ok: boolean) => void = () => undefined;
			const navigiert = vi
				.spyOn(TestBed.inject(Router), 'navigateByUrl')
				.mockReturnValue(new Promise<boolean>((r) => (beende = r)));
			const abgelaufen = { status: 401, statusText: 'Unauthorized' };
			await vi.waitFor(() =>
				http.expectOne('/demo/api/v1/ansprechpartner').flush({ fehler: 'nicht angemeldet' }, abgelaufen),
			);
			harness.detectChanges();
			await vi.waitFor(() => expect(navigiert).toHaveBeenCalledTimes(1));
			await vi.waitFor(() =>
				http.expectOne('/demo/api/v1/meine-jungfischer').flush({ fehler: 'nicht angemeldet' }, abgelaufen),
			);
			harness.detectChanges();
			beende(true);
			antworte('/demo/api/v1/verein', VEREIN);
			await harness.fixture.whenStable();
			harness.detectChanges();

			expect(navigiert).toHaveBeenCalledTimes(1);
			expect(navigiert).toHaveBeenCalledWith('/demo/anmelden?weiter=%2Fdemo');
			const seite = harness.routeNativeElement as HTMLElement;
			expect(seite.querySelector('[role="alert"]')).toBeNull();
			expect(text(seite)).not.toContain('Nochmal versuchen');
		});

		it('fuehrt ein 401 eines Abschnitts zur Anmeldung statt zu einem Fehler', async () => {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo');
			await vi.waitFor(() => http.expectOne('/demo/api/v1/ich').flush(ichMit()));
			await navigation;
			await vi.waitFor(() =>
				http
					.expectOne('/demo/api/v1/ansprechpartner')
					.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
			);
			await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/demo/anmelden?weiter=%2Fdemo'));
			// Die Anmeldeseite laedt ihren Vereinskopf; hier zaehlt nur das Ziel der Umleitung.
			for (const kopf of http.match('/demo/api/v1/verein')) kopf.flush(VEREIN);
			await harness.fixture.whenStable();
			harness.detectChanges();

			expect(text(harness.routeNativeElement as HTMLElement)).not.toContain('nicht angemeldet');
		});
	});

	describe('Waechter und Verein', () => {
		it('die Adresse mit Schraegstrich am Ende ist nicht die Startseite des Vereins', async () => {
			// Ursache des Fehlers nach Anmeldung und Zur App: navigateByUrl('/demo/') liefert dem
			// Router ein leeres letztes Segment, das keine Route trifft; der Waechter lief dann
			// gar nicht und es erschien Nicht gefunden, obwohl die Sitzung galt. Ein voller
			// Seitenaufruf strippt den Schraegstrich vorher, darum fiel es nur im Browser auf.
			const harness = await RouterTestingHarness.create();
			await harness.navigateByUrl('/demo/');
			harness.detectChanges();

			http.expectNone('/demo/api/v1/ich');
			expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		});

		it('leitet ohne Sitzung (401) auf die Anmeldung des Vereins', async () => {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo');
			await vi.waitFor(() =>
				http
					.expectOne('/demo/api/v1/ich')
					.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
			);
			await navigation;

			expect(TestBed.inject(Router).url).toBe('/demo/anmelden?weiter=%2Fdemo');
			// Die Anmeldeseite laedt ihren Vereinskopf; hier zaehlt nur das Ziel der Umleitung.
			http.match('/demo/api/v1/verein');
		});

		it('merkt sich die aufgerufene Seite: /demo/profil ohne Sitzung fuehrt zu anmelden?weiter', async () => {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo/profil');
			await vi.waitFor(() =>
				http
					.expectOne('/demo/api/v1/ich')
					.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
			);
			await navigation;

			expect(TestBed.inject(Router).url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fprofil');
			http.match('/demo/api/v1/verein');
		});

		it('zeigt Nicht gefunden, wenn der Server den Verein nicht kennt (404 auf ich)', async () => {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo');
			await vi.waitFor(() =>
				http
					.expectOne('/demo/api/v1/ich')
					.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
			);
			await navigation;
			harness.detectChanges();

			expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		});

		it('zeigt bei 404 auf den Verein Nicht gefunden oder keine Berechtigung', async () => {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo');
			await vi.waitFor(() => http.expectOne('/demo/api/v1/ich').flush(ichMit()));
			await navigation;
			await vi.waitFor(() => antworte('/demo/api/v1/ansprechpartner', { ansprechpartner: [] }));
			http
				.expectOne('/demo/api/v1/verein')
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
			await harness.fixture.whenStable();
			harness.detectChanges();

			expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		});

		it('setzt Titel und Vereinsfarbe zurueck, wenn die Person den Verein verlaesst', async () => {
			const { harness } = await oeffneStart();
			expect(document.title).toBe('Jungfischer Demo');

			await harness.navigateByUrl('/');
			await harness.fixture.whenStable();

			expect(document.title).toBe('JuFi App');
			expect(document.documentElement.style.getPropertyValue('--akzent-hell')).toBe('');
			expect(document.documentElement.style.getPropertyValue('--akzent-flaeche-dunkel')).toBe('');
			expect(document.documentElement.style.getPropertyValue('--auf-akzent-hell')).toBe('');
		});

		it('zeigt beim Wechsel von Verein A zu unbekanntem Verein B nichts von A', async () => {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/vereina');
			await vi.waitFor(() => http.expectOne('/vereina/api/v1/ich').flush(ichMit()));
			await navigation;
			await vi.waitFor(() => antworte('/vereina/api/v1/ansprechpartner', { ansprechpartner: [] }));
			antworte('/vereina/api/v1/verein', { ...VEREIN, slug: 'vereina', anzeigename: 'Verein A' });
			await harness.fixture.whenStable();
			harness.detectChanges();
			expect(document.title).toBe('Verein A');

			// Kein whenStable: die offene Anfrage von B haelt die Anwendung absichtlich instabil.
			const wechsel = harness.navigateByUrl('/vereinb');
			await vi.waitFor(() => http.expectOne('/vereinb/api/v1/ich').flush(ichMit()));
			await wechsel;
			harness.detectChanges();
			// Waehrend B noch laedt: weder Titel noch Farbe von A.
			expect(document.title).toBe('JuFi App');
			expect(document.documentElement.style.getPropertyValue('--akzent-hell')).toBe('');

			await vi.waitFor(() => antworte('/vereinb/api/v1/ansprechpartner', { ansprechpartner: [] }));
			http
				.expectOne('/vereinb/api/v1/verein')
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
			await harness.fixture.whenStable();
			harness.detectChanges();

			expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
			expect(harness.routeNativeElement?.textContent).not.toContain('Verein A');
			expect(document.title).toBe('JuFi App');
			expect(document.documentElement.style.getPropertyValue('--akzent-hell')).toBe('');
		});

		it('zeigt ohne Netz zum Verein die Meldung zum erneuten Versuch', async () => {
			const { seite } = await oeffneStart({ verein: new Error('netz') });

			expect(text(seite)).toContain('Keine Verbindung – nochmal versuchen');
			expect(text(seite)).not.toContain('Nicht gefunden');
		});

		it('unbekannte tiefe Route zeigt Nicht gefunden', async () => {
			const harness = await RouterTestingHarness.create('/demo/gibt/es/nicht');

			expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		});
	});
});
