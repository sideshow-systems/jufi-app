import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { type TerminZeile, terminZeit } from '@jufi/domain';
import { adminTestAnbieter, EchtzeitAttrappe } from '../admin/test-hilfen';

const API = '/demo/api/v1';

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

const ICH = {
	person: { id: 'p-1', vorname: 'Flo', nachname: 'Muster', art: 'ERWACHSENER', rechte: [] as string[] },
	kennung: 'flo@example.org',
	passkeys: [],
	hatPasswort: true,
	hatKinder: false,
	totp: { moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 },
};

function termin(threadId: string, titel: string, zusatz: Partial<TerminZeile['termin']> = {}): TerminZeile {
	return {
		threadId,
		segment: `${threadId}-${titel.toLowerCase()}`,
		titel,
		termin: {
			modulId: `m-${threadId}`,
			startDatum: '2026-11-07',
			endDatum: null,
			beginn: '14:00',
			ende: '16:00',
			ort: 'Vereinsheim',
			treffpunkt: null,
			...zusatz,
		},
	};
}

const BOWLING = termin('t1', 'Bowling');
// Ueber die Monatsgrenze: im November sind der 1. und der 2. markiert.
const ZELTLAGER = termin('t2', 'Zeltlager', { startDatum: '2026-10-30', endDatum: '2026-11-02', ort: null });

type Antwort = { termine: TerminZeile[] } | { status: number; body: object } | 'netz';

