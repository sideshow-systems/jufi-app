import { expect, type Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZUSTAND } from './hilfen';
import { keinWaagrechtesScrollen, leisteVerdecktNichts, lesbar, seitenGrund, tippflaechen } from './messen';

/**
 * Layouts gemessen: jede Seite bei 375 x 812 (Handy) und 1280 x 800 (Verwaltung am Desktop), hell und
 * dunkel. Die Sitzungen und Mias ID legt der Ablauf in ZUSTAND ab (Projekt ablauf, von dem dieses
 * abhaengt); gemessen wird also an genau dem Verein, den der Ablauf aufgebaut hat. Alle Daten erfunden.
 *
 * Die Seiten werden nur angesehen, nie veraendert: Jeder Test bekommt einen frischen Kontext mit der
 * gespeicherten Sitzung, und die Reihenfolge der Tests ist egal.
 */

const SLUG = 'musterbach';

type Rolle = 'oeffentlich' | 'leitung' | 'mutter' | 'kind';
/**
 * mitglied: unter der Mitglieder-Huelle mit unterer .leiste (Start, Mehr, Profil, Meine Jungfischer).
 * verwaltung: unter der Verwaltungs-Huelle mit Seitenleiste; dort gibt es keine .leiste.
 */
type Art = 'oeffentlich' | 'mitglied' | 'verwaltung';

interface Seite {
	rolle: Rolle;
	art: Art;
	/** Ohne fuehrenden Schraegstrich unterhalb der Wurzel; mia steht fuer Mias ID aus dem Ablauf. */
	pfad: string;
}

const SEITEN: Seite[] = [
	{ rolle: 'oeffentlich', art: 'oeffentlich', pfad: '' },
	{ rolle: 'oeffentlich', art: 'oeffentlich', pfad: 'impressum' },
	{ rolle: 'oeffentlich', art: 'oeffentlich', pfad: 'datenschutz' },
	{ rolle: 'oeffentlich', art: 'oeffentlich', pfad: `${SLUG}/anmelden` },
	{ rolle: 'leitung', art: 'mitglied', pfad: `${SLUG}/` },
	{ rolle: 'leitung', art: 'mitglied', pfad: `${SLUG}/mehr` },
	{ rolle: 'leitung', art: 'mitglied', pfad: `${SLUG}/profil` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/personen/mia` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/untergruppen` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/rechte` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/einstellungen` },
	{ rolle: 'mutter', art: 'mitglied', pfad: `${SLUG}/` },
	{ rolle: 'mutter', art: 'mitglied', pfad: `${SLUG}/meine-jungfischer` },
	{ rolle: 'kind', art: 'mitglied', pfad: `${SLUG}/` },
];

const GROESSEN = [
	{ name: '375x812', viewport: { width: 375, height: 812 } },
	{ name: '1280x800', viewport: { width: 1280, height: 800 } },
] as const;

const SCHEMATA = ['light', 'dark'] as const;

/** Ohne Sitzung fuer oeffentliche Seiten: Eine Sitzung koennte die Anmeldeseite umleiten. */
function sitzung(rolle: Rolle): string | { cookies: []; origins: [] } {
	return rolle === 'oeffentlich' ? { cookies: [], origins: [] } : join(ZUSTAND, `${rolle}.json`);
}

/**
 * Erst im Test gelesen, nicht beim Laden der Datei: Playwright laedt alle Testdateien schon vor dem
 * ersten Projekt, und dann hat der Ablauf ids.json noch nicht geschrieben.
 */
function adresse(pfad: string): string {
	if (!pfad.includes('/mia')) return `/${pfad}`;
	const ids = JSON.parse(readFileSync(join(ZUSTAND, 'ids.json'), 'utf8')) as { mia: string };
	return `/${pfad.replace('/mia', `/${ids.mia}`)}`;
}

/**
 * Aufrufen und warten, bis die Seite fertig ist: keine Anfrage mehr unterwegs, eine h1 sichtbar, kein
 * Ladehinweis. Die Adresse wird geprueft, weil eine abgelaufene Sitzung sonst still zur Anmeldeseite
 * fuehrte und der Test die falsche Seite vermaesse.
 */
