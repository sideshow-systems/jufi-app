import { Recht, type Beziehung, type PrismaClient } from '@jufi/db';

export const DEMO_SLUG = 'demo';

const ALLE_RECHTE = Object.values(Recht);

/**
 * Eigene Klasse, damit fuehreAus die Verweigerung als erwartete Meldung mit Exit-Code 1
 * ausgibt und sie nicht mit einem Datenbankfehler verwechselt.
 */
export class DemoGeschuetztFehler extends Error {
	constructor(zugaenge: number, sitzungen: number) {
		super(
			`Der Verein mit dem Slug "${DEMO_SLUG}" hat ${zugaenge} Zugang/Zugaenge und ${sitzungen} Sitzung(en), ` +
				'ist also kein Demo-Verein. Nichts wurde geloescht. Den Verein vorher umbenennen oder von Hand entfernen.',
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
 * Spielt den erfundenen Verein "Jungfischer Demo" ein (Spec 7.1). Ein vorhandener
 * Verein `demo` wird vorher samt allen Daten geloescht, andere Vereine bleiben
 * unberuehrt. Hat der vorhandene Verein `demo` Zugaenge oder Sitzungen, ist er
 * kein Demo-Verein: dann wirft die Funktion DemoGeschuetztFehler und loescht nichts.
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
		// einmal erhalten haben, und das Werkzeug darf ihn nie wegloeschen. Der
		// Demo-Verein hat heute keine Zugaenge und Sitzungen, daran erkennt man
		// den echten. Legt die Anmeldung (Etappe 3) im Demo-Verein welche an, muss dieses
		// Kriterium neu gefasst werden, sonst verweigert das Werkzeug jedes Mal. Verworfen: ein Kennzeichen am
		// Verein -- ein Schemafeld nur fuer dieses Entwicklungswerkzeug.
		const vorhanden = await tx.verein.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } });
		if (vorhanden) {
			const [zugaenge, sitzungen] = await Promise.all([
				tx.zugang.count({ where: { vereinId: vorhanden.id } }),
				tx.session.count({ where: { vereinId: vorhanden.id } }),
			]);
			if (zugaenge > 0 || sitzungen > 0) throw new DemoGeschuetztFehler(zugaenge, sitzungen);
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
			},
		});
		const vereinId = verein.id;

		const erwachsener = (vorname: string, nachname: string, rechte: Recht[]) =>
			tx.person.create({ data: { vereinId, art: 'ERWACHSENER', vorname, nachname, rechte } });
		const jungfischer = (vorname: string, nachname: string, alter: number, jugendsprecher = false) =>
			tx.person.create({
				data: {
					vereinId,
					art: 'JUNGFISCHER',
					vorname,
					nachname,
					geburtsdatum: geburtsdatumFuer(alter, jetzt),
					jugendsprecher,
				},
			});

		await erwachsener('Thomas', 'Beispiel', ALLE_RECHTE);
		await erwachsener(
			'Katrin',
			'Muster',
			ALLE_RECHTE.filter((r) => r !== 'JUGENDLEITER_RECHTE' && r !== 'EINSTELLUNGEN'),
		);
		const sandra = await erwachsener('Sandra', 'Huber', []);
		const hans = await erwachsener('Hans', 'Huber', []);

		const lena = await jungfischer('Lena', 'Huber', 14);
		const max = await jungfischer('Max', 'Huber', 12);
		const jonas = await jungfischer('Jonas', 'Weber', 17, true);

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
		await tx.bezugsperson.createMany({
			data: [
				bezug(sandra.id, lena.id, 'MUTTER', true),
				bezug(sandra.id, max.id, 'MUTTER', true),
				bezug(hans.id, lena.id, 'GROSSVATER', false),
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

		return { vereinId, personen: await tx.person.count({ where: { vereinId } }) };
	});
}
