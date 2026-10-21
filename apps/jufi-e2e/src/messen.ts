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

/**
 * Die vier Eintraege der unteren Leiste: jeder mindestens 44 px hoch, in einer Reihe nebeneinander und
 * ganz innerhalb des Fensters. tippflaechen misst die Hoehe schon fuer jeden Link; hier kommt dazu, dass
 * die Eintraege einander nicht ueberlappen und nicht aus der Leiste ragen, was eine Hoehe nicht zeigt.
 * Gemessen wird die Zahl vier mit: Ein fuenfter Eintrag sprengte bei 375 px die Spaltenbreite.
 */
export async function leisteHatVierEintraege(page: Page): Promise<void> {
	const m = await page.evaluate(() => {
		const eintraege = Array.from(document.querySelectorAll('jf-mitglieder-huelle > .leiste > a')).map((a) => {
			const r = a.getBoundingClientRect();
			return { text: a.textContent?.trim() ?? '', links: r.left, rechts: r.right, oben: r.top, hoehe: r.height };
		});
		return { eintraege, fenster: window.innerWidth };
	});
	const { eintraege, fenster } = m;
	expect(
		eintraege.map((e) => e.text.replace(/\s*neu$/, '')),
		'Eintraege der Leiste',
	).toEqual(['Start', 'Threads', 'Termine', 'Mehr']);
	for (const [i, e] of eintraege.entries()) {
		expect(e.hoehe, `${e.text} ist ${e.hoehe} px hoch`).toBeGreaterThanOrEqual(44);
		expect(e.links, `${e.text} beginnt bei ${e.links}`).toBeGreaterThanOrEqual(0);
		expect(e.rechts, `${e.text} endet bei ${e.rechts} im Fenster von ${fenster} px`).toBeLessThanOrEqual(fenster);
		if (i > 0) {
			const davor = eintraege[i - 1];
			// Halbe Pixel aus gebrochenen Spaltenbreiten sind keine Ueberlappung.
			expect(
				e.links,
				`${e.text} beginnt bei ${e.links}, ${davor.text} endet bei ${davor.rechts}`,
			).toBeGreaterThanOrEqual(davor.rechts - 0.5);
			expect(e.oben, `${e.text} liegt nicht in einer Reihe mit ${davor.text}`).toBeCloseTo(davor.oben, 0);
		}
	}
}

/**
 * Der Neu-Punkt an "Threads" schneidet den Text darunter nicht. Mit dem Icon darf er sich ueberlagern, das
 * ist gewollt (er sitzt an dessen oberer rechter Ecke, der Ring in der Farbe der Leiste hebt ihn ab); das
 * Icon wird deshalb nur gemeldet, nicht verlangt. Der Ring muss die Farbe der Leiste haben, sonst blitzte
 * im dunklen Schema ein hellerer Rand um den Punkt. Rueckgabe: die Ueberlappung mit dem Icon in px^2.
 */
export async function punktUeberdecktTextNicht(page: Page): Promise<number> {
	const m = await page.evaluate(() => {
		const link = Array.from(document.querySelectorAll('jf-mitglieder-huelle > .leiste > a')).find((a) =>
			a.textContent?.includes('Threads'),
		);
		const punkt = link?.querySelector('.punkt');
		const text = link?.querySelector(':scope > span:not(.punkt)');
		const icon = link?.querySelector('jf-icon');
		const leiste = document.querySelector('jf-mitglieder-huelle > .leiste');
		if (!punkt || !text || !icon || !leiste) throw new Error('Leiste ohne Punkt an Threads, Text oder Icon');
		const r = (el: Element) => {
			const b = el.getBoundingClientRect();
			return { links: b.left, rechts: b.right, oben: b.top, unten: b.bottom };
		};
		return {
			punkt: r(punkt),
			text: r(text),
			icon: r(icon),
			ring: getComputedStyle(punkt).borderTopColor,
			leiste: getComputedStyle(leiste).backgroundColor,
		};
	});
	const schnitt = (a: typeof m.punkt, b: typeof m.punkt) =>
		Math.max(0, Math.min(a.rechts, b.rechts) - Math.max(a.links, b.links)) *
		Math.max(0, Math.min(a.unten, b.unten) - Math.max(a.oben, b.oben));
	expect(
		schnitt(m.punkt, m.text),
		`Punkt ${JSON.stringify(m.punkt)} schneidet den Text ${JSON.stringify(m.text)}`,
	).toBe(0);
	expect(m.ring, 'Ring des Punkts in der Farbe der Leiste').toBe(m.leiste);
	return schnitt(m.punkt, m.icon);
}