async function oeffne(page: Page, ziel: string): Promise<void> {
	await page.goto(ziel);
	await page.waitForLoadState('networkidle');
	await expect(page).toHaveURL((url) => url.pathname.replace(/\/$/, '') === ziel.replace(/\/$/, ''));
	await expect(page.locator('h1').first()).toBeVisible();
	await expect(page.getByText(/Wird geladen|Lädt/)).toHaveCount(0);
}

for (const groesse of GROESSEN) {
	for (const schema of SCHEMATA) {
		test.describe(`${groesse.name} ${schema}`, () => {
			test.use({ viewport: groesse.viewport, colorScheme: schema });

			for (const seite of SEITEN) {
				test.describe(seite.rolle, () => {
					test.use({ storageState: sitzung(seite.rolle) });

					test(`/${seite.pfad}`, async ({ page }) => {
						await oeffne(page, adresse(seite.pfad));
						const handy = groesse.viewport.width < 768;

						await keinWaagrechtesScrollen(page);
						expect(await lesbar(page), 'Kontrast h1 zu body').toBeGreaterThanOrEqual(4.5);

						if (handy) expect(await tippflaechen(page), 'Tippflaechen unter 44 px').toEqual([]);
						if (seite.art === 'mitglied') await leisteVerdecktNichts(page);

						if (seite.art === 'verwaltung') {
							const seitenleiste = page.locator('aside');
							const menueKnopf = page.getByRole('button', { name: 'Menü öffnen' });
							const navigation = page.getByRole('navigation', { name: 'Verwaltung', includeHidden: true });
							if (handy) {
								await expect(menueKnopf).toBeVisible();
								await expect(navigation).toBeHidden();
							} else {
								await expect(seitenleiste).toBeVisible();
								expect((await seitenleiste.boundingBox())?.width).toBe(248);
								await expect(menueKnopf).toHaveCount(0);
							}
						}

						// Hell gegen dunkel in einem Test statt ueber zwei Laeufe: Die Tests sind voneinander
						// unabhaengig, ein Vergleich ueber Laeufe braeuchte geteilten Zustand und eine Reihenfolge.
						if (schema === 'dark') {
							const dunkel = await seitenGrund(page);
							await page.emulateMedia({ colorScheme: 'light' });
							const hell = await seitenGrund(page);
							await page.emulateMedia({ colorScheme: 'dark' });
							expect(dunkel, 'body-Hintergrund dunkel gleich hell').not.toBe(hell);
						}
					});
				});
			}
		});
	}
}

/**
 * Die Bruchstelle der Verwaltungs-Huelle bei 768 px. In Task 12 verteilte das Grid unter 768 px den
 * Freiraum seiner min-height auf beide Zeilen, und zwischen Menuezeile und Inhalt klaffte eine Luecke
 * von gut 300 px. Gemessen wird deshalb der Abstand, nicht nur die Sichtbarkeit.
 */
test.describe('Verwaltungs-Huelle an der Bruchstelle', () => {
	test.use({ storageState: sitzung('leitung') });

	test.describe('375x812', () => {
		test.use({ viewport: { width: 375, height: 812 } });

		test('Inhalt beginnt direkt unter der Menuezeile', async ({ page }) => {
			await oeffne(page, `/${SLUG}/verwaltung`);
			const { zeileUnten, inhaltOben } = await page.evaluate(() => {
				const aside = document.querySelector('aside');
				const main = document.querySelector('main');
				if (!aside || !main) throw new Error('aside oder main fehlt');
				return { zeileUnten: aside.getBoundingClientRect().bottom, inhaltOben: main.getBoundingClientRect().top };
			});
			const abstand = inhaltOben - zeileUnten;
			expect(abstand, `main beginnt ${abstand} px unter der Menuezeile`).toBeGreaterThanOrEqual(0);
			expect(abstand, `main beginnt ${abstand} px unter der Menuezeile`).toBeLessThanOrEqual(32);
		});
	});

	test.describe('767x800', () => {
		test.use({ viewport: { width: 767, height: 800 } });

		test('Menueknopf statt Seitenleiste', async ({ page }) => {
			await oeffne(page, `/${SLUG}/verwaltung`);
			await expect(page.getByRole('button', { name: 'Menü öffnen' })).toBeVisible();
			await expect(page.getByRole('navigation', { name: 'Verwaltung', includeHidden: true })).toBeHidden();
			// Die Leiste wird zur Kopfzeile ueber die ganze Breite, nicht zur 248 px breiten Spalte.
			expect((await page.locator('aside').boundingBox())?.width).toBe(767);
		});
	});

	test.describe('768x800', () => {
		test.use({ viewport: { width: 768, height: 800 } });

		test('Seitenleiste ohne Menueknopf', async ({ page }) => {
			await oeffne(page, `/${SLUG}/verwaltung`);
			await expect(page.getByRole('button', { name: /Menü/ })).toHaveCount(0);
			await expect(page.getByRole('navigation', { name: 'Verwaltung' })).toBeVisible();
			expect((await page.locator('aside').boundingBox())?.width).toBe(248);
		});
	});
});

