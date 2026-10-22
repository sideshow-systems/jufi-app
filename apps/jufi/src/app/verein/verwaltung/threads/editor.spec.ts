import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
	KEINE_MEDIEN,
	type ModulEntwurf,
	type ThreadBearbeitung,
	type ThreadEntwurf,
	type VerwaltungListe,
} from '@jufi/domain';
import { adminTestAnbieter, knopf, tippe } from '../../../admin/test-hilfen';
import { antworteAbgelaufen, API, erwarteAnmeldung, hake, ichMit, oeffneSeite, stabil, waehle } from '../test-hilfen';

type Umfrage = Extract<ModulEntwurf, { typ: 'UMFRAGE' }>;

const UNTERGRUPPEN = [
	{ id: 'u-gross', name: 'Große' },
	{ id: 'u-klein', name: 'Kleine' },
];

const LISTE: VerwaltungListe = { threads: [], untergruppen: UNTERGRUPPEN, darfErstellen: true };

const TEILNAHME: Umfrage = {
	typ: 'UMFRAGE',
	id: 'm-umfrage',
	titel: null,
	frage: 'Kommst du mit?',
	einheit: 'JUNGFISCHER',
	mehrfach: false,
	teilnahme: true,
	vielleicht: true,
	frist: '2026-10-22T16:00:00.000Z',
	ergebnisse: 'ALLE',
	optionen: [
		{ schluessel: 'dabei', text: 'Dabei' },
		{ schluessel: 'vielleicht', text: 'Vielleicht' },
		{ schluessel: 'abgesagt', text: 'Abgesagt' },
	],
};

// Bowling aus Spec 1.1, gespeichert: Info, Termin, Teilnahme-Umfrage.
function bowling(): ThreadEntwurf {
	return {
		titel: '🎳 Bowling',
		modus: 'KOMMENTARE',
		rollenfilter: 'JUNGFISCHER_FAMILIE',
		alleUntergruppen: false,
		untergruppenIds: ['u-gross'],
		module: [
			{ typ: 'INFO', id: 'm-info', titel: null, text: 'Wir treffen uns an der Bahn.' },
			{
				typ: 'TERMIN',
				id: 'm-termin',
				titel: null,
				termin: {
					startDatum: '2026-10-24',
					endDatum: null,
					beginn: '18:00',
					ende: '20:00',
					ort: 'Bowlingcenter',
					treffpunkt: null,
				},
			},
			{ ...TEILNAHME, optionen: TEILNAHME.optionen.map((o) => ({ ...o })) },
		],
	};
}

function bearbeitung(rest: Partial<ThreadBearbeitung> = {}): ThreadBearbeitung {
	return {
		id: 't1',
		segment: 't1-bowling',
		art: 'NORMAL',
		version: 3,
		veroeffentlicht: false,
		angepinnt: false,
		archiviert: false,
		darfLoeschen: true,
		darfArchivieren: true,
		entwurf: bowling(),
		sperren: {},
		medien: { gesamt: KEINE_MEDIEN, module: {} },
		untergruppen: UNTERGRUPPEN,
		...rest,
	};
}

const VERALTET = { fehler: 'Der Thread wurde inzwischen geändert. Bitte neu laden.', code: 'VERALTET' };

