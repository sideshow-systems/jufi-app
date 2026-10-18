import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EINWILLIGUNG_TEXT_VERSION } from '@jufi/domain';
import { DemoGeschuetztFehler, demoEinspielen } from './demo.js';

const BEZUGSTAG = new Date('2026-10-12T12:00:00Z');

/** Volle Lebensjahre am Bezugstag, aus dem gespeicherten Datum gerechnet. */
function alterAn(geburtsdatum: Date, jetzt: Date): number {
	let alter = jetzt.getUTCFullYear() - geburtsdatum.getUTCFullYear();
	const vorGeburtstag =
		jetzt.getUTCMonth() < geburtsdatum.getUTCMonth() ||
		(jetzt.getUTCMonth() === geburtsdatum.getUTCMonth() && jetzt.getUTCDate() < geburtsdatum.getUTCDate());
	if (vorGeburtstag) alter -= 1;
	return alter;
}

describe('demoEinspielen', () => {
	const prisma: PrismaClient = createPrismaClientFromEnv();

	// Die Testdatenbank gehoert diesem Projekt allein, aber die Tests laufen
	// nacheinander in einer Datei: ohne Leeren sahe der erste Test Reste des letzten.
	beforeEach(async () => {
		await prisma.verein.deleteMany();
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	async function zaehlung() {
		return {
			vereine: await prisma.verein.count({ where: { slug: 'demo' } }),
			personen: await prisma.person.count(),
			bezugspersonen: await prisma.bezugsperson.count(),
			untergruppen: await prisma.untergruppe.count(),
			mitglieder: await prisma.untergruppeMitglied.count(),
		};
	}

	it('legt 10 Personen, 7 Familienzuordnungen, 2 Untergruppen und 2 Einwilligungen an', async () => {
		const ergebnis = await demoEinspielen(prisma, BEZUGSTAG);

		expect(ergebnis.personen).toBe(10);
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug: 'demo' } });
		expect(ergebnis.vereinId).toBe(verein.id);
		expect(verein).toMatchObject({
			name: 'Jungfischer Demo e.V.',
			anzeigename: 'Jungfischer Demo',
			farbe: '#0f766e',
		});
		expect(await prisma.person.count({ where: { vereinId: verein.id } })).toBe(10);
		expect(await prisma.bezugsperson.count({ where: { vereinId: verein.id } })).toBe(7);
		const gruppen = await prisma.untergruppe.findMany({
			where: { vereinId: verein.id },
			include: { mitglieder: { include: { person: true } } },
		});
		const mitglieder = Object.fromEntries(
			gruppen.map((g) => [g.name, g.mitglieder.map((m) => m.person.vorname).sort()]),
		);
		expect(mitglieder).toEqual({ Ältere: ['Jonas', 'Lena'], Jüngere: ['Max'] });
		expect(await prisma.einwilligung.count({ where: { vereinId: verein.id } })).toBe(2);
		// Das Werkzeug legt selbst keine Zugaenge an; die entstehen erst durch Einladung.
		expect(await prisma.zugang.count({ where: { vereinId: verein.id } })).toBe(0);
	});

	it('vergibt Rechte wie vorgesehen und haelt die CHECKs ein', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);

		const rechte = async (vorname: string) =>
			(await prisma.person.findFirstOrThrow({ where: { vorname } })).rechte.slice().sort();
		expect(await rechte('Thomas')).toHaveLength(7);
		expect(await rechte('Thomas')).toContain('EINSTELLUNGEN');
		const katrin = await rechte('Katrin');
		expect(katrin).toHaveLength(5);
		expect(katrin).not.toContain('JUGENDLEITER_RECHTE');
		expect(katrin).not.toContain('EINSTELLUNGEN');
		expect(await rechte('Sandra')).toEqual([]);
		expect(await rechte('Hans')).toEqual([]);
		expect(await rechte('Bernd')).toEqual(['THREADS_ERSTELLEN']);

		const hans = await prisma.bezugsperson.findMany({ where: { erwachsener: { vorname: 'Hans' } } });
		expect(hans).toHaveLength(2);
		expect(hans.every((b) => b.beziehung === 'VATER' && b.erziehungsberechtigt)).toBe(true);
		const gerda = await prisma.bezugsperson.findMany({ where: { erwachsener: { vorname: 'Gerda' } } });
		expect(gerda).toHaveLength(2);
		expect(gerda.every((b) => b.beziehung === 'GROSSMUTTER' && !b.erziehungsberechtigt)).toBe(true);
		const sandra = await prisma.bezugsperson.findMany({
			where: { erwachsener: { vorname: 'Sandra' } },
			include: { jungfischer: true },
		});
		expect(sandra.map((b) => b.jungfischer.vorname).sort()).toEqual(['Lena', 'Max']);
		expect(sandra.every((b) => b.beziehung === 'MUTTER' && b.erziehungsberechtigt)).toBe(true);
	});

	it('der Verein hat einen erfundenen Kontakttext und kein Logo', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);

		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug: 'demo' } });
		// Der Text steht in den Vereinseinstellungen im Feld Kontakt; die Adresse liegt unter example.org (RFC 2606).
		expect(verein.kontakt).toBe('Fragen an die Jugendleitung: jugend@example.org');
		// Ohne Logo zeigt das Icon die Initialen, das die Demo vorfuehren soll.
		expect(await prisma.vereinLogo.count({ where: { vereinId: verein.id } })).toBe(0);
	});

	it('Erwachsene haben erfundene Adressen unter example.org', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);

		const erwachsene = await prisma.person.findMany({ where: { art: 'ERWACHSENER' } });
		expect(erwachsene).toHaveLength(7);
		for (const e of erwachsene) {
			expect(e.email).toBe(`${e.vorname}.${e.nachname}@example.org`.toLowerCase());
		}
		// Jungfischer bekommen keine: ihre Adresse ist freiwillig und kommt erst mit TP5.
		expect(await prisma.person.count({ where: { art: 'JUNGFISCHER', email: { not: null } } })).toBe(0);
	});

	it('zweimal einspielen ergibt denselben Stand', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);
		const erster = await zaehlung();
		await demoEinspielen(prisma, BEZUGSTAG);

		expect(await zaehlung()).toEqual(erster);
		expect(erster.vereine).toBe(1);
		expect(erster.personen).toBe(10);
	});

	it('andere Vereine bleiben unberuehrt', async () => {
		const fremd = await prisma.verein.create({
			data: {
				slug: 'fremdverein',
				name: 'Fremdverein e.V.',
				anzeigename: 'Fremdverein',
				farbe: '#1d4ed8',
				personen: { create: { art: 'ERWACHSENER', vorname: 'Erika', nachname: 'Fremd' } },
			},
		});

		await demoEinspielen(prisma, BEZUGSTAG);
		await demoEinspielen(prisma, BEZUGSTAG);

		expect(await prisma.verein.findUnique({ where: { id: fremd.id } })).not.toBeNull();
		expect(await prisma.person.count({ where: { vereinId: fremd.id } })).toBe(1);
	});

	it('Jonas ist Jugendsprecher und wird morgen 18, Lena und Max sind 14 und 12', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);

		const jungfischer = await prisma.person.findMany({ where: { art: 'JUNGFISCHER' } });
		const alter = Object.fromEntries(jungfischer.map((p) => [p.vorname, alterAn(p.geburtsdatum as Date, BEZUGSTAG)]));
		expect(alter).toEqual({ Lena: 14, Max: 12, Jonas: 17 });
		expect(jungfischer.filter((p) => p.jugendsprecher).map((p) => p.vorname)).toEqual(['Jonas']);
		const jonas = jungfischer.find((p) => p.vorname === 'Jonas')!;
		expect(alterAn(jonas.geburtsdatum as Date, new Date('2026-10-13T12:00:00Z'))).toBe(18);
	});

	it('Einwilligungen: Lena durch ihre Mutter, Jonas durch seine, Max keine', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);

		const einwilligungen = await prisma.einwilligung.findMany({
			include: { jungfischer: true, erteiltVonPerson: true },
		});
		expect(einwilligungen.map((e) => [e.jungfischer.vorname, e.erteiltVonPerson.vorname]).sort()).toEqual([
			['Jonas', 'Petra'],
			['Lena', 'Sandra'],
		]);
		expect(einwilligungen.every((e) => e.art === 'DSGVO_ART8' && e.widerrufenAm === null)).toBe(true);
		expect(einwilligungen.every((e) => e.textVersion === EINWILLIGUNG_TEXT_VERSION)).toBe(true);
	});

	describe('Schutz eines echten Vereins mit dem Slug demo', () => {
		/** Ein Verein mit Slug demo; die Adresse der Leitung entscheidet, ob er ein Demo-Verein ist. */
		async function vereinMitSlugDemo(email: string) {
			const verein = await prisma.verein.create({
				data: { slug: 'demo', name: 'Verein e.V.', anzeigename: 'Verein', farbe: '#1d4ed8' },
			});
			const person = await prisma.person.create({
				data: { vereinId: verein.id, art: 'ERWACHSENER', vorname: 'Erika', nachname: 'Leitung', email },
			});
			return { verein, person };
		}

		it('Demo mit Zugang und Sitzung wird neu eingespielt', async () => {
			// Seit Etappe 3 melden sich Leute im Demo-Verein an; das darf das Werkzeug nicht blockieren.
			const { verein, person } = await vereinMitSlugDemo('leitung@example.org');
			const zugang = await prisma.zugang.create({ data: { vereinId: verein.id, personId: person.id } });
			await prisma.session.create({
				data: {
					vereinId: verein.id,
					zugangId: zugang.id,
					tokenHash: 'erfundener-hash',
					ablauf: new Date('2027-01-01T00:00:00Z'),
				},
			});

			const ergebnis = await demoEinspielen(prisma, BEZUGSTAG);

			expect(ergebnis.personen).toBe(10);
			expect(await prisma.zugang.count()).toBe(0);
			expect(await prisma.session.count()).toBe(0);
			expect(await prisma.verein.count({ where: { id: verein.id } })).toBe(0);
		});

		it('Verein demo mit echter Adresse ist geschuetzt', async () => {
			const { verein, person } = await vereinMitSlugDemo('leitung@verein.de');
			const zugang = await prisma.zugang.create({ data: { vereinId: verein.id, personId: person.id } });

			await expect(demoEinspielen(prisma, BEZUGSTAG)).rejects.toBeInstanceOf(DemoGeschuetztFehler);

			expect(await prisma.verein.findUnique({ where: { id: verein.id } })).not.toBeNull();
			expect(await prisma.person.count({ where: { vereinId: verein.id } })).toBe(1);
			expect(await prisma.zugang.count({ where: { id: zugang.id } })).toBe(1);
			expect(await prisma.verein.count()).toBe(1);
		});

		it('meldet die Zahl der Personen mit echter Adresse', async () => {
			const { verein } = await vereinMitSlugDemo('leitung@verein.de');
			await prisma.person.create({
				data: { vereinId: verein.id, art: 'ERWACHSENER', vorname: 'Egon', nachname: 'Zwei', email: 'egon@example.org' },
			});

			await expect(demoEinspielen(prisma, BEZUGSTAG)).rejects.toThrow(/1 Person/);
		});
	});
});
