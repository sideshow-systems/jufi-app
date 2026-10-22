import { HttpEventType } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { type DokumenteAntwort, FEHLER_TEXT, MB, type SpeicherAntwort } from '@jufi/domain';
import { adminTestAnbieter, knopf, tippe } from '../../admin/test-hilfen';
import { API, ichMit, oeffneSeite, stabil, waehle } from './test-hilfen';

const SPEICHER: SpeicherAntwort = { verbrauchBytes: 1288490189, grenzeMb: 5120 };

const ANTWORT: DokumenteAntwort = {
	darfPflegen: true,
	kategorien: [
		{
			id: 'k1',
			name: 'Ordnungen',
			dokumente: [
				{
					id: 'a',
					titel: 'Satzung',
					dateiId: 'd-a',
					typ: 'application/pdf',
					groesse: 1572864,
					name: 'Satzung.pdf',
					hochgeladenAm: '2026-10-01T10:00:00.000Z',
				},
				{
					id: 'b',
					titel: 'Beitragsordnung',
					dateiId: 'd-b',
					typ: 'application/pdf',
					groesse: 20480,
					name: 'Beitrag.pdf',
					hochgeladenAm: '2026-10-01T10:00:00.000Z',
				},
			],
		},
		{ id: 'k2', name: 'Merkblätter', dokumente: [] },
		{ id: 'k3', name: 'Formulare', dokumente: [] },
	],
};