describe('Thread-Editor', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => {
		TestBed.inject(HttpTestingController).verify();
		vi.restoreAllMocks();
	});

	function hilfen(r: { harness: RouterTestingHarness; seite: HTMLElement; http: HttpTestingController }) {
		const { seite } = r;
		const feld = <T extends HTMLElement = HTMLInputElement>(s: string) => {
			const el = seite.querySelector<T>(s);
			if (!el) throw new Error(`nicht gefunden: ${s}`);
			return el;
		};
		const nachLabel = (label: string) => feld<HTMLButtonElement>(`button[aria-label="${label}"]`);
		return {
			...r,
			feld,
			nachLabel,
			listenTexte: () =>
				[...seite.querySelectorAll('ol.module > li .waehlen strong')].map((e) => e.textContent?.trim()),
			karten: () => [...seite.querySelectorAll<HTMLElement>('jf-thread-vorschau .karte')],
			modulFelder: () => seite.querySelector<HTMLElement>('jf-modul-felder'),
			hinzufuegen: (text: string) => knopf(feld('[role="group"][aria-label="Modul hinzufügen"]'), text).click(),
		};
	}

	async function oeffneNeu() {
		const r = await oeffneSeite('/demo/verwaltung/threads/neu', ichMit(['THREADS_ERSTELLEN']), [
			['/verwaltung/threads', LISTE],
		]);
		return hilfen(r);
	}

	async function oeffneBestehend(b: ThreadBearbeitung = bearbeitung()) {
		const r = await oeffneSeite(`/demo/verwaltung/threads/${b.id}`, ichMit(['THREADS_ERSTELLEN']), [
			[`/threads/${b.id}/bearbeitung`, b],
		]);
		return hilfen(r);
	}

	describe('neuer Thread', () => {
		it('beginnt leer an alle mit Kommentaren und gesperrtem Benachrichtigen', async () => {
			const { feld, seite } = await oeffneNeu();
			expect(seite.querySelector('h1')?.textContent).toContain('Neuer Thread');
			expect(feld('#thread-titel').value).toBe('');
			expect(feld('input[name="alleUntergruppen"]').checked).toBe(true);
			expect(feld<HTMLSelectElement>('select[name="rollenfilter"]').value).toBe('JUNGFISCHER_FAMILIE');
			expect(feld<HTMLSelectElement>('select[name="modus"]').value).toBe('KOMMENTARE');
			const benachrichtigen = feld('input[name="benachrichtigen"]');
			expect(benachrichtigen.disabled).toBe(true);
			expect(benachrichtigen.closest('.benachrichtigen')?.textContent).toContain('Kommt mit den Push-Nachrichten.');
			expect(knopf(seite, 'Entwurf speichern')).toBeTruthy();
			expect(knopf(seite, 'Veröffentlichen')).toBeTruthy();
			expect(() => knopf(seite, 'Löschen')).toThrow();
			expect(() => knopf(seite, 'Anpinnen')).toThrow();
		});

		it('zeigt ohne darfErstellen Nicht gefunden oder keine Berechtigung', async () => {
			const r = await oeffneSeite('/demo/verwaltung/threads/neu', ichMit(['ANTWORTEN_DETAIL']), [
				['/verwaltung/threads', { ...LISTE, darfErstellen: false }],
			]);
			expect(r.seite.textContent).toContain('Nicht gefunden oder keine Berechtigung');
			expect(r.seite.querySelector('#thread-titel')).toBeNull();
		});

		it('Modul hinzufügen: Umfrage ergibt die Teilnahme-Vorlage, gewaehlt und in der Vorschau', async () => {
			const { harness, hinzufuegen, modulFelder, karten, listenTexte } = await oeffneNeu();
			hinzufuegen('Umfrage');
			await stabil(harness);

			expect(listenTexte()).toEqual(['Umfrage']);
			const felder = modulFelder()!;
			expect(felder.querySelector<HTMLInputElement>('input[name="frage"]')?.value).toBe('Kommst du mit?');
			expect(felder.querySelector<HTMLInputElement>('input[name="teilnahme"]')?.checked).toBe(true);
			expect(felder.querySelector<HTMLSelectElement>('select[name="einheit"]')?.value).toBe('JUNGFISCHER');
			expect(karten()).toHaveLength(1);
			expect(karten()[0]?.textContent).toContain('Kommst du mit?');
			expect(karten()[0]?.textContent).toContain('Dabei');
			expect(karten()[0]?.classList).toContain('markiert');
		});

		it('stellt die Einheit einer neuen Umfrage auf eine, die beim Rollenfilter jemanden fragt', async () => {
			const { harness, hinzufuegen, modulFelder, seite } = await oeffneNeu();
			waehle(seite, 'select[name="rollenfilter"]', 'NUR_FAMILIE');
			await stabil(harness);
			hinzufuegen('Umfrage');
			await stabil(harness);

			expect(modulFelder()!.querySelector<HTMLSelectElement>('select[name="einheit"]')?.value).toBe('ERWACHSENER');
		});

		it('stellt bei einem Rollenfilterwechsel unpassende Einheiten ungesperrter Umfragen um', async () => {
			const { harness, hinzufuegen, modulFelder, seite } = await oeffneNeu();
			hinzufuegen('Umfrage');
			await stabil(harness);
			waehle(seite, 'select[name="rollenfilter"]', 'NUR_JUGENDLEITER');
			await stabil(harness);

			expect(modulFelder()!.querySelector<HTMLSelectElement>('select[name="einheit"]')?.value).toBe('ERWACHSENER');
			expect(modulFelder()!.querySelector('.fehler')).toBeNull();
		});

		it('leerer Titel: Fehler am Titel und keine Anfrage', async () => {
			const { harness, seite, feld, http } = await oeffneNeu();
			knopf(seite, 'Entwurf speichern').click();
			await stabil(harness);

			expect(feld('#thread-titel-fehler').textContent).toContain('Bitte einen Titel eingeben.');
			expect(feld('#thread-titel').getAttribute('aria-invalid')).toBe('true');
			http.expectNone(`${API}/threads`);
		});

		it('verteilt Modulfehler an die Felder, waehlt das erste fehlerhafte und markiert die anderen', async () => {
			const { harness, seite, http, hinzufuegen, modulFelder, feld } = await oeffneNeu();
			tippe(seite, '#thread-titel', 'Bowling');
			hinzufuegen('Info-Text');
			hinzufuegen('Termin');
			hinzufuegen('Info-Text');
			await stabil(harness);
			knopf(seite, 'Entwurf speichern').click();
			await stabil(harness);

			http.expectNone(`${API}/threads`);
			const eintraege = [...seite.querySelectorAll('ol.module > li')];
			// Das erste fehlerhafte Modul ist gewaehlt und zeigt seinen Fehler am Feld.
			expect(eintraege[0]?.classList).toContain('gewaehlt');
			expect(modulFelder()?.querySelector('textarea[name="text"]')).toBeTruthy();
			expect(modulFelder()?.textContent).toContain('Bitte einen Text eingeben.');
			// Das andere fehlerhafte Modul traegt eine Marke in der Liste, das fehlerfreie nicht.
			expect(eintraege[0]?.querySelector('.fehlermarke')).toBeNull();
			expect(eintraege[1]?.querySelector('.fehlermarke')).toBeNull();
			expect(eintraege[2]?.querySelector('.fehlermarke')?.textContent).toContain('Fehler');

			// Wird das Modul behoben, verschwindet der Fehler sofort.
			tippe(modulFelder()!, 'textarea[name="text"]', 'Hallo');
			await stabil(harness);
			expect(modulFelder()?.textContent).not.toContain('Bitte einen Text eingeben.');
			expect(feld('#thread-titel').getAttribute('aria-invalid')).toBeNull();
		});

		it('Veröffentlichen mit 400 aus lege: kein Veröffentlichen, Eingaben bleiben', async () => {
			const { harness, seite, http, feld, hinzufuegen } = await oeffneNeu();
			tippe(seite, '#thread-titel', 'Bowling');
			hinzufuegen('Info-Text');
			await stabil(harness);
			tippe(seite, 'jf-modul-felder textarea[name="text"]', 'Wir treffen uns.');
			await stabil(harness);
			knopf(seite, 'Veröffentlichen').click();

			await vi.waitFor(() =>
				http
					.expectOne({ method: 'POST', url: `${API}/threads` })
					.flush(
						{ fehler: 'Bitte einen Text eingeben.', feld: 'module.0.text' },
						{ status: 400, statusText: 'Bad Request' },
					),
			);
			await stabil(harness);

			http.expectNone(`${API}/threads/t1/veroeffentlichen`);
			expect(TestBed.inject(Router).url).toBe('/demo/verwaltung/threads/neu');
			expect(feld('#thread-titel').value).toBe('Bowling');
			expect(feld<HTMLTextAreaElement>('jf-modul-felder textarea[name="text"]').value).toBe('Wir treffen uns.');
			expect(seite.querySelector('jf-modul-felder')?.textContent).toContain('Bitte einen Text eingeben.');
		});

		it('Veröffentlichen: erst lege, dann veroeffentliche, dann die Adresse threads/<id>', async () => {
			const { harness, seite, http } = await oeffneNeu();
			const router = TestBed.inject(Router);
			const navigieren = vi.spyOn(router, 'navigate');
			tippe(seite, '#thread-titel', '🎳 Bowling');
			await stabil(harness);
			knopf(seite, 'Veröffentlichen').click();

			const gespeichert = bearbeitung({ entwurf: { ...bowling(), module: [] } });
			await vi.waitFor(() => {
				const anfrage = http.expectOne({ method: 'POST', url: `${API}/threads` });
				expect(anfrage.request.body).toEqual({
					entwurf: {
						titel: '🎳 Bowling',
						modus: 'KOMMENTARE',
						rollenfilter: 'JUNGFISCHER_FAMILIE',
						alleUntergruppen: true,
						untergruppenIds: [],
						module: [],
					},
				});
				anfrage.flush(gespeichert, { status: 201, statusText: 'Created' });
			});
			await vi.waitFor(() =>
				http
					.expectOne({ method: 'POST', url: `${API}/threads/t1/veroeffentlichen` })
					.flush({ ...gespeichert, veroeffentlicht: true }),
			);
			await vi.waitFor(() => expect(router.url).toBe('/demo/verwaltung/threads/t1'));
			await stabil(harness);

			expect(navigieren.mock.calls.at(-1)?.[1]).toMatchObject({ replaceUrl: true });
			// Die neue Seite uebernimmt den Stand aus der Antwort und laedt ihn nicht noch einmal.
			http.expectNone(`${API}/threads/t1/bearbeitung`);
			const neu = harness.routeNativeElement as HTMLElement;
			expect(neu.querySelector<HTMLInputElement>('#thread-titel')?.value).toBe('🎳 Bowling');
			expect(knopf(neu, 'Speichern')).toBeTruthy();
			expect(() => knopf(neu, 'Veröffentlichen')).toThrow();
		});

		it('401 beim Veröffentlichen fuehrt zur Anmeldung und danach nicht mehr zum neuen Thread', async () => {
			const { harness, seite, http } = await oeffneNeu();
			const router = TestBed.inject(Router);
			const navigieren = vi.spyOn(router, 'navigate');
			tippe(seite, '#thread-titel', 'Bowling');
			await stabil(harness);
			knopf(seite, 'Veröffentlichen').click();

			await vi.waitFor(() =>
				http
					.expectOne({ method: 'POST', url: `${API}/threads` })
					.flush(bearbeitung({ entwurf: { ...bowling(), module: [] } }), { status: 201, statusText: 'Created' }),
			);
			await antworteAbgelaufen(http, '/threads/t1/veroeffentlichen');
			await erwarteAnmeldung(http, '/demo/verwaltung/threads/neu');
			// Die zerstoerte Seite haette sonst gleich danach noch threads/t1 angesteuert.
			// Ohne whenStable: Eine solche Navigation hinge am Waechter (GET /ich) und liesse den Test
			// in die Zeitgrenze laufen, statt zu sagen, was geschah.
			await new Promise((fertig) => setTimeout(fertig, 20));
			http.match(() => true);

			expect(navigieren).not.toHaveBeenCalled();
			expect(router.url).toBe(`/demo/anmelden?weiter=${encodeURIComponent('/demo/verwaltung/threads/neu')}`);
		});

		it('schickt keine lokalen Schluessel der Module an den Server', async () => {
			const { harness, seite, http, hinzufuegen } = await oeffneNeu();
			tippe(seite, '#thread-titel', 'Bowling');
			hinzufuegen('Termin');
			await stabil(harness);
			knopf(seite, 'Entwurf speichern').click();

			await vi.waitFor(() => {
				const anfrage = http.expectOne({ method: 'POST', url: `${API}/threads` });
				const modul = (anfrage.request.body as { entwurf: ThreadEntwurf }).entwurf.module[0]!;
				expect(Object.keys(modul).sort()).toEqual(['id', 'termin', 'titel', 'typ']);
				expect(modul.id).toBeNull();
				anfrage.flush(bearbeitung(), { status: 201, statusText: 'Created' });
			});
			await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/demo/verwaltung/threads/t1'));
		});
	});

	describe('bestehender Thread', () => {
		it('zeigt den Entwurf mit seinen Knoepfen und Wegen', async () => {
			const { seite, feld, listenTexte, karten } = await oeffneBestehend();
			expect(seite.querySelector('h1')?.textContent).toContain('Thread bearbeiten');
			expect(seite.querySelector('.titelzeile')?.textContent).toContain('Entwurf');
			expect(feld('#thread-titel').value).toBe('🎳 Bowling');
			expect(feld('input[name="alleUntergruppen"]').checked).toBe(false);
			expect(feld('input[name="untergruppe"][value="u-gross"]').checked).toBe(true);
			expect(listenTexte()).toEqual(['Info-Text', 'Termin', 'Umfrage']);
			expect(karten()).toHaveLength(3);
			expect(knopf(seite, 'Entwurf speichern')).toBeTruthy();
			expect(knopf(seite, 'Veröffentlichen')).toBeTruthy();
			expect(knopf(seite, 'Anpinnen')).toBeTruthy();
			expect(knopf(seite, 'Archivieren')).toBeTruthy();
			expect(knopf(seite, 'Löschen')).toBeTruthy();
			expect(seite.querySelector('a[href="/demo/t/t1-bowling"]')?.textContent).toContain('Thread ansehen');
			expect(seite.querySelector('a[href="/demo/verwaltung/threads/t1/antworten"]')?.textContent).toContain(
				'Antworten',
			);
		});

		it('veroeffentlicht: nur Speichern, Loesen und Wiederherstellen, ohne Loeschen und Antworten-Link ohne Umfrage', async () => {
			const { seite } = await oeffneBestehend(
				bearbeitung({
					veroeffentlicht: true,
					angepinnt: true,
					archiviert: true,
					darfLoeschen: false,
					entwurf: { ...bowling(), module: bowling().module.slice(0, 2) },
				}),
			);
			expect(knopf(seite, 'Speichern')).toBeTruthy();
			expect(() => knopf(seite, 'Veröffentlichen')).toThrow();
			expect(() => knopf(seite, 'Entwurf speichern')).toThrow();
			expect(knopf(seite, 'Lösen')).toBeTruthy();
			expect(knopf(seite, 'Wiederherstellen')).toBeTruthy();
			expect(() => knopf(seite, 'Löschen')).toThrow();
			expect(seite.querySelector('a[href="/demo/verwaltung/threads/t1/antworten"]')).toBeNull();
		});

		it('ohne darfArchivieren kein Archivieren', async () => {
			const { seite } = await oeffneBestehend(bearbeitung({ darfArchivieren: false }));
			expect(() => knopf(seite, 'Archivieren')).toThrow();
		});

		it('Hoch und Runter tauschen, die Vorschau folgt, die Auswahl wandert mit', async () => {
			const { harness, nachLabel, listenTexte, karten, seite } = await oeffneBestehend();
			seite.querySelectorAll<HTMLButtonElement>('ol.module > li .waehlen')[0]?.click();
			await stabil(harness);
			expect(nachLabel('Nach oben: Modul 1').disabled).toBe(true);
			expect(nachLabel('Nach unten: Modul 3').disabled).toBe(true);

			nachLabel('Nach unten: Modul 1').click();
			await stabil(harness);
			expect(listenTexte()).toEqual(['Termin', 'Info-Text', 'Umfrage']);
			expect(karten()[0]?.querySelector('jf-termin-modul')).toBeTruthy();
			expect(karten()[1]?.querySelector('jf-info-modul')).toBeTruthy();
			expect(karten().map((k) => k.classList.contains('markiert'))).toEqual([false, true, false]);

			nachLabel('Nach oben: Modul 3').click();
			await stabil(harness);
			expect(listenTexte()).toEqual(['Termin', 'Umfrage', 'Info-Text']);
			expect(karten()[1]?.querySelector('jf-umfrage-modul')).toBeTruthy();
		});

		it('behaelt beim Umsortieren je Modul sein Bauteil und baut es fuer ein anderes Modul neu', async () => {
			const { harness, nachLabel, seite } = await oeffneBestehend();
			const waehlen = (i: number) => seite.querySelectorAll<HTMLButtonElement>('ol.module > li .waehlen')[i]?.click();
			waehlen(2);
			await stabil(harness);
			const vorher = seite.querySelector('jf-modul-felder');
			nachLabel('Nach oben: Modul 3').click();
			await stabil(harness);
			expect(seite.querySelector('jf-modul-felder')).toBe(vorher);
			expect(seite.querySelector<HTMLInputElement>('jf-modul-felder input[name="frage"]')?.value).toBe(
				'Kommst du mit?',
			);

			// Ein anderes Modul bekommt ein eigenes Bauteil, keinen Zustand des vorigen.
			waehlen(0);
			await stabil(harness);
			expect(seite.querySelector('jf-modul-felder')).not.toBe(vorher);
		});

		it('Tippen auf eine Karte der Vorschau waehlt das Modul im Formular', async () => {
			const { harness, karten, modulFelder, seite } = await oeffneBestehend();
			karten()[1]?.click();
			await stabil(harness);
			expect(seite.querySelectorAll('ol.module > li')[1]?.classList).toContain('gewaehlt');
			expect(modulFelder()?.querySelector('input[name="startDatum"]')).toBeTruthy();
		});

		it('Entfernen nimmt das Modul aus Liste und Vorschau', async () => {
			const { harness, nachLabel, listenTexte, karten } = await oeffneBestehend();
			nachLabel('Entfernen: Modul 1').click();
			await stabil(harness);
			expect(listenTexte()).toEqual(['Termin', 'Umfrage']);
			expect(karten()).toHaveLength(2);
		});

		it('laesst eine beantwortete Umfrage nicht entfernen und gibt ihr die Sperre', async () => {
			const { harness, nachLabel, seite } = await oeffneBestehend(
				bearbeitung({
					sperren: { 'm-umfrage': { beantwortet: true, schluessel: ['dabei'], mehrfachGenutzt: false } },
				}),
			);
			expect(nachLabel('Entfernen: Modul 3').disabled).toBe(true);
			expect(seite.querySelectorAll('ol.module > li')[2]?.textContent).toContain(
				'Gesperrt, weil schon Antworten da sind',
			);
			seite.querySelectorAll<HTMLButtonElement>('ol.module > li .waehlen')[2]?.click();
			await stabil(harness);
			expect(seite.querySelector<HTMLSelectElement>('jf-modul-felder select[name="einheit"]')?.disabled).toBe(true);
		});

		it('Speichern schickt die Version und nimmt den Stand des Servers als neue Basis', async () => {
			const { harness, seite, http, feld } = await oeffneBestehend();
			const frage = vi.spyOn(window, 'confirm').mockReturnValue(false);
			tippe(seite, '#thread-titel', 'Bowling am Samstag');
			await stabil(harness);
			knopf(seite, 'Entwurf speichern').click();

			await vi.waitFor(() => {
				const anfrage = http.expectOne({ method: 'PUT', url: `${API}/threads/t1` });
				expect(anfrage.request.body).toEqual({
					version: 3,
					entwurf: { ...bowling(), titel: 'Bowling am Samstag' },
				});
				anfrage.flush(bearbeitung({ version: 4, entwurf: { ...bowling(), titel: 'Bowling am Samstag' } }));
			});
			await stabil(harness);
			expect(seite.querySelector('[role="status"]')?.textContent).toContain('Entwurf gespeichert');

			// Die naechste Aenderung geht mit der neuen Version.
			tippe(seite, '#thread-titel', 'Bowling am Sonntag');
			await stabil(harness);
			knopf(seite, 'Entwurf speichern').click();
			await vi.waitFor(() => {
				const anfrage = http.expectOne({ method: 'PUT', url: `${API}/threads/t1` });
				expect((anfrage.request.body as { version: number }).version).toBe(4);
				anfrage.flush(bearbeitung({ version: 5, entwurf: { ...bowling(), titel: 'Bowling am Sonntag' } }));
			});
			await stabil(harness);
			expect(feld('#thread-titel').value).toBe('Bowling am Sonntag');

			// Nichts mehr ungespeichert: Verlassen fragt nicht.
			await TestBed.inject(Router).navigateByUrl('/demo/verwaltung/threads');
			await vi.waitFor(() => http.expectOne(`${API}/verwaltung/threads`).flush(LISTE));
			expect(frage).not.toHaveBeenCalled();
			expect(TestBed.inject(Router).url).toBe('/demo/verwaltung/threads');
		});

		it('409 VERALTET zeigt Neu laden und laedt den Stand des Servers', async () => {
			const { harness, seite, http, feld } = await oeffneBestehend();
			tippe(seite, '#thread-titel', 'Mein Titel');
			await stabil(harness);
			knopf(seite, 'Entwurf speichern').click();
			await vi.waitFor(() =>
				http
					.expectOne({ method: 'PUT', url: `${API}/threads/t1` })
					.flush(VERALTET, { status: 409, statusText: 'Conflict' }),
			);
			await stabil(harness);

			const karte = feld('.veraltet');
			expect(karte.textContent).toContain('Der Thread wurde inzwischen geändert. Bitte neu laden.');
			knopf(karte, 'Neu laden').click();
			await vi.waitFor(() =>
				http
					.expectOne(`${API}/threads/t1/bearbeitung`)
					.flush(bearbeitung({ version: 4, entwurf: { ...bowling(), titel: 'Von Petra geändert' } })),
			);
			await stabil(harness);
			expect(seite.querySelector('.veraltet')).toBeNull();
			expect(feld('#thread-titel').value).toBe('Von Petra geändert');
		});

		it('ein Feldfehler des Servers landet am Feld, ein Konflikt an der Zielgruppe beim Veroeffentlichen', async () => {
			const { harness, seite, http, feld } = await oeffneBestehend();
			knopf(seite, 'Veröffentlichen').click();
			await vi.waitFor(() =>
				http.expectOne({ method: 'PUT', url: `${API}/threads/t1` }).flush(bearbeitung({ version: 4 })),
			);
			await vi.waitFor(() =>
				http.expectOne({ method: 'POST', url: `${API}/threads/t1/veroeffentlichen` }).flush(
					{
						fehler: 'Der Thread hat keine Zielgruppe mehr. Bitte zuerst eine Untergruppe wählen.',
						code: 'KEINE_ZIELGRUPPE',
						feld: 'zielgruppe',
					},
					{ status: 409, statusText: 'Conflict' },
				),
			);
			await stabil(harness);
			expect(feld('#zielgruppe-fehler').textContent).toContain('keine Zielgruppe mehr');
			expect(knopf(seite, 'Veröffentlichen')).toBeTruthy();
		});

		it('409 BEANTWORTET an den Optionen einer Teilnahme-Umfrage steht an ihrem Feld', async () => {
			const { harness, seite, http, modulFelder } = await oeffneBestehend();
			knopf(seite, 'Entwurf speichern').click();
			await vi.waitFor(() =>
				http.expectOne({ method: 'PUT', url: `${API}/threads/t1` }).flush(
					{
						fehler: 'Auf „Vielleicht“ hat schon jemand geantwortet.',
						code: 'BEANTWORTET',
						feld: 'module.2.optionen',
					},
					{ status: 409, statusText: 'Conflict' },
				),
			);
			await stabil(harness);
			expect(modulFelder()?.querySelector('input[name="teilnahme"]')).toBeTruthy();
			expect(modulFelder()?.textContent).toContain('Auf „Vielleicht“ hat schon jemand geantwortet.');
			expect(seite.querySelector('.meldung')).toBeNull();
		});

		it('ein Feld, das die Seite an diesem Modul nicht zeigt, steht als Satz unter den Knoepfen', async () => {
			const { harness, seite, http } = await oeffneBestehend();
			for (const feld of ['module.2.ergebnisse', 'module.0.optionen']) {
				knopf(seite, 'Entwurf speichern').click();
				await vi.waitFor(() =>
					http
						.expectOne({ method: 'PUT', url: `${API}/threads/t1` })
						.flush({ fehler: `Ungültige Anfrage an ${feld}`, feld }, { status: 400, statusText: 'Bad Request' }),
				);
				await stabil(harness);
				expect(seite.querySelector('.meldung[role="alert"]')?.textContent).toContain(`Ungültige Anfrage an ${feld}`);
				expect(seite.querySelector('.fehlermarke')).toBeNull();
				expect(seite.querySelector('jf-modul-felder .fehler')).toBeNull();
			}
		});

		it('ein Feldfehler des Servers wandert beim Umsortieren mit seinem Modul und geht mit ihm', async () => {
			const { harness, seite, http, nachLabel, modulFelder } = await oeffneBestehend();
			const eintraege = () => [...seite.querySelectorAll('ol.module > li')];
			knopf(seite, 'Entwurf speichern').click();
			await vi.waitFor(() =>
				http
					.expectOne({ method: 'PUT', url: `${API}/threads/t1` })
					.flush(
						{ fehler: 'Höchstens 80 Zeichen.', feld: 'module.0.titel' },
						{ status: 400, statusText: 'Bad Request' },
					),
			);
			await stabil(harness);
			expect(modulFelder()?.textContent).toContain('Höchstens 80 Zeichen.');

			// Der Info-Text rutscht an die zweite Stelle; sein Fehler kommt mit, der Termin bleibt sauber.
			nachLabel('Nach unten: Modul 1').click();
			await stabil(harness);
			expect(modulFelder()?.querySelector('textarea[name="text"]')).toBeTruthy();
			expect(modulFelder()?.textContent).toContain('Höchstens 80 Zeichen.');
			seite.querySelectorAll<HTMLButtonElement>('ol.module > li .waehlen')[0]?.click();
			await stabil(harness);
			expect(modulFelder()?.querySelector('input[name="startDatum"]')).toBeTruthy();
			expect(modulFelder()?.textContent).not.toContain('Höchstens 80 Zeichen.');
			expect(eintraege().map((e) => e.querySelector('.fehlermarke') !== null)).toEqual([false, true, false]);

			// Entfernt, nimmt das Modul seinen Fehler mit; kein anderes erbt ihn.
			nachLabel('Entfernen: Modul 2').click();
			await stabil(harness);
			expect(eintraege().map((e) => e.querySelector('.fehlermarke') !== null)).toEqual([false, false]);
			expect(seite.textContent).not.toContain('Höchstens 80 Zeichen.');
		});

		it('404 beim Speichern sagt Nicht gefunden oder keine Berechtigung, 429 nennt die Wartezeit', async () => {
			const { harness, seite, http } = await oeffneBestehend();
			knopf(seite, 'Entwurf speichern').click();
			await vi.waitFor(() =>
				http
					.expectOne({ method: 'PUT', url: `${API}/threads/t1` })
					.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
			);
			await stabil(harness);
			expect(seite.querySelector('.meldung[role="alert"]')?.textContent).toContain(
				'Nicht gefunden oder keine Berechtigung',
			);

			knopf(seite, 'Entwurf speichern').click();
			await vi.waitFor(() =>
				http
					.expectOne({ method: 'PUT', url: `${API}/threads/t1` })
					.flush({ fehler: 'Zu viele Anfragen', wartenSekunden: 30 }, { status: 429, statusText: 'Too Many' }),
			);
			await stabil(harness);
			expect(seite.querySelector('.meldung[role="alert"]')?.textContent).toContain(
				'Zu viele Versuche – bitte in 30 Sekunden erneut',
			);
		});

		it('laedt bei 404 nichts und sagt Nicht gefunden oder keine Berechtigung', async () => {
			const http = TestBed.inject(HttpTestingController);
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo/verwaltung/threads/t9');
			await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit(['THREADS_ERSTELLEN'])));
			await navigation;
			await vi.waitFor(() =>
				http
					.expectOne(`${API}/threads/t9/bearbeitung`)
					.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
			);
			await vi.waitFor(() =>
				http.expectOne(`${API}/verein`).flush({ slug: 'demo', anzeigename: 'Demo', farbe: '#1d4ed8', hatLogo: false }),
			);
			await stabil(harness);
			const seite = harness.routeNativeElement as HTMLElement;
			expect(seite.textContent).toContain('Nicht gefunden oder keine Berechtigung');
			expect(seite.querySelector('#thread-titel')).toBeNull();
		});

		it('Anpinnen aendert die Knoepfe, aber nicht die Eingaben', async () => {
			const { harness, seite, http, feld } = await oeffneBestehend();
			tippe(seite, '#thread-titel', 'Noch nicht gespeichert');
			await stabil(harness);
			knopf(seite, 'Anpinnen').click();
			await vi.waitFor(() => {
				const anfrage = http.expectOne({ method: 'PUT', url: `${API}/threads/t1/angepinnt` });
				expect(anfrage.request.body).toEqual({ angepinnt: true });
				anfrage.flush(bearbeitung({ angepinnt: true }));
			});
			await stabil(harness);
			expect(knopf(seite, 'Lösen')).toBeTruthy();
			expect(feld('#thread-titel').value).toBe('Noch nicht gespeichert');
		});

		it('Archivieren schickt archiviert und zeigt danach Wiederherstellen', async () => {
			const { harness, seite, http } = await oeffneBestehend();
			knopf(seite, 'Archivieren').click();
			await vi.waitFor(() => {
				const anfrage = http.expectOne({ method: 'PUT', url: `${API}/threads/t1/archiv` });
				expect(anfrage.request.body).toEqual({ archiviert: true });
				anfrage.flush(bearbeitung({ archiviert: true }));
			});
			await stabil(harness);
			expect(knopf(seite, 'Wiederherstellen')).toBeTruthy();
		});

		it('Loeschen fragt mit jf-bestaetigung und fuehrt danach ohne Rueckfrage zur Liste', async () => {
			const { harness, seite, http } = await oeffneBestehend();
			const frage = vi.spyOn(window, 'confirm');
			tippe(seite, '#thread-titel', 'Egal');
			await stabil(harness);
			knopf(seite, 'Löschen').click();
			await stabil(harness);
			const dialog = seite.querySelector<HTMLElement>('jf-bestaetigung [role="dialog"]')!;
			expect(dialog).toBeTruthy();
			knopf(dialog, 'Abbrechen').click();
			await stabil(harness);
			expect(seite.querySelector('jf-bestaetigung')).toBeNull();
			http.expectNone({ method: 'DELETE', url: `${API}/threads/t1` });

			knopf(seite, 'Löschen').click();
			await stabil(harness);
			knopf(seite.querySelector<HTMLElement>('jf-bestaetigung [role="dialog"]')!, 'Endgültig löschen').click();
			await vi.waitFor(() =>
				http
					.expectOne({ method: 'DELETE', url: `${API}/threads/t1` })
					.flush(null, { status: 204, statusText: 'No Content' }),
			);
			await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/demo/verwaltung/threads'));
			await vi.waitFor(() => http.expectOne(`${API}/verwaltung/threads`).flush(LISTE));
			expect(frage).not.toHaveBeenCalled();
		});

		it('am Austausch sind Zielgruppe und Module ausgeblendet', async () => {
			const { seite, feld } = await oeffneBestehend(
				bearbeitung({ art: 'JUGENDSPRECHER_AUSTAUSCH', darfLoeschen: false, darfArchivieren: false }),
			);
			expect(feld('#thread-titel')).toBeTruthy();
			expect(feld('select[name="modus"]')).toBeTruthy();
			expect(seite.querySelector('input[name="alleUntergruppen"]')).toBeNull();
			expect(seite.querySelector('select[name="rollenfilter"]')).toBeNull();
			expect(seite.querySelector('ol.module')).toBeNull();
			expect(seite.querySelector('[aria-label="Modul hinzufügen"]')).toBeNull();
			expect(seite.querySelector('jf-modul-felder')).toBeNull();
			expect(seite.textContent).toContain('Zielgruppe und Module des Austauschs stehen fest.');
		});
	});

	describe('Ungespeichertes', () => {
		it('fragt beim Verlassen mit Aenderung und bleibt bei Abbruch', async () => {
			const { harness, seite } = await oeffneBestehend();
			const frage = vi.spyOn(window, 'confirm').mockReturnValue(false);
			hake(seite, 'input[name="alleUntergruppen"]');
			await stabil(harness);
			const router = TestBed.inject(Router);
			expect(await router.navigateByUrl('/demo/verwaltung/threads')).toBe(false);
			expect(frage).toHaveBeenCalledWith('Ungespeicherte Änderungen verwerfen?');
			expect(router.url).toBe('/demo/verwaltung/threads/t1');
		});

		it('fragt nicht, wenn eine Aenderung zurueckgenommen ist', async () => {
			const { harness, seite, http } = await oeffneBestehend();
			const frage = vi.spyOn(window, 'confirm');
			tippe(seite, '#thread-titel', 'Anders');
			tippe(seite, '#thread-titel', '🎳 Bowling');
			await stabil(harness);
			await TestBed.inject(Router).navigateByUrl('/demo/verwaltung/threads');
			await vi.waitFor(() => http.expectOne(`${API}/verwaltung/threads`).flush(LISTE));
			expect(frage).not.toHaveBeenCalled();
		});

		it('eine ab- und wieder angehakte Untergruppe ist keine Aenderung', async () => {
			const { harness, seite } = await oeffneBestehend(
				bearbeitung({ entwurf: { ...bowling(), untergruppenIds: ['u-gross', 'u-klein'] } }),
			);
			hake(seite, 'input[name="untergruppe"][value="u-gross"]', false);
			await stabil(harness);
			hake(seite, 'input[name="untergruppe"][value="u-gross"]', true);
			await stabil(harness);
			const verlassen = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(verlassen);
			expect(verlassen.defaultPrevented).toBe(false);
		});

		it('haelt beforeunload nur mit Aenderung auf', async () => {
			const { harness, seite } = await oeffneBestehend();
			const ohne = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(ohne);
			expect(ohne.defaultPrevented).toBe(false);

			tippe(seite, '#thread-titel', 'Anders');
			await stabil(harness);
			const mit = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(mit);
			expect(mit.defaultPrevented).toBe(true);
		});
	});

	describe('Gestaltung', () => {
		it('alle Knoepfe tragen .knopf und alle Haken .haken (44 px Tippflaeche)', async () => {
			const { harness, seite, hinzufuegen } = await oeffneBestehend();
			hinzufuegen('Umfrage');
			await stabil(harness);
			const knoepfe = [...seite.querySelectorAll('button')];
			expect(knoepfe.length).toBeGreaterThan(10);
			expect(knoepfe.filter((b) => !b.classList.contains('knopf')).map((b) => b.outerHTML)).toEqual([]);
			const haken = [...seite.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
			expect(haken.length).toBeGreaterThan(3);
			expect(haken.filter((h) => !h.closest('label.haken')).map((h) => h.name)).toEqual([]);
		});

		it('schaltet unter 1024 px zwischen Bearbeiten und Vorschau um', async () => {
			const mq = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
			vi.stubGlobal(
				'matchMedia',
				vi.fn((q: string) => (q.includes('1023') ? mq : { ...mq, matches: false })),
			);
			try {
				const { harness, seite, karten } = await oeffneBestehend();
				const formular = seite.querySelector<HTMLElement>('.formular')!;
				const vorschau = seite.querySelector<HTMLElement>('.vorschau-spalte')!;
				expect(formular.hidden).toBe(false);
				expect(vorschau.hidden).toBe(true);
				const umschalter = seite.querySelector<HTMLElement>('[role="group"][aria-label="Ansicht"]')!;
				expect(knopf(umschalter, 'Bearbeiten').getAttribute('aria-pressed')).toBe('true');

				knopf(umschalter, 'Vorschau').click();
				await stabil(harness);
				expect(formular.hidden).toBe(true);
				expect(vorschau.hidden).toBe(false);

				// Tippen auf eine Karte fuehrt zurueck in die Felder des Moduls.
				karten()[1]?.click();
				await stabil(harness);
				expect(formular.hidden).toBe(false);
				expect(seite.querySelector('jf-modul-felder input[name="startDatum"]')).toBeTruthy();
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it('zeigt am Desktop Formular und Vorschau nebeneinander, ohne Umschalter', async () => {
			const { seite } = await oeffneBestehend();
			expect(seite.querySelector<HTMLElement>('.formular')?.hidden).toBe(false);
			expect(seite.querySelector<HTMLElement>('.vorschau-spalte')?.hidden).toBe(false);
			expect(seite.querySelector('[aria-label="Ansicht"]')).toBeNull();
		});
	});
});
