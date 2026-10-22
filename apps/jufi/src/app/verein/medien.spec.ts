import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { DokumenteAntwort, DokumentAnsicht, MedienAntwort, MedienBlock } from '@jufi/domain';
import { adminTestAnbieter } from '../admin/test-hilfen';

const API = '/demo/api/v1';

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

const ICH = {
	person: { id: 'p-1', vorname: 'Lena', nachname: 'Muster', art: 'ERWACHSENER', rechte: [] as string[] },
	kennung: 'lena@example.org',
	passkeys: [],
	hatPasswort: true,
	hatKinder: false,
};

const TYPEN = {
	pdf: 'application/pdf',
	jpeg: 'image/jpeg',
	png: 'image/png',
	word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	powerpoint: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	odt: 'application/vnd.oasis.opendocument.text',
	ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

function dokument(id: string, titel: string, typ: string, groesse = 1024): DokumentAnsicht {
	return {
		id,
		titel,
		dateiId: `d-${id}`,
		typ,
		groesse,
		name: `${titel}.bin`,
		hochgeladenAm: '2026-10-01T10:00:00.000Z',
	};
}

const ANTWORT: DokumenteAntwort = {
	darfPflegen: false,
	kategorien: [
		{
			id: 'k1',
			name: 'Ordnungen',
			dokumente: [dokument('a', 'Satzung', TYPEN.pdf, 1572864), dokument('b', 'Beitragsordnung', TYPEN.word, 20480)],
		},
		{ id: 'k2', name: 'Formulare', dokumente: [dokument('c', 'Anmeldung', TYPEN.pdf, 524288)] },
	],
};

function block(teil: Partial<MedienBlock> & { threadId: string }): MedienBlock {
	return {
		segment: `${teil.threadId}-lager`,
		titel: 'Zeltlager',
		archiviert: false,
		fotos: 0,
		vorschau: [],
		dateien: [],
		weitereDateien: 0,
		...teil,
	};
}

const MEDIEN: MedienAntwort = {
	bloecke: [
		block({
			threadId: 't1',
			segment: 't1-zeltlager',
			titel: 'Zeltlager',
			fotos: 23,
			vorschau: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'],
			dateien: [
				{
					id: 'd1',
					name: 'Packliste.pdf',
					typ: TYPEN.pdf,
					groesse: 1572864,
					hochgeladenAm: '2026-10-01T10:00:00.000Z',
				},
				{ id: 'd2', name: 'Plan.docx', typ: TYPEN.word, groesse: 20480, hochgeladenAm: '2026-10-02T10:00:00.000Z' },
			],
			weitereDateien: 3,
		}),
		block({
			threadId: 't2',
			segment: 't2-fischerfest',
			titel: 'Fischerfest 2025',
			archiviert: true,
			fotos: 1,
			vorschau: ['g1'],
		}),
	],
};

describe('Medien', () => {
	let http: HttpTestingController;
	let router: Router;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		http = TestBed.inject(HttpTestingController);
		router = TestBed.inject(Router);
	});

	afterEach(() => http.verify());

	function text(el: Element): string {
		return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
	}

	async function stabil(): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
		seite = harness.routeNativeElement as HTMLElement;
	}

	type Fehlerantwort = { status: number; body: object };

	/** Beantwortet die Anfrage an pfad; der Effekt der Ressource schickt sie erst im naechsten Durchlauf. */
	async function antworte(pfad: string, antwort: object | Fehlerantwort | 'netz'): Promise<void> {
		await vi.waitFor(() => {
			harness.detectChanges();
			const anfrage = http.expectOne(`${API}${pfad}`);
			if (antwort === 'netz') anfrage.error(new ProgressEvent('error'));
			else if ('status' in antwort && 'body' in antwort) {
				const f = antwort as Fehlerantwort;
				anfrage.flush(f.body, { status: f.status, statusText: 'Fehler' });
			} else anfrage.flush(antwort);
		});
		await stabil();
	}

	async function betritt(adresse: string): Promise<void> {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl(adresse);
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		http.expectOne(`${API}/verein`).flush(VEREIN);
	}

	/** Der Reiter Dokumente, wie ihn Zurueck aus einem Thread wieder oeffnet. */
	async function oeffne(antwort: DokumenteAntwort | Fehlerantwort | 'netz' = ANTWORT): Promise<void> {
		await betritt('/demo/medien?reiter=dokumente');
		await antworte('/dokumente', antwort);
	}

	/** Die Vorgabe: der Reiter Fotos & Dateien. */
	async function oeffneMedien(antwort: MedienAntwort | Fehlerantwort | 'netz' = MEDIEN): Promise<void> {
		await betritt('/demo/medien');
		await antworte('/medien', antwort);
	}

	const kategorien = () => [...seite.querySelectorAll<HTMLElement>('main section')];
	const zeilen = () => [...seite.querySelectorAll<HTMLAnchorElement>('main li a')];

	it('zeigt die Kategorien in der Reihenfolge der Antwort, je mit Ueberschrift und ihren Dokumenten', async () => {
		await oeffne();

		expect(kategorien().map((k) => text(k.querySelector('h2') as Element))).toEqual(['Ordnungen', 'Formulare']);
		expect([...kategorien()[0].querySelectorAll('li .titel')].map(text)).toEqual(['Satzung', 'Beitragsordnung']);
		expect([...kategorien()[1].querySelectorAll('li .titel')].map(text)).toEqual(['Anmeldung']);
	});

	it('zeigt Typ-Kuerzel und Groesse unter dem Titel und ein Dokument-Icon', async () => {
		await oeffne();

		const satzung = zeilen()[0];
		expect(text(satzung.querySelector('.zusatz') as Element)).toBe('PDF · 1,5 MB');
		expect(satzung.querySelector('jf-icon')).not.toBeNull();
		expect(text(zeilen()[1].querySelector('.zusatz') as Element)).toBe('Word · 20 KB');
	});

	it.each([
		[TYPEN.pdf, 'PDF'],
		[TYPEN.word, 'Word'],
		[TYPEN.excel, 'Excel'],
		[TYPEN.powerpoint, 'PowerPoint'],
		[TYPEN.odt, 'OpenDocument'],
		[TYPEN.ods, 'OpenDocument'],
		[TYPEN.jpeg, 'Bild'],
		[TYPEN.png, 'Bild'],
	])('nennt den Typ %s mit dem Kuerzel %s', async (typ, kuerzel) => {
		await oeffne({
			darfPflegen: false,
			kategorien: [{ id: 'k', name: 'Alles', dokumente: [dokument('x', 'Datei', typ)] }],
		});

		expect(text(zeilen()[0].querySelector('.zusatz') as Element).split(' · ')[0]).toBe(kuerzel);
	});

	it.each([
		[TYPEN.pdf, true],
		[TYPEN.jpeg, true],
		[TYPEN.png, true],
		[TYPEN.word, false],
		[TYPEN.excel, false],
		[TYPEN.powerpoint, false],
		[TYPEN.odt, false],
		[TYPEN.ods, false],
	])('oeffnet %s im neuen Tab: %s, sonst laedt es herunter', async (typ, oeffnen) => {
		await oeffne({
			darfPflegen: false,
			kategorien: [{ id: 'k', name: 'Alles', dokumente: [dokument('x', 'Datei', typ)] }],
		});

		const a = zeilen()[0];
		if (oeffnen) {
			expect(a.getAttribute('href')).toBe('/demo/api/v1/dateien/d-x');
			expect(a.getAttribute('target')).toBe('_blank');
			expect(a.getAttribute('rel')).toBe('noopener');
		} else {
			expect(a.getAttribute('href')).toBe('/demo/api/v1/dateien/d-x?herunterladen=1');
			expect(a.hasAttribute('target')).toBe(false);
		}
	});

	it('zeigt ohne Dokumente den Leertext und keine Kategorien', async () => {
		await oeffne({ darfPflegen: false, kategorien: [] });

		expect(text(seite.querySelector('main') as Element)).toContain('Noch keine Dokumente.');
		expect(kategorien()).toHaveLength(0);
	});

	it('zeigt auch den Leertext, wenn alle Kategorien ohne Dokumente sind', async () => {
		await oeffne({ darfPflegen: true, kategorien: [{ id: 'k', name: 'Ordnungen', dokumente: [] }] });

		expect(text(seite.querySelector('main') as Element)).toContain('Noch keine Dokumente.');
	});

	it('fuehrt bei 401 zur Anmeldung und merkt sich die Seite als weiter', async () => {
		await oeffne({ status: 401, body: { fehler: 'nicht angemeldet' } });

		// Mit dem Reiter: Nach der Anmeldung geht es dorthin zurueck, wo die Person war.
		expect(router.url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fmedien%3Freiter%3Ddokumente');
	});

	it('zeigt bei einem Netzfehler den Text mit Knopf und laedt auf Knopfdruck neu', async () => {
		await oeffne('netz');

		expect(text(seite.querySelector('main [role="alert"]') as Element)).toBe('Keine Verbindung – nochmal versuchen');
		seite.querySelector<HTMLButtonElement>('main [role="alert"] ~ button')?.click();
		await antworte('/dokumente', ANTWORT);

		expect(kategorien()).toHaveLength(2);
	});

	describe('Reiter', () => {
		const reiter = () => [...seite.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')];

		it('hat die Ueberschrift Medien und eine Reiterleiste mit Fotos & Dateien und Dokumente', async () => {
			await oeffneMedien();

			expect(text(seite.querySelector('main h1') as Element)).toBe('Medien');
			expect(seite.querySelector('[role="tablist"]')).not.toBeNull();
			expect(reiter().map(text)).toEqual(['Fotos & Dateien', 'Dokumente']);
		});

		it('oeffnet ohne Parameter Fotos & Dateien und laedt nur die Medien', async () => {
			await oeffneMedien();

			expect(reiter().map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'false']);
			expect(seite.querySelector('[role="tabpanel"]')).not.toBeNull();
			http.expectNone(`${API}/dokumente`);
		});

		it('oeffnet mit reiter=dokumente die Dokumente und laedt nur sie', async () => {
			await oeffne();

			expect(reiter().map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true']);
			expect(kategorien()).toHaveLength(2);
			http.expectNone(`${API}/medien`);
		});

		it('faellt bei einem unbekannten Wert auf Fotos & Dateien zurueck', async () => {
			await betritt('/demo/medien?reiter=quatsch');
			await antworte('/medien', MEDIEN);

			expect(reiter().map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'false']);
		});

		it('setzt beim Wechsel zu Dokumente reiter=dokumente in die Adresse und laedt die Dokumente', async () => {
			await oeffneMedien();

			reiter()[1].click();
			await antworte('/dokumente', ANTWORT);

			expect(router.url).toBe('/demo/medien?reiter=dokumente');
			expect(kategorien()).toHaveLength(2);
			expect(reiter()[1].getAttribute('aria-selected')).toBe('true');
		});

		it('nimmt beim Wechsel zurueck zu Fotos & Dateien den Parameter wieder aus der Adresse', async () => {
			await oeffne();

			reiter()[0].click();
			await antworte('/medien', MEDIEN);

			expect(router.url).toBe('/demo/medien');
			expect(reiter()[0].getAttribute('aria-selected')).toBe('true');
		});

		it('wechselt mit den Pfeiltasten und fuehrt den Fokus mit', async () => {
			await oeffneMedien();

			reiter()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
			await antworte('/dokumente', ANTWORT);

			expect(router.url).toBe('/demo/medien?reiter=dokumente');
			expect(document.activeElement).toBe(reiter()[1]);
			expect(reiter().map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0']);
		});
	});

	describe('Fotos & Dateien', () => {
		const bloecke = () => [...seite.querySelectorAll<HTMLElement>('main [data-block]')];

		it('zeigt je Thread einen Block, den Titel als Link auf den Thread, nach der Reihenfolge der Antwort', async () => {
			await oeffneMedien();

			expect(bloecke()).toHaveLength(2);
			const titel = bloecke().map((b) => b.querySelector<HTMLAnchorElement>('h2 a') as HTMLAnchorElement);
			expect(titel.map(text)).toEqual(['Zeltlager', 'Fischerfest 2025']);
			expect(titel.map((a) => a.getAttribute('href'))).toEqual(['/demo/t/t1-zeltlager', '/demo/t/t2-fischerfest']);
		});

		it('kennzeichnet nur archivierte Threads mit Archiv', async () => {
			await oeffneMedien();

			expect(bloecke()[0].querySelector('.archiv')).toBeNull();
			expect(text(bloecke()[1].querySelector('.archiv') as Element)).toBe('Archiv');
		});

		it('zeigt bis zu 6 Vorschaubilder aus der Vorschau-Route und die Zahl der Fotos', async () => {
			await oeffneMedien();

			const bilder = [...bloecke()[0].querySelectorAll<HTMLImageElement>('.vorschau img')];
			expect(bilder.map((b) => b.getAttribute('src'))).toEqual(
				['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => `/demo/api/v1/dateien/${id}/vorschau`),
			);
			expect(bilder.every((b) => b.getAttribute('alt') === '' && b.getAttribute('loading') === 'lazy')).toBe(true);
			expect(text(bloecke()[0].querySelector('.zahl') as Element)).toBe('23 Fotos');
			expect(text(bloecke()[1].querySelector('.zahl') as Element)).toBe('1 Foto');
		});

		it('zeigt die Dateien wie im Datei-Modul mit Kuerzel, Groesse und Link und dann und 3 weitere', async () => {
			await oeffneMedien();

			const zeilen = [...bloecke()[0].querySelectorAll<HTMLAnchorElement>('.dateien a')];
			expect(zeilen.map((z) => text(z.querySelector('.titel') as Element))).toEqual(['Packliste.pdf', 'Plan.docx']);
			expect(text(zeilen[0].querySelector('.zusatz') as Element)).toBe('PDF · 1,5 MB');
			expect(zeilen[0].getAttribute('href')).toBe('/demo/api/v1/dateien/d1');
			expect(zeilen[0].getAttribute('target')).toBe('_blank');
			expect(zeilen[1].getAttribute('href')).toBe('/demo/api/v1/dateien/d2?herunterladen=1');
			expect(text(bloecke()[0].querySelector('.weitere') as Element)).toBe('und 3 weitere');
		});

		it('zeigt ohne Fotos keine Vorschau-Reihe und ohne weitere Dateien keine Zeile dazu', async () => {
			await oeffneMedien({
				bloecke: [
					block({
						threadId: 't3',
						dateien: [
							{ id: 'd1', name: 'A.pdf', typ: TYPEN.pdf, groesse: 10, hochgeladenAm: '2026-10-01T10:00:00.000Z' },
						],
					}),
				],
			});

			expect(seite.querySelector('.vorschau')).toBeNull();
			expect(seite.querySelector('.zahl')).toBeNull();
			expect(seite.querySelector('.weitere')).toBeNull();
			expect(seite.querySelectorAll('.dateien li')).toHaveLength(1);
		});

		it('hat je Block einen Zum Thread Link, und die Dateizeilen haben weder Umbenennen noch Loeschen', async () => {
			await oeffneMedien();

			const links = bloecke().map((b) => b.querySelector<HTMLAnchorElement>('a.zum-thread') as HTMLAnchorElement);
			expect(links.map(text)).toEqual(['Zum Thread', 'Zum Thread']);
			expect(links.map((l) => l.getAttribute('href'))).toEqual(['/demo/t/t1-zeltlager', '/demo/t/t2-fischerfest']);
			expect(seite.querySelector('main .tafel button')).toBeNull();
		});

		it('zeigt ohne Bloecke den Leertext', async () => {
			await oeffneMedien({ bloecke: [] });

			expect(text(seite.querySelector('main') as Element)).toContain('Noch keine Fotos oder Dateien.');
			expect(bloecke()).toHaveLength(0);
		});

		it('fuehrt bei 401 zur Anmeldung und merkt sich die Seite als weiter', async () => {
			await oeffneMedien({ status: 401, body: { fehler: 'nicht angemeldet' } });

			expect(router.url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fmedien');
		});

		it('zeigt bei einem Netzfehler den Text mit Knopf und laedt auf Knopfdruck neu', async () => {
			await oeffneMedien('netz');

			expect(text(seite.querySelector('main [role="alert"]') as Element)).toBe('Keine Verbindung – nochmal versuchen');
			seite.querySelector<HTMLButtonElement>('main [role="alert"] ~ button')?.click();
			await antworte('/medien', MEDIEN);

			expect(bloecke()).toHaveLength(2);
		});
	});
});
