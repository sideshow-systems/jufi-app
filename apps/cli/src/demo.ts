import { Recht, type Beziehung, type PrismaClient } from '@jufi/db';
import { DEMO_SLUG, EINWILLIGUNG_TEXT_VERSION } from '@jufi/domain';
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
): Promise<{ vereinId: string; personen: number }> {
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
				// Erfunden, unter .test (RFC 2606, nie zustellbar): Die Startseite zeigt den Text unter
				// "Ansprechpartner". Bewusst kein Logo, damit die Demo das Initialen-Icon vorfuehrt.
				kontakt: 'Fragen an die Jugendleitung: jugend@example.test',
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

		await erwachsener('Thomas', 'Beispiel', ALLE_RECHTE);
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

		return { vereinId, personen: await tx.person.count({ where: { vereinId } }) };
	});
}
