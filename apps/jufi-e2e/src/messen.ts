import { expect, type Page } from '@playwright/test';
// Relativ statt ueber einen Paketnamen: farben.ts ist eine reine Rechendatei ohne Import, Angular kommt so
// nicht mit. Verworfen: die Kontrastformel hier ein zweites Mal schreiben -- dann pruefte der Test eine
// Formel, die von der der App abweichen kann, und die App rechnet die Vereinsfarbe mit genau dieser.
import { kontrast } from '../../jufi/src/app/gestaltung/farben';

/**
 * Messungen fuer layout.spec.ts. Jede misst im Browser (getBoundingClientRect, scrollWidth,
 * getComputedStyle) und nicht am Bildschirmfoto: Ein Bild sagt, dass etwas anders aussieht,
 * eine Zahl sagt, um wie viel und wo.
 */

/**
 * Kein waagrechtes Scrollen. body hat overflow-x hidden, die Seite liesse sich also gar nicht
 * seitlich schieben; scrollWidth zaehlt den Ueberstand trotzdem mit. Genau den wollen wir sehen,
 * denn abgeschnittener Inhalt ist am Handy so schlecht wie schiebbarer.
 */
export async function keinWaagrechtesScrollen(page: Page): Promise<void> {
	const { breite, fenster, taeter } = await page.evaluate(() => {
		const fenster = window.innerWidth;
		// Die innersten Elemente, die rechts hinausragen: Sie nennt die Meldung, damit ein roter Lauf
		// gleich sagt, wo es liegt, statt nur um wie viel.
		const raus = Array.from(document.body.querySelectorAll('*')).filter(
			(el) => el.getBoundingClientRect().right > fenster + 0.5,
		);
		const innerste = raus.filter((el) => !raus.some((anderes) => anderes !== el && el.contains(anderes)));
		const taeter = innerste.slice(0, 5).map((el) => {
			const klasse = typeof el.className === 'string' && el.className ? `.${el.className.split(' ').join('.')}` : '';
			return `${el.tagName.toLowerCase()}${klasse} bis ${Math.round(el.getBoundingClientRect().right)}`;
		});
		return { breite: document.documentElement.scrollWidth, fenster, taeter };
	});
	expect(breite, `scrollWidth ${breite} bei Fensterbreite ${fenster}: ${taeter.join(', ')}`).toBeLessThanOrEqual(
		fenster,
	);
}

/**
 * Text oder Beschriftung jedes sichtbaren Bedienelements, das niedriger als mindestens ist.
 * Kontrollkaestchen und Optionsfelder fehlen mit Absicht: Bei ihnen ist die ganze Zeile mit
 * Beschriftung die Tippflaeche (Klasse haken in styles.css), nicht das Kaestchen selbst.
 */
export async function tippflaechen(page: Page, mindestens = 44): Promise<string[]> {
	return page.evaluate((grenze) => {
		const auswahl = 'button, .knopf, nav a, input:not([type=checkbox]):not([type=radio]), select';
		const zuKlein: string[] = [];
		for (const el of Array.from(document.querySelectorAll<HTMLElement>(auswahl))) {
			// checkVisibility deckt hidden, display none und visibility hidden auch bei Vorfahren ab.
			if (!el.checkVisibility({ visibilityProperty: true })) continue;
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (r.height >= grenze) continue;
			const feld = el as HTMLInputElement;
			const knapp = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');
			const beschriftung = knapp(el.getAttribute('aria-label')) || knapp(feld.labels?.[0]?.textContent);
			zuKlein.push(beschriftung || knapp(el.textContent) || feld.name || el.tagName.toLowerCase());
		}
		return zuKlein;
	}, mindestens);
}

/**
 * Die untere Leiste der Mitglieder-Huelle liegt fest ueber dem Inhalt. Am Ende der Seite muss der
 * letzte Inhalt ueber ihr enden, sonst liegt etwa der Knopf Abmelden darunter und ist nicht zu treffen.
 */
export async function leisteVerdecktNichts(page: Page): Promise<void> {
	const { unten, oben } = await page.evaluate(() => {
		window.scrollTo(0, document.documentElement.scrollHeight);
		// Unter der Huelle gesucht: Auch Seiten haben eine .leiste (etwa die Werkzeugzeile der Mitgliederliste),
		// und eine solche in main kaeme im Dokument vor der unteren Leiste.
		const letztes = document.querySelector('jf-mitglieder-huelle > main')?.lastElementChild;
		const leiste = document.querySelector('jf-mitglieder-huelle > .leiste');
		if (!letztes || !leiste) throw new Error('main ohne Inhalt oder keine .leiste auf der Seite');
		return { unten: letztes.getBoundingClientRect().bottom, oben: leiste.getBoundingClientRect().top };
	});
	expect(unten, `letzter Inhalt endet bei ${unten}, die Leiste beginnt bei ${oben}`).toBeLessThanOrEqual(oben);
}

/** Kontrast der h1-Schrift zum Hintergrund von body nach WCAG 2. */
export async function lesbar(page: Page): Promise<number> {
	const { schrift, grund } = await page.evaluate(() => {
		const h1 = document.querySelector('h1');
		if (!h1) throw new Error('keine h1 auf der Seite');
		return { schrift: getComputedStyle(h1).color, grund: getComputedStyle(document.body).backgroundColor };
	});
	return kontrast(alsHex(schrift), alsHex(grund));
}

/** Hintergrundfarbe von body, wie der Browser sie berechnet. */
export async function seitenGrund(page: Page): Promise<string> {
	return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/**
 * rgb() und rgba() aus getComputedStyle als Hex fuer kontrast. Durchscheinende Farben lehnt es ab:
 * Ihr Kontrast haengt an dem, was darunter liegt, und eine Zahl dafuer waere geraten.
 */
function alsHex(farbe: string): string {
	const teile = farbe.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
	if (!teile) throw new Error(`Farbe nicht lesbar: ${farbe}`);
	if (teile[4] !== undefined && Number(teile[4]) < 1) throw new Error(`durchscheinende Farbe: ${farbe}`);
	return '#' + [teile[1], teile[2], teile[3]].map((t) => Number(t).toString(16).padStart(2, '0')).join('');
}
