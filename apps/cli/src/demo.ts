import { randomInt } from 'node:crypto';
import { austauschAnlegen, Recht, standardKategorien, type Beziehung, type PrismaClient } from '@jufi/db';
import {
	berlinerTag,
	berlinZeitpunkt,
	DEMO_SLUG,
	EINWILLIGUNG_TEXT_VERSION,
	tagPlus,
	teilnahmeOptionen,
	threadSegment,
} from '@jufi/domain';
import { CliFehler } from './fehler.js';

const ALLE_RECHTE = Object.values(Recht);

/** Reservierte Domain (RFC 2606): Adressen darunter sind nie zustellbar. */
const ERFUNDENE_ADRESSE = '@example.org';

/**
 * Erbt von CliFehler, damit fuehreAus die Verweigerung als erwartete Meldung mit Exit-Code 1
 * ausgibt und sie nicht mit einem Datenbankfehler verwechselt.
 */
export class DemoGeschuetztFehler extends CliFehler {
	constructor(personenMitEchterAdresse: number) {
		super(
			`Der Verein mit dem Slug "${DEMO_SLUG}" hat ${personenMitEchterAdresse} Person(en) mit einer Adresse ausserhalb von ` +
				`${ERFUNDENE_ADRESSE}, ist also kein Demo-Verein. Nichts wurde geloescht. ` +
				'Den Verein vorher umbenennen oder von Hand entfernen.',
		);
		this.name = 'DemoGeschuetztFehler';
	}
}

/**
 * Geburtsdatum, an dem die Person bei `jetzt` genau `alter` Jahre und mindestens
 * fuenf Monate alt ist. Der Erste des Monats und der Abstand zum Geburtstag
 * halten das Alter eindeutig, auch bei Zeitzonen- und Schaltjahrfragen; ein
 * Geburtsdatum genau am Bezugstag liesse es von der Tageszeit abhaengen.
 */
function geburtsdatumFuer(alter: number, jetzt: Date): Date {
	return new Date(Date.UTC(jetzt.getUTCFullYear() - alter, jetzt.getUTCMonth() - 6, 1));
}

/**
 * Geburtsdatum, an dem die Person bei `jetzt` 17 Jahre und 364 Tage alt ist, also
 * morgen volljaehrig wird. Damit zeigt die Demo den Randfall des
 * Volljaehrigkeitshinweises, ohne dass er mit der Zeit verstreicht.
 */
function geburtsdatumMorgenVolljaehrig(jetzt: Date): Date {
	return new Date(Date.UTC(jetzt.getUTCFullYear() - 18, jetzt.getUTCMonth(), jetzt.getUTCDate() + 1));
}

/**
 * Der erste Tag mit dem gewuenschten Wochentag (0 = Sonntag) nach dem Berliner Tag von `jetzt`,
 * heute selbst nie: An einem Freitag ist der "naechste Freitag" der in einer Woche. Verworfen:
 * den heutigen Tag mitzaehlen, weil ein Termin um 17:00 dann je nach Tageszeit des Einspielens
 * schon vorbei waere und die Demo einen abgelaufenen Termin zeigte.
 */
function naechsterWochentag(jetzt: Date, wochentag: number): string {
	const heute = berlinerTag(jetzt);
	const [j, m, t] = heute.split('-').map(Number);
	const aktuell = new Date(Date.UTC(j, m - 1, t)).getUTCDay();
	return tagPlus(heute, ((wochentag - aktuell + 6) % 7) + 1);
}

const FREITAG = 5;
const SAMSTAG = 6;

/** Spalte @db.Date: Mitternacht UTC des Kalendertags, ohne Zeitzonenversatz (wie ladeThread sie liest). */
function datumSpalte(tag: string): Date {
	return new Date(`${tag}T00:00:00Z`);
}

const INFO_TEXT_WICHTIGE_INFOS = [
	'Willkommen bei den **Jungfischern**! Das sollte jeder wissen:',
	'',
	'- Wir treffen uns freitags um 17:00 im Vereinsheim.',
	'- Bitte feste Schuhe und warme Kleidung mitbringen.',
	'- Fragen an die Jugendleitung: [jugend@example.org](mailto:jugend@example.org)',
	'',
	'Mehr zum Verein auf [jungfischer-demo.example.org](https://jungfischer-demo.example.org).',
].join('\n');

