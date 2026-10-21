import {
	type Browser,
	type BrowserContext,
	expect,
	type Locator,
	type Page,
	test,
	type WebSocket,
} from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { berlinerTag, MONATSNAMEN, tagPlus, threadSegment } from '@jufi/domain';
import { passkeyGeraet, TESTPASSWORT, ZUSTAND } from './hilfen';
import { leisteHatVierEintraege, punktUeberdecktTextNicht } from './messen';
import { fuelleAustausch, personIdMitMail } from './threads';

/**
 * Der Weg aus Spec 9 von Anfang bis Ende: Der Admin legt den Verein an, die Leitung
 * nimmt mit Passkey an und laedt die Mutter ein, die Mutter willigt fuer ihr Kind
 * ein und schickt ihm einen Link, das Kind richtet einen Passkey ein. Jede Person
 * hat ihren eigenen Browser-Kontext, also eigene Cookies und ein eigenes Geraet.
 *
 * Seriell, weil jeder Schritt auf dem vorigen aufbaut; die Links wandern ueber die
 * Variablen unten weiter, wie sie im echten Leben per Messenger weitergingen. Alle
 * Personen sind erfunden.
 */

const SLUG = 'musterbach';
const LEITUNG_MAIL = 'lea@example.test';
const MUTTER_MAIL = 'mara@example.test';

let leitungLink = '';
let mutterLink = '';
let kindLink = '';
/** Segmente der Thread-Seiten und die ID fuer die Verwaltungspfade; die Leitung legt Bowling im Editor an. */
let bowling = '';
let bowlingId = '';
let austausch = '';
/** Der Tag des Bowling-Termins (der Editor legt ihn sieben Berliner Tage nach jetzt an); sein Monat ist der, in dem der Kalender Bowling zeigt. */
let terminTag = '';

/** Ein neuer Kontext mit eigenem virtuellen Authenticator und seiner ersten Seite. */
async function person(browser: Browser): Promise<{ kontext: BrowserContext; seite: Page }> {
	const kontext = await browser.newContext();
	await passkeyGeraet(kontext);
	return { kontext, seite: kontext.pages()[0] };
}

/**
 * Der Link steht im Einladungstext, der auch fuer den Messenger gedacht ist. Gelesen
 * wird er aus dem Text und nicht ueber "Link kopieren": Die Zwischenablage ist im
 * kopflosen Browser nicht verlaesslich, und der Text ist das, was Menschen weitergeben.
 */
