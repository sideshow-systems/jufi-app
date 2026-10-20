import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { passkeyGeraet, TESTPASSWORT, ZUSTAND } from './hilfen';
import { legeE2eThreadAn, personIdMitMail } from './threads';

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

	test('Mutter antwortet fuer Mia und schreibt im Verlauf, Mia und Leitung sehen es', async ({ browser }) => {
		const leitungId = await personIdMitMail(SLUG, LEITUNG_MAIL);
		const { bowling, austausch } = await legeE2eThreadAn(SLUG, leitungId, new Date());
		const ids = JSON.parse(await readFile(join(ZUSTAND, 'ids.json'), 'utf8')) as Record<string, string>;
		await writeFile(join(ZUSTAND, 'ids.json'), JSON.stringify({ ...ids, bowling, austausch }, null, '\t'));

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
