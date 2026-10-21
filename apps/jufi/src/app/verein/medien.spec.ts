import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { DokumenteAntwort, DokumentAnsicht } from '@jufi/domain';
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

	/** Beantwortet die Dokumenteanfrage; der Effekt der Ressource schickt sie erst im naechsten Durchlauf. */
	async function antworte(antwort: DokumenteAntwort | { status: number; body: object } | 'netz'): Promise<void> {
		await vi.waitFor(() => {
			harness.detectChanges();
			const anfrage = http.expectOne(`${API}/dokumente`);
			if (antwort === 'netz') anfrage.error(new ProgressEvent('error'));
			else if ('status' in antwort) anfrage.flush(antwort.body, { status: antwort.status, statusText: 'Fehler' });
			else anfrage.flush(antwort);
		});
		await stabil();
	}

	async function oeffne(
		antwort: DokumenteAntwort | { status: number; body: object } | 'netz' = ANTWORT,
	): Promise<void> {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/medien');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		http.expectOne(`${API}/verein`).flush(VEREIN);
		await antworte(antwort);
	}

	const kategorien = () => [...seite.querySelectorAll<HTMLElement>('main section')];
	const zeilen = () => [...seite.querySelectorAll<HTMLAnchorElement>('main li a')];

	it('hat die Ueberschrift Medien und zeigt keine Reiterleiste', async () => {
		await oeffne();

		expect(text(seite.querySelector('main h1') as Element)).toBe('Medien');
		expect(seite.querySelector('[role="tablist"]')).toBeNull();
	});

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
		expect(text(zeilen()[1].querySelector('.zusatz') as Element)).toBe('Word · 0,0 MB');
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

		expect(router.url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fmedien');
	});

	it('zeigt bei einem Netzfehler den Text mit Knopf und laedt auf Knopfdruck neu', async () => {
		await oeffne('netz');

		expect(text(seite.querySelector('main [role="alert"]') as Element)).toBe('Keine Verbindung – nochmal versuchen');
		seite.querySelector<HTMLButtonElement>('main button')?.click();
		await antworte(ANTWORT);

		expect(kategorien()).toHaveLength(2);
	});
});
