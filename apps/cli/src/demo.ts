import { austauschAnlegen, Recht, type Beziehung, type PrismaClient } from '@jufi/db';
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
		await tx.untergruppe.create({
			data: {
				vereinId,
				name: 'Ältere',
				mitglieder: { create: [{ personId: lena.id }, { personId: jonas.id }] },
			},
		});
		await tx.untergruppe.create({
			data: { vereinId, name: 'Jüngere', mitglieder: { create: [{ personId: max.id }] } },
		});

		// Staende von Hand statt ueber mitAenderung: Das Werkzeug vergibt sie fuer einen Verein, den nur
		// diese Transaktion kennt, also gibt es keinen gleichzeitigen Schreiber, den die Sperre der
		// Vereinszeile ausschliessen muesste. Ein Update des Zaehlers am Ende genuegt. Jeder Thread und
		// jede Nachricht bekommt trotzdem einen eigenen Stand mit einer Aenderung, wie es die Routen tun.
		let stand = 0;
		const aenderungen: {
			stand: number;
			threadId: string;
			art: 'THREAD' | 'VERLAUF';
			objektId: string;
			urheberId: string;
		}[] = [];

		const thread = async (
			daten: { titel: string; modus: 'AUSHANG' | 'KOMMENTARE'; angepinnt: boolean },
			module: (threadId: string) => Promise<void>,
		) => {
			stand += 1;
			const zeile = await tx.thread.create({
				data: {
					vereinId,
					...daten,
					rollenfilter: 'JUNGFISCHER_FAMILIE',
					alleUntergruppen: true,
					veroeffentlichtAm: jetzt,
					erstelltVonId: thomas.id,
					letzteAktivitaetAm: jetzt,
					letzteAktivitaetStand: stand,
					angelegtAm: jetzt,
				},
			});
			await module(zeile.id);
			aenderungen.push({ stand, threadId: zeile.id, art: 'THREAD', objektId: zeile.id, urheberId: thomas.id });
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
			termin: { tag: string; beginn: string; ende: string; ort: string; treffpunkt?: string },
		) => {
			const modul = await tx.threadModul.create({ data: { vereinId, threadId, typ: 'TERMIN', position, titel } });
			await tx.terminModul.create({
				data: {
					vereinId,
					id: modul.id,
					startDatum: datumSpalte(termin.tag),
					beginn: termin.beginn,
					ende: termin.ende,
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
			// Ohne Antworten: Die Demo soll das Antworten selbst vorfuehren.
			await tx.umfrageOption.createMany({
				data: teilnahmeOptionen(true).map((o, position) => ({ vereinId, umfrageId: modul.id, position, ...o })),
			});
		});

		// Den Austausch hat der Verein schon (austauschAnlegen); er bekommt hier nur seine Stande und
		// zwei Nachrichten, damit der Verlauf nicht leer ist.
		const austausch = await tx.thread.findFirstOrThrow({
			where: { vereinId, art: 'JUGENDSPRECHER_AUSTAUSCH' },
			select: { id: true, titel: true },
		});
		stand += 1;
		aenderungen.push({ stand, threadId: austausch.id, art: 'THREAD', objektId: austausch.id, urheberId: thomas.id });
		for (const [autor, text] of [
			[jonas, 'Können wir beim Bowling hinterher noch Pizza essen?'],
			[thomas, 'Gute Idee, ich frage im Bowlingcenter nach.'],
		] as const) {
			stand += 1;
			const eintrag = await tx.verlaufEintrag.create({
				data: { vereinId, threadId: austausch.id, art: 'NACHRICHT', autorId: autor.id, text, stand, angelegtAm: jetzt },
			});
			aenderungen.push({ stand, threadId: austausch.id, art: 'VERLAUF', objektId: eintrag.id, urheberId: autor.id });
		}
		await tx.thread.update({
			where: { id: austausch.id },
			data: { letzteAktivitaetAm: jetzt, letzteAktivitaetStand: stand },
		});

		await tx.aenderung.createMany({
			data: aenderungen.map((a) => ({ vereinId, ...a, angelegtAm: jetzt })),
		});
		await tx.verein.update({ where: { id: vereinId }, data: { aenderungsstand: stand } });

		return {
			vereinId,
			personen: await tx.person.count({ where: { vereinId } }),
			threads: [infos, bowling, austausch].map((t) => ({ titel: t.titel, segment: threadSegment(t.id, t.titel) })),
		};
	});
}