/**
 * Einstellungsseite: Datei-Feld, Farbzeile und das nur lesbare Adressfeld bleiben in ihrer Karte, und
 * das Adressfeld sieht nicht aus wie ein Feld, in das man tippen kann.
 */
test.describe('Vereinseinstellungen', () => {
	test.use({ storageState: sitzung('leitung') });

	for (const groesse of GROESSEN) {
		for (const schema of SCHEMATA) {
			test.describe(`${groesse.name} ${schema}`, () => {
				test.use({ viewport: groesse.viewport, colorScheme: schema });

				test('Felder bleiben in der Karte, die Adresse ist als nur lesbar erkennbar', async ({ page }) => {
					await oeffne(page, `/${SLUG}/verwaltung/einstellungen`);
					// Zuerst die ganze Seite: Ist eine Karte selbst zu breit, bestuenden die Felder darin den
					// Vergleich mit ihr trotzdem (so geschehen mit dem Datei-Feld bei 375 px).
					await keinWaagrechtesScrollen(page);
					const datei = page.getByLabel('Neues Logo wählen');
					const adressfeld = page.getByLabel('Adresse');
					const anzeigename = page.getByLabel('Anzeigename');
					const farbzeile = page.locator('form[aria-label="Vereinsfarbe"] .farbe');

					for (const [name, ort] of [
						['Datei-Feld', datei],
						['Farbzeile', farbzeile],
						['Adressfeld', adressfeld],
					] as const) {
						const m = await ort.evaluate((el) => {
							const karte = el.closest('jf-karte');
							if (!karte) throw new Error('nicht in einer Karte');
							const r = el.getBoundingClientRect();
							const k = karte.getBoundingClientRect();
							const stil = getComputedStyle(karte);
							return {
								links: r.left,
								rechts: r.right,
								innenLinks: k.left + parseFloat(stil.borderLeftWidth) + parseFloat(stil.paddingLeft),
								innenRechts: k.right - parseFloat(stil.borderRightWidth) - parseFloat(stil.paddingRight),
								scrollBreite: el.scrollWidth,
								breite: el.clientWidth,
							};
						});
						// Halbe Pixel aus gebrochenen Breiten sind kein Ueberlauf.
						expect(m.rechts, `${name} ragt rechts aus der Karte`).toBeLessThanOrEqual(m.innenRechts + 0.5);
						expect(m.links, `${name} ragt links aus der Karte`).toBeGreaterThanOrEqual(m.innenLinks - 0.5);
						expect(m.scrollBreite, `${name} laeuft in sich ueber`).toBeLessThanOrEqual(m.breite);
					}

					await expect(adressfeld).not.toBeEditable();
					await expect(anzeigename).toBeEditable();
					const stil = (el: Element) => {
						const s = getComputedStyle(el);
						return { grund: s.backgroundColor, rand: s.borderTopColor };
					};
					const fest = await adressfeld.evaluate(stil);
					const offen = await anzeigename.evaluate(stil);
					expect(fest.grund, 'Adressfeld mit Hintergrund eines bearbeitbaren Felds').not.toBe(offen.grund);
					expect(fest.rand, 'Adressfeld mit Rahmen eines bearbeitbaren Felds').not.toBe(offen.rand);

					if (groesse.viewport.width < 768) {
						const hoehe = (await datei.boundingBox())?.height ?? 0;
						expect(hoehe, 'Datei-Feld als Tippflaeche').toBeGreaterThanOrEqual(44);
					}
				});
			});
		}
	}
});
