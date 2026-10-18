import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { adminTestAnbieter, tippe } from '../../admin/test-hilfen';
import type { PersonListe } from '../mitglieder-api';
import { hake, ichMit, oeffneSeite, stabil, waehle } from './test-hilfen';

const GRUPPEN = {
	untergruppen: [
		{ id: 'u1', name: 'Gruppe A', mitglieder: 1 },
		{ id: 'u2', name: 'Gruppe B', mitglieder: 1 },
	],
};

const PERSONEN: PersonListe[] = [
	{
		id: 'k1',
		art: 'JUNGFISCHER',
		vorname: 'Lena',
		nachname: 'Muster',
		untergruppen: [{ id: 'u1', name: 'Gruppe A' }],
		warnhinweise: [{ art: 'OHNE_FAMILIE' }, { art: 'EINWILLIGUNG_FEHLT' }],
	},
	{
		id: 'k2',
		art: 'JUNGFISCHER',
		vorname: 'Jonas',
		nachname: 'Beispiel',
		untergruppen: [{ id: 'u2', name: 'Gruppe B' }],
		warnhinweise: [],
	},
	{
		id: 'e1',
		art: 'ERWACHSENER',
		vorname: 'Anna',
		nachname: 'Muster',
		email: 'anna@example.org',
		untergruppen: [],
		warnhinweise: [{ art: 'EINLADUNG_OFFEN', ablauf: '2026-11-01T10:00:00.000Z' }, { art: 'MAIL_NICHT_ZUGESTELLT' }],
	},
	{
		id: 'k3',
		art: 'JUNGFISCHER',
		vorname: 'Max',
		nachname: 'Alt',
		untergruppen: [],
		warnhinweise: [{ art: 'VOLLJAEHRIG', seit: '2026-09-01T00:00:00.000Z' }],
	},
];

describe('Mitgliederliste', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));

	async function oeffne(rechte: string[], personen = PERSONEN) {
		const r = await oeffneSeite('/demo/verwaltung', ichMit(rechte), [
			['/personen', { personen }],
			['/untergruppen', GRUPPEN],
		]);
		return {
			...r,
			namen: () => [...r.seite.querySelectorAll('[data-person] a.name')].map((a) => a.textContent?.trim()),
		};
	}

	afterEach(() => TestBed.inject(HttpTestingController).verify());

	it('Liste filtert nach Suche, Art, Untergruppe und Warnhinweis', async () => {
		const { harness, seite, namen } = await oeffne(['MITGLIEDER']);
		expect(namen()).toEqual(['Lena Muster', 'Jonas Beispiel', 'Anna Muster', 'Max Alt']);

		tippe(seite, 'input[name="suche"]', 'muster');
		await stabil(harness);
		expect(namen()).toEqual(['Lena Muster', 'Anna Muster']);

		waehle(seite, 'select[name="art"]', 'ERWACHSENER');
		await stabil(harness);
		expect(namen()).toEqual(['Anna Muster']);

		waehle(seite, 'select[name="art"]', 'alle');
		tippe(seite, 'input[name="suche"]', '');
		waehle(seite, 'select[name="untergruppe"]', 'u2');
		await stabil(harness);
		expect(namen()).toEqual(['Jonas Beispiel']);

		waehle(seite, 'select[name="untergruppe"]', '');
		hake(seite, 'input[name="nurHinweise"]');
		await stabil(harness);
		expect(namen()).toEqual(['Lena Muster', 'Anna Muster', 'Max Alt']);
	});

	it('zeigt die Warnhinweise im Wortlaut der Spec', async () => {
		const { seite } = await oeffne(['MITGLIEDER']);
		const text = seite.textContent ?? '';
		expect(text).toContain('Ohne erziehungsberechtigte Familie');
		expect(text).toContain('Einwilligung fehlt');
		expect(text).toContain('Einladung offen, läuft am 01.11.2026 ab');
		expect(text).toContain('Einladungsmail nicht zustellbar');
		expect(text).toContain('Volljährig seit 01.09.2026');
	});

	it('Verwaltung sieht E-Mail-Spalte und den Knopf zum Anlegen', async () => {
		const { seite } = await oeffne(['MITGLIEDER']);
		expect(seite.textContent).toContain('anna@example.org');
		expect(seite.querySelector('a[href="/demo/verwaltung/neu"]')).toBeTruthy();
	});

	// Untergruppen und Rechte stehen jetzt in der Seitenleiste der Huelle (huelle.spec.ts), die Seite hat nur noch den Knopf zum Anlegen.
	it('hat in der Seite nur den Knopf zum Anlegen, keine Links zu Startseite, Untergruppen und Rechten', async () => {
		const { seite } = await oeffne(['MITGLIEDER', 'JUGENDLEITER_RECHTE']);
		const ziele = [...seite.querySelectorAll('jf-mitglieder .leiste a')].map((a) => a.getAttribute('href'));
		expect(ziele).toEqual(['/demo/verwaltung/neu']);
		expect(seite.querySelector('jf-mitglieder')?.textContent).not.toContain('Zur Startseite');
	});

	it('Verwaltung ohne JUGENDLEITER_RECHTE sieht den Rechte-Link nicht', async () => {
		const { seite } = await oeffne(['MITGLIEDER']);
		expect(seite.querySelector('a[href="/demo/verwaltung/rechte"]')).toBeNull();
		expect(seite.querySelector('a[href="/demo/verwaltung/untergruppen"]')).not.toBeNull();
	});

	it('Betreuer sieht keine E-Mail-Spalte und keine Bearbeiten-Knöpfe', async () => {
		const ohneMail = PERSONEN.map(({ email: _e, ...rest }) => rest);
		const { seite } = await oeffne(['ANTWORTEN_DETAIL'], ohneMail);
		expect(seite.textContent).not.toContain('E-Mail');
		expect(seite.querySelector('a[href="/demo/verwaltung/neu"]')).toBeNull();
		expect(seite.textContent).toContain('Lena Muster');
	});
});