describe('Termine', () => {
	let http: HttpTestingController;
	let router: Router;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;

	beforeEach(() => {
		// 1.11.2026, 00:30 in Berlin, aber noch der 31.10. in UTC: Der Test prueft, dass der Berliner Tag zaehlt.
		// Nur Date, damit Ressource und Zonen ihre Zeitgeber behalten.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-31T23:30:00.000Z'));
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		http = TestBed.inject(HttpTestingController);
		router = TestBed.inject(Router);
	});

	afterEach(() => {
		vi.useRealTimers();
		http.verify();
	});

	function text(el: Element): string {
		return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
	}

	/** Beantwortet die Terminanfrage; wartet, bis sie da ist (der Effekt der Ressource schickt sie spaet). */
	async function antworte(monat: string, antwort: Antwort): Promise<void> {
		await vi.waitFor(() => {
			harness.detectChanges();
			const anfrage = http.expectOne(`${API}/termine?monat=${monat}`);
			if (antwort === 'netz') anfrage.error(new ProgressEvent('error'));
			else if ('status' in antwort) anfrage.flush(antwort.body, { status: antwort.status, statusText: 'Fehler' });
			else anfrage.flush(antwort);
		});
		await stabil();
	}

	async function stabil(): Promise<void> {
		for (const kopf of http.match(`${API}/verein`)) kopf.flush(VEREIN);
		await harness.fixture.whenStable();
		harness.detectChanges();
		seite = harness.routeNativeElement as HTMLElement;
	}

	async function oeffne(url: string, monat: string, antwort: Antwort = { termine: [] }): Promise<void> {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl(url);
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		await antworte(monat, antwort);
	}

	const felder = () => [...seite.querySelectorAll<HTMLElement>('tbody td')];
	const ueberschrift = () => text(seite.querySelector('h2') as Element);
	const knopf = (name: string) => seite.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;
	const eintraege = () => [...seite.querySelectorAll<HTMLAnchorElement>('ul a')];

	describe('Monat', () => {
		it('zeigt ohne Angabe den Berliner Monat von jetzt und fragt ihn ab', async () => {
			await oeffne('/demo/termine', '2026-11');

			expect(ueberschrift()).toBe('November 2026');
		});

		it('laedt den Monat aus der Adresse', async () => {
			await oeffne('/demo/termine?monat=2026-10', '2026-10');

			expect(ueberschrift()).toBe('Oktober 2026');
		});

		it('nimmt bei einem ungueltigen Monat den aktuellen und fragt nie mit dem ungueltigen Wert', async () => {
			await oeffne('/demo/termine?monat=xyz', '2026-11');

			expect(ueberschrift()).toBe('November 2026');
			http.expectNone(`${API}/termine?monat=xyz`);
		});

		it('nimmt bei einem wiederholten Monat den aktuellen statt eines der beiden', async () => {
			// Beide Werte gueltig und keiner der aktuelle: Gewaehlt werden darf weder der erste noch der letzte.
			await oeffne('/demo/termine?monat=2026-09&monat=2026-10', '2026-11');

			expect(ueberschrift()).toBe('November 2026');
			http.expectNone((r) => r.url === `${API}/termine` && r.params.get('monat') !== '2026-11');
		});

		it('blaettert mit Voriger Monat und schreibt den Monat in die Adresse', async () => {
			await oeffne('/demo/termine', '2026-11');

			knopf('Voriger Monat').click();
			await antworte('2026-10', { termine: [] });

			expect(router.url).toBe('/demo/termine?monat=2026-10');
			expect(ueberschrift()).toBe('Oktober 2026');
		});

		it('blaettert ueber den Jahreswechsel mit Naechster Monat', async () => {
			await oeffne('/demo/termine?monat=2026-12', '2026-12');

			knopf('Nächster Monat').click();
			await antworte('2027-01', { termine: [] });

			expect(router.url).toBe('/demo/termine?monat=2027-01');
			expect(ueberschrift()).toBe('Januar 2027');
		});

		// Zurueck selbst laesst sich hier nicht spielen: Der Test-Router hoert nicht auf den Verlauf des Browsers.
		// Geprueft wird darum, dass die Navigation keinen Eintrag ersetzt (replaceUrl: false).
		it('macht jeden Monatswechsel zu einem Verlaufseintrag, damit Zurueck den Monat wiederfindet', async () => {
			await oeffne('/demo/termine', '2026-11');
			const navigiere = vi.spyOn(router, 'navigate');

			knopf('Voriger Monat').click();
			await antworte('2026-10', { termine: [] });

			expect(navigiere).toHaveBeenCalledWith([], { queryParams: { monat: '2026-10' }, replaceUrl: false });
		});
	});

	describe('Raster', () => {
		it('hat sieben Spaltenkoepfe von Mo bis So und 42 Felder', async () => {
			await oeffne('/demo/termine', '2026-11');

			const koepfe = [...seite.querySelectorAll('thead th')];
			expect(koepfe.map(text)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
			expect(koepfe.every((k) => k.getAttribute('scope') === 'col')).toBe(true);
			expect(felder()).toHaveLength(42);
			// Der 1.11.2026 ist ein Sonntag: Das siebte Feld der ersten Woche traegt den ersten Tag.
			expect(text(felder()[5])).toBe('');
			expect(text(felder()[6])).toContain('1');
		});

		it('markiert die Tage eines Termins ueber die Monatsgrenze und sagt es auch ohne Farbe', async () => {
			await oeffne('/demo/termine', '2026-11', { termine: [ZELTLAGER] });

			const markiert = felder().filter((f) => f.classList.contains('markiert'));
			expect(markiert.map((f) => text(f))).toEqual(['1 Termin', '2 Termin']);
		});

		it('markiert nichts, wo kein Termin liegt', async () => {
			await oeffne('/demo/termine', '2026-11', { termine: [BOWLING] });

			const markiert = felder().filter((f) => f.classList.contains('markiert'));
			expect(markiert.map((f) => text(f))).toEqual(['7 Termin']);
		});

		it('kennzeichnet heute (Berliner Tag, hier schon der 1.11.) mit aria-current', async () => {
			await oeffne('/demo/termine', '2026-11');

			const heute = felder().filter((f) => f.getAttribute('aria-current') === 'date');
			expect(heute.map((f) => text(f))).toEqual(['1']);
		});

		it('kennzeichnet heute nicht in einem anderen Monat', async () => {
			await oeffne('/demo/termine?monat=2026-10', '2026-10');

			expect(felder().some((f) => f.hasAttribute('aria-current'))).toBe(false);
		});

		it('macht die Felder nicht anklickbar', async () => {
			await oeffne('/demo/termine', '2026-11', { termine: [BOWLING] });

			expect(seite.querySelector('table a, table button')).toBeNull();
		});
	});

	describe('Liste', () => {
		it('zeigt je Termin Zeit, Ort und Thread-Titel und verlinkt auf das Modul', async () => {
			await oeffne('/demo/termine', '2026-11', { termine: [BOWLING, ZELTLAGER] });

			const zeilen = eintraege();
			expect(zeilen).toHaveLength(2);
			// Die Zeit kommt aus terminZeit; der Test schreibt ihre Form nicht noch einmal hin.
			expect(text(zeilen[0].querySelector('.titel') as Element)).toBe('Bowling');
			expect(text(zeilen[0].querySelector('.zusatz') as Element)).toBe(`${terminZeit(BOWLING.termin)} · Vereinsheim`);
			expect(zeilen[0].getAttribute('href')).toBe('/demo/t/t1-bowling/m/m-t1');
			expect(text(zeilen[1].querySelector('.titel') as Element)).toBe('Zeltlager');
			expect(text(zeilen[1].querySelector('.zusatz') as Element)).toBe(terminZeit(ZELTLAGER.termin));
			expect(zeilen[1].getAttribute('href')).toBe('/demo/t/t2-zeltlager/m/m-t2');
		});

		it('sagt es, wenn der Monat keine Termine hat', async () => {
			await oeffne('/demo/termine', '2026-11');

			expect(text(seite)).toContain('Keine Termine in diesem Monat.');
			expect(eintraege()).toHaveLength(0);
		});
	});

	describe('Fehler', () => {
		it('zeigt bei 404 Nicht gefunden oder keine Berechtigung', async () => {
			await oeffne('/demo/termine', '2026-11', { status: 404, body: { fehler: 'nicht gefunden' } });

			expect(text(seite)).toContain('Nicht gefunden oder keine Berechtigung');
			expect(text(seite)).not.toContain('Keine Termine in diesem Monat.');
		});

		it('fuehrt bei 401 zur Anmeldung und merkt sich die Seite als weiter', async () => {
			await oeffne('/demo/termine?monat=2026-10', '2026-10', {
				status: 401,
				body: { fehler: 'nicht angemeldet' },
			});

			await vi.waitFor(() => expect(router.url).toBe('/demo/anmelden?weiter=%2Fdemo%2Ftermine%3Fmonat%3D2026-10'));
		});

		it('zeigt bei einem Netzfehler den Text mit Knopf und laedt auf Knopfdruck neu', async () => {
			await oeffne('/demo/termine', '2026-11', 'netz');

			expect(text(seite)).toContain('Keine Verbindung – nochmal versuchen');
			(seite.querySelector('button.knopf.primaer') as HTMLButtonElement).click();
			await antworte('2026-11', { termine: [BOWLING] });

			expect(eintraege()).toHaveLength(1);
			expect(text(seite)).not.toContain('Keine Verbindung');
		});

		it('laesst das Blaettern nach einem Fehler weiter zu', async () => {
			await oeffne('/demo/termine', '2026-11', 'netz');

			knopf('Voriger Monat').click();
			await antworte('2026-10', { termine: [BOWLING] });

			expect(ueberschrift()).toBe('Oktober 2026');
			expect(eintraege()).toHaveLength(1);
		});
	});

	describe('Echtzeit', () => {
		const signal = (art: 'VERLAUF' | 'ANTWORT' | 'THREAD') => ({
			typ: 'signal' as const,
			signal: { stand: 43, threadId: 't1', art, objektId: 'x' },
		});

		it('fragt bei Nachrichten und Antworten nicht neu, bei einer Aenderung am Thread schon', async () => {
			await oeffne('/demo/termine', '2026-11', { termine: [] });
			const echtzeit = TestBed.inject(EchtzeitAttrappe);

			echtzeit.quelle.next(signal('VERLAUF'));
			echtzeit.quelle.next(signal('ANTWORT'));
			// Laenger als das Entprellen: Haette die Seite nachgeladen, stuende die Anfrage jetzt offen.
			await new Promise((r) => setTimeout(r, 300));
			await stabil();
			http.expectNone(`${API}/termine?monat=2026-11`);

			echtzeit.quelle.next(signal('THREAD'));
			await antworte('2026-11', { termine: [BOWLING] });

			expect(eintraege()).toHaveLength(1);
		});

		it('fragt nach einem Abgleich neu', async () => {
			await oeffne('/demo/termine', '2026-11', { termine: [] });

			TestBed.inject(EchtzeitAttrappe).quelle.next({ typ: 'sync', geaendert: ['t1'], unsichtbar: [] });
			await antworte('2026-11', { termine: [BOWLING] });

			expect(eintraege()).toHaveLength(1);
		});
	});
});
