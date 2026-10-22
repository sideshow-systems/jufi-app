import {
	type Browser,
	type BrowserContext,
	expect,
	type Locator,
	type Page,
	request,
	test,
	type WebSocket,
} from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { berlinerTag, MONATSNAMEN, tagPlus, threadSegment } from '@jufi/domain';
import { BASIS_URL, erzeugeJpeg, passkeyGeraet, TESTPASSWORT, ZUSTAND } from './hilfen';
import { leisteHatFuenfEintraege, punktUeberdecktTextNicht } from './messen';
import { beendeFrist, fuelleAustausch, legeKindAn, leseFrist, personIdMitMail, setzeFrist } from './threads';

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

/** Ein erzeugtes PDF-Geruest: Der Server erkennt den Typ am Anfang der Bytes, und die Bytes kommen unveraendert zurueck. */
const PDF_BYTES = Buffer.from(
	'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
	'latin1',
);

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
async function ausSitzung(
	browser: Browser,
	rolle: string,
	optionen: Parameters<Browser['newContext']>[0] = {},
): Promise<{ kontext: BrowserContext; seite: Page }> {
	const kontext = await browser.newContext({ ...optionen, storageState: join(ZUSTAND, `${rolle}.json`) });
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
	// Beide zusammen: Scheitert das Warten auf den Socket, bliebe das auf den Abgleich sonst unbeachtet
	// stehen und meldete sich spaeter als unbehandelte Ablehnung neben der eigentlichen Meldung.
	const [ws] = await Promise.all([socket, abgleich]);
	expect(ws.isClosed(), 'Socket nach dem ersten Abgleich zu; nimmt der Server das Upgrade an?').toBe(false);
	return ws;
}

/**
 * Das Signal kam ueber denselben Socket, der seit dem Oeffnen steht. Ohne Abbruch gab es keinen
 * Abgleich nach Neuverbinden, also hat das Signal die Seite aktualisiert, nicht ein Nachholen. Der
 * dritte Anlass fuer einen Abgleich, die Rueckkehr in den Vordergrund, kommt hier nicht vor: Jeder
 * Kontext hat seine eigene, stets sichtbare Seite, und gewechselt wird zwischen ihnen nicht.
 */
async function kamLive<T>(ws: WebSocket, signal: Promise<T>): Promise<T> {
	const wert = await signal;
	expect(ws.isClosed(), 'Socket zwischendurch zu; kam die Aenderung ueber den Abgleich statt live?').toBe(false);
	return wert;
}

/** Ein Signal des Hubs aus einem Frame, oder null, wenn der Frame keines ist. */
function alsSignal(payload: string | Buffer): { stand: number; threadId: string | null; art: string } | null {
	try {
		const wert = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as unknown;
		return wert && typeof wert === 'object' && 'stand' in wert && 'art' in wert
			? (wert as { stand: number; threadId: string | null; art: string })
			: null;
	} catch {
		return null;
	}
}

/**
 * Entprellen der Nachlader (Entscheidung 10). Nur fuer den Beweis, dass etwas ausbleibt: Laedt ein
 * Fehler die Ansicht ueber einen Nachlader nach, geht die Anfrage erst nach dieser Zeit hinaus.
 */