const INFO_TEXT_BOWLING = [
	'Wir gehen bowlen! Bitte **Socken** mitbringen, die Schuhe gibt es vor Ort.',
	'',
	'- Treffpunkt ist eine halbe Stunde vor dem Start am Vereinsheim.',
	'- Wir fahren gemeinsam, Abholung ab 17:00 Uhr am Bowlingcenter.',
].join('\n');

const INFO_TEXT_ZELTLAGER = [
	'Im Sommer fahren wir ins **Zeltlager** an den See! Alle Älteren sind eingeladen.',
	'',
	'- Zelte und Kochgeschirr stellt der Verein, Schlafsack und Isomatte bringt ihr selbst mit.',
	'- Am Ankunftsabend gibt es Pizza, stimmt unten ab, welche.',
	'- Hier im Chat könnt ihr Fragen stellen und euch absprechen.',
].join('\n');

const INFO_TEXT_FISCHERFEST = [
	'Das **Fischerfest** am Vereinsweiher war ein voller Erfolg!',
	'',
	'- Danke an alle, die Kuchen gebacken und beim Aufbau geholfen haben.',
	'- Fotos gibt es bei der Jugendleitung.',
].join('\n');

const ZEICHEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Schluessel einer freien Option oder einer Helfer-Position, wie der Server sie beim Speichern aus
 * dem Editor vergibt (neuerSchluessel in apps/jufi, Plan-Entscheidung 11): "o" und acht Zeichen aus
 * a-z0-9. Das "o" haelt sie von den festen Schluesseln der Teilnahme fern. Verworfen: die Funktion
 * aus apps/jufi zu importieren -- die CLI haengt nicht an der App, und ein Paket nur dafuer waere
 * mehr als diese vier Zeilen. Verworfen: Schluessel aus dem Text ("margherita"): so vergibt sie der
 * Editor nie, und die Demo soll dieselben Daten zeigen wie ein echter Verein.
 */
function neuerSchluessel(): string {
	let schluessel = 'o';
	for (let i = 0; i < 8; i++) schluessel += ZEICHEN[randomInt(ZEICHEN.length)];
	return schluessel;
}

/**
 * Spielt den erfundenen Verein "Jungfischer Demo" ein (Spec 7.1). Ein vorhandener
 * Verein `demo` wird vorher samt allen Daten geloescht, andere Vereine bleiben
 * unberuehrt. Hat im vorhandenen Verein `demo` eine Person eine Adresse, die nicht
 * auf @example.org endet, ist er kein Demo-Verein: dann wirft die Funktion
 * DemoGeschuetztFehler und loescht nichts. Zugaenge und Sitzungen allein schuetzen
 * nicht mehr, im Demo-Verein darf man sich anmelden.
 *
 * Mit dem schlichten PrismaClient statt vereinDb: Die Funktion legt einen Verein
 * an und ist damit eine Plattform-Operation. vereinDb gehoert zur Anfragebehandlung
 * eines bestehenden Vereins.
 *
 * Eine Transaktion, damit nach einem Fehler kein halber Demo-Verein stehen bleibt.
 * Das Loeschen steckt mit drin: Scheitert das Anlegen, bleibt der alte Stand.
 */