function datei(name: string, bytes = 10): File {
	return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

describe('Verwaltung Dokumente', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
	});
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function oeffne(
		antwort: DokumenteAntwort = ANTWORT,
		speicher: SpeicherAntwort = SPEICHER,
		rechte = ['DOKUMENTE'],
	) {
		const o = await oeffneSeite('/demo/verwaltung/dokumente', ichMit(rechte), [
			['/dokumente', antwort],
			['/speicher', speicher],
		]);
		harness = o.harness;
		seite = o.seite;
		http = o.http;
	}

	/** Beantwortet das Neuladen von Liste und Speicherstand, das jede gelungene Aktion nach sich zieht. */
	async function neuGeladen(antwort: DokumenteAntwort = ANTWORT, speicher: SpeicherAntwort = SPEICHER): Promise<void> {
		await vi.waitFor(() => http.expectOne(`${API}/dokumente`).flush(antwort));
		await vi.waitFor(() => http.expectOne(`${API}/speicher`).flush(speicher));
		await stabil(harness);
	}

	const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
	const abschnitte = () => [...seite.querySelectorAll<HTMLElement>('section')];
	// Ueber die Id statt ueber die Ueberschrift: Beim Umbenennen steht dort ein Feld statt des Namens.
	const KATEGORIE_IDS: Record<string, string> = { Ordnungen: 'k1', Merkblätter: 'k2', Formulare: 'k3' };
	const DOKUMENT_IDS: Record<string, string> = { Satzung: 'a', Beitragsordnung: 'b' };
	const abschnitt = (name: string) => {
		const a = seite.querySelector<HTMLElement>(`section[data-kategorie="${KATEGORIE_IDS[name]}"]`);
		if (!a) throw new Error(`Kategorie nicht gefunden: ${name}`);
		return a;
	};
	const zeile = (titel: string) => {
		const z = seite.querySelector<HTMLElement>(`li[data-dokument="${DOKUMENT_IDS[titel]}"]`);
		if (!z) throw new Error(`Dokument nicht gefunden: ${titel}`);
		return z;
	};

	function waehleDateien(eingabe: HTMLInputElement, dateien: File[]): void {
		Object.defineProperty(eingabe, 'files', { value: dateien, configurable: true });
		eingabe.dispatchEvent(new Event('change', { bubbles: true }));
	}

	describe('Anzeige', () => {
		it('zeigt je Kategorie einen Abschnitt in der Reihenfolge der Antwort, auch leere, mit ihren Dokumenten', async () => {
			await oeffne();

			expect(seite.querySelector('h1')?.textContent).toContain('Dokumente');
			expect(abschnitte().map((s) => text(s.querySelector('h2')))).toEqual(['Ordnungen', 'Merkblätter', 'Formulare']);
			expect([...abschnitt('Ordnungen').querySelectorAll('li .titel')].map(text)).toEqual([
				'Satzung',
				'Beitragsordnung',
			]);
			expect(text(zeile('Satzung').querySelector('.zusatz'))).toBe('Satzung.pdf · 1,5 MB');
			expect(text(zeile('Beitragsordnung').querySelector('.zusatz'))).toBe('Beitrag.pdf · 20 KB');
		});

		it('zeigt oben den Speicherstand ohne Warnung', async () => {
			await oeffne();

			expect(text(seite.querySelector('.speicher'))).toBe('1,2 GB von 5,0 GB belegt');
			expect(seite.querySelector('.speicher jf-icon')).toBeNull();
			expect(seite.textContent).not.toContain('fast voll');
		});

		it('warnt ab 90 Prozent mit Icon und Satz', async () => {
			await oeffne(ANTWORT, { verbrauchBytes: 9 * MB, grenzeMb: 10 });

			expect(text(seite.querySelector('.speicher'))).toBe('9,0 MB von 10,0 MB belegt');
			expect(seite.querySelector('.speicher jf-icon')).not.toBeNull();
			expect(text(seite.querySelector('.speicher-warnung'))).toBe('Der Speicher ist fast voll.');
		});

		it('warnt knapp darunter nicht', async () => {
			await oeffne(ANTWORT, { verbrauchBytes: 9 * MB - 1, grenzeMb: 10 });

			expect(seite.querySelector('.speicher-warnung')).toBeNull();
		});

		it('bietet Loeschen nur bei leeren Kategorien an', async () => {
			await oeffne();

			const hatLoeschen = (name: string) =>
				[...abschnitt(name).querySelectorAll('button')].some((b) => text(b) === 'Kategorie löschen');
			expect(hatLoeschen('Ordnungen')).toBe(false);
			expect(hatLoeschen('Merkblätter')).toBe(true);
			expect(hatLoeschen('Formulare')).toBe(true);
		});

		it('sperrt den Pfeil nach oben bei der ersten und den nach unten bei der letzten Kategorie', async () => {
			await oeffne();

			const pfeil = (name: string, richtung: 'oben' | 'unten') =>
				abschnitt(name).querySelector<HTMLButtonElement>(`button[aria-label$="nach ${richtung}"]`);
			expect(pfeil('Ordnungen', 'oben')?.disabled).toBe(true);
			expect(pfeil('Ordnungen', 'unten')?.disabled).toBe(false);
			expect(pfeil('Formulare', 'unten')?.disabled).toBe(true);
			expect(pfeil('Formulare', 'oben')?.disabled).toBe(false);
		});

		it('zeigt ohne Recht an der Antwort Nicht gefunden und keine Pflege', async () => {
			await oeffne({ darfPflegen: false, kategorien: [] }, SPEICHER, ['THREADS_ERSTELLEN']);

			expect(seite.textContent).toContain('Nicht gefunden oder keine Berechtigung');
			expect(abschnitte()).toHaveLength(0);
		});

		it('zeigt bei einem Ladefehler den Text mit Knopf, der neu laedt', async () => {
			const o = await oeffneSeite('/demo/verwaltung/dokumente', ichMit(['DOKUMENTE']), []);
			harness = o.harness;
			seite = o.seite;
			http = o.http;
			// oeffneSeite hat keine Antworten verlangt; die Seitenanfragen stehen noch offen.
			http.expectOne(`${API}/dokumente`).error(new ProgressEvent('error'));
			http.expectOne(`${API}/speicher`).flush(SPEICHER);
			await stabil(harness);

			await vi.waitFor(() =>
				expect(text(seite.querySelector('[role="alert"]'))).toBe('Keine Verbindung – nochmal versuchen'),
			);
			knopf(seite, 'Nochmal versuchen').click();
			await neuGeladen();
			expect(abschnitte()).toHaveLength(3);
		});

		it('fuehrt bei 401 zur Anmeldung', async () => {
			const o = await oeffneSeite('/demo/verwaltung/dokumente', ichMit(['DOKUMENTE']), []);
			http = o.http;
			http
				.expectOne(`${API}/dokumente`)
				.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
			http
				.expectOne(`${API}/speicher`)
				.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });

			await vi.waitFor(() =>
				expect(TestBed.inject(Router).url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fverwaltung%2Fdokumente'),
			);
			http.match(() => true);
		});
	});

	describe('Hochladen', () => {
		const feld = (name: string) =>
			abschnitt(name).querySelector<HTMLInputElement>('input[type="file"][data-hochladen]') as HTMLInputElement;

		it('bietet die Dateiauswahl mit den erlaubten Endungen und mehreren Dateien an', async () => {
			await oeffne();

			expect(feld('Ordnungen').accept).toBe('.pdf,.docx,.xlsx,.pptx,.odt,.ods,.jpg,.jpeg,.png');
			expect(feld('Ordnungen').multiple).toBe(true);
			expect(text(abschnitt('Ordnungen'))).toContain('Dokument hochladen');
		});

		it('schickt die Datei an die Kategorie, zeigt den Fortschritt und laedt danach neu', async () => {
			await oeffne();
			waehleDateien(feld('Merkblätter'), [datei('Packliste.pdf')]);
			await stabil(harness);

			const anfrage = http.expectOne(`${API}/dokumente?kategorie=k2`);
			expect(anfrage.request.method).toBe('POST');
			expect(anfrage.request.headers.get('X-Dateiname')).toBe('Packliste.pdf');
			anfrage.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
			await stabil(harness);
			const zeileHoch = abschnitt('Merkblätter').querySelector('li[data-hochladung]');
			expect(text(zeileHoch)).toContain('Packliste.pdf');
			expect(zeileHoch?.querySelector('progress')?.value).toBe(0.5);

			anfrage.flush({ id: 'n' }, { status: 201, statusText: 'Created' });
			await neuGeladen();
			expect(abschnitt('Merkblätter').querySelector('li[data-hochladung]')).toBeNull();
		});

		it('laedt mehrere Dateien nacheinander hoch', async () => {
			await oeffne();
			waehleDateien(feld('Formulare'), [datei('eins.pdf'), datei('zwei.pdf')]);
			await stabil(harness);

			const erste = http.expectOne(`${API}/dokumente?kategorie=k3`);
			expect(erste.request.headers.get('X-Dateiname')).toBe('eins.pdf');
			expect(abschnitt('Formulare').querySelectorAll('li[data-hochladung]')).toHaveLength(2);
			erste.flush({}, { status: 201, statusText: 'Created' });
			await vi.waitFor(() => {
				const zweite = http.expectOne(`${API}/dokumente?kategorie=k3`);
				expect(zweite.request.headers.get('X-Dateiname')).toBe('zwei.pdf');
				zweite.flush({}, { status: 201, statusText: 'Created' });
			});
			// Der Stapel laedt die Seite einmal neu, nicht je Datei.
			await neuGeladen();
		});

		it('zeigt bei einem Fehler den Text der Zeile mit Nochmal, und Nochmal schickt dieselbe Datei erneut', async () => {
			await oeffne();
			waehleDateien(feld('Ordnungen'), [datei('Bild.pdf')]);
			await stabil(harness);
			http
				.expectOne(`${API}/dokumente?kategorie=k1`)
				.flush({ fehler: FEHLER_TEXT.TYP.DATEI, code: 'TYP' }, { status: 415, statusText: 'Unsupported Media Type' });
			await stabil(harness);

			const z = abschnitt('Ordnungen').querySelector('li[data-hochladung]');
			expect(text(z?.querySelector('[role="alert"]'))).toBe(FEHLER_TEXT.TYP.DATEI);
			knopf(z as HTMLElement, 'Nochmal').click();
			await stabil(harness);

			const zweiter = http.expectOne(`${API}/dokumente?kategorie=k1`);
			expect(zweiter.request.headers.get('X-Dateiname')).toBe('Bild.pdf');
			zweiter.flush({}, { status: 201, statusText: 'Created' });
			await neuGeladen();
		});

		it('fuehrt bei 401 waehrend des Uploads zur Anmeldung, wie jede andere Anfrage', async () => {
			await oeffne();
			waehleDateien(feld('Ordnungen'), [datei('Bild.pdf')]);
			await stabil(harness);

			http
				.expectOne(`${API}/dokumente?kategorie=k1`)
				.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });

			await vi.waitFor(() =>
				expect(TestBed.inject(Router).url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fverwaltung%2Fdokumente'),
			);
			http.match(() => true);
		});

		it('benennt das Ersetzen-Feld am Feld selbst, mit dem Titel des Dokuments', async () => {
			await oeffne();
			const eingabe = zeile('Satzung').querySelector('input[type="file"]') as HTMLInputElement;

			expect(eingabe.getAttribute('aria-label')).toBe('Datei von „Satzung“ ersetzen');
			expect(eingabe.closest('label')?.hasAttribute('aria-label')).toBe(false);
		});

		it('zeigt eine wartende Datei ohne Balken', async () => {
			await oeffne();
			waehleDateien(feld('Formulare'), [datei('eins.pdf'), datei('zwei.pdf')]);
			await stabil(harness);

			const zeilen = [...abschnitt('Formulare').querySelectorAll('li[data-hochladung]')];
			expect(zeilen[0]?.querySelector('progress')).not.toBeNull();
			expect(zeilen[1]?.querySelector('progress')).toBeNull();
			expect(text(zeilen[1])).toContain('Wartet');
			http.expectOne(`${API}/dokumente?kategorie=k3`);
		});

		it('weist eine zu grosse Datei ohne Anfrage ab und laesst sich verwerfen', async () => {
			await oeffne();
			waehleDateien(feld('Ordnungen'), [datei('riesig.pdf', 25 * MB + 1)]);
			await stabil(harness);

			http.expectNone(`${API}/dokumente?kategorie=k1`);
			const z = abschnitt('Ordnungen').querySelector<HTMLElement>('li[data-hochladung]');
			expect(text(z?.querySelector('[role="alert"]'))).toBe(FEHLER_TEXT.GROESSE.DATEI);
			knopf(z as HTMLElement, 'Verwerfen').click();
			await stabil(harness);
			expect(abschnitt('Ordnungen').querySelector('li[data-hochladung]')).toBeNull();
		});

		it('ersetzt die Datei eines Dokuments per PUT und zeigt die Zeile in dessen Kategorie', async () => {
			await oeffne();
			const eingabe = zeile('Satzung').querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
			expect(eingabe.multiple).toBe(false);
			waehleDateien(eingabe, [datei('Satzung-neu.pdf')]);
			await stabil(harness);

			const anfrage = http.expectOne(`${API}/dokumente/a/datei`);
			expect(anfrage.request.method).toBe('PUT');
			expect(anfrage.request.headers.get('X-Dateiname')).toBe('Satzung-neu.pdf');
			expect(text(abschnitt('Ordnungen').querySelector('li[data-hochladung]'))).toContain('Satzung ersetzen');
			anfrage.flush({}, { status: 200, statusText: 'OK' });
			await neuGeladen();
		});
	});

	describe('Dokumente pflegen', () => {
		it('loescht erst nach der Rueckfrage', async () => {
			await oeffne();
			knopf(zeile('Satzung'), 'Löschen').click();
			await stabil(harness);

			expect(text(seite.querySelector('jf-bestaetigung'))).toContain('‚Satzung‘ löschen?');
			http.expectNone(`${API}/dokumente/a`);

			knopf(seite.querySelector('jf-bestaetigung') as HTMLElement, 'Löschen').click();
			const anfrage = http.expectOne(`${API}/dokumente/a`);
			expect(anfrage.request.method).toBe('DELETE');
			anfrage.flush(null, { status: 204, statusText: 'No Content' });
			await neuGeladen();
			expect(seite.querySelector('jf-bestaetigung')).toBeNull();
		});

		it('bricht die Rueckfrage ohne Anfrage ab', async () => {
			await oeffne();
			knopf(zeile('Satzung'), 'Löschen').click();
			await stabil(harness);
			knopf(seite.querySelector('jf-bestaetigung') as HTMLElement, 'Abbrechen').click();
			await stabil(harness);

			expect(seite.querySelector('jf-bestaetigung')).toBeNull();
			http.expectNone(`${API}/dokumente/a`);
		});

		it('benennt ein Dokument per PUT mit dem Titel um', async () => {
			await oeffne();
			knopf(zeile('Satzung'), 'Umbenennen').click();
			await stabil(harness);
			tippe(seite, 'input[name="titel"]', '  Vereinssatzung  ');
			await stabil(harness);
			knopf(zeile('Satzung'), 'Speichern').click();

			const anfrage = http.expectOne(`${API}/dokumente/a`);
			expect(anfrage.request.method).toBe('PUT');
			expect(anfrage.request.body).toEqual({ titel: 'Vereinssatzung' });
			anfrage.flush({}, { status: 200, statusText: 'OK' });
			await neuGeladen();
			await vi.waitFor(() => expect(seite.querySelector('input[name="titel"]')).toBeNull());
		});

		it('zeigt den Fehler des Servers beim Umbenennen an der Zeile', async () => {
			await oeffne();
			knopf(zeile('Satzung'), 'Umbenennen').click();
			await stabil(harness);
			tippe(seite, 'input[name="titel"]', 'x');
			await stabil(harness);
			knopf(zeile('Satzung'), 'Speichern').click();
			http
				.expectOne(`${API}/dokumente/a`)
				.flush({ fehler: 'Der Titel darf nicht leer sein', feld: 'titel' }, { status: 400, statusText: 'Bad Request' });
			await stabil(harness);

			expect(text(zeile('Satzung').querySelector('[role="alert"]'))).toBe('Der Titel darf nicht leer sein');
		});

		it('verschiebt ein Dokument in eine andere Kategorie per PUT mit kategorieId', async () => {
			await oeffne();
			const auswahl = zeile('Satzung').querySelector('select') as HTMLSelectElement;
			expect([...auswahl.options].map((o) => text(o))).toEqual(['Ordnungen', 'Merkblätter', 'Formulare']);
			expect(auswahl.value).toBe('k1');
			waehle(zeile('Satzung'), 'select', 'k3');

			const anfrage = http.expectOne(`${API}/dokumente/a`);
			expect(anfrage.request.method).toBe('PUT');
			expect(anfrage.request.body).toEqual({ kategorieId: 'k3' });
			anfrage.flush({}, { status: 200, statusText: 'OK' });
			await neuGeladen();
		});
	});

	describe('Kategorien pflegen', () => {
		it('legt eine Kategorie an und leert das Feld', async () => {
			await oeffne();
			tippe(seite, 'input[name="neueKategorie"]', ' Satzungen ');
			await stabil(harness);
			knopf(seite, 'Kategorie anlegen').click();

			const anfrage = http.expectOne(`${API}/dokument-kategorien`);
			expect(anfrage.request.method).toBe('POST');
			expect(anfrage.request.body).toEqual({ name: 'Satzungen' });
			anfrage.flush({ id: 'k4', name: 'Satzungen' }, { status: 201, statusText: 'Created' });
			await neuGeladen();
			await vi.waitFor(() =>
				expect(seite.querySelector<HTMLInputElement>('input[name="neueKategorie"]')?.value).toBe(''),
			);
		});

		it('zeigt bei einem doppelten Namen den Text des Servers am Anlegen', async () => {
			await oeffne();
			tippe(seite, 'input[name="neueKategorie"]', 'Ordnungen');
			await stabil(harness);
			knopf(seite, 'Kategorie anlegen').click();
			http
				.expectOne(`${API}/dokument-kategorien`)
				.flush({ fehler: 'Diese Kategorie gibt es schon' }, { status: 409, statusText: 'Conflict' });
			await stabil(harness);

			expect(text(seite.querySelector('form[aria-label="Kategorie anlegen"] [role="alert"]'))).toBe(
				'Diese Kategorie gibt es schon',
			);
		});

		it('benennt eine Kategorie per PUT um', async () => {
			await oeffne();
			knopf(abschnitt('Merkblätter'), 'Umbenennen').click();
			await stabil(harness);
			tippe(seite, 'input[name="kategorieName"]', 'Packlisten');
			await stabil(harness);
			knopf(abschnitt('Merkblätter'), 'Speichern').click();

			const anfrage = http.expectOne(`${API}/dokument-kategorien/k2`);
			expect(anfrage.request.method).toBe('PUT');
			expect(anfrage.request.body).toEqual({ name: 'Packlisten' });
			anfrage.flush({ id: 'k2', name: 'Packlisten' });
			await neuGeladen();
		});

		it('loescht eine leere Kategorie per DELETE', async () => {
			await oeffne();
			knopf(abschnitt('Formulare'), 'Kategorie löschen').click();

			const anfrage = http.expectOne(`${API}/dokument-kategorien/k3`);
			expect(anfrage.request.method).toBe('DELETE');
			anfrage.flush(null, { status: 204, statusText: 'No Content' });
			await neuGeladen();
		});

		it('schickt beim Pfeil nach unten alle Ids in der neuen Reihenfolge', async () => {
			await oeffne();
			(abschnitt('Ordnungen').querySelector('button[aria-label$="nach unten"]') as HTMLButtonElement).click();

			const anfrage = http.expectOne(`${API}/dokument-kategorien/reihenfolge`);
			expect(anfrage.request.method).toBe('PUT');
			expect(anfrage.request.body).toEqual({ ids: ['k2', 'k1', 'k3'] });
			anfrage.flush(null, { status: 204, statusText: 'No Content' });
			await neuGeladen();
		});

		it('schickt beim Pfeil nach oben die getauschte Reihenfolge', async () => {
			await oeffne();
			(abschnitt('Formulare').querySelector('button[aria-label$="nach oben"]') as HTMLButtonElement).click();

			const anfrage = http.expectOne(`${API}/dokument-kategorien/reihenfolge`);
			expect(anfrage.request.body).toEqual({ ids: ['k1', 'k3', 'k2'] });
			anfrage.flush(null, { status: 204, statusText: 'No Content' });
			await neuGeladen();
		});

		it('laedt bei 404 neu und sagt, dass es das nicht mehr gibt', async () => {
			await oeffne();
			knopf(abschnitt('Formulare'), 'Kategorie löschen').click();
			http
				.expectOne(`${API}/dokument-kategorien/k3`)
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
			await neuGeladen({ darfPflegen: true, kategorien: ANTWORT.kategorien.slice(0, 2) });

			expect(abschnitte()).toHaveLength(2);
			expect(seite.textContent).toContain('gibt es nicht mehr');
		});
	});
});