/**
 * Das Monatsraster der Termine-Seite: Die Tabelle laeuft nicht in sich ueber (scrollWidth, das ein
 * table-layout fixed mit zu breitem Inhalt sonst still abschneidet), und die Reihen sind gleich hoch,
 * ob ein Tag markiert ist oder nicht; sonst spraenge die Liste darunter beim Blaettern. Rueckgabe:
 * die Hoehen aller Reihen des Rasters, getrennt nach Reihen mit und ohne markierten Tag.
 */
export async function monatsrasterPasst(page: Page): Promise<{ mit: number[]; ohne: number[] }> {
	const m = await page.evaluate(() => {
		const tabelle = document.querySelector('jf-termine table');
		if (!tabelle) throw new Error('keine Tabelle auf der Seite');
		const reihen = Array.from(tabelle.querySelectorAll('tbody > tr')).map((tr) => ({
			markiert: tr.querySelector('td.markiert') !== null,
			hoehe: tr.getBoundingClientRect().height,
		}));
		return {
			scroll: tabelle.scrollWidth,
			breite: tabelle.clientWidth,
			rechts: tabelle.getBoundingClientRect().right,
			fenster: window.innerWidth,
			zellen: tabelle.querySelectorAll('tbody td').length,
			reihen,
		};
	});
	expect(m.zellen, 'Felder im Raster').toBe(42);
	expect(m.scroll, `Raster ist ${m.scroll} px breit bei clientWidth ${m.breite}`).toBeLessThanOrEqual(m.breite);
	expect(m.rechts, `Raster endet bei ${m.rechts} im Fenster von ${m.fenster} px`).toBeLessThanOrEqual(m.fenster);
	return {
		mit: m.reihen.filter((r) => r.markiert).map((r) => r.hoehe),
		ohne: m.reihen.filter((r) => !r.markiert).map((r) => r.hoehe),
	};
}

/**
 * Der Verlauf eines Threads: Das Eingabefeld sitzt fest ueber der unteren Leiste und die letzte
 * Nachricht muss nach dem Scrollen ans Seitenende ueber ihm enden. Beides gemessen statt aus dem CSS
 * gerechnet (56 px Leiste, 72 px Abstandhalter): Eine Rechnung sagt nichts ueber die Aussparung am
 * Geraet und nichts darueber, ob eine andere Regel dazwischenkommt. Ohne Nachricht gaebe es nichts zu
 * messen; das ist ein Fehler der Testdaten, kein Erfolg.
 */
export async function verlaufUeberLeiste(page: Page): Promise<void> {
	const m = await page.evaluate(() => {
		window.scrollTo(0, document.documentElement.scrollHeight);
		const eingabe = document.querySelector('jf-verlauf form.eingabe');
		const nachrichten = document.querySelectorAll('jf-verlauf ol > li');
		const leiste = document.querySelector('jf-mitglieder-huelle > .leiste');
		if (!eingabe || !leiste) throw new Error('kein Eingabefeld des Verlaufs oder keine .leiste auf der Seite');
		const letzte = nachrichten[nachrichten.length - 1];
		if (!letzte || letzte.classList.contains('leer')) throw new Error('Verlauf ohne Nachricht');
		return {
			eingabeOben: eingabe.getBoundingClientRect().top,
			eingabeUnten: eingabe.getBoundingClientRect().bottom,
			leisteOben: leiste.getBoundingClientRect().top,
			nachrichtUnten: letzte.getBoundingClientRect().bottom,
		};
	});
	// Halbe Pixel aus gebrochenen Hoehen sind keine Ueberdeckung.
	expect(
		m.eingabeUnten,
		`Eingabefeld endet bei ${m.eingabeUnten}, die Leiste beginnt bei ${m.leisteOben}`,
	).toBeLessThanOrEqual(m.leisteOben + 0.5);
	expect(
		m.nachrichtUnten,
		`letzte Nachricht endet bei ${m.nachrichtUnten}, das Eingabefeld beginnt bei ${m.eingabeOben}`,
	).toBeLessThanOrEqual(m.eingabeOben + 0.5);
}

