import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { demoEinspielen } from './demo.js';

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

	it('legt 7 Personen, 3 Familienzuordnungen und eine Untergruppe an', async () => {
		const ergebnis = await demoEinspielen(prisma, BEZUGSTAG);

		expect(ergebnis.personen).toBe(7);
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug: 'demo' } });
		expect(ergebnis.vereinId).toBe(verein.id);
		expect(verein).toMatchObject({
			name: 'Jungfischer Demo e.V.',
			anzeigename: 'Jungfischer Demo',
			farbe: '#0f766e',
		});
		expect(await prisma.person.count({ where: { vereinId: verein.id } })).toBe(7);
		expect(await prisma.bezugsperson.count({ where: { vereinId: verein.id } })).toBe(3);
		const gruppen = await prisma.untergruppe.findMany({
			where: { vereinId: verein.id },
			include: { mitglieder: { include: { person: true } } },
		});
		expect(gruppen.map((g) => g.name)).toEqual(['Ältere']);
		expect(gruppen[0].mitglieder.map((m) => m.person.vorname).sort()).toEqual(['Jonas', 'Lena']);
		// Zugaenge entstehen erst ab Etappe 3.
		expect(await prisma.zugang.count({ where: { vereinId: verein.id } })).toBe(0);
	});

	it('vergibt Rechte wie vorgesehen und haelt die CHECKs ein', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);

		const rechte = async (vorname: string) =>
			(await prisma.person.findFirstOrThrow({ where: { vorname } })).rechte.slice().sort();
		expect(await rechte('Thomas')).toHaveLength(7);
		const katrin = await rechte('Katrin');
		expect(katrin).toHaveLength(5);
		expect(katrin).not.toContain('JUGENDLEITER_RECHTE');
		expect(katrin).not.toContain('EINSTELLUNGEN');
		expect(await rechte('Sandra')).toEqual([]);
		expect(await rechte('Hans')).toEqual([]);

		const hans = await prisma.bezugsperson.findFirstOrThrow({ where: { erwachsener: { vorname: 'Hans' } } });
		expect(hans).toMatchObject({ beziehung: 'GROSSVATER', erziehungsberechtigt: false, beziehungFreitext: null });
		const sandra = await prisma.bezugsperson.findMany({
			where: { erwachsener: { vorname: 'Sandra' } },
			include: { jungfischer: true },
		});
		expect(sandra.map((b) => b.jungfischer.vorname).sort()).toEqual(['Lena', 'Max']);
		expect(sandra.every((b) => b.beziehung === 'MUTTER' && b.erziehungsberechtigt)).toBe(true);
	});

	it('zweimal einspielen ergibt denselben Stand', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);
		const erster = await zaehlung();
		await demoEinspielen(prisma, BEZUGSTAG);

		expect(await zaehlung()).toEqual(erster);
		expect(erster.vereine).toBe(1);
		expect(erster.personen).toBe(7);
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

	it('Jonas ist Jugendsprecher und am Bezugstag 17', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);

		const jungfischer = await prisma.person.findMany({ where: { art: 'JUNGFISCHER' } });
		const alter = Object.fromEntries(jungfischer.map((p) => [p.vorname, alterAn(p.geburtsdatum as Date, BEZUGSTAG)]));
		expect(alter).toEqual({ Lena: 14, Max: 12, Jonas: 17 });
		expect(jungfischer.filter((p) => p.jugendsprecher).map((p) => p.vorname)).toEqual(['Jonas']);
	});
});