const ENTPRELLEN_MS = 250;

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

	test('Mats kommt als zweites Kind der Mutter dazu', async () => {
		// Direkt in der Datenbank: Mia entstand schon ueber das Formular, ein zweites Kind wiederholte nur
		// diesen Weg. Geprueft wird, was mit zwei Kindern geschieht (Start, Antworten, Teilen, Fristende).
		const maraId = await personIdMitMail(SLUG, MUTTER_MAIL);
		await legeKindAn(SLUG, maraId, 'Mats', 'Muster');
	});

	test('Mutter sieht Bowling auf Start, am Punkt der Leiste, in der Liste und im Kalender', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'mutter');
		// Handymass: Die Leiste und der Punkt sind dafuer gebaut, und gemessen wird an dem, was da ist.
		await seite.setViewportSize({ width: 375, height: 812 });
		await seite.goto(`/${SLUG}/`);
		await expect(seite.getByRole('heading', { name: 'Hallo Mara' })).toBeVisible();

		const leiste = hauptnavigation(seite);
		await expect(leiste.getByRole('link')).toHaveCount(5);
		for (const name of ['Start', 'Threads', 'Termine', 'Medien', 'Mehr']) {
			await expect(leiste.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
		}

		// Die Zeile ist die offene Umfrage fuer Mia (mit ihrem Namen davor), nicht irgendein Text mit Bowling.
		const bereich = (titel: string) =>
			seite.locator('jf-abschnitt').filter({ has: seite.getByRole('heading', { name: titel, exact: true }) });
		// Je Kind eine Zeile, mit dem Vornamen davor; ohne ihn liessen sich die beiden nicht unterscheiden.
		const brauchtAntwort = bereich('Braucht deine Antwort');
		await expect(brauchtAntwort.getByRole('link', { name: /^Mia: .*Bowling noch offen/ })).toBeVisible();
		await expect(brauchtAntwort.getByRole('link', { name: /^Mats: .*Bowling noch offen/ })).toBeVisible();
		await expect(brauchtAntwort.getByRole('link', { name: /Bowling noch offen/ })).toHaveCount(2);
		await expect(bereich('Neu seit deinem letzten Besuch').getByRole('link', { name: /Bowling/ })).toContainText(
			'Neuer Thread',
		);

		// Der Punkt an "Threads", hell und dunkel; die Ueberlappung mit dem Icon ist gewollt und wird nur genannt.
		const punkt = leiste.getByRole('link', { name: /^Threads/ }).getByRole('img', { name: 'neu' });
		await expect(punkt).toBeVisible();
		for (const schema of ['dark', 'light'] as const) {
			await seite.emulateMedia({ colorScheme: schema });
			await leisteHatFuenfEintraege(seite);
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

		// Eine Mutter, zwei Kinder (Rahmen 13): Jede Zeile antwortet fuer sich, Mats mit etwas anderem als Mia.
		const zeileMats = mutter.seite.locator('jf-umfrage-modul .zeile').filter({ hasText: 'Mats' });
		await expect(zeileMats).toBeVisible();
		await zeileMats.getByRole('button', { name: '✗ Abgesagt' }).click();
		await expect(zeileMats).toContainText('von dir eingetragen');
		await expect(zeileMia).toContainText('von dir eingetragen');

		// Beide Zeilen sind beantwortet, also steht auf dem Start nichts mehr unter "Braucht deine Antwort".
		await mutter.seite.goto(`/${SLUG}/`);
		await expect(mutter.seite.getByRole('heading', { name: 'Hallo Mara' })).toBeVisible();
		// Erst der Beweis, dass die Bloecke geladen sind: Der Abschnitt "Braucht deine Antwort" fehlt auch,
		// solange noch nichts da ist, und "keiner da" bestuende sonst auf einer Seite, die noch laedt.
		// "Als Naechstes" kommt aus derselben Antwort wie die offenen Punkte.
		await expect(
			mutter.seite
				.locator('jf-start-bloecke jf-abschnitt')
				.filter({ has: mutter.seite.getByRole('heading', { name: 'Als Nächstes', exact: true }) })
				.getByRole('link', { name: /Bowling/ }),
		).toBeVisible();
		await expect(mutter.seite.getByRole('link', { name: /Bowling noch offen/ })).toHaveCount(0);
		await expect(
			mutter.seite.locator('jf-abschnitt').filter({
				has: mutter.seite.getByRole('heading', { name: 'Braucht deine Antwort', exact: true }),
			}),
		).toHaveCount(0);
		await mutter.seite.goto(`/${SLUG}/t/${bowling}`);
		await expect(mutter.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();

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
		// Ein Beobachter im Browser haelt jedes Erscheinen fest.
		await leitung.seite.evaluate(() => {
			const fenster = window as unknown as { zahlGesehen: boolean };
			fenster.zahlGesehen = false;
			new MutationObserver(() => {
				if (document.querySelector('nav[aria-label="Ansicht"] .zahl')) fenster.zahlGesehen = true;
			}).observe(document.body, { childList: true, subtree: true, characterData: true });
		});
		// Der Zaehler kaeme nur mit einer neu geladenen Ansicht (GET /threads/<id>); fuer eine Live-Nachricht
		// im offenen Verlauf laedt die Seite weder sie noch den Verlauf. Gezaehlt wird ab dem Signal: Der
		// Abgleich beim Oeffnen laedt beides einmal, und das ist laengst vorbei, wenn die Mutter sendet.
		let nachSignal = false;
		const ladenNachSignal: string[] = [];
		leitung.seite.on('request', (r) => {
			const pfad = new URL(r.url()).pathname;
			if (nachSignal && r.method() === 'GET' && pfad.startsWith(`/${SLUG}/api/v1/threads/${bowlingId}`)) {
				ladenNachSignal.push(pfad);
			}
		});
		// Alle Gelesen-Meldungen des Verlaufs mit ihrem Stand; die beim Oeffnen hat einen kleineren.
		const meldungen: { bis: number; status: number }[] = [];
		leitung.seite.on('response', (r) => {
			if (r.request().method() !== 'PUT' || !new URL(r.url()).pathname.endsWith(`/threads/${bowlingId}/gelesen`)) {
				return;
			}
			const koerper = r.request().postDataJSON() as { bereich?: string; bis?: number };
			if (koerper.bereich === 'verlauf' && typeof koerper.bis === 'number') {
				meldungen.push({ bis: koerper.bis, status: r.status() });
			}
		});
		const istNachricht = (payload: string | Buffer) => {
			const s = alsSignal(payload);
			return s?.art === 'VERLAUF' && s.threadId === bowlingId;
		};
		// Vor waitForEvent angemeldet, also vor ihm gerufen: Ab diesem Frame zaehlt jedes Laden.
		ws.on('framereceived', (f) => {
			if (istNachricht(f.payload)) nachSignal = true;
		});
		const signal = ws.waitForEvent('framereceived', { predicate: (f) => istNachricht(f.payload) });

		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/t/${bowling}?reiter=verlauf`);
		await mutter.seite.getByLabel('Nachricht schreiben').fill('Wir kommen zu zweit');
		await mutter.seite.getByRole('button', { name: 'Senden' }).click();
		await expect(mutter.seite.getByRole('listitem').filter({ hasText: 'Wir kommen zu zweit' })).toBeVisible();

		await expect(leitung.seite.getByRole('listitem').filter({ hasText: 'Wir kommen zu zweit' })).toBeVisible({
			timeout: 5000,
		});
		const frame = await kamLive(ws, signal);
		const stand = alsSignal(frame.payload)?.stand;
		expect(stand, 'Signal ohne Stand').toBeDefined();
		// Genau der Stand der Live-Nachricht: Die Seite meldet ihn, ohne die Ansicht neu zu laden (Entscheidung 8).
		await expect
			.poll(() => meldungen.find((m) => m.bis === stand)?.status, {
				message: `keine Gelesen-Meldung bis ${stand}, gemeldet: ${JSON.stringify(meldungen)}`,
				timeout: 5000,
			})
			.toBe(204);
		// Die eine feste Wartezeit des Ablaufs, denn zu zeigen ist ein Ausbleiben: Ein Neuladen aus dem
		// Signal ginge sofort hinaus (die Seite ruft ohne Entprellen), ueber einen Nachlader erst nach
		// ENTPRELLEN_MS. Gewartet wird darueber hinaus und nicht auf die Antwort: Es zaehlt schon, ob die
		// Anfrage hinausging. Verworfen: ohne Wartezeit pruefen -- ein entprelltes Neuladen fiele durch.
		await leitung.seite.waitForTimeout(ENTPRELLEN_MS * 2);
		expect(ladenNachSignal, 'Ansicht oder Verlauf nach dem Signal neu geladen').toEqual([]);
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

	test('Leitung teilt den Stand', async ({ browser }) => {
		// Zwischenablage nur mit Erlaubnis; 1280 x 800 ist ein feiner Zeiger, also kopiert die Seite, statt das Teilen-Blatt zu oeffnen.
		const { kontext, seite } = await ausSitzung(browser, 'leitung', {
			permissions: ['clipboard-read', 'clipboard-write'],
			viewport: { width: 1280, height: 800 },
		});
		await seite.goto(`/${SLUG}/t/${bowling}`);
		await expect(seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		await seite.getByRole('button', { name: 'Stand teilen' }).click();
		await expect(seite.getByRole('status').filter({ hasText: 'Kopiert' })).toBeVisible();
		await expect(seite.getByLabel('Text zum Teilen')).toHaveCount(0);

		const text = await seite.evaluate(() => navigator.clipboard.readText());
		expect(text.startsWith('🎳 *Bowling* – Stand '), `Titelzeile:\n${text}`).toBe(true);
		// Die Leitung sieht die Namen (3.4), also stehen sie im Text: Mia hat die Leitung nachgetragen, Mats die Mutter.
		expect(text).toContain('🤔 Vielleicht (1): Mia M.');
		expect(text).toContain('❌ Abgesagt (1): Mats M.');
		expect(text.endsWith(`👉 Antworten: ${BASIS_URL}/${SLUG}/t/${bowling}`), `Linkzeile:\n${text}`).toBe(true);
		await kontext.close();
	});

	test('Leitung laedt eine Ordnung hoch, die Mutter oeffnet sie in Medien', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'leitung', { viewport: { width: 1280, height: 800 } });
		await seite.goto(`/${SLUG}/verwaltung/dokumente`);
		await expect(seite.getByRole('heading', { name: 'Dokumente', level: 1 })).toBeVisible();

		const ordnungen = seite.locator('section[data-kategorie]').filter({
			has: seite.getByRole('heading', { name: 'Ordnungen', exact: true }),
		});
		// Erzeugt, nicht aus dem Repo: Der Typ zaehlt am Inhalt, und %PDF- am Anfang genuegt dem Server.
		await ordnungen.locator('input[data-hochladen]').setInputFiles({
			name: 'Jugendfischereiordnung.pdf',
			mimeType: 'application/pdf',
			buffer: PDF_BYTES,
		});
		// Der Titel ist der bereinigte Name ohne Endung (Plan, Entscheidung 9); die Zeile erscheint erst mit der Antwort des Servers.
		await expect(ordnungen.locator('li[data-dokument]')).toContainText('Jugendfischereiordnung');
		await expect(ordnungen.locator('li[data-hochladung]')).toHaveCount(0);
		await kontext.close();

		const mutter = await ausSitzung(browser, 'mutter');
		// Medien beginnt mit "Fotos & Dateien" (Plan, Entscheidung 13); die Dokumente liegen im zweiten
		// Reiter, und der Wechsel muss in der Adresse stehen, damit "Zurueck" dorthin fuehrt.
		await mutter.seite.goto(`/${SLUG}/medien`);
		await expect(mutter.seite.getByRole('heading', { name: 'Medien', level: 1 })).toBeVisible();
		await mutter.seite.getByRole('tab', { name: 'Dokumente' }).click();
		await expect(mutter.seite).toHaveURL(/[?&]reiter=dokumente/);
		await expect(mutter.seite.getByRole('tab', { name: 'Dokumente' })).toHaveAttribute('aria-selected', 'true');
		await expect(mutter.seite.getByRole('heading', { name: 'Ordnungen', level: 2 })).toBeVisible();
		// Leere Kategorien (Merkblaetter, Formulare) zeigt die Mitgliederseite nicht.
		await expect(mutter.seite.getByRole('heading', { level: 2 })).toHaveCount(1);
		const link = mutter.seite.getByRole('link', { name: /Jugendfischereiordnung/ });
		await expect(link).toBeVisible();
		const href = await link.getAttribute('href');
		expect(href, 'Adresse des Dokuments').toBeTruthy();

		// Mit der Sitzung der Mutter, wie ihr Browser den Link oeffnete; die Bytes muessen die hochgeladenen sein.
		const antwort = await mutter.kontext.request.get(new URL(href ?? '', BASIS_URL).toString());
		expect(antwort.status()).toBe(200);
		expect(antwort.headers()['content-type']).toContain('application/pdf');
		expect((await antwort.body()).equals(PDF_BYTES), 'ausgelieferte Bytes gleich den hochgeladenen').toBe(true);
		await mutter.kontext.close();
	});

	test('Leitung loescht das Dokument, die Mutter sieht Medien wieder leer', async ({ browser }) => {
		const leitung = await ausSitzung(browser, 'leitung', { viewport: { width: 1280, height: 800 } });
		await leitung.seite.goto(`/${SLUG}/verwaltung/dokumente`);
		await expect(leitung.seite.getByRole('heading', { name: 'Dokumente', level: 1 })).toBeVisible();
		await leitung.seite.getByRole('button', { name: '„Jugendfischereiordnung“ löschen' }).click();
		const dialog = leitung.seite.getByRole('dialog');
		await expect(dialog).toContainText('‚Jugendfischereiordnung‘ löschen?');
		await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
		await expect(leitung.seite.locator('li[data-dokument]')).toHaveCount(0);
		// Die Leitung sieht ihre leeren Kategorien hier weiter, sonst koennte sie keine mehr befuellen.
		await expect(leitung.seite.getByRole('heading', { name: 'Ordnungen', level: 2 })).toBeVisible();
		await leitung.kontext.close();

		const mutter = await ausSitzung(browser, 'mutter');
		// Hier ueber die Adresse mit Reiter: So oeffnet sie ein geteilter Link oder "Zurueck".
		await mutter.seite.goto(`/${SLUG}/medien?reiter=dokumente`);
		await expect(mutter.seite.getByText('Noch keine Dokumente.')).toBeVisible();
		await expect(mutter.seite.getByRole('heading', { level: 2 })).toHaveCount(0);
		await expect(mutter.seite.getByRole('link', { name: /Jugendfischereiordnung/ })).toHaveCount(0);
		await mutter.kontext.close();
	});

	// Fotos und Dateien der Threads (TP4 Etappe 2). Auf Bowling, dem Thread des Ablaufs: Die Leitung baut
	// ihn um, wie sie es in echt mit einem laufenden Thread taete, und Zielgruppe, Teilnahme-Umfrage und
	// zwei Kinder der Mutter sind schon da. Alle Bilder sind erzeugt (TP4-Spec 1.2).

	test('Leitung fuegt Bowling Dateien und Fotos hinzu und laedt im Editor eine Packliste hoch', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'leitung', { viewport: { width: 1280, height: 800 } });
		await seite.goto(`/${SLUG}/verwaltung/threads/${bowlingId}`);
		await expect(seite.getByRole('heading', { name: 'Thread bearbeiten', level: 1 })).toBeVisible();
		const hinzufuegen = seite.getByRole('group', { name: 'Modul hinzufügen' });
		const module = seite.locator('ol.module > li');
		const vorher = await module.count();

		await hinzufuegen.getByRole('button', { name: 'Dateien' }).click();
		// Ungespeichert gibt es nichts hochzuladen: Das Modul hat noch keine ID (Plan, Entscheidung 10).
		await expect(seite.getByText('Erst speichern, dann hochladen')).toBeVisible();
		await hinzufuegen.getByRole('button', { name: 'Fotos' }).click();
		await seite.getByRole('checkbox', { name: 'Alle Leser dürfen Fotos hochladen' }).check();
		await expect(module).toHaveCount(vorher + 2);
		await seite.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect(seite.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();

		// Nach dem Speichern hat das Datei-Modul eine ID; gewaehlt wird es ueber seine Zeile in der Liste.
		await module.nth(vorher).locator('button.waehlen').click();
		await expect(seite.getByRole('heading', { name: `Dateien (Modul ${vorher + 1})` })).toBeVisible();
		await seite.getByLabel('Dateien hochladen').setInputFiles({
			name: 'Packliste.pdf',
			mimeType: 'application/pdf',
			buffer: PDF_BYTES,
		});
		// Die Zahl kommt erst, wenn der Server die Datei hat und der Editor die Zahlen neu geladen hat.
		await expect(seite.getByText('1 Datei', { exact: true })).toBeVisible();
		await kontext.close();
	});

	test('Mutter laedt zwei Fotos hoch, Mia sieht sie live, ausgeliefert ohne EXIF', async ({ browser }) => {
		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/t/${bowling}`);
		await expect(mutter.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		const fotosMutter = mutter.seite.locator('jf-fotos-modul');
		await expect(fotosMutter.getByText('Noch keine Fotos.')).toBeVisible();

		// Der Hinweis nennt nur Kinder der Zielgruppe, die laut Teilnahme-Umfrage dabei sind (namen.ts,
		// ohneFotoEinwilligung). Mia steht in der Umfrage, gehoert also zur Zielgruppe; seit dem Nachtragen
		// der Leitung ist sie "Vielleicht", Mats hat abgesagt, also nennt der Hinweis noch niemanden.
		const zeileMia = mutter.seite.locator('jf-umfrage-modul .zeile').filter({ hasText: 'Mia' });
		await expect(zeileMia).toContainText('? Vielleicht');
		await expect(fotosMutter.locator('.hinweis')).toHaveCount(0);
		await zeileMia.getByRole('button', { name: 'Antwort für Mia ändern' }).click();
		await zeileMia.getByRole('button', { name: '✓ Dabei' }).click();
		await expect(zeileMia).toContainText('✓ Dabei');
		await expect(zeileMia).toContainText('von dir eingetragen');
		await mutter.seite.reload();
		await expect(fotosMutter.locator('.hinweis')).toHaveText('Von Mia M. dürfen keine Fotos gezeigt werden');

		// Mia hat den Thread offen, bevor die Fotos kommen.
		const kind = await ausSitzung(browser, 'kind');
		const ws = await oeffneVerbunden(kind.seite, `/${SLUG}/t/${bowling}`);
		const kacheln = kind.seite.locator('jf-fotos-modul button.kachel');
		await expect(kind.seite.locator('jf-fotos-modul').getByText('Noch keine Fotos.')).toBeVisible();
		const signal = ws.waitForEvent('framereceived', {
			predicate: (f) => alsSignal(f.payload)?.threadId === bowlingId,
		});

		// Eines groesser als 2560 px und mit GPS, damit Verkleinern und Entfernen der Metadaten etwas zu tun haben.
		const mitGps = await erzeugeJpeg(3000, 2000, true);
		expect((await sharp(mitGps).metadata()).exif, 'das erzeugte Bild traegt EXIF').toBeDefined();
		await fotosMutter.getByLabel('Fotos hochladen').setInputFiles([
			{ name: 'see.jpg', mimeType: 'image/jpeg', buffer: mitGps },
			{ name: 'steg.jpg', mimeType: 'image/jpeg', buffer: await erzeugeJpeg(1200, 900) },
		]);
		await expect(fotosMutter.locator('button.kachel')).toHaveCount(2);
		await expect(fotosMutter.locator('li[data-hochladung]')).toHaveCount(0);

		await expect(kacheln).toHaveCount(2, { timeout: 5000 });
		await kamLive(ws, signal);
		await kind.kontext.close();

		// Mit der Sitzung der Mutter, wie ihr Browser die Grossansicht laedt: die 2560er-Fassung, nicht die Vorschau.
		const breiten: number[] = [];
		for (const bild of await fotosMutter.locator('button.kachel img').all()) {
			const vorschau = await bild.getAttribute('src');
			expect(vorschau, 'Adresse der Vorschau').toMatch(/\/vorschau$/);
			const antwort = await mutter.kontext.request.get(
				new URL((vorschau ?? '').replace(/\/vorschau$/, ''), BASIS_URL).toString(),
			);
			expect(antwort.status()).toBe(200);
			expect(antwort.headers()['content-type']).toContain('image/jpeg');
			const meta = await sharp(await antwort.body()).metadata();
			expect(meta.exif, 'EXIF im ausgelieferten Foto').toBeUndefined();
			expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2560);
			breiten.push(meta.width ?? 0);
		}
		// Das grosse Foto ist auf die lange Seite verkleinert, das kleine nicht vergroessert.
		expect(breiten.sort((a, b) => a - b)).toEqual([1200, 2560]);
		await mutter.kontext.close();
	});

	test('Mutter erlaubt Fotos fuer Mia, der Hinweis im offenen Thread verschwindet live', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'mutter');
		const ws = await oeffneVerbunden(seite, `/${SLUG}/t/${bowling}`);
		const hinweis = seite.locator('jf-fotos-modul .hinweis');
		await expect(hinweis).toContainText('Mia M.');
		const signal = ws.waitForEvent('framereceived');

		// Eine zweite Seite derselben Person: Der Thread bleibt offen, ohne neu geladen zu werden.
		const verwaltung = await kontext.newPage();
		await verwaltung.goto(`/${SLUG}/meine-jungfischer`);
		const karte = verwaltung
			.getByRole('article')
			.filter({ has: verwaltung.getByRole('heading', { name: 'Mia Muster' }) });
		await expect(karte).toContainText('Fotos: nicht erlaubt');
		await karte.getByRole('button', { name: 'Fotos erlauben' }).click();
		await karte.getByRole('button', { name: 'Ja, Fotos erlauben' }).click();
		await expect(karte).toContainText('Fotos: erlaubt');

		await expect(hinweis).toHaveCount(0, { timeout: 5000 });
		await kamLive(ws, signal);
		await kontext.close();
	});

	test('Leitung loescht ein Foto in der Grossansicht, die Mutter sieht noch eins', async ({ browser }) => {
		const leitung = await ausSitzung(browser, 'leitung');
		await leitung.seite.goto(`/${SLUG}/t/${bowling}`);
		const kacheln = leitung.seite.locator('jf-fotos-modul button.kachel');
		await expect(kacheln).toHaveCount(2);
		await kacheln.first().click();
		const grossansicht = leitung.seite.getByRole('dialog', { name: /^Foto von / });
		await expect(grossansicht).toContainText('1 von 2');
		await grossansicht.getByRole('button', { name: 'Löschen', exact: true }).click();
		const frage = leitung.seite.getByRole('dialog', { name: 'Foto löschen' });
		await frage.getByRole('button', { name: 'Löschen', exact: true }).click();
		await expect(kacheln).toHaveCount(1);
		await leitung.kontext.close();

		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/t/${bowling}`);
		await expect(mutter.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		await expect(mutter.seite.locator('jf-fotos-modul button.kachel')).toHaveCount(1);
		await mutter.kontext.close();
	});

	test('Mutter sieht in Medien den Block von Bowling, die Dokumente im zweiten Reiter', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'mutter');
		await seite.goto(`/${SLUG}/medien`);
		await expect(seite.getByRole('heading', { name: 'Medien', level: 1 })).toBeVisible();
		await expect(seite.getByRole('tab', { name: 'Fotos & Dateien' })).toHaveAttribute('aria-selected', 'true');
		const block = seite.locator('[data-block]').filter({ has: seite.getByRole('heading', { name: /Bowling/ }) });
		await expect(block).toHaveCount(1);
		await expect(block.locator('.zahl')).toHaveText('1 Foto');
		await expect(block.locator('ul.vorschau img')).toHaveCount(1);
		await expect(block.getByRole('link', { name: /Packliste\.pdf/ })).toBeVisible();

		// Der Dokumente-Reiter ist weiter leer, seit die Leitung die Ordnung geloescht hat.
		await seite.getByRole('tab', { name: 'Dokumente' }).click();
		await expect(seite).toHaveURL(/[?&]reiter=dokumente/);
		await expect(seite.getByText('Noch keine Dokumente.')).toBeVisible();
		await expect(seite.getByRole('link', { name: /Packliste/ })).toHaveCount(0);
		await kontext.close();
	});

	// Die Helferliste (TP4 Etappe 3), wieder auf Bowling: Die Leitung haengt sie an den laufenden Thread,
	// die Mutter traegt sich ein, Mia sieht es live, die Leitung traegt nach und versucht, eine belegte
	// Position zu entfernen. Die Einheit bleibt bei der Vorgabe "pro Erwachsener": gefragt sind Mutter
	// und Leitung, Mia liest nur mit.

	/** Eine Position der Helferliste auf der Thread-Seite, nach ihrem Text (section mit aria-label). */
	function helferPosition(seite: Page, text: string): Locator {
		return seite.locator('jf-helfer-modul').getByRole('region', { name: text, exact: true });
	}

	/** Die Mutter traegt sich auf ihrer offenen Thread-Seite mit Notiz ein und wartet auf die Antwort des Servers. */
	async function trageEin(position: Locator, notiz: string): Promise<void> {
		await position.getByRole('button', { name: 'Eintragen', exact: true }).click();
		await position.getByLabel('Notiz (optional)').fill(notiz);
		// Der Knopf im Formular, nicht der, der es geoeffnet hat: Beide heissen "Eintragen".
		await position.locator('form').getByRole('button', { name: 'Eintragen', exact: true }).click();
		await expect(position.locator('form')).toHaveCount(0);
	}

	test('Leitung fuegt Bowling eine Helferliste mit Kuchen und Grill hinzu', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'leitung', { viewport: { width: 1280, height: 800 } });
		const fristTag = tagPlus(berlinerTag(new Date()), 3);
		await seite.goto(`/${SLUG}/verwaltung/threads/${bowlingId}`);
		await expect(seite.getByRole('heading', { name: 'Thread bearbeiten', level: 1 })).toBeVisible();
		const module = seite.locator('ol.module > li');
		const vorher = await module.count();

		await seite.getByRole('group', { name: 'Modul hinzufügen' }).getByRole('button', { name: 'Helferliste' }).click();
		await expect(module).toHaveCount(vorher + 1);
		const felder = seite.locator('jf-helfer-felder');
		// Die Vorgabe des Editors: pro Erwachsener, eine leere Position mit einem Platz.
		await expect(felder.getByLabel('Einheit')).toHaveValue('ERWACHSENER');
		await felder.getByRole('textbox', { name: 'Position 1', exact: true }).fill('Kuchen');
		await expect(felder.getByRole('spinbutton', { name: 'Anzahl: Position 1', exact: true })).toHaveValue('1');
		await felder.getByRole('button', { name: 'Position hinzufügen' }).click();
		await felder.getByRole('textbox', { name: 'Position 2', exact: true }).fill('Grill');
		await felder.getByRole('spinbutton', { name: 'Anzahl: Position 2', exact: true }).fill('2');
		await felder.getByRole('checkbox', { name: 'ohne Frist' }).uncheck();
		await felder.getByLabel('Datum', { exact: true }).fill(fristTag);
		await expect(felder.getByLabel('Uhrzeit', { exact: true })).toHaveValue('18:00');

		// Die Vorschau zeigt die Liste, wie die Familie sie sehen wird, noch ohne Eintraege.
		const vorschau = seite.getByRole('region', { name: 'Vorschau am Handy' }).locator('jf-helfer-modul');
		await expect(vorschau.getByRole('region', { name: 'Kuchen', exact: true })).toContainText('0/1');
		await expect(vorschau.getByRole('region', { name: 'Grill', exact: true })).toContainText('0/2');

		await seite.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect(seite.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
		await kontext.close();
	});

	test('Mutter traegt sich ueber Braucht deine Antwort bei Kuchen ein, Mia sieht es live', async ({ browser }) => {
		// Mia hat den Thread offen, bevor die Mutter sich eintraegt.
		const kind = await ausSitzung(browser, 'kind');
		const ws = await oeffneVerbunden(kind.seite, `/${SLUG}/t/${bowling}`);
		const kuchenKind = helferPosition(kind.seite, 'Kuchen');
		await expect(kuchenKind).toContainText('Noch niemand eingetragen.');
		// Gefragt sind Erwachsene: Mia sieht die Liste, hat aber keinen Knopf darin.
		await expect(kind.seite.locator('jf-helfer-modul').getByRole('button')).toHaveCount(0);
		const signal = ws.waitForEvent('framereceived', {
			predicate: (f) => alsSignal(f.payload)?.threadId === bowlingId,
		});

		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/`);
		await expect(mutter.seite.getByRole('heading', { name: 'Hallo Mara' })).toBeVisible();
		const brauchtAntwort = mutter.seite
			.locator('jf-abschnitt')
			.filter({ has: mutter.seite.getByRole('heading', { name: 'Braucht deine Antwort', exact: true }) });
		// Die eigene Zeile, ohne Vornamen davor: Die Umfrage haben Mia und Mats schon beantwortet, offen ist
		// nur die Helferliste, und die fragt die Mutter selbst.
		const zeile = brauchtAntwort.getByRole('link', { name: /^🎳 Bowling noch offen/ });
		await expect(zeile).toBeVisible();
		await expect(brauchtAntwort.getByRole('link')).toHaveCount(1);
		await zeile.click();
		await expect(mutter.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();

		const kuchen = helferPosition(mutter.seite, 'Kuchen');
		await trageEin(kuchen, 'Marmorkuchen');
		await expect(kuchen.locator('.fuell')).toHaveText(/^\s*1\/1\s*voll\s*$/);
		await expect(kuchen).toContainText('Mara M.');
		await expect(kuchen).toContainText('Marmorkuchen');

		await expect(kuchenKind).toContainText('Marmorkuchen', { timeout: 5000 });
		await expect(kuchenKind).toContainText('Mara M.');
		await expect(kuchenKind.locator('.fuell')).toHaveText(/^\s*1\/1\s*voll\s*$/);
		await kamLive(ws, signal);
		await kind.kontext.close();

		// Mit einem Eintrag im Modul ist die Liste fuer die Mutter erledigt (Plan zu Etappe 3, Entscheidung 8),
		// auch wenn Grill noch Platz hat. Erst der Beweis, dass die Bloecke geladen sind.
		await mutter.seite.goto(`/${SLUG}/`);
		await expect(
			mutter.seite
				.locator('jf-start-bloecke jf-abschnitt')
				.filter({ has: mutter.seite.getByRole('heading', { name: 'Als Nächstes', exact: true }) })
				.getByRole('link', { name: /Bowling/ }),
		).toBeVisible();
		await expect(brauchtAntwort).toHaveCount(0);
		await mutter.kontext.close();
	});

	test('Leitung traegt die Mutter in der Antworten-Uebersicht bei Grill nach, die Mutter sieht es', async ({
		browser,
	}) => {
		const leitung = await ausSitzung(browser, 'leitung', { viewport: { width: 1280, height: 800 } });
		await leitung.seite.goto(`/${SLUG}/verwaltung/threads/${bowlingId}/antworten`);
		await expect(leitung.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		const block = leitung.seite.locator('[data-helfer]');
		await expect(block.getByRole('heading', { name: 'Helferliste', level: 2 })).toBeVisible();
		// Gefragt sind die Mutter und die Leitung selbst (Jugendleiter); ohne Eintrag ist nur noch die Leitung.
		await expect(block).toContainText('1 ohne Eintrag');
		const kuchen = block.getByRole('region', { name: 'Kuchen', exact: true });
		await expect(kuchen.locator('.zahl')).toHaveText('1/1');
		await expect(kuchen).toContainText('Marmorkuchen');
		// Eine volle Position hat kein Formular zum Nachtragen.
		await expect(kuchen.getByRole('form')).toHaveCount(0);

		const grill = block.getByRole('region', { name: 'Grill', exact: true });
		const formular = grill.getByRole('form', { name: 'Eintragen in Grill' });
		await formular.getByLabel('Person').selectOption({ label: 'Mara M.' });
		await formular.getByRole('button', { name: 'Eintragen in Grill' }).click();
		await expect(grill.locator('.zahl')).toHaveText('1/2');
		await expect(grill).toContainText('Mara M.');
		await expect(grill).toContainText('eingetragen von Lea L.');
		await leitung.kontext.close();

		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/t/${bowling}`);
		const grillMutter = helferPosition(mutter.seite, 'Grill');
		await expect(grillMutter.locator('.fuell')).toHaveText(/^\s*1\/2\s*$/);
		await expect(grillMutter).toContainText('Mara M.');
		// Die Zeile geht die Mutter an, also sieht sie, wer sie eingetragen hat (Plan zu Etappe 3, Entscheidung 11).
		await expect(grillMutter).toContainText('eingetragen von Lea L.');
		await expect(grillMutter.getByRole('button', { name: 'Austragen', exact: true })).toBeVisible();
		await mutter.kontext.close();
	});

	test('Leitung kann Kuchen nicht entfernen, auch nicht aus einem Editor von vor dem Eintrag', async ({ browser }) => {
		const leitung = await ausSitzung(browser, 'leitung', { viewport: { width: 1280, height: 800 } });
		const felder = leitung.seite.locator('jf-helfer-felder');
		const entfernen = felder.getByRole('button', { name: 'Entfernen: Position 1', exact: true });
		/** Oeffnet den Editor frisch und waehlt die Helferliste, das letzte Modul. */
		const oeffneEditor = async () => {
			await leitung.seite.goto(`/${SLUG}/verwaltung/threads/${bowlingId}`);
			await expect(leitung.seite.getByRole('heading', { name: 'Thread bearbeiten', level: 1 })).toBeVisible();
			await leitung.seite.locator('ol.module > li').last().locator('button.waehlen').click();
			await expect(felder.getByRole('textbox', { name: 'Position 1', exact: true })).toHaveValue('Kuchen');
		};

		// Ein frischer Editor kennt den Eintrag und laesst das Entfernen gar nicht erst zu.
		await oeffneEditor();
		await expect(entfernen).toBeDisabled();

		// Damit der Server entscheiden muss, braucht es einen Editor, der den Eintrag nicht kennt: Die Mutter
		// traegt sich aus, die Leitung oeffnet den Editor neu, die Mutter traegt sich wieder ein. Der Editor
		// laedt Eintraege nicht live nach. Verworfen: den Editor vor dem ersten Eintrag offen zu halten -- dann
		// stuende dieser Schritt mitten im Eintragen der Mutter statt nach dem Nachtragen.
		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/t/${bowling}`);
		const kuchen = helferPosition(mutter.seite, 'Kuchen');
		await kuchen.getByRole('button', { name: 'Austragen', exact: true }).click();
		await expect(kuchen).toContainText('Noch niemand eingetragen.');
		await expect(kuchen.locator('.fuell')).toHaveText(/^\s*0\/1\s*$/);

		await oeffneEditor();
		await expect(entfernen).toBeEnabled();

		await trageEin(kuchen, 'Marmorkuchen');
		await expect(kuchen.locator('.fuell')).toHaveText(/^\s*1\/1\s*voll\s*$/);
		await mutter.kontext.close();

		await entfernen.click();
		await expect(felder.getByRole('textbox', { name: 'Position 1', exact: true })).toHaveValue('Grill');
		await leitung.seite.getByRole('button', { name: 'Speichern', exact: true }).click();
		// Der Satz des Servers steht an den Positionen der Helferliste, nicht unter den Knoepfen.
		await expect(felder.getByRole('alert')).toHaveText('Für „Kuchen“ hat sich schon jemand eingetragen.');
		await expect(leitung.seite.getByRole('status').filter({ hasText: 'Gespeichert' })).toHaveCount(0);
		await leitung.kontext.close();
	});

	test('Nach Fristende gibt es keinen Antwortknopf mehr, die Leitung traegt weiter nach', async ({ browser }) => {
		// Die Frist von Bowling kommt danach zurueck: Das Projekt layout misst die Antwortknoepfe der Seite,
		// und eine abgelaufene Frist nahm sie ihm. Gelesen wird sie vor dem Beenden, nicht neu erfunden.
		const urspruenglich = await leseFrist(SLUG, bowlingId);
		expect(urspruenglich, 'Bowling hat eine Frist').not.toBeNull();
		await beendeFrist(SLUG, bowlingId, new Date());
		try {
			const mutter = await ausSitzung(browser, 'mutter');
			await mutter.seite.goto(`/${SLUG}/t/${bowling}`);
			await expect(mutter.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
			const umfrage = mutter.seite.locator('jf-umfrage-modul');
			// Erst die Zeilen: Ohne sie bestuende "kein Knopf" auch auf einer Seite, die noch laedt.
			await expect(umfrage.locator('.zeile').filter({ hasText: 'Mia' })).toBeVisible();
			await expect(umfrage.locator('.zeile').filter({ hasText: 'Mats' })).toBeVisible();
			await expect(umfrage.locator('.frist')).toHaveText('Frist abgelaufen');
			await expect(umfrage.locator('.zeile').getByRole('button')).toHaveCount(0);
			await mutter.kontext.close();

			const leitung = await ausSitzung(browser, 'leitung');
			await leitung.seite.goto(`/${SLUG}/verwaltung/threads/${bowlingId}/antworten`);
			await expect(leitung.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
			const gruppe = (titel: string) =>
				leitung.seite
					.locator('section[data-gruppe]')
					.filter({ has: leitung.seite.getByRole('heading', { name: titel }) });
			// Bearbeiter tragen auch nach der Frist nach: Mia (seit den Foto-Schritten "Dabei") bleibt eintragbar ...
			await expect(gruppe('✓ Dabei').getByRole('button', { name: 'Eintragen für Mia M.' })).toBeVisible();
			// ... und fuer Mats geht es von "Abgesagt" auf "Dabei".
			await gruppe('✗ Abgesagt').getByRole('button', { name: 'Eintragen für Mats M.' }).click();
			await leitung.seite
				.getByRole('group', { name: 'Antwort für Mats M.' })
				.getByRole('button', { name: '✓ Dabei' })
				.click();
			await expect(gruppe('✓ Dabei')).toContainText('Mats M.');
			await expect(gruppe('✓ Dabei')).toContainText('eingetragen von Lea L.');
			await expect(gruppe('✗ Abgesagt').getByRole('heading')).toHaveText('✗ Abgesagt (0)');
			await leitung.kontext.close();
		} finally {
			await setzeFrist(SLUG, bowlingId, urspruenglich);
		}
	});

	// Die Fahrgemeinschaft (TP4 Etappe 4, Spec 1.1 Schritt 4 verkleinert), wieder auf Bowling und nur fuer die
	// Hinfahrt: Die Mutter bietet ein Auto an und setzt Mia hinein, die Leitung setzt Mats dazu, die Mutter zieht
	// das Auto zurueck. Erst hier, weil "Braucht noch Mitfahrt" nur Kinder mit "Dabei" kennt: Mia hat seit den
	// Foto-Schritten zugesagt, Mats seit dem Nachtragen nach Fristende.

	/** Die Fahrgemeinschaft auf der Thread-Seite. */
	function fahrt(seite: Page): Locator {
		return seite.locator('jf-fahrt-modul');
	}

	/** Das Auto der Mutter in der Fahrgemeinschaft, nach dem Namen des Fahrers. */
	function autoDerMutter(seite: Page): Locator {
		return fahrt(seite).locator('section.auto').filter({ hasText: 'Mara M.' });
	}

	/** Die Kinder unter "Braucht noch Mitfahrt". */
	function brauchtMitfahrt(seite: Page): Locator {
		return fahrt(seite).locator('[data-abschnitt="braucht"]');
	}

	test('Leitung fuegt Bowling eine Fahrgemeinschaft nur fuer die Hinfahrt hinzu', async ({ browser }) => {
		const { kontext, seite } = await ausSitzung(browser, 'leitung', { viewport: { width: 1280, height: 800 } });
		await seite.goto(`/${SLUG}/verwaltung/threads/${bowlingId}`);
		await expect(seite.getByRole('heading', { name: 'Thread bearbeiten', level: 1 })).toBeVisible();
		const module = seite.locator('ol.module > li');
		const vorher = await module.count();

		const hinzufuegen = seite.getByRole('group', { name: 'Modul hinzufügen' });
		await hinzufuegen.getByRole('button', { name: 'Fahrgemeinschaft' }).click();
		await expect(module).toHaveCount(vorher + 1);
		// Hoechstens eine je Thread (Plan-Entscheidung 9): "Modul hinzufuegen" bietet keine zweite an.
		await expect(hinzufuegen.getByRole('button', { name: 'Fahrgemeinschaft' })).toHaveCount(0);
		const felder = seite.locator('jf-fahrt-felder');
		await expect(felder.getByRole('checkbox', { name: 'Hinfahrt' })).toBeChecked();
		await felder.getByRole('checkbox', { name: 'Rückfahrt' }).uncheck();

		// Die Vorschau zeigt nur die Hinfahrt, also keinen Umschalter Hin/Rueck, und noch kein Auto.
		const vorschau = seite.getByRole('region', { name: 'Vorschau am Handy' }).locator('jf-fahrt-modul');
		await expect(vorschau.getByRole('heading', { name: 'Hinfahrt' })).toBeVisible();
		await expect(vorschau.getByRole('tablist')).toHaveCount(0);
		await expect(vorschau).toContainText('Noch kein Auto.');

		await seite.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect(seite.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
		await kontext.close();
	});

	test('Mutter bietet ein Auto an und setzt Mia hinein, Mia sieht sich live darin', async ({ browser }) => {
		// Mia hat den Thread offen, bevor die Mutter das Auto anbietet.
		const kind = await ausSitzung(browser, 'kind');
		const ws = await oeffneVerbunden(kind.seite, `/${SLUG}/t/${bowling}`);
		await expect(fahrt(kind.seite)).toContainText('Noch kein Auto.');
		const signal = ws.waitForEvent('framereceived', {
			predicate: (f) => alsSignal(f.payload)?.threadId === bowlingId,
		});

		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/t/${bowling}`);
		await expect(mutter.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		// Beide Kinder haben zugesagt und noch keine Mitfahrt.
		await expect(brauchtMitfahrt(mutter.seite)).toContainText('Mia M.');
		await expect(brauchtMitfahrt(mutter.seite)).toContainText('Mats M.');

		await fahrt(mutter.seite).getByRole('button', { name: 'Auto anbieten' }).click();
		const formular = fahrt(mutter.seite).locator('jf-fahrt-auto-formular');
		// Der Abfahrtstag ist mit dem Tag des Termins vorbelegt (Plan-Entscheidung 15).
		await expect(formular.getByLabel('Abfahrt am')).toHaveValue(terminTag);
		await formular.getByLabel('Plätze für Kinder').fill('2');
		await formular.getByLabel('Uhrzeit').fill('15:30');
		await formular.getByLabel('Treffpunkt').fill('Vereinsheim');
		await formular.getByRole('button', { name: 'Anbieten' }).click();
		await expect(formular).toHaveCount(0);

		const auto = autoDerMutter(mutter.seite);
		await expect(auto).toContainText('15:30 · Vereinsheim');
		await expect(auto.locator('.frei')).toHaveText('2 frei');
		await auto.getByRole('button', { name: 'Mia einsteigen' }).click();
		await expect(auto.locator('.kind').filter({ hasText: 'Mia M.' })).toBeVisible();
		await expect(auto.locator('.frei')).toHaveText('1 frei');
		await expect(brauchtMitfahrt(mutter.seite)).not.toContainText('Mia M.');
		await expect(brauchtMitfahrt(mutter.seite)).toContainText('Mats M.');
		await mutter.kontext.close();

		const autoKind = autoDerMutter(kind.seite);
		await expect(autoKind.locator('.kind').filter({ hasText: 'Mia M.' })).toBeVisible({ timeout: 5000 });
		await expect(autoKind.locator('.frei')).toHaveText('1 frei');
		await kamLive(ws, signal);
		await kind.kontext.close();
	});

	test('Leitung setzt Mats aus Braucht noch Mitfahrt ins Auto, die Mutter sieht es live voll', async ({ browser }) => {
		// Die Mutter hat den Thread offen, bevor die Leitung umsetzt.
		const mutter = await ausSitzung(browser, 'mutter');
		const ws = await oeffneVerbunden(mutter.seite, `/${SLUG}/t/${bowling}`);
		const autoMutter = autoDerMutter(mutter.seite);
		await expect(autoMutter.locator('.frei')).toHaveText('1 frei');
		const signal = ws.waitForEvent('framereceived', {
			predicate: (f) => alsSignal(f.payload)?.threadId === bowlingId,
		});

		const leitung = await ausSitzung(browser, 'leitung');
		await leitung.seite.goto(`/${SLUG}/t/${bowling}`);
		await expect(leitung.seite.getByRole('heading', { name: '🎳 Bowling', level: 1 })).toBeVisible();
		const autoLeitung = autoDerMutter(leitung.seite);
		const autoId = await autoLeitung.getAttribute('data-auto');
		expect(autoId).toBeTruthy();
		await brauchtMitfahrt(leitung.seite).getByRole('button', { name: 'Mats M. umsetzen' }).click();
		await brauchtMitfahrt(leitung.seite)
			.getByLabel('Mats M. umsetzen in')
			.selectOption(autoId ?? '');
		await brauchtMitfahrt(leitung.seite).getByRole('button', { name: 'Speichern' }).click();
		await expect(autoLeitung.locator('.kind').filter({ hasText: 'Mats M.' })).toBeVisible();
		await expect(autoLeitung.locator('.frei')).toHaveText('voll');
		await expect(brauchtMitfahrt(leitung.seite)).toContainText('Alle haben eine Mitfahrt.');
		await leitung.kontext.close();

		await expect(autoMutter.locator('.kind').filter({ hasText: 'Mats M.' })).toBeVisible({ timeout: 5000 });
		await expect(autoMutter.locator('.frei')).toHaveText('voll');
		// Im vollen Auto steigt niemand mehr ein.
		await expect(autoMutter.getByRole('button', { name: /einsteigen/ })).toHaveCount(0);
		await kamLive(ws, signal);
		await mutter.kontext.close();
	});

	test('Mutter zieht das Auto zurueck, beide brauchen wieder eine Mitfahrt, der Verlauf sagt es', async ({
		browser,
	}) => {
		const mutter = await ausSitzung(browser, 'mutter');
		await mutter.seite.goto(`/${SLUG}/t/${bowling}`);
		const auto = autoDerMutter(mutter.seite);
		await expect(auto.locator('.frei')).toHaveText('voll');

		await auto.getByRole('button', { name: 'Auto zurückziehen' }).click();
		// Die Rueckfrage nennt die Kinder in der Reihenfolge des Einsteigens.
		const dialog = mutter.seite.getByRole('dialog', { name: 'Auto zurückziehen' });
		await expect(dialog).toContainText('Mia M. und Mats M. brauchen dann wieder eine Mitfahrt.');
		await dialog.getByRole('button', { name: 'Zurückziehen' }).click();

		await expect(auto).toHaveCount(0);
		await expect(fahrt(mutter.seite)).toContainText('Noch kein Auto.');
		await expect(brauchtMitfahrt(mutter.seite)).toContainText('Mia M.');
		await expect(brauchtMitfahrt(mutter.seite)).toContainText('Mats M.');

		await mutter.seite
			.getByRole('navigation', { name: 'Ansicht' })
			.getByRole('link', { name: /^Verlauf/ })
			.click();
		// Der Systemeintrag, mit dem Fahrer als Kurzname und den Kindern in der Reihenfolge des Einsteigens.
		await expect(
			mutter.seite.getByRole('list', { name: 'Verlauf' }).getByRole('listitem').filter({
				hasText: 'Auto von Mara M. (Hinfahrt) zurückgezogen – Mia M. und Mats M. brauchen wieder eine Mitfahrt.',
			}),
		).toBeVisible();
		await mutter.kontext.close();
	});

	test('Die Link-Vorschau nennt den Titel nur, wo die Familie ihn sehen darf', async () => {
		// Ohne Sitzung: So holt ein Messenger die Seite. Der Kontext von Playwright traegt keine Cookies hinein.
		const ohneSitzung = await request.newContext({ baseURL: BASIS_URL });
		try {
			const veroeffentlicht = await ohneSitzung.get(`/${SLUG}/t/${bowling}`);
			expect(veroeffentlicht.status()).toBe(200);
			// Die Antwort haengt am Stand des Threads; ein Cache zeigte den Titel eines zurueckgezogenen Threads weiter.
			expect(veroeffentlicht.headers()['cache-control']).toBe('no-store');
			expect(await veroeffentlicht.text()).toContain('property="og:title" content="🎳 Bowling"');

			// Austausch (nur Jugendleiter) und eine unbekannte ID duerfen sich nicht unterscheiden, auch nicht um ein Byte.
			const verborgen = await ohneSitzung.get(`/${SLUG}/t/${austausch}`);
			const unbekannt = await ohneSitzung.get(`/${SLUG}/t/unbekannt`);
			expect(verborgen.status()).toBe(unbekannt.status());
			expect(verborgen.headers()['cache-control']).toBe('no-store');
			expect(unbekannt.headers()['cache-control']).toBe('no-store');
			const verborgenBytes = await verborgen.body();
			expect(verborgenBytes.equals(await unbekannt.body()), 'Austausch und unbekannte ID unterscheiden sich').toBe(
				true,
			);
			const html = verborgenBytes.toString('utf8');
			expect(html).toContain('property="og:title" content="Jungfischer Musterbach"');
			expect(html).not.toContain('Jugendsprecher-Austausch');
		} finally {
			await ohneSitzung.dispose();
		}
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
