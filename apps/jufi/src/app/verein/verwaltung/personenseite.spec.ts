import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { adminTestAnbieter, knopf, tippe } from '../../admin/test-hilfen';
import type { PersonDetail } from '../mitglieder-api';
import { API, hake, ichMit, oeffneSeite, stabil, waehle } from './test-hilfen';

const GRUPPEN = {
	untergruppen: [
		{ id: 'u1', name: 'Gruppe A', mitglieder: 1 },
		{ id: 'u2', name: 'Gruppe B', mitglieder: 0 },
	],
};
const ERWACHSENE = {
	personen: [
		{ id: 'e1', art: 'ERWACHSENER', vorname: 'Anna', nachname: 'Muster' },
		{ id: 'e2', art: 'ERWACHSENER', vorname: 'Rosa', nachname: 'Muster' },
		{ id: 'k1', art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Muster' },
	],
};

function kind(zusatz: Partial<PersonDetail> = {}): PersonDetail {
	return {
		id: 'k1',
		art: 'JUNGFISCHER',
		vorname: 'Lena',
		nachname: 'Muster',
		geburtsdatum: '2015-05-01',
		jugendsprecher: false,
		rechte: [],
		untergruppen: [{ id: 'u1', name: 'Gruppe A' }],
		warnhinweise: [],
		familie: [
			{
				erwachsenerId: 'e1',
				jungfischerId: 'k1',
				vorname: 'Anna',
				nachname: 'Muster',
				beziehung: 'MUTTER',
				beziehungFreitext: null,
				erziehungsberechtigt: true,
			},
		],
		einladung: { offen: false, ablauf: null, mailNichtZugestellt: false },
		zugang: { vorhanden: false, letzteAnmeldungAm: null, erlaubt: true },
		...zusatz,
	};
}

describe('Personenseite', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	/** Verwaltung: Person, dazu fuer Jungfischer die Auswahlen (Untergruppen, Erwachsene). */
	async function oeffneVerwaltung(person: PersonDetail, rechte = ['MITGLIEDER'], ichId = 'ich-1') {
		const hilfen: [string, object][] =
			person.art === 'JUNGFISCHER'
				? [
						['/untergruppen', GRUPPEN],
						['/personen', ERWACHSENE],
					]
				: [];
		return oeffneSeite(`/demo/verwaltung/personen/${person.id}`, ichMit(rechte, ichId), [
			[`/personen/${person.id}`, person],
			...hilfen,
		]);
	}

	/** Beantwortet das Neuladen der Person nach einer Aktion. */
	async function neuGeladen(http: HttpTestingController, harness: Parameters<typeof stabil>[0], person: PersonDetail) {
		await vi.waitFor(() => http.expectOne(`${API}/personen/${person.id}`).flush(person));
		await stabil(harness);
	}

	it('zeigt Stammdaten, Familie, Hinweise und Zugang', async () => {
		const { seite } = await oeffneVerwaltung(kind({ warnhinweise: [{ art: 'EINWILLIGUNG_FEHLT' }] }));
		const text = seite.textContent ?? '';
		expect(text).toContain('Lena Muster');
		expect(text).toContain('Einwilligung fehlt');
		expect(text).toContain('Anna Muster');
		expect(text).toContain('Mutter');
		expect(text).toContain('erziehungsberechtigt');
		expect(text).toContain('Noch nicht eingerichtet');
		expect((seite.querySelector('input[name="vorname"]') as HTMLInputElement).value).toBe('Lena');
	});

	it('Betreuer sieht die Person ohne Bearbeiten-Knöpfe und ohne Zugangsstand', async () => {
		const gelesen = kind({ einladung: undefined, zugang: undefined, warnhinweise: [{ art: 'OHNE_FAMILIE' }] });
		const { seite } = await oeffneSeite('/demo/verwaltung/personen/k1', ichMit(['ANTWORTEN_DETAIL']), [
			['/personen/k1', gelesen],
		]);
		expect(seite.textContent).toContain('Lena Muster');
		expect(seite.textContent).toContain('Ohne erziehungsberechtigte Familie');
		expect(seite.querySelectorAll('button').length).toBe(0);
		expect(seite.querySelector('input')).toBeNull();
		expect(seite.textContent).not.toContain('Zugang');
	});

	it('speichert nur geänderte Stammdaten samt Jugendsprecher-Häkchen', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		tippe(seite, 'input[name="nachname"]', 'Beispiel');
		hake(seite, 'input[name="jugendsprecher"]');
		knopf(seite, 'Speichern').click();
		const anfrage = http.expectOne(`${API}/personen/k1`);
		expect(anfrage.request.method).toBe('PATCH');
		expect(anfrage.request.body).toEqual({ nachname: 'Beispiel', jugendsprecher: true });
		anfrage.flush({ ok: true });
		await neuGeladen(http, harness, kind({ nachname: 'Beispiel', jugendsprecher: true }));
		expect(seite.textContent).toContain('Gespeichert');
	});

	it('E-Mail mit Zugang ist festgestellt und wird nicht gesendet', async () => {
		const erw: PersonDetail = {
			id: 'e1',
			art: 'ERWACHSENER',
			vorname: 'Anna',
			nachname: 'Muster',
			rechte: [],
			email: 'anna@example.org',
			untergruppen: [],
			warnhinweise: [],
			familie: [],
			einladung: { offen: false, ablauf: null, mailNichtZugestellt: false },
			zugang: { vorhanden: true, letzteAnmeldungAm: '2026-10-01T08:00:00.000Z', erlaubt: true },
		};
		const { seite } = await oeffneVerwaltung(erw);
		expect((seite.querySelector('input[name="email"]') as HTMLInputElement).disabled).toBe(true);
		expect(seite.textContent).toContain('lässt sich nicht mehr ändern');
		expect(seite.textContent).toContain('zuletzt angemeldet am 01.10.2026 10:00 Uhr');
	});

	it('speichert die Untergruppen als Ganzes', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		hake(seite, 'input[name="untergruppe-u2"]');
		knopf(seite, 'Untergruppen speichern').click();
		const anfrage = http.expectOne(`${API}/personen/k1/untergruppen`);
		expect(anfrage.request.body).toEqual({ untergruppenIds: ['u1', 'u2'] });
		anfrage.flush({ untergruppenIds: ['u1', 'u2'] });
		await neuGeladen(http, harness, kind());
	});

	it('Familie hinzufügen belegt erziehungsberechtigt bei Mutter vor, bei Großmutter nicht', async () => {
		const { harness, seite } = await oeffneVerwaltung(kind());
		const haken = () => (seite.querySelector('input[name="erziehungsberechtigt"]') as HTMLInputElement).checked;
		waehle(seite, 'select[name="beziehung"]', 'MUTTER');
		await stabil(harness);
		expect(haken()).toBe(true);
		waehle(seite, 'select[name="beziehung"]', 'GROSSMUTTER');
		await stabil(harness);
		expect(haken()).toBe(false);
	});

	it('Familie hinzufügen: vorhandene Person wählen, Anna ist schon zugeordnet und fehlt', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		const optionen = [...seite.querySelectorAll('select[name="erwachsener"] option')].map((o) => o.textContent?.trim());
		expect(optionen).toEqual(['Bitte wählen', 'Rosa Muster']);
		waehle(seite, 'select[name="erwachsener"]', 'e2');
		waehle(seite, 'select[name="beziehung"]', 'GROSSMUTTER');
		await stabil(harness);
		knopf(seite, 'Zur Familie hinzufügen').click();
		const anfrage = http.expectOne(`${API}/personen/k1/familie/e2`);
		expect(anfrage.request.method).toBe('PUT');
		expect(anfrage.request.body).toEqual({ beziehung: 'GROSSMUTTER', erziehungsberechtigt: false });
		anfrage.flush({ erziehungsberechtigt: false });
		await neuGeladen(http, harness, kind());
		await vi.waitFor(() => http.expectOne(`${API}/personen`).flush(ERWACHSENE));
	});

	it('Familie hinzufügen: neue Person wird zuerst angelegt, dann zugeordnet', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		hake(seite, 'input[name="modus"][value="neu"]');
		await stabil(harness);
		tippe(seite, 'input[name="neuVorname"]', 'Hans');
		tippe(seite, 'input[name="neuNachname"]', 'Muster');
		waehle(seite, 'select[name="beziehung"]', 'ANDERE');
		await stabil(harness);
		tippe(seite, 'input[name="freitext"]', 'Opa');
		knopf(seite, 'Zur Familie hinzufügen').click();
		const anlage = http.expectOne(`${API}/personen`);
		expect(anlage.request.body).toEqual({ art: 'ERWACHSENER', vorname: 'Hans', nachname: 'Muster' });
		anlage.flush({ id: 'e9' }, { status: 201, statusText: 'Created' });
		const zuordnung = await vi.waitFor(() => http.expectOne(`${API}/personen/k1/familie/e9`));
		expect(zuordnung.request.body).toEqual({
			beziehung: 'ANDERE',
			beziehungFreitext: 'Opa',
			erziehungsberechtigt: false,
		});
		zuordnung.flush({ erziehungsberechtigt: false });
		await neuGeladen(http, harness, kind());
		await vi.waitFor(() => http.expectOne(`${API}/personen`).flush(ERWACHSENE));
	});

	it('Zuordnung lösen fragt erst nach', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		knopf(seite, 'Zuordnung lösen').click();
		await stabil(harness);
		http.expectNone(`${API}/personen/k1/familie/e1`);
		expect(seite.querySelector('[role="alertdialog"]')?.textContent).toContain('Anna Muster');
		knopf(seite, 'Ja, lösen').click();
		const anfrage = http.expectOne(`${API}/personen/k1/familie/e1`);
		expect(anfrage.request.method).toBe('DELETE');
		anfrage.flush(null, { status: 204, statusText: 'No Content' });
		await neuGeladen(http, harness, kind({ familie: [] }));
		expect(seite.textContent).toContain('Noch niemand zugeordnet');
	});

	it('Entfernen fragt nach und zeigt danach das Folgeangebot', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		knopf(seite, 'Aus der Gruppe entfernen').click();
		await stabil(harness);
		http.expectNone(`${API}/personen/k1`);
		expect(seite.querySelector('[role="alertdialog"]')?.textContent).toContain(
			'Lena Muster wirklich aus der Gruppe entfernen',
		);
		knopf(seite, 'Ja, entfernen').click();
		const anfrage = http.expectOne(`${API}/personen/k1`);
		expect(anfrage.request.method).toBe('DELETE');
		anfrage.flush({ folgeangebot: [{ id: 'e1', vorname: 'Hans', nachname: 'Muster' }] });
		await stabil(harness);
		expect(seite.textContent).toContain('Lena Muster wurde entfernt');
		expect(seite.textContent).toContain('Hans Muster hat keine Jungfischer mehr in der Gruppe – auch entfernen?');
		knopf(seite, 'Auch entfernen').click();
		const folge = http.expectOne(`${API}/personen/e1`);
		expect(folge.request.method).toBe('DELETE');
		folge.flush({ folgeangebot: [] });
		await stabil(harness);
		expect(seite.textContent).not.toContain('auch entfernen?');
	});

	it('die eigene Person lässt sich nicht entfernen', async () => {
		const ich: PersonDetail = { ...kind(), id: 'ich-1', art: 'ERWACHSENER', familie: [], untergruppen: [] };
		const { seite } = await oeffneVerwaltung(ich);
		expect(() => knopf(seite, 'Aus der Gruppe entfernen')).toThrow();
	});

	it('Einladen erzeugt den Text mit Ablauf aus der Serverantwort', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		knopf(seite, 'Einladung erzeugen').click();
		const anfrage = http.expectOne(`${API}/personen/k1/einladung`);
		expect(anfrage.request.body).toEqual({ mail: false });
		anfrage.flush(
			{
				link: 'https://x.example/demo/einladung?t=abc',
				text: 'Hallo Lena, dein Link',
				ablauf: '2026-11-01T00:00:00.000Z',
			},
			{ status: 201, statusText: 'Created' },
		);
		await neuGeladen(http, harness, kind());
		expect(seite.textContent).toContain('Hallo Lena, dein Link');
		expect(seite.textContent).toContain('Der Link gilt bis 01.11.2026, 01:00 Uhr');
	});

	it('Per Mail senden gibt es nur mit Adresse und sendet mail:true', async () => {
		const ohne = await oeffneVerwaltung(kind());
		expect(() => knopf(ohne.seite, 'Per Mail senden')).toThrow();
	});

	it('Per Mail senden sendet mail:true', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind({ email: 'lena@example.org' }));
		knopf(seite, 'Per Mail senden').click();
		const anfrage = http.expectOne(`${API}/personen/k1/einladung`);
		expect(anfrage.request.body).toEqual({ mail: true });
		anfrage.flush(
			{ link: 'l', text: 'Text', ablauf: '2026-11-01T00:00:00.000Z' },
			{ status: 201, statusText: 'Created' },
		);
		await neuGeladen(http, harness, kind({ email: 'lena@example.org' }));
	});

	it('Einladen-Knopf nennt den Grund bei 409 EINWILLIGUNG_FEHLT', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		knopf(seite, 'Einladung erzeugen').click();
		http
			.expectOne(`${API}/personen/k1/einladung`)
			.flush(
				{ fehler: 'Die Einwilligung einer erziehungsberechtigten Person fehlt noch', code: 'EINWILLIGUNG_FEHLT' },
				{ status: 409, statusText: 'Conflict' },
			);
		await stabil(harness);
		const alarm = seite.querySelector('[role="alert"]')?.textContent ?? '';
		expect(alarm).toContain('Es fehlt die Einwilligung einer erziehungsberechtigten Person');
		expect(seite.textContent).not.toContain('Einladungstext');
	});

	it('Einladen nennt den Grund bei 409 ZUGANG_NICHT_ERLAUBT', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		knopf(seite, 'Einladung erzeugen').click();
		http
			.expectOne(`${API}/personen/k1/einladung`)
			.flush({ fehler: 'x', code: 'ZUGANG_NICHT_ERLAUBT' }, { status: 409, statusText: 'Conflict' });
		await stabil(harness);
		expect(seite.querySelector('[role="alert"]')?.textContent).toContain('nicht erlaubt');
	});

	it('Doppelklick auf Einladen sendet nur eine Anfrage', async () => {
		const { seite, http } = await oeffneVerwaltung(kind());
		const k = knopf(seite, 'Einladung erzeugen');
		k.click();
		k.click();
		const anfragen = http.match(`${API}/personen/k1/einladung`);
		expect(anfragen.length).toBe(1);
		anfragen[0].flush(
			{ link: 'l', text: 'T', ablauf: '2026-11-01T00:00:00.000Z' },
			{ status: 201, statusText: 'Created' },
		);
		await vi.waitFor(() => http.expectOne(`${API}/personen/k1`).flush(kind()));
	});

	it('Entfernen räumt den angezeigten Link weg', async () => {
		const { harness, seite, http } = await oeffneVerwaltung(kind());
		knopf(seite, 'Einladung erzeugen').click();
		http
			.expectOne(`${API}/personen/k1/einladung`)
			.flush(
				{ link: 'l', text: 'Hallo Lena, dein Link', ablauf: '2026-11-01T00:00:00.000Z' },
				{ status: 201, statusText: 'Created' },
			);
		await neuGeladen(http, harness, kind());
		expect(seite.textContent).toContain('dein Link');
		knopf(seite, 'Aus der Gruppe entfernen').click();
		await stabil(harness);
		knopf(seite, 'Ja, entfernen').click();
		http.expectOne(`${API}/personen/k1`).flush({ folgeangebot: [] });
		await stabil(harness);
		expect(seite.textContent).not.toContain('dein Link');
	});

	it('Volljährigkeitshinweis bietet die drei Wege', async () => {
		const volljaehrig = kind({ warnhinweise: [{ art: 'VOLLJAEHRIG', seit: '2026-09-01T00:00:00.000Z' }] });
		const { harness, seite, http } = await oeffneVerwaltung(volljaehrig);
		const feld = seite.querySelector('[data-volljaehrig]') as HTMLElement;
		expect(feld.textContent).toContain('Lena ist seit dem 01.09.2026 volljährig');
		expect(knopf(feld, 'Belassen')).toBeTruthy();
		expect(knopf(feld, 'Familie lösen')).toBeTruthy();
		expect(knopf(feld, 'Aus der Gruppe entfernen')).toBeTruthy();

		knopf(feld, 'Belassen').click();
		const anfrage = http.expectOne(`${API}/personen/k1/volljaehrig-belassen`);
		expect(anfrage.request.method).toBe('POST');
		anfrage.flush({ ok: true });
		await neuGeladen(http, harness, kind());
		expect(seite.querySelector('[data-volljaehrig]')).toBeNull();
	});

	it('Familie lösen im Volljährigkeitshinweis löst alle Zuordnungen nach Rückfrage', async () => {
		const volljaehrig = kind({ warnhinweise: [{ art: 'VOLLJAEHRIG', seit: '2026-09-01T00:00:00.000Z' }] });
		const { harness, seite, http } = await oeffneVerwaltung(volljaehrig);
		knopf(seite.querySelector('[data-volljaehrig]') as HTMLElement, 'Familie lösen').click();
		await stabil(harness);
		knopf(seite, 'Ja, alle lösen').click();
		await vi.waitFor(() =>
			http.expectOne(`${API}/personen/k1/familie/e1`).flush(null, { status: 204, statusText: 'No Content' }),
		);
		await neuGeladen(http, harness, kind({ familie: [] }));
	});
});
