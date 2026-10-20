import { expect, type Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZUSTAND } from './hilfen';
import {
	abstandUnterKopf,
	keinWaagrechtesScrollen,
	leisteVerdecktNichts,
	lesbar,
	verlaufUeberLeiste,
	seitenGrund,
	tippflaechen,
} from './messen';

/**
 * Layouts gemessen: jede Seite bei 375 x 812 (Handy) und 1280 x 800 (Verwaltung am Desktop), hell und
 * dunkel. Die Sitzungen und die IDs (Mia, Bowling, Austausch) legt der Ablauf in ZUSTAND ab (Projekt ablauf, von dem dieses
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
	/**
	 * Ohne fuehrenden Schraegstrich unterhalb der Wurzel; die Platzhalter :mia, :bowling, :bowlingId und
	 * :austausch stehen fuer die IDs und Thread-Segmente aus dem Ablauf. Eine Abfrage (?reiter=verlauf) gehoert zum Pfad.
	 */
	pfad: string;
	/** Die Seite zeigt den Verlauf mit festem Eingabefeld; gemessen wird, dass es nichts verdeckt und nichts davon verdeckt wird. */
	verlauf?: true;
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
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/personen/:mia` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/untergruppen` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/rechte` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/einstellungen` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/threads` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/threads/neu` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/threads/:bowlingId` },
	{ rolle: 'leitung', art: 'verwaltung', pfad: `${SLUG}/verwaltung/threads/:bowlingId/antworten` },
	{ rolle: 'mutter', art: 'mitglied', pfad: `${SLUG}/` },
	{ rolle: 'mutter', art: 'mitglied', pfad: `${SLUG}/meine-jungfischer` },
	{ rolle: 'kind', art: 'mitglied', pfad: `${SLUG}/` },
	{ rolle: 'mutter', art: 'mitglied', pfad: `${SLUG}/t/:bowling` },
	{ rolle: 'kind', art: 'mitglied', pfad: `${SLUG}/t/:bowling` },
	{ rolle: 'mutter', art: 'mitglied', pfad: `${SLUG}/t/:bowling?reiter=verlauf`, verlauf: true },
	{ rolle: 'leitung', art: 'mitglied', pfad: `${SLUG}/t/:austausch?reiter=verlauf`, verlauf: true },
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

const PLATZHALTER: readonly string[] = [':mia', ':bowling', ':bowlingId', ':austausch'];

/**
 * Erst im Test gelesen, nicht beim Laden der Datei: Playwright laedt alle Testdateien schon vor dem
 * ersten Projekt, und dann hat der Ablauf ids.json noch nicht geschrieben.
 */
function adresse(pfad: string): string {
	// Platzhalter mit Doppelpunkt wie in den Routen: Sie koennen in keinem echten Pfadteil vorkommen,
	// anders als ein Teilstring wie /mia, der auch in /miami traefe. Ersetzt wird der ganze Platzhalter
	// bis zum naechsten Nicht-Buchstaben: Mit includes und replace je Eintrag traefe :bowling auch den
	// Anfang von :bowlingId und hinterliesse "<segment>Id", eine ID, die es nicht gibt.
	const gesucht = pfad.match(/:[A-Za-z]+/g) ?? [];
	if (gesucht.length === 0) return `/${pfad}`;
	const ids = JSON.parse(readFileSync(join(ZUSTAND, 'ids.json'), 'utf8')) as Record<string, string>;
	return `/${pfad.replace(/:[A-Za-z]+/g, (platzhalter) => {
		const id = PLATZHALTER.includes(platzhalter) ? ids[platzhalter.slice(1)] : undefined;
		if (!id) throw new Error(`ids.json kennt ${platzhalter} nicht, lief der Ablauf?`);
		return id;
	})}`;
}

/**
 * Aufrufen und warten, bis die Seite fertig ist: keine Anfrage mehr unterwegs, eine h1 sichtbar, kein
 * Ladehinweis. Die Adresse wird geprueft, weil eine abgelaufene Sitzung sonst still zur Anmeldeseite
 * fuehrte und der Test die falsche Seite vermaesse.
 */
async function oeffne(page: Page, ziel: string): Promise<void> {
	await page.goto(ziel);
	await page.waitForLoadState('networkidle');
	// Nur der Pfad: Die Abfrage (?reiter=verlauf) gehoert zum Ziel, die Seite darf sie behalten.
	const pfad = ziel.split('?')[0];
	await expect(page).toHaveURL((url) => url.pathname.replace(/\/$/, '') === pfad.replace(/\/$/, ''));
	await expect(page.locator('h1').first()).toBeVisible();
	await expect(page.getByText(/Wird geladen|Lädt/)).toHaveCount(0);
	// Eine falsche ID ergibt eine Seite mit h1 und ohne Ladehinweis, aber nicht die gemeinte: Ohne diese
	// Pruefung vermaesse der Test still die Karte "Nicht gefunden" (so geschehen mit :bowling in :bowlingId).
	await expect(page.getByRole('heading', { name: 'Nicht gefunden oder keine Berechtigung' })).toHaveCount(0);
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
						if (seite.verlauf) await verlaufUeberLeiste(page);

						if (seite.art === 'verwaltung') {
							const seitenleiste = page.locator('aside');
							const menueKnopf = page.getByRole('button', { name: 'Menü öffnen' });
							const navigation = page.getByRole('navigation', { name: 'Verwaltung', includeHidden: true });
							if (handy) {
								await expect(menueKnopf).toBeVisible();
								// toBeHidden bestuende auch ohne Navigation; erst muss es sie geben.
								await expect(navigation).toHaveCount(1);
								await expect(navigation).toBeHidden();
								const abstand = await abstandUnterKopf(page);
								expect(abstand, `main beginnt ${abstand} px unter der Menuezeile`).toBeGreaterThanOrEqual(0);
								expect(abstand, `main beginnt ${abstand} px unter der Menuezeile`).toBeLessThanOrEqual(32);
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
 * von gut 300 px. Den Abstand misst der Seitentest bei 375 auf jeder Verwaltungsseite (abstandUnterKopf),
 * hier stehen das Umschalten an der Grenze und das offene Menue.
 */
test.describe('Verwaltungs-Huelle an der Bruchstelle', () => {
	test.use({ storageState: sitzung('leitung') });

	test.describe('375x812', () => {
		test.use({ viewport: { width: 375, height: 812 } });

		// Der Abstand unter der Menuezeile steht im Seitentest, gemessen auf jeder Verwaltungsseite.
		// Hier das aufgeklappte Menue: Am Handy ist es der einzige Weg durch die Verwaltung, und
		// geschlossen ueberspringt tippflaechen seine Links.
		test('aufgeklapptes Menue', async ({ page }) => {
			await oeffne(page, `/${SLUG}/verwaltung/untergruppen`);
			await page.getByRole('button', { name: 'Menü öffnen' }).click();
			const navigation = page.getByRole('navigation', { name: 'Verwaltung' });
			await expect(navigation).toBeVisible();
			// Fuenf Punkte der Verwaltung (seit TP3 mit Threads) und der Weg zurueck in die App.
			await expect(navigation.getByRole('link')).toHaveCount(6);
			await expect(page.getByRole('button', { name: 'Menü schließen' })).toBeVisible();
			expect(await tippflaechen(page), 'Tippflaechen unter 44 px').toEqual([]);
			await keinWaagrechtesScrollen(page);
		});
	});

	test.describe('767x800', () => {
		test.use({ viewport: { width: 767, height: 800 } });

		test('Menueknopf statt Seitenleiste', async ({ page }) => {
			await oeffne(page, `/${SLUG}/verwaltung`);
			await expect(page.getByRole('button', { name: 'Menü öffnen' })).toBeVisible();
			const navigation = page.getByRole('navigation', { name: 'Verwaltung', includeHidden: true });
			await expect(navigation).toHaveCount(1);
			await expect(navigation).toBeHidden();
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

/**
 * Der Thread-Editor (Spec 6.6): ab 1024 px Formular und Vorschau nebeneinander, darunter ein Umschalter
 * und nur eines von beiden. Der Seitentest oben misst den Editor so, wie er geladen wird, also ohne
 * gewaehltes Modul; hier kommen die Felder jedes Moduls und die Vorschau am Handy dazu. Waehlen und
 * Umschalten aendern nichts am Thread, die Seite bleibt nur angesehen.
 */
test.describe('Thread-Editor', () => {
	test.use({ storageState: sitzung('leitung') });

	for (const groesse of GROESSEN) {
		for (const schema of SCHEMATA) {
			test.describe(`${groesse.name} ${schema}`, () => {
				test.use({ viewport: groesse.viewport, colorScheme: schema });

				test('Formular und Vorschau, jedes Modul ohne waagrechtes Scrollen', async ({ page }) => {
					await oeffne(page, adresse(`${SLUG}/verwaltung/threads/:bowlingId`));
					const handy = groesse.viewport.width < 768;
					const formular = page.getByRole('group', { name: 'Thread', exact: true });
					const vorschau = page.getByRole('region', { name: 'Vorschau am Handy' });
					const umschalter = page.getByRole('group', { name: 'Ansicht' });

					/** Nach jedem Schritt dasselbe: nichts ragt hinaus, und am Handy ist jede Tippflaeche gross genug. */
					const pruefe = async (wo: string) => {
						await keinWaagrechtesScrollen(page);
						if (handy) expect(await tippflaechen(page), `Tippflaechen unter 44 px (${wo})`).toEqual([]);
					};

					if (handy) {
						await expect(umschalter).toBeVisible();
						await expect(formular).toBeVisible();
						await expect(vorschau).toBeHidden();
						await pruefe('Bearbeiten');
						await umschalter.getByRole('button', { name: 'Vorschau' }).click();
						await expect(vorschau).toBeVisible();
						await expect(formular).toBeHidden();
						await pruefe('Vorschau');
						await umschalter.getByRole('button', { name: 'Bearbeiten' }).click();
						await expect(formular).toBeVisible();
					} else {
						await expect(umschalter).toHaveCount(0);
						await expect(formular).toBeVisible();
						await expect(vorschau).toBeVisible();
						const f = await formular.boundingBox();
						const v = await vorschau.boundingBox();
						if (!f || !v) throw new Error('Formular oder Vorschau ohne Box');
						// Halbe Pixel aus gebrochenen Breiten sind keine Ueberlappung.
						expect(
							f.x + f.width,
							`Formular endet bei ${f.x + f.width}, die Vorschau beginnt bei ${v.x}`,
						).toBeLessThanOrEqual(v.x + 0.5);
						await pruefe('ohne Modul');
					}

					// Die Felder stehen nur fuer das gewaehlte Modul; Bowling hat Info-Text, Termin und Umfrage.
					const module = page.locator('ol.module button.waehlen');
					await expect(module).toHaveCount(3);
					for (let i = 0; i < 3; i++) {
						await module.nth(i).click();
						await expect(page.getByRole('heading', { name: `(Modul ${i + 1})` })).toBeVisible();
						await pruefe(`Modul ${i + 1}`);
					}
				});
			});
		}
	}
});