async function linkAusEinladung(bereich: Locator | Page): Promise<string> {
	const text = await bereich.getByLabel('Einladungstext').innerText();
	const link = text.match(/https?:\/\/\S+#\S+/)?.[0];
	expect(link, `kein Link im Einladungstext:\n${text}`).toBeTruthy();
	return link ?? '';
}

function hauptnavigation(seite: Page): Locator {
	return seite.getByRole('navigation', { name: 'Hauptnavigation' });
}

/** Ein Kontext mit der gespeicherten Sitzung der Rolle, wie ihn auch das Projekt layout benutzt. */
async function ausSitzung(browser: Browser, rolle: string): Promise<{ kontext: BrowserContext; seite: Page }> {
	const kontext = await browser.newContext({ storageState: join(ZUSTAND, `${rolle}.json`) });
	return { kontext, seite: await kontext.newPage() };
}

async function speichereSitzung(kontext: BrowserContext, rolle: string): Promise<void> {
	await kontext.storageState({ path: join(ZUSTAND, `${rolle}.json`) });
}

/**
 * Oeffnet die Seite und wartet auf den ersten Abgleich der Huelle. Ein gelungener Abgleich allein
 * belegt keine Verbindung: Scheitert das Upgrade, gleicht der Client nach jedem Abbruch ebenfalls ab
 * und holt Aenderungen im Takt des Backoffs nach (1, 2, 4 s), was ein Live-Schritt mit 5 s Frist
 * nicht vom Signal unterschiede. Darum muss der Socket danach noch offen sein, und die Schritte
 * pruefen am Ende, dass er es geblieben ist und ein Signal ueber ihn kam. Verworfen: auf den Hinweis
 * im Kopf zu schauen -- leer ist er in den ersten 2 s auch ohne Hub.
 */
async function oeffneVerbunden(seite: Page, pfad: string): Promise<WebSocket> {
	// Mit eigener Frist: Ohne sie endete ein Lauf ohne Socket erst mit dem Test, ohne zu sagen, worauf er wartete.
	const socket = seite.waitForEvent('websocket', {
		predicate: (ws) => new URL(ws.url()).pathname === `/${SLUG}/ws`,
		timeout: 5000,
	});
	const abgleich = seite.waitForResponse(
		(r) => new URL(r.url()).pathname === `/${SLUG}/api/v1/sync` && r.status() === 200,
	);
	await seite.goto(pfad);
	const ws = await socket;
	await abgleich;
	expect(ws.isClosed(), 'Socket nach dem ersten Abgleich zu; nimmt der Server das Upgrade an?').toBe(false);
	return ws;
}

/**
 * Das Signal kam ueber denselben Socket, der seit dem Oeffnen steht. Ohne Abbruch gab es keinen
 * Abgleich nach Neuverbinden, also hat das Signal die Seite aktualisiert, nicht ein Nachholen.
 */
async function kamLive(ws: WebSocket, signal: Promise<unknown>): Promise<void> {
	await signal;
	expect(ws.isClosed(), 'Socket zwischendurch zu; kam die Aenderung ueber den Abgleich statt live?').toBe(false);
}

test.describe.serial('Ablauf von Verein bis Kind', () => {
	test('Admin richtet sich ein und legt den Verein an', async ({ browser }) => {
		const adminLink = process.env['E2E_ADMIN_LINK'];
		expect(adminLink, 'E2E_ADMIN_LINK fehlt, lief der Aufbau?').toBeTruthy();
		const { kontext, seite } = await person(browser);

		await seite.goto(adminLink ?? '');
		await expect(seite.getByRole('heading', { name: 'Willkommen, e2e-admin' })).toBeVisible();
		await seite.getByLabel('Passwort', { exact: true }).fill(TESTPASSWORT);
		await seite.getByLabel('Passwort wiederholen').fill(TESTPASSWORT);
		await seite.getByRole('button', { name: 'Passwort festlegen' }).click();

		await expect(seite.getByRole('heading', { name: /Zweiter Faktor/ })).toBeVisible();
		await seite.getByRole('button', { name: 'Überspringen' }).click();
		// Der Passkey-Schritt erscheint, weil Chromium WebAuthn kann; der Admin braucht hier keinen.
		await expect(seite.getByRole('heading', { name: 'Passkey' })).toBeVisible();
		await seite.getByRole('button', { name: 'Überspringen' }).click();
		await expect(seite.getByRole('heading', { name: 'Fertig' })).toBeVisible();
		await seite.getByRole('link', { name: 'Zu den Vereinen' }).click();

		await seite.getByRole('link', { name: 'Verein anlegen' }).click();
		await seite.getByLabel('Offizieller Name').fill('Fischereiverein Musterbach e.V.');
		await seite.getByLabel('Anzeigename').fill('Jungfischer Musterbach');
		await seite.getByLabel('Slug').fill(SLUG);
		await seite.getByLabel('Farbe').fill('#1d4ed8');
		await seite.getByLabel('Vorname').fill('Lea');
		await seite.getByLabel('Nachname').fill('Leitner');
		await seite.getByLabel('E-Mail').fill(LEITUNG_MAIL);
		await seite.getByRole('button', { name: 'Verein anlegen' }).click();

		await expect(seite.getByRole('heading', { name: 'Verein angelegt' })).toBeVisible();
		leitungLink = await linkAusEinladung(seite);
		expect(leitungLink).toContain(`/${SLUG}/einladung#`);
		await kontext.close();
	});

	test('Leitung nimmt mit Passkey an, legt Mia an und laedt Mara ein', async ({ browser }) => {
		const { kontext, seite } = await person(browser);

		await seite.goto(leitungLink);
		await expect(seite.getByRole('heading', { name: /Hallo Lea/ })).toBeVisible();
		await seite.getByRole('button', { name: 'Weiter' }).click();
		// Die Leitung hat schon eine E-Mail-Adresse; sie steht vorbelegt und wird bestaetigt.
		await expect(seite.getByLabel('E-Mail-Adresse')).toHaveValue(LEITUNG_MAIL);
		await seite.getByRole('button', { name: 'Weiter' }).click();
		await seite.getByRole('button', { name: 'Passkey einrichten' }).click();
		await expect(seite.getByRole('heading', { name: 'Fertig' })).toBeVisible();
		await seite.getByRole('button', { name: 'Zur App' }).click();

		await expect(seite.getByRole('heading', { name: 'Hallo Lea' })).toBeVisible();
		await expect(hauptnavigation(seite).getByRole('link', { name: 'Start' })).toHaveAttribute('aria-current', 'page');

		await hauptnavigation(seite).getByRole('link', { name: 'Mehr' }).click();
		await seite.getByRole('navigation', { name: 'Mehr' }).getByRole('link', { name: 'Verwaltung' }).click();
		await expect(seite.getByRole('heading', { name: 'Mitglieder' })).toBeVisible();

		await seite.getByRole('link', { name: 'Person anlegen' }).click();
		await seite.getByRole('radio', { name: 'Jungfischer' }).check();
		await seite.getByLabel('Vorname').fill('Mia');
		await seite.getByLabel('Nachname').fill('Muster');
		await seite.getByLabel('Geburtsdatum').fill('2015-05-01');
		await seite.getByRole('button', { name: 'Anlegen' }).click();

		await expect(seite.getByRole('heading', { name: 'Mia Muster' })).toBeVisible();
		const miaId = new URL(seite.url()).pathname.split('/').pop() ?? '';
		expect(miaId).not.toBe('');

		// Zwei Formulare auf der Seite haben ein Feld Vorname (Stammdaten und Familie); das Formular
		// mit der Ueberschrift grenzt ein.
		const familie = seite.locator('form').filter({ has: seite.getByRole('heading', { name: 'Familie hinzufügen' }) });
		await familie.getByRole('radio', { name: 'Neue Person anlegen' }).check();
		await familie.getByLabel('Vorname').fill('Mara');
		await familie.getByLabel('Nachname').fill('Muster');
		await familie.getByLabel('E-Mail (freiwillig)').fill(MUTTER_MAIL);
		await familie.getByLabel('Beziehung').selectOption({ label: 'Mutter' });
		await familie.getByRole('checkbox', { name: 'Erziehungsberechtigt' }).check();
		await familie.getByRole('button', { name: 'Zur Familie hinzufügen' }).click();

		const mara = seite.getByRole('link', { name: 'Mara Muster' });
		await expect(mara).toBeVisible();
		await expect(seite.getByRole('listitem').filter({ has: mara })).toContainText('Mutter · erziehungsberechtigt');
		await mara.click();

		await expect(seite.getByRole('heading', { name: 'Mara Muster' })).toBeVisible();
		await seite.getByRole('button', { name: 'Einladung erzeugen' }).click();
		mutterLink = await linkAusEinladung(seite);
		expect(mutterLink).toContain(`/${SLUG}/einladung#`);

		await seite.getByRole('link', { name: 'Zur App' }).click();
		await expect(seite.getByRole('heading', { name: 'Hallo Lea' })).toBeVisible();
		await expect(seite.getByText('1 offene Einladung')).toBeVisible();

		await speichereSitzung(kontext, 'leitung');
		await writeFile(join(ZUSTAND, 'ids.json'), JSON.stringify({ mia: miaId }, null, '\t'));
		await kontext.close();
	});

	test('Mutter willigt fuer Mia ein und erzeugt Mias Link', async ({ browser }) => {
		const { kontext, seite } = await person(browser);

		await seite.goto(mutterLink);
		await expect(seite.getByRole('heading', { name: /Hallo Mara/ })).toBeVisible();
		await seite.getByRole('button', { name: 'Weiter' }).click();

		await expect(seite.getByRole('heading', { name: 'Einwilligung' })).toBeVisible();
		const mia = seite.getByRole('group', { name: 'Mia', exact: true });
		await mia.getByRole('checkbox', { name: 'Ich willige ein' }).check();
		await expect(mia.getByRole('checkbox', { name: 'Ja, mit eigenem Anmeldenamen' })).toBeChecked();
		await seite.getByRole('button', { name: 'Weiter' }).click();

		await expect(seite.getByLabel('E-Mail-Adresse')).toHaveValue(MUTTER_MAIL);
		await seite.getByRole('button', { name: 'Weiter' }).click();
		await seite.getByLabel('Passwort (zusätzlich oder statt Passkey)').fill(TESTPASSWORT);
		await seite.getByRole('button', { name: 'Zugang einrichten' }).click();
		await expect(seite.getByRole('heading', { name: 'Fertig' })).toBeVisible();
		await seite.getByRole('button', { name: 'Zur App' }).click();

		await expect(seite.getByRole('heading', { name: 'Hallo Mara' })).toBeVisible();
		// Die Karte im Abschnitt Deine Jungfischer, nicht irgendein Link dieses Namens: Die ganze
		// Karte ist der Link zu Meine Jungfischer und nennt den Zugangsstand, den die Mutter
		// gerade erlaubt hat.
		const jungfischer = seite
			.locator('jf-abschnitt')
			.filter({ has: seite.getByRole('heading', { name: 'Deine Jungfischer' }) });
		const miaKarte = jungfischer.getByRole('link', { name: /Mia Muster/ });
		await expect(miaKarte).toBeVisible();
		await expect(miaKarte).toHaveAttribute('href', `/${SLUG}/meine-jungfischer`);
		await expect(miaKarte).toContainText('Zugang erlaubt, noch nicht eingerichtet');

		await hauptnavigation(seite).getByRole('link', { name: 'Mehr' }).click();
		await seite.getByRole('link', { name: 'Meine Jungfischer' }).click();
		const karte = seite.getByRole('article').filter({ has: seite.getByRole('heading', { name: 'Mia Muster' }) });
		await karte.getByRole('button', { name: 'Neuen Link erzeugen' }).click();
		kindLink = await linkAusEinladung(karte);
		expect(kindLink).toContain(`/${SLUG}/einladung#`);

		await speichereSitzung(kontext, 'mutter');
		await kontext.close();
	});

	test('Kind richtet Passkey ein, meldet sich ab und wieder an', async ({ browser }) => {
		const { kontext, seite } = await person(browser);

		await seite.goto(kindLink);
		await expect(seite.getByRole('heading', { name: /Hallo Mia/ })).toBeVisible();
		await seite.getByRole('button', { name: 'Weiter' }).click();
		await seite.getByLabel('Anmeldename').fill('mia');
		await seite.getByRole('button', { name: 'Weiter' }).click();
		await seite.getByRole('button', { name: 'Passkey einrichten' }).click();
		await expect(seite.getByRole('heading', { name: 'Fertig' })).toBeVisible();
		await seite.getByRole('button', { name: 'Zur App' }).click();
		await expect(seite.getByRole('heading', { name: 'Hallo Mia' })).toBeVisible();

		await hauptnavigation(seite).getByRole('link', { name: 'Mehr' }).click();
		await seite.getByRole('button', { name: 'Abmelden' }).click();
		await expect(seite).toHaveURL(new RegExp(`/${SLUG}/anmelden`));
		await seite.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
		await expect(seite.getByRole('heading', { name: 'Hallo Mia' })).toBeVisible();
		await expect(seite).toHaveURL(new RegExp(`/${SLUG}$`));

		await speichereSitzung(kontext, 'kind');
		await kontext.close();
	});

	test('Leitung legt Bowling im Editor an, speichert den Entwurf und veroeffentlicht', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'leitung');
		// Die Frist wie bisher in threads.ts: sieben Berliner Tage nach jetzt, 18 Uhr (die Vorgabe des Felds).
		const fristTag = tagPlus(berlinerTag(new Date()), 7);
		// Der Termin behaelt die Vorgabe des Editors (sieben Berliner Tage nach jetzt), also den Tag der Frist.
		terminTag = fristTag;

		await seite.goto(`/${SLUG}/verwaltung/threads`);
		await seite.getByRole('link', { name: 'Neuer Thread' }).click();
		await expect(seite.getByRole('heading', { name: 'Neuer Thread', level: 1 })).toBeVisible();
		await seite.getByLabel('Titel', { exact: true }).fill('🎳 Bowling');
		const hinzufuegen = seite.getByRole('group', { name: 'Modul hinzufügen' });
		const vorschau = seite.getByRole('region', { name: 'Vorschau am Handy' });

		// Fett ueber die Knopfleiste: Ohne Auswahl setzt sie einen markierten Platzhalter, den das
		// Weitertippen ersetzt, und der Cursor steht danach noch im Textfeld.
		await hinzufuegen.getByRole('button', { name: 'Info-Text' }).click();
		const text = seite.getByRole('textbox', { name: 'Text', exact: true });
		await text.fill('Wir gehen zusammen ');
		await seite.getByRole('toolbar', { name: 'Formatierung' }).getByRole('button', { name: 'Fett' }).click();
		await seite.keyboard.type('Bowling');
		await seite.keyboard.press('End');
		await seite.keyboard.type('. Bitte bis zur Frist anmelden.');
		await expect(text).toHaveValue('Wir gehen zusammen **Bowling**. Bitte bis zur Frist anmelden.');
		await expect(vorschau.locator('jf-info-modul strong', { hasText: 'Bowling' })).toBeVisible();

		await hinzufuegen.getByRole('button', { name: 'Termin' }).click();
		await seite.getByLabel('Ort (optional)').fill('Bowlingcenter');

		// Die erste Umfrage ist die Teilnahme-Vorlage, zunaechst ohne Frist.
		await hinzufuegen.getByRole('button', { name: 'Umfrage' }).click();
		await expect(seite.getByRole('checkbox', { name: 'Teilnahme-Umfrage' })).toBeChecked();
		await seite.getByRole('checkbox', { name: 'ohne Frist' }).uncheck();
		await seite.getByLabel('Datum', { exact: true }).fill(fristTag);
		await expect(seite.getByLabel('Uhrzeit', { exact: true })).toHaveValue('18:00');

		await seite.getByRole('button', { name: 'Entwurf speichern' }).click();
		await expect(seite.getByRole('status').filter({ hasText: 'Entwurf gespeichert' })).toBeVisible();
		// Nach dem ersten Speichern steht die ID in der Adresse statt "neu".
		await expect(seite).toHaveURL(new RegExp(`/${SLUG}/verwaltung/threads/(?!neu$)[^/]+$`));
		bowlingId = new URL(seite.url()).pathname.split('/').pop() ?? '';
		expect(bowlingId).not.toBe('');

		await seite.getByRole('link', { name: 'Zur Liste' }).click();
		const entwuerfe = seite.getByRole('region', { name: 'Entwürfe' });
		await expect(entwuerfe.getByRole('link', { name: '🎳 Bowling' })).toBeVisible();
		await entwuerfe.getByRole('link', { name: '🎳 Bowling' }).click();

		await expect(seite.getByRole('heading', { name: 'Thread bearbeiten', level: 1 })).toBeVisible();
		await seite.getByRole('button', { name: 'Veröffentlichen' }).click();
		await expect(seite.getByRole('status').filter({ hasText: 'Veröffentlicht' })).toBeVisible();
		await expect(seite.getByRole('button', { name: 'Veröffentlichen' })).toHaveCount(0);

		await seite.getByRole('link', { name: 'Thread ansehen' }).click();
		await expect(seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		await expect(seite).toHaveURL(new RegExp(`/${SLUG}/t/[^/]+$`));
		bowling = new URL(seite.url()).pathname.split('/').pop() ?? '';
		expect(bowling).toBe(threadSegment(bowlingId, '🎳 Bowling'));
		await kontext.close();

		const leitungId = await personIdMitMail(SLUG, LEITUNG_MAIL);
		austausch = await fuelleAustausch(SLUG, leitungId, new Date());
		const ids = JSON.parse(await readFile(join(ZUSTAND, 'ids.json'), 'utf8')) as Record<string, string>;
		await writeFile(
			join(ZUSTAND, 'ids.json'),
			JSON.stringify({ ...ids, bowling, bowlingId, austausch, terminMonat: terminTag.slice(0, 7) }, null, '\t'),
		);
	});

	test('Mutter sieht Bowling auf Start, am Punkt der Leiste, in der Liste und im Kalender', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'mutter');
		// Handymass: Die Leiste und der Punkt sind dafuer gebaut, und gemessen wird an dem, was da ist.
		await seite.setViewportSize({ width: 375, height: 812 });
		await seite.goto(`/${SLUG}/`);
		await expect(seite.getByRole('heading', { name: 'Hallo Mara' })).toBeVisible();

		const leiste = hauptnavigation(seite);
		await expect(leiste.getByRole('link')).toHaveCount(4);
		for (const name of ['Start', 'Threads', 'Termine', 'Mehr']) {
			await expect(leiste.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
		}

		// Die Zeile ist die offene Umfrage fuer Mia (mit ihrem Namen davor), nicht irgendein Text mit Bowling.
		const bereich = (titel: string) =>
			seite.locator('jf-abschnitt').filter({ has: seite.getByRole('heading', { name: titel, exact: true }) });
		await expect(bereich('Braucht deine Antwort').getByRole('link', { name: /Bowling noch offen/ })).toBeVisible();
		await expect(bereich('Neu seit deinem letzten Besuch').getByRole('link', { name: /Bowling/ })).toContainText(
			'Neuer Thread',
		);

		// Der Punkt an "Threads", hell und dunkel; die Ueberlappung mit dem Icon ist gewollt und wird nur genannt.
		const punkt = leiste.getByRole('link', { name: /^Threads/ }).getByRole('img', { name: 'neu' });
		await expect(punkt).toBeVisible();
		for (const schema of ['dark', 'light'] as const) {
			await seite.emulateMedia({ colorScheme: schema });
			await leisteHatVierEintraege(seite);
			await punktUeberdecktTextNicht(seite);
		}

		await leiste.getByRole('link', { name: /^Threads/ }).click();
		await expect(seite.getByRole('heading', { name: 'Threads', level: 1 })).toBeVisible();
		const zeile = seite.getByRole('main').getByRole('link', { name: /Bowling/ });
		await expect(zeile.getByRole('img', { name: 'neu' })).toBeVisible();

		// Das Oeffnen meldet den Stand als gelesen; erst nach dieser Antwort ist "Zurueck" ein faires Urteil.
		const gelesen = seite.waitForResponse(
			(r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/gelesen'),
		);
		await zeile.click();
		await expect(seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		await gelesen;
		await seite.getByRole('link', { name: 'Zurück zur Thread-Liste' }).click();
		await expect(seite).toHaveURL(new RegExp(`/${SLUG}/threads$`));
		await expect(zeile).toBeVisible();
		await expect(zeile.getByRole('img', { name: 'neu' })).toHaveCount(0);
		await expect(leiste.getByRole('img', { name: 'neu' })).toHaveCount(0);

		// Der Termin liegt sieben Tage voraus, also im laufenden oder im naechsten Monat.
		await leiste.getByRole('link', { name: /^Termine/ }).click();
		await expect(seite.getByRole('heading', { name: 'Termine', level: 1 })).toBeVisible();
		const [jahr, monat] = terminTag.split('-').map(Number);
		const ueberschrift = seite.getByRole('heading', { name: `${MONATSNAMEN[monat - 1]} ${jahr}`, level: 2 });
		if ((await ueberschrift.count()) === 0) await seite.getByRole('button', { name: 'Nächster Monat' }).click();
		await expect(ueberschrift).toBeVisible();
		await expect(seite.getByRole('main').getByRole('link', { name: /Bowling/ })).toBeVisible();
		await expect(seite.locator('jf-termine td.markiert').first()).toBeVisible();
		await kontext.close();
	});

	test('Mutter antwortet fuer Mia und schreibt im Verlauf, Mia und Leitung sehen es', async ({ browser }) => {
		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/t/${bowling}`);
		await expect(mutter.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		// Die Zeile der Umfrage fuer Mia, nicht irgendein Text mit ihrem Namen.
		const zeileMia = mutter.seite.locator('jf-umfrage-modul .zeile').filter({ hasText: 'Mia' });
		await expect(zeileMia).toBeVisible();
		await zeileMia.getByRole('button', { name: '✓ Dabei' }).click();
		await expect(zeileMia).toContainText('von dir eingetragen');
		await expect(zeileMia.getByRole('button', { name: '✓ Dabei' })).toHaveCount(0);

		await mutter.seite.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Verlauf' }).click();
		await mutter.seite.getByLabel('Nachricht schreiben').fill('Wo genau ist der Treffpunkt?');
		await mutter.seite.getByRole('button', { name: 'Senden' }).click();
		const nachricht = mutter.seite.getByRole('listitem').filter({ hasText: 'Wo genau ist der Treffpunkt?' });
		await expect(nachricht).toBeVisible();
		await expect(nachricht).toContainText('Du');

		// Ein Jugendleiter-Thread ist fuer die Mutter nicht da, nicht verboten (Rahmen-Spec 8).
		await mutter.seite.goto(`/${SLUG}/t/${austausch}`);
		await expect(mutter.seite.getByRole('heading', { name: 'Nicht gefunden oder keine Berechtigung' })).toBeVisible();
		await mutter.kontext.close();

		const kind = await ausSitzung(browser, 'kind');
		await kind.seite.goto(`/${SLUG}/t/${bowling}`);
		const zeileDu = kind.seite.locator('jf-umfrage-modul .zeile').filter({ hasText: 'Du' });
		await expect(zeileDu).toContainText('✓ Dabei');
		await expect(zeileDu).toContainText('eingetragen von Mutter Mara');
		// Die Nachricht der Mutter ist fuer Mia ungelesen; der Zaehler am Reiter nennt sie, fuer Screenreader mit dem Wort.
		await expect(
			kind.seite.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: /^Verlauf\s*1\s*ungelesen$/ }),
		).toBeVisible();
		await kind.kontext.close();

		const leitung = await ausSitzung(browser, 'leitung');
		await leitung.seite.goto(`/${SLUG}/t/${austausch}`);
		await expect(leitung.seite.getByRole('heading', { name: 'Jugendsprecher-Austausch', level: 1 })).toBeVisible();
		await leitung.seite.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Verlauf' }).click();
		await expect(leitung.seite.getByLabel('Nachricht schreiben')).toBeVisible();
		await leitung.kontext.close();
	});

	// Live (Spec 5): Zwei Personen haben gleichzeitig offen, keine Seite wird neu geladen. Die Frist
	// von 5 s ist grosszuegig fuer ein Signal, schliesst aber den langsamen Weg ueber Neuverbinden und
	// Abgleich nicht aus; das tut erst kamLive.

	test('Live: Leitung sieht die Nachricht der Mutter im offenen Verlauf, der Zaehler bleibt bei 0', async ({
		browser,
	}) => {
		const leitung = await ausSitzung(browser, 'leitung');
		const ws = await oeffneVerbunden(leitung.seite, `/${SLUG}/t/${bowling}?reiter=verlauf`);
		const reiter = leitung.seite.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: /^Verlauf/ });
		await expect(leitung.seite.getByRole('listitem').filter({ hasText: 'Wo genau ist der Treffpunkt?' })).toBeVisible();
		// Die Frage der Mutter war fuer die Leitung ungelesen; das Oeffnen des Verlaufs hat sie gemeldet.
		await expect(reiter.locator('.zahl')).toHaveCount(0);

		// Zu beweisen ist, dass etwas nicht geschieht: Der Zaehler darf nicht einmal kurz erscheinen.
		// toHaveCount(0) am Ende bestuende auch, wenn er auf 1 sprang und nach dem Melden wieder fiel.
		// Ein Beobachter im Browser haelt jedes Erscheinen fest. Verworfen: eine feste Wartezeit -- sie
		// saehe nur ihren Augenblick und kostete jeden Lauf Sekunden.
		await leitung.seite.evaluate(() => {
			const fenster = window as unknown as { zahlGesehen: boolean };
			fenster.zahlGesehen = false;
			new MutationObserver(() => {
				if (document.querySelector('nav[aria-label="Ansicht"] .zahl')) fenster.zahlGesehen = true;
			}).observe(document.body, { childList: true, subtree: true, characterData: true });
		});
		const signal = ws.waitForEvent('framereceived');
		// Die Meldung nach der Live-Nachricht; erst danach kennt der Server den neuen Stand als gelesen,
		// und jede spaetere Aktualisierung brachte ebenfalls 0.
		const gelesen = leitung.seite.waitForResponse(
			(r) =>
				r.request().method() === 'PUT' &&
				new URL(r.url()).pathname.endsWith('/gelesen') &&
				(r.request().postDataJSON() as { bereich?: string }).bereich === 'verlauf',
		);

		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/t/${bowling}?reiter=verlauf`);
		await mutter.seite.getByLabel('Nachricht schreiben').fill('Wir kommen zu zweit');
		await mutter.seite.getByRole('button', { name: 'Senden' }).click();
		await expect(mutter.seite.getByRole('listitem').filter({ hasText: 'Wir kommen zu zweit' })).toBeVisible();

		await expect(leitung.seite.getByRole('listitem').filter({ hasText: 'Wir kommen zu zweit' })).toBeVisible({
			timeout: 5000,
		});
		await kamLive(ws, signal);
		expect((await gelesen).status()).toBe(204);
		await expect(reiter.locator('.zahl')).toHaveCount(0);
		const gesehen = await leitung.seite.evaluate(() => (window as unknown as { zahlGesehen: boolean }).zahlGesehen);
		expect(gesehen, 'Zaehler am Reiter Verlauf erschien').toBe(false);
		await mutter.kontext.close();
		await leitung.kontext.close();
	});

	test('Live: Leitung pinnt Bowling an, die offene Liste der Mutter zeigt es unter Angepinnt', async ({ browser }) => {
		const mutter = await ausSitzung(browser, 'mutter');
		const ws = await oeffneVerbunden(mutter.seite, `/${SLUG}/threads`);
		const abschnitt = (titel: string) =>
			mutter.seite
				.locator('jf-abschnitt')
				.filter({ has: mutter.seite.getByRole('heading', { name: titel, exact: true }) });
		await expect(abschnitt('Aktiv').getByRole('link', { name: /Bowling/ })).toBeVisible();
		await expect(abschnitt('Angepinnt')).toHaveCount(0);

		const leitung = await ausSitzung(browser, 'leitung');
		await leitung.seite.goto(`/${SLUG}/verwaltung/threads/${bowlingId}`);
		await expect(leitung.seite.getByRole('heading', { name: 'Thread bearbeiten', level: 1 })).toBeVisible();
		const angepinnt = ws.waitForEvent('framereceived');
		await leitung.seite.getByRole('button', { name: 'Anpinnen' }).click();
		await expect(leitung.seite.getByRole('button', { name: 'Lösen' })).toBeVisible();

		await expect(abschnitt('Angepinnt').getByRole('link', { name: /Bowling/ })).toBeVisible({ timeout: 5000 });
		await expect(abschnitt('Aktiv').getByRole('link', { name: /Bowling/ })).toHaveCount(0);
		await kamLive(ws, angepinnt);

		// Wieder loesen: Der Rest des Ablaufs erwartet Bowling unter Aktiv. Auch das kommt live an.
		const geloest = ws.waitForEvent('framereceived');
		await leitung.seite.getByRole('button', { name: 'Lösen' }).click();
		await expect(leitung.seite.getByRole('button', { name: 'Anpinnen' })).toBeVisible();
		await expect(abschnitt('Aktiv').getByRole('link', { name: /Bowling/ })).toBeVisible({ timeout: 5000 });
		await expect(abschnitt('Angepinnt')).toHaveCount(0);
		await kamLive(ws, geloest);
		await leitung.kontext.close();
		await mutter.kontext.close();
	});

	test('Live: Leitung stellt einen Thread auf Nur Jugendleiter, die offene Seite der Mutter zeigt Nicht gefunden', async ({
		browser,
	}) => {
		// Ein eigener Thread statt Bowling: Bowling braucht der Rest des Ablaufs fuer die Familie sichtbar.
		const titel = 'Zielgruppe (Test)';
		const leitung = await ausSitzung(browser, 'leitung');
		await leitung.seite.goto(`/${SLUG}/verwaltung/threads/neu`);
		await expect(leitung.seite.getByRole('heading', { name: 'Neuer Thread', level: 1 })).toBeVisible();
		await leitung.seite.getByLabel('Titel', { exact: true }).fill(titel);
		await leitung.seite
			.getByRole('group', { name: 'Modul hinzufügen' })
			.getByRole('button', { name: 'Info-Text' })
			.click();
		await leitung.seite.getByRole('textbox', { name: 'Text', exact: true }).fill('Ein Thread nur für diesen Test.');
		// Der Editor beginnt mit allen Untergruppen und Jungfischer + Familie, die Mutter gehoert also dazu.
		await expect(leitung.seite.getByLabel('Rollen')).toHaveValue('JUNGFISCHER_FAMILIE');
		await leitung.seite.getByRole('button', { name: 'Veröffentlichen' }).click();
		await expect(leitung.seite.getByRole('status').filter({ hasText: 'Veröffentlicht' })).toBeVisible();
		await expect(leitung.seite).toHaveURL(new RegExp(`/${SLUG}/verwaltung/threads/(?!neu$)[^/]+$`));
		const id = new URL(leitung.seite.url()).pathname.split('/').pop() ?? '';

		const mutter = await ausSitzung(browser, 'mutter');
		const ws = await oeffneVerbunden(mutter.seite, `/${SLUG}/t/${threadSegment(id, titel)}`);
		await expect(mutter.seite.getByRole('heading', { name: titel, level: 1 })).toBeVisible();

		const signal = ws.waitForEvent('framereceived');
		await leitung.seite.getByLabel('Rollen').selectOption({ label: 'Nur Jugendleiter' });
		await leitung.seite.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect(leitung.seite.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();

		await expect(mutter.seite.getByRole('heading', { name: 'Nicht gefunden oder keine Berechtigung' })).toBeVisible({
			timeout: 5000,
		});
		await expect(mutter.seite.getByRole('heading', { name: titel })).toHaveCount(0);
		await kamLive(ws, signal);
		await mutter.kontext.close();
		await leitung.kontext.close();
	});

	test('Ohne Verbindung steht nach 2 s der Hinweis im Kopf', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'mutter');
		// Vor dem ersten Aufruf: Jeder Versuch wird sofort geschlossen, der Client bleibt im Backoff.
		await seite.routeWebSocket(/\/ws$/, (ws) => ws.close());
		const kopf = seite.locator('jf-mitglieder-huelle > header.kopf');
		const beginn = Date.now();
		await seite.goto(`/${SLUG}/`);
		await expect(seite.getByRole('heading', { name: 'Hallo Mara' })).toBeVisible();
		await expect(kopf.getByRole('status')).toHaveText('Nicht verbunden – Inhalte evtl. veraltet', { timeout: 5000 });
		// Nicht vor den 2 s: Ein kurzer Aussetzer beim Verbinden soll nichts anzeigen.
		expect(Date.now() - beginn, 'Hinweis frueher als nach 2 s').toBeGreaterThanOrEqual(2000);
		await kontext.close();
	});

	test('Leitung traegt fuer Mia nach, Mia sieht es', async ({ browser }) => {
		const leitung = await ausSitzung(browser, 'leitung');
		await leitung.seite.goto(`/${SLUG}/verwaltung/threads`);
		await leitung.seite
			.getByRole('region', { name: 'Aktiv' })
			.getByRole('listitem')
			.filter({ hasText: '🎳 Bowling' })
			.getByRole('link', { name: 'Antworten' })
			.click();
		await expect(leitung.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();

		// Die Gruppe nach ihrer Ueberschrift ("✓ Dabei (1)"), nicht irgendein Text mit Mias Namen.
		const gruppe = (titel: string) =>
			leitung.seite
				.locator('section[data-gruppe]')
				.filter({ has: leitung.seite.getByRole('heading', { name: titel }) });
		await expect(gruppe('✓ Dabei')).toContainText('Mia M.');
		await gruppe('✓ Dabei').getByRole('button', { name: 'Eintragen für Mia M.' }).click();
		await leitung.seite
			.getByRole('group', { name: 'Antwort für Mia M.' })
			.getByRole('button', { name: '? Vielleicht' })
			.click();
		await expect(gruppe('? Vielleicht')).toContainText('Mia M.');
		await expect(gruppe('? Vielleicht')).toContainText('eingetragen von Lea L.');
		await expect(gruppe('✓ Dabei').getByRole('heading')).toHaveText('✓ Dabei (0)');
		await leitung.kontext.close();

		const kind = await ausSitzung(browser, 'kind');
		await kind.seite.goto(`/${SLUG}/t/${bowling}`);
		const zeileDu = kind.seite.locator('jf-umfrage-modul .zeile').filter({ hasText: 'Du' });
		await expect(zeileDu).toContainText('? Vielleicht');
		await expect(zeileDu).toContainText('eingetragen von Lea L.');
		await kind.kontext.close();
	});

	test('Leitung archiviert Bowling im Editor und stellt es auf der Thread-Seite wieder her', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'leitung');
		await seite.goto(`/${SLUG}/verwaltung/threads/${bowlingId}`);
		await expect(seite.getByRole('heading', { name: 'Thread bearbeiten', level: 1 })).toBeVisible();
		await seite.getByRole('button', { name: 'Archivieren' }).click();
		// Der Knopf wechselt erst mit der Antwort des Servers; vorher waere "Thread ansehen" ein Wettlauf.
		await expect(seite.getByRole('button', { name: 'Wiederherstellen' })).toBeVisible();

		// Die Liste in einer zweiten Seite, damit der Editor fuer "Thread ansehen" stehen bleibt.
		const liste = await kontext.newPage();
		await liste.goto(`/${SLUG}/threads`);
		await expect(liste.getByRole('heading', { name: 'Threads', level: 1 })).toBeVisible();
		const abschnitt = (titel: string) =>
			liste.locator('jf-abschnitt').filter({ has: liste.getByRole('heading', { name: titel, exact: true }) });
		const bowlingZeile = liste.getByRole('main').getByRole('link', { name: /Bowling/ });
		// Archiv zu: keine Zeile, nur die Zahl; "Aktiv" kennt Bowling nicht mehr.
		await expect(liste.getByText('Archiv · 1', { exact: true })).toBeVisible();
		await expect(bowlingZeile).toHaveCount(0);
		await expect(abschnitt('Aktiv').getByRole('link', { name: /Bowling/ })).toHaveCount(0);
		await liste.getByText('Archiv · 1', { exact: true }).click();
		await expect(liste.locator('details.archiv').getByRole('link', { name: /Bowling/ })).toBeVisible();

		// Die Suche findet auch den archivierten Thread und klappt das Archiv dafuer auf.
		await liste.goto(`/${SLUG}/threads`);
		await liste.getByLabel('Threads durchsuchen').fill('bowl');
		await expect(liste).toHaveURL(/suche=bowl/);
		await expect(liste.locator('details.archiv').getByRole('link', { name: /Bowling/ })).toBeVisible();

		await seite.getByRole('link', { name: 'Thread ansehen' }).click();
		await expect(seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		const marke = seite.locator('header').getByText('Archiviert', { exact: true });
		await expect(marke).toBeVisible();
		await seite.getByRole('button', { name: 'Wiederherstellen' }).click();
		await expect(marke).toHaveCount(0);
		await expect(seite.getByRole('button', { name: 'Wiederherstellen' })).toHaveCount(0);

		await liste.goto(`/${SLUG}/threads`);
		await expect(abschnitt('Aktiv').getByRole('link', { name: /Bowling/ })).toBeVisible();
		await expect(liste.getByText(/^Archiv · /)).toHaveCount(0);
		await kontext.close();
	});

	test('Ohne Sitzung fuehrt die Anmeldung zur aufgerufenen Seite zurueck', async ({ browser }) => {
		const { kontext, seite } = await person(browser);

		await seite.goto(`/${SLUG}/profil`);
		await expect(seite).toHaveURL(
			(url) => url.pathname === `/${SLUG}/anmelden` && url.searchParams.get('weiter') === `/${SLUG}/profil`,
		);
		await seite.getByLabel('E-Mail oder Anmeldename').fill(MUTTER_MAIL);
		await seite.getByLabel('Passwort', { exact: true }).fill(TESTPASSWORT);
		await seite.getByRole('button', { name: 'Anmelden', exact: true }).click();
		await expect(seite).toHaveURL(new RegExp(`/${SLUG}/profil$`));
		// Nicht nur die Adresse: Die Seite muss mit den Daten der angemeldeten Person geladen sein.
		await expect(seite.getByRole('heading', { name: 'Profil', level: 1 })).toBeVisible();
		await expect(seite.getByRole('heading', { name: 'Du', exact: true })).toBeVisible();
		await expect(seite.getByRole('definition').filter({ hasText: 'Mara Muster' })).toBeVisible();
		await expect(seite.getByRole('definition').filter({ hasText: MUTTER_MAIL })).toBeVisible();
		await kontext.close();
	});
});