export async function demoEinspielen(
	prisma: PrismaClient,
	jetzt: Date,
): Promise<{ vereinId: string; personen: number; threads: { titel: string; segment: string }[] }> {
	return prisma.$transaction(async (tx) => {
		// Der Slug demo laesst sich nicht in pruefeSlug reservieren: der Demo-Verein
		// selbst muss darunter erreichbar bleiben. Also kann ein echter Verein ihn
		// einmal erhalten haben, und das Werkzeug darf ihn nie wegloeschen. Erkennbar
		// ist der echte daran, dass eine Person eine echte Adresse hat: die erste
		// Leitung eines Vereins hat immer eine, der Demo-Verein nur erfundene unter
		// example.org. Zugaenge und Sitzungen taugen seit der Anmeldung (Etappe 3)
		// nicht mehr, weil man sich im Demo-Verein anmelden darf. Verworfen: ein
		// Kennzeichen am Verein -- ein Schemafeld nur fuer dieses Entwicklungswerkzeug.
		const vorhanden = await tx.verein.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } });
		if (vorhanden) {
			const echte = await tx.person.count({
				where: {
					vereinId: vorhanden.id,
					email: { not: null },
					NOT: { email: { endsWith: ERFUNDENE_ADRESSE } },
				},
			});
			if (echte > 0) throw new DemoGeschuetztFehler(echte);
		}

		// Die Vereinsloeschung nimmt Personen, Familienzuordnungen und Untergruppen
		// per Cascade mit.
		await tx.verein.deleteMany({ where: { slug: DEMO_SLUG } });

		const verein = await tx.verein.create({
			data: {
				slug: DEMO_SLUG,
				name: 'Jungfischer Demo e.V.',
				anzeigename: 'Jungfischer Demo',
				farbe: '#0f766e',
				// Erfunden, unter example.org wie die Adressen der Personen (reserviert, nie zustellbar). Der
				// Text steht in den Vereinseinstellungen im Feld Kontakt; Mitglieder lesen ihn auf der
				// Startseite bei Ansprechpartner. Bewusst kein Logo, damit die Demo das Initialen-Icon vorfuehrt.
				kontakt: 'Fragen an die Jugendleitung: jugend@example.org',
				// Das Loeschen oben nimmt den alten Austausch per Cascade mit, ein zweites Einspielen
				// findet also keinen vor und legt ihn neu an (sonst griffe thread_ein_austausch).
				threads: { create: austauschAnlegen(jetzt) },
				// Wie beim Austausch: Das Loeschen oben nimmt die alten Kategorien per Cascade mit.
				kategorien: { create: standardKategorien() },
			},
		});
		const vereinId = verein.id;

		// Erfundene Adressen unter example.org (reserviert, nie zustellbar), damit die
		// Admin-Seite im Demo-Verein Ansprechpartner zeigt und nie eine echte Adresse
		// in Demo-Daten steht. Kleingeschrieben, wie es der CHECK person_email verlangt.
		const erwachsener = (vorname: string, nachname: string, rechte: Recht[]) =>
			tx.person.create({
				data: {
					vereinId,
					art: 'ERWACHSENER',
					vorname,
					nachname,
					rechte,
					email: `${vorname}.${nachname}@example.org`.toLowerCase(),
				},
			});
		const jungfischer = (vorname: string, nachname: string, geburtsdatum: Date, jugendsprecher = false) =>
			tx.person.create({
				data: { vereinId, art: 'JUNGFISCHER', vorname, nachname, geburtsdatum, jugendsprecher },
			});

		const thomas = await erwachsener('Thomas', 'Beispiel', ALLE_RECHTE);
		await erwachsener(
			'Katrin',
			'Muster',
			ALLE_RECHTE.filter((r) => r !== 'JUGENDLEITER_RECHTE' && r !== 'EINSTELLUNGEN'),
		);
		// Betreuer: darf Threads erstellen, aber keine Mitglieder pflegen.
		await erwachsener('Bernd', 'Betreuer', ['THREADS_ERSTELLEN']);
		const sandra = await erwachsener('Sandra', 'Huber', []);
		const hans = await erwachsener('Hans', 'Huber', []);
		const gerda = await erwachsener('Gerda', 'Huber', []);
		const petra = await erwachsener('Petra', 'Weber', []);

		const lena = await jungfischer('Lena', 'Huber', geburtsdatumFuer(14, jetzt));
		// Ohne Einwilligung: zeigt, was Verwaltung und Eltern ohne sie sehen.
		const max = await jungfischer('Max', 'Huber', geburtsdatumFuer(12, jetzt));
		// Ohne Familie und ohne Einwilligung: Thomas hat in der Demo ein Kind, fuer das er Antworten nachtragen kann.
		const tim = await jungfischer('Tim', 'Schmid', geburtsdatumFuer(11, jetzt));
		const jonas = await jungfischer('Jonas', 'Weber', geburtsdatumMorgenVolljaehrig(jetzt), true);

		const bezug = (
			erwachsenerId: string,
			jungfischerId: string,
			beziehung: Beziehung,
			erziehungsberechtigt: boolean,
		) => ({
			vereinId,
			erwachsenerId,
			jungfischerId,
			beziehung,
			erziehungsberechtigt,
		});
		// Familie Huber: Mutter und Vater erziehungsberechtigt, die Grossmutter nicht.
		// Familie Weber: nur die Mutter.
		await tx.bezugsperson.createMany({
			data: [
				bezug(sandra.id, lena.id, 'MUTTER', true),
				bezug(sandra.id, max.id, 'MUTTER', true),
				bezug(hans.id, lena.id, 'VATER', true),
				bezug(hans.id, max.id, 'VATER', true),
				bezug(gerda.id, lena.id, 'GROSSMUTTER', false),
				bezug(gerda.id, max.id, 'GROSSMUTTER', false),
				bezug(petra.id, jonas.id, 'MUTTER', true),
			],
		});

		// Max hat keine: Einwilligung nur durch eine erziehungsberechtigte Bezugsperson.
		await tx.einwilligung.createMany({
			data: [
				{
					vereinId,
					jungfischerId: lena.id,
					erteiltVon: sandra.id,
					art: 'DSGVO_ART8',
					textVersion: EINWILLIGUNG_TEXT_VERSION,
					erteiltAm: jetzt,
				},
				{
					vereinId,
					jungfischerId: jonas.id,
					erteiltVon: petra.id,
					art: 'DSGVO_ART8',
					textVersion: EINWILLIGUNG_TEXT_VERSION,
					erteiltAm: jetzt,
				},
			],
		});

		// Ohne vereinId in den Mitgliedern: Prisma setzt es aus der Untergruppe, die
		// Eingabe mit eigenem vereinId lehnt es als unbekanntes Argument ab.
		const aeltere = await tx.untergruppe.create({
			data: {
				vereinId,
				name: 'Ältere',
				mitglieder: { create: [{ personId: lena.id }, { personId: jonas.id }] },
			},
		});
		await tx.untergruppe.create({
			data: {
				vereinId,
				name: 'Jüngere',
				mitglieder: { create: [{ personId: max.id }, { personId: tim.id }] },
			},
		});

		// Staende von Hand statt ueber mitAenderung: Das Werkzeug vergibt sie fuer einen Verein, den nur
		// diese Transaktion kennt, also gibt es keinen gleichzeitigen Schreiber, den die Sperre der
		// Vereinszeile ausschliessen muesste. Ein Update des Zaehlers am Ende genuegt. Jeder Thread, jede
		// Antwort und jede Nachricht bekommt trotzdem einen eigenen Stand, wie es die Routen tun; ein Thread
		// schreibt neben THREAD je Modul eine MODUL-Aenderung in denselben Stand (POST /threads).
		let stand = 0;
		const aenderungen: {
			stand: number;
			threadId: string;
			art: 'THREAD' | 'MODUL' | 'ANTWORT' | 'VERLAUF';
			objektId: string;
			urheberId: string | null;
		}[] = [];

		const thread = async (
			daten: {
				titel: string;
				modus: 'AUSHANG' | 'KOMMENTARE' | 'CHAT';
				angepinnt: boolean;
				/** Sichtbar nur fuer diese Untergruppe; ohne Angabe fuer alle. */
				nurUntergruppeId?: string;
			},
			module: (threadId: string) => Promise<void>,
		) => {
			stand += 1;
			const { nurUntergruppeId, ...kopf } = daten;
			const zeile = await tx.thread.create({
				data: {
					vereinId,
					...kopf,
					rollenfilter: 'JUNGFISCHER_FAMILIE',
					alleUntergruppen: nurUntergruppeId === undefined,
					// Der Standardwert, hier ausdruecklich: Das Fischerfest soll die Zeitregel zeigen (Spec 3.7),
					// nicht einen Knopfdruck, und kein Thread der Demo ist von Hand archiviert.
					archivModus: 'AUTOMATISCH',
					veroeffentlichtAm: jetzt,
					erstelltVonId: thomas.id,
					letzteAktivitaetAm: jetzt,
					letzteAktivitaetStand: stand,
					angelegtAm: jetzt,
				},
			});
			if (nurUntergruppeId !== undefined) {
				await tx.threadUntergruppe.create({ data: { vereinId, threadId: zeile.id, untergruppeId: nurUntergruppeId } });
			}
			await module(zeile.id);
			aenderungen.push({ stand, threadId: zeile.id, art: 'THREAD', objektId: zeile.id, urheberId: thomas.id });
			// Die Modul-IDs aus der Datenbank statt aus den Helfern: Jedes Modul, das die Callbacks anlegen, ist
			// damit erfasst, auch wenn ein kuenftiger Helfer vergisst, die ID zu melden.
			const angelegte = await tx.threadModul.findMany({ where: { threadId: zeile.id }, orderBy: { position: 'asc' } });
			for (const m of angelegte) {
				aenderungen.push({ stand, threadId: zeile.id, art: 'MODUL', objektId: m.id, urheberId: thomas.id });
			}
			return zeile;
		};
		const infoModul = async (threadId: string, position: number, text: string) => {
			const modul = await tx.threadModul.create({ data: { vereinId, threadId, typ: 'INFO', position } });
			await tx.infoModul.create({ data: { vereinId, id: modul.id, text } });
		};
		const terminModul = async (
			threadId: string,
			position: number,
			titel: string,
			termin: { tag: string; endTag?: string; beginn?: string; ende?: string; ort: string; treffpunkt?: string },
		) => {
			const modul = await tx.threadModul.create({ data: { vereinId, threadId, typ: 'TERMIN', position, titel } });
			await tx.terminModul.create({
				data: {
					vereinId,
					id: modul.id,
					startDatum: datumSpalte(termin.tag),
					endDatum: termin.endTag ? datumSpalte(termin.endTag) : null,
					beginn: termin.beginn ?? null,
					ende: termin.ende ?? null,
					ort: termin.ort,
					treffpunkt: termin.treffpunkt ?? null,
				},
			});
		};

		const infos = await thread({ titel: 'Wichtige Infos', modus: 'AUSHANG', angepinnt: true }, async (threadId) => {
			await infoModul(threadId, 0, INFO_TEXT_WICHTIGE_INFOS);
			await terminModul(threadId, 1, 'Nächste Gruppenstunde', {
				tag: naechsterWochentag(jetzt, FREITAG),
				beginn: '17:00',
				ende: '18:30',
				ort: 'Vereinsheim',
			});
		});

		// Der uebernaechste Samstag, damit zwischen Einspielen und Frist immer Tage liegen; die Frist
		// ist der Donnerstag davor, 18:00 Berliner Wandzeit (berlinZeitpunkt kennt die Zeitumstellung).
		const bowlingTag = tagPlus(naechsterWochentag(jetzt, SAMSTAG), 7);
		// Die Helferliste und die Fahrgemeinschaft von Bowling, damit die Etappen lokal etwas zum Abnehmen
		// haben (Plan zu TP4 Etappe 3, Entscheidung 14, und Etappe 4, Entscheidung 18); das Zeltlager mit allen
		// Modulen folgt in Etappe 6.
		let helferModulId = '';
		const helferPositionen = new Map<string, string>();
		let teilnahmeId = '';
		let dabeiId = '';
		let fahrtModulId = '';
		const bowling = await thread({ titel: '🎳 Bowling', modus: 'KOMMENTARE', angepinnt: false }, async (threadId) => {
			await infoModul(threadId, 0, INFO_TEXT_BOWLING);
			await terminModul(threadId, 1, 'Bowling', {
				tag: bowlingTag,
				beginn: '14:00',
				ende: '17:00',
				ort: 'Bowlingcenter',
				treffpunkt: '13:30 am Vereinsheim',
			});
			const modul = await tx.threadModul.create({ data: { vereinId, threadId, typ: 'UMFRAGE', position: 2 } });
			teilnahmeId = modul.id;
			await tx.umfrageModul.create({
				data: {
					vereinId,
					id: modul.id,
					threadId,
					frage: 'Kommst du mit?',
					einheit: 'JUNGFISCHER',
					teilnahme: true,
					vielleicht: true,
					frist: berlinZeitpunkt(tagPlus(bowlingTag, -2), '18:00'),
					ergebnisse: 'ALLE',
				},
			});
			// Antworten nur fuer Lena und Max (unten), die die Fahrgemeinschaft braucht: Tim und Jonas bleiben offen,
			// damit die Demo das Antworten selbst vorfuehrt.
			await tx.umfrageOption.createMany({
				data: teilnahmeOptionen(true).map((o, position) => ({ vereinId, umfrageId: modul.id, position, ...o })),
			});
			dabeiId = (await tx.umfrageOption.findFirstOrThrow({ where: { umfrageId: modul.id, schluessel: 'dabei' } })).id;

			// Als letztes Modul, pro Erwachsener wie die Vorgabe des Editors. Die Frist fuenf Berliner Tage nach
			// dem Einspielen um 18:00, wie der Editor sie vorbelegt; der Termin liegt mindestens acht Tage voraus,
			// die Frist also immer davor. Verworfen: jetzt plus fuenf mal 24 Stunden -- die Frist truege dann die
			// Uhrzeit des Einspielens (etwa 03:17), die kein Ersteller waehlte.
			const helfer = await tx.threadModul.create({
				data: { vereinId, threadId, typ: 'HELFER', position: 3, titel: 'Mitbringen und fahren' },
			});
			helferModulId = helfer.id;
			await tx.helferModul.create({
				data: {
					vereinId,
					id: helfer.id,
					einheit: 'ERWACHSENER',
					frist: berlinZeitpunkt(tagPlus(berlinerTag(jetzt), 5), '18:00'),
				},
			});
			for (const [position, [text, anzahl]] of (
				[
					['Fahrer', 2],
					['Snacks', 3],
				] as const
			).entries()) {
				const zeile = await tx.helferPosition.create({
					data: { vereinId, modulId: helfer.id, position, text, anzahl, schluessel: neuerSchluessel() },
				});
				helferPositionen.set(text, zeile.id);
			}

			// Hin und zurueck, ohne eigene Ueberschrift, wie der Editor sie anlegt: Die Seite zeigt dann
			// "Fahrgemeinschaft". Nach der Helferliste, damit deren Position (3) bleibt, was sie war.
			const fahrt = await tx.threadModul.create({ data: { vereinId, threadId, typ: 'FAHRT', position: 4 } });
			fahrtModulId = fahrt.id;
			await tx.fahrtModul.create({ data: { vereinId, id: fahrt.id, threadId, hin: true, rueck: true } });
		});

		// Das Zeltlager des Folgejahres, nur fuer die Aelteren, als Chat mit Umfrage. Der Titel traegt das Jahr
		// seines Termins (Berliner Jahr von jetzt plus 1): So steht dort nie ein Jahr, das schon vorbei ist.
		// Verworfen: das Jahr von jetzt -- ab August waere der Termin vergangen, und die Demo zeigte ein
		// abgelaufenes Lager.
		const lagerJahr = Number(berlinerTag(jetzt).slice(0, 4)) + 1;
		const pizzaOptionen = new Map<string, string>();
		let pizzaUmfrageId = '';
		const zeltlager = await thread(
			{ titel: `Zeltlager ${lagerJahr}`, modus: 'CHAT', angepinnt: false, nurUntergruppeId: aeltere.id },
			async (threadId) => {
				await infoModul(threadId, 0, INFO_TEXT_ZELTLAGER);
				await terminModul(threadId, 1, 'Zeltlager', {
					tag: `${lagerJahr}-08-02`,
					endTag: `${lagerJahr}-08-08`,
					ort: 'Zeltplatz am See',
				});
				const modul = await tx.threadModul.create({ data: { vereinId, threadId, typ: 'UMFRAGE', position: 2 } });
				pizzaUmfrageId = modul.id;
				await tx.umfrageModul.create({
					data: {
						vereinId,
						id: modul.id,
						threadId,
						frage: 'Welche Pizza am Ankunftsabend?',
						einheit: 'PERSON',
						teilnahme: false,
						mehrfach: false,
						// Ohne Frist: Die Demo soll das Antworten jederzeit zeigen koennen.
						frist: null,
						ergebnisse: 'ALLE',
					},
				});
				for (const [position, text] of ['Margherita', 'Salami', 'Funghi'].entries()) {
					const option = await tx.umfrageOption.create({
						data: { vereinId, umfrageId: modul.id, position, text, schluessel: neuerSchluessel() },
					});
					pizzaOptionen.set(text, option.id);
				}
			},
		);

		// Vor 14 Tagen vorbei und damit nach der Karenz von 7 Tagen archiviert (Spec 3.7, archivModus
		// AUTOMATISCH): Der Thread zeigt die Zeitregel und braucht keinen Knopfdruck.
		const fischerfest = await thread(
			{ titel: '🎣 Fischerfest', modus: 'KOMMENTARE', angepinnt: false },
			async (threadId) => {
				await infoModul(threadId, 0, INFO_TEXT_FISCHERFEST);
				await terminModul(threadId, 1, 'Fischerfest', {
					tag: tagPlus(berlinerTag(jetzt), -14),
					beginn: '10:00',
					ende: '16:00',
					ort: 'Vereinsweiher',
				});
			},
		);

		// Den Austausch hat der Verein schon (austauschAnlegen); er bekommt hier nur seine Staende und
		// zwei Nachrichten, damit der Verlauf nicht leer ist. Seine THREAD-Aenderung hat keinen Urheber,
		// denn den Thread hat das System angelegt (erstelltVonId ist null).
		const austausch = await tx.thread.findFirstOrThrow({
			where: { vereinId, art: 'JUGENDSPRECHER_AUSTAUSCH' },
			select: { id: true, titel: true },
		});
		stand += 1;
		aenderungen.push({ stand, threadId: austausch.id, art: 'THREAD', objektId: austausch.id, urheberId: null });

		// Antworten und Nachrichten, je mit eigenem Stand; die Zeile der Antwort ist das Objekt der
		// Aenderung wie in schreibeAntwort, die der Nachricht wie in schreibeNachricht.
		// von: wer die Antwort eingetragen hat, ohne Angabe die Person selbst.
		const antwort = async (
			threadId: string,
			umfrageId: string,
			person: { id: string },
			optionId: string,
			von: { id: string } = person,
		) => {
			stand += 1;
			const zeile = await tx.umfrageAntwort.create({
				data: {
					vereinId,
					umfrageId,
					fuerId: person.id,
					vonId: von.id,
					abgegebenAm: jetzt,
					clientId: `demo-antwort-${stand}`,
				},
			});
			await tx.umfrageAntwortOption.create({ data: { vereinId, umfrageId, antwortId: zeile.id, optionId } });
			aenderungen.push({ stand, threadId, art: 'ANTWORT', objektId: zeile.id, urheberId: von.id });
		};
		// Ein Helfer-Eintrag hat das Modul als Objekt seiner Aenderung, nicht die Eintragszeile (TP4-Spec 8,
		// wie schreibeEintrag): Die Ansicht der Liste haengt an allen Eintraegen zugleich.
		const helferEintrag = async (
			threadId: string,
			modulId: string,
			positionId: string,
			person: { id: string },
			notiz: string | null,
		) => {
			stand += 1;
			await tx.helferEintrag.create({
				data: {
					vereinId,
					positionId,
					fuerId: person.id,
					vonId: person.id,
					notiz,
					eingetragenAm: jetzt,
					clientId: `demo-helfer-${stand}`,
				},
			});
			aenderungen.push({ stand, threadId, art: 'ANTWORT', objektId: modulId, urheberId: person.id });
		};
		const nachricht = async (threadId: string, autor: { id: string }, text: string) => {
			stand += 1;
			const eintrag = await tx.verlaufEintrag.create({
				data: { vereinId, threadId, art: 'NACHRICHT', autorId: autor.id, text, stand, angelegtAm: jetzt },
			});
			aenderungen.push({ stand, threadId, art: 'VERLAUF', objektId: eintrag.id, urheberId: autor.id });
		};
		const aktivitaet = (threadId: string) =>
			tx.thread.update({ where: { id: threadId }, data: { letzteAktivitaetAm: jetzt, letzteAktivitaetStand: stand } });

		// Ein einziger Eintrag, damit Fuellstand, Name und Notiz zu sehen sind und die Liste fuer die uebrigen
		// Erwachsenen (Hans, Gerda, Petra, die Leitung) weiter unter "Braucht deine Antwort" steht.
		await helferEintrag(bowling.id, helferModulId, helferPositionen.get('Snacks')!, sandra, 'Gemüsesticks');

		// Die Fahrgemeinschaft betrachtet nur Kinder mit "Dabei" (Spec 6.2): Ohne Zusage zeigte die Karte Lena im
		// Auto als "nicht mehr dabei", und "Braucht noch Mitfahrt" bliebe leer. Lena sagt selbst zu; fuer Max, der
		// ohne Einwilligung keinen Zugang hat, sagt die Mutter zu. Er bleibt ohne Mitfahrt, damit die Liste
		// "Braucht noch Mitfahrt" nicht leer ist und Sandra ihn in ihr Auto setzen kann.
		await antwort(bowling.id, teilnahmeId, lena, dabeiId);
		await antwort(bowling.id, teilnahmeId, max, dabeiId, sandra);
		// Auto und Mitfahrt haben das Modul als Objekt ihrer Aenderung (TP4-Spec 8, wie der Helfer-Eintrag). Der
		// Abfahrtstag ist der Tag des Termins, wie ihn das Formular vorbelegt (Plan-Entscheidung 15).
		stand += 1;
		const auto = await tx.auto.create({
			data: {
				vereinId,
				modulId: fahrtModulId,
				fahrerId: sandra.id,
				richtung: 'HIN',
				plaetze: 3,
				abfahrtTag: datumSpalte(bowlingTag),
				abfahrtZeit: '15:30',
				ort: 'Vereinsheim',
				angelegtAm: jetzt,
				clientId: `demo-auto-${stand}`,
			},
		});
		aenderungen.push({ stand, threadId: bowling.id, art: 'ANTWORT', objektId: fahrtModulId, urheberId: sandra.id });
		stand += 1;
		await tx.mitfahrt.create({
			data: {
				vereinId,
				modulId: fahrtModulId,
				richtung: 'HIN',
				kindId: lena.id,
				autoId: auto.id,
				vonId: sandra.id,
				eingetragenAm: jetzt,
				clientId: `demo-mitfahrt-${stand}`,
			},
		});
		aenderungen.push({ stand, threadId: bowling.id, art: 'ANTWORT', objektId: fahrtModulId, urheberId: sandra.id });
		await aktivitaet(bowling.id);

		await antwort(zeltlager.id, pizzaUmfrageId, lena, pizzaOptionen.get('Salami')!);
		await antwort(zeltlager.id, pizzaUmfrageId, thomas, pizzaOptionen.get('Margherita')!);
		await nachricht(zeltlager.id, lena, 'Ich freue mich schon! Darf ich meine Gitarre mitbringen?');
		await nachricht(zeltlager.id, thomas, 'Klar, die Gitarre darf mit. Am Lagerfeuer ist Platz dafür.');
		await aktivitaet(zeltlager.id);

		await nachricht(austausch.id, jonas, 'Können wir beim Bowling hinterher noch Pizza essen?');
		await nachricht(austausch.id, thomas, 'Gute Idee, ich frage im Bowlingcenter nach.');
		await aktivitaet(austausch.id);

		await tx.aenderung.createMany({
			data: aenderungen.map((a) => ({ vereinId, ...a, angelegtAm: jetzt })),
		});
		await tx.verein.update({ where: { id: vereinId }, data: { aenderungsstand: stand } });

		return {
			vereinId,
			personen: await tx.person.count({ where: { vereinId } }),
			threads: [infos, bowling, zeltlager, fischerfest, austausch].map((t) => ({
				titel: t.titel,
				segment: threadSegment(t.id, t.titel),
			})),
		};
	});
}