/**
 * Der Hinweis "Nicht verbunden" im Kopf der Mitglieder-Huelle schneidet den Vereinsnamen nicht und
 * bleibt im Fenster. Gemessen am Namen und nicht am ganzen Kopf: Der Hinweis steht im Kopf, und
 * worauf es ankommt, ist, dass der Name lesbar bleibt, wenn beide sich die Zeile teilen. Rueckgabe:
 * Hoehe des Hinweises und des Kopfs in px, damit ein Umbruch im Bericht zu sehen ist.
 */
export async function hinweisUeberdecktNamenNicht(page: Page): Promise<{ hinweis: number; kopf: number }> {
	const m = await page.evaluate(() => {
		const kopf = document.querySelector('jf-mitglieder-huelle > header.kopf');
		const hinweis = kopf?.querySelector('.hinweis');
		const name = kopf?.querySelector('.name');
		if (!kopf || !hinweis || !name) throw new Error('Kopf ohne Hinweis oder Vereinsnamen');
		const r = (el: Element) => {
			const b = el.getBoundingClientRect();
			return { links: b.left, rechts: b.right, oben: b.top, unten: b.bottom };
		};
		return {
			hinweis: r(hinweis),
			name: r(name),
			kopf: r(kopf),
			text: hinweis.textContent?.trim() ?? '',
			fenster: window.innerWidth,
		};
	});
	// Ohne Text gaebe es nichts zu messen; dann ist der Hinweis gar nicht erschienen.
	expect(m.text, 'Hinweis im Kopf').toBe('Nicht verbunden – Inhalte evtl. veraltet');
	const schnitt =
		Math.max(0, Math.min(m.hinweis.rechts, m.name.rechts) - Math.max(m.hinweis.links, m.name.links)) *
		Math.max(0, Math.min(m.hinweis.unten, m.name.unten) - Math.max(m.hinweis.oben, m.name.oben));
	expect(schnitt, `Hinweis ${JSON.stringify(m.hinweis)} schneidet den Namen ${JSON.stringify(m.name)}`).toBe(0);
	expect(m.hinweis.rechts, `Hinweis endet bei ${m.hinweis.rechts} im Fenster von ${m.fenster} px`).toBeLessThanOrEqual(
		m.fenster,
	);
	// Halbe Pixel aus gebrochenen Hoehen sind kein Ueberstand.
	expect(m.hinweis.unten, `Hinweis ragt unten aus dem Kopf (${m.kopf.unten})`).toBeLessThanOrEqual(m.kopf.unten + 0.5);
	return { hinweis: m.hinweis.unten - m.hinweis.oben, kopf: m.kopf.unten - m.kopf.oben };
}

/**
 * Abstand von der Unterkante der Menuezeile (aside) zur Oberkante des Inhalts in der Verwaltungs-Huelle.
 * Die Luecke aus Task 12 entstand nur, wenn der Inhalt kuerzer als der Bildschirm ist: Dann verteilte das
 * Grid den Freiraum seiner min-height auf beide Zeilen. Gemessen wird deshalb auf jeder Verwaltungsseite,
 * gerade auch auf den kurzen (Untergruppen, Rechte); auf einer hohen Seite bliebe die Luecke unsichtbar.
 */
export async function abstandUnterKopf(page: Page): Promise<number> {
	return page.evaluate(() => {
		const aside = document.querySelector('jf-verwaltung-huelle .huelle > aside');
		const main = document.querySelector('jf-verwaltung-huelle .huelle > main');
		if (!aside || !main) throw new Error('Verwaltungs-Huelle ohne aside oder main');
		return main.getBoundingClientRect().top - aside.getBoundingClientRect().bottom;
	});
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
