import { createPrismaClientFromEnv } from '@jufi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { legeVereinAn } from '../test-vereine.js';
import { MAIL_MAX_VERSUCHE, naechsterAbstandMs, starteMailArbeiter } from './arbeiter.js';
import type { MailVersand } from './versand.js';

const MINUTE_MS = 60 * 1000;
const STUNDE_MS = 60 * MINUTE_MS;
const ADRESSE = 'geheim-empfaenger@jufi.test';

describe('naechsterAbstandMs', () => {
	it('verdoppelt ab 5 Minuten und deckelt bei 24 Stunden', () => {
		expect(naechsterAbstandMs(1)).toBe(5 * MINUTE_MS);
		expect(naechsterAbstandMs(2)).toBe(10 * MINUTE_MS);
		expect(naechsterAbstandMs(3)).toBe(20 * MINUTE_MS);
		expect(naechsterAbstandMs(20)).toBe(24 * STUNDE_MS);
	});
});

describe('Mail-Arbeiter', () => {
	const prisma = createPrismaClientFromEnv();
	// Weit vor jeder Uhr der anderen Testdateien: Der Arbeiter arbeitet
	// plattformweit, faellig (naechsterVersuch <= jetzt) und abgelaufen (< jetzt)
	// sind so nur die Zeilen dieses Tests. Mit der gemeinsamen Test-Uhr
	// beanspruchte er Mails und loeschte Challenges, die parallel laufende Dateien
	// gerade pruefen. Verworfen: Dateien nacheinander laufen lassen (langsamer)
	// oder einen Vereinsfilter im Arbeiter nur fuer Tests.
	const t0 = new Date('2000-01-01T08:00:00Z');
	let jetzt = t0;
	let verein: { id: string };
	let n = 0;
	const sende = vi.fn<MailVersand['sende']>();
	const versand: MailVersand = { sende: (m) => sende(m) };
	let log: string[];

	beforeAll(async () => {
		verein = await legeVereinAn(prisma, { slug: 'mail-arbeiter' });
	});

	afterAll(() => prisma.$disconnect());

	beforeEach(async () => {
		jetzt = t0;
		log = [];
		sende.mockReset();
		sende.mockResolvedValue(undefined);
		// Alle Dateien teilen die Datenbank; die Warteschlange gehoert diesem Verein.
		await prisma.mailWarteschlange.deleteMany({ where: { vereinId: verein.id } });
	});

	function arbeiter() {
		return starteMailArbeiter({
			prisma,
			versand,
			jetzt: () => jetzt,
			intervallMs: 3_600_000,
			log: (z) => log.push(z),
		});
	}

	async function legeAn(daten: { naechsterVersuch?: Date; versuche?: number } = {}) {
		n += 1;
		return prisma.mailWarteschlange.create({
			data: {
				vereinId: verein.id,
				empfaenger: ADRESSE,
				betreff: `Betreff ${n}`,
				text: `Text ${n}`,
				naechsterVersuch: daten.naechsterVersuch ?? t0,
				versuche: daten.versuche ?? 0,
			},
		});
	}

	// Eine Zeile je Test; sende wird nur fuer diesen Verein gezaehlt, damit Mails
	// anderer Testdateien in derselben Datenbank nicht mitzaehlen.
	function eigeneAufrufe() {
		return sende.mock.calls.filter(([m]) => m.empfaenger === ADRESSE);
	}

	it('sendet eine faellige Mail und merkt sich Zeitpunkt und Versuch', async () => {
		const mail = await legeAn();
		const a = arbeiter();
		await a.tick();
		await a.stoppe();
		expect(sende).toHaveBeenCalledWith({ empfaenger: ADRESSE, betreff: mail.betreff, text: mail.text });
		const danach = await prisma.mailWarteschlange.findUniqueOrThrow({ where: { id: mail.id } });
		expect(danach.gesendetAm).toEqual(jetzt);
		expect(danach.versuche).toBe(1);
		expect(danach.fehler).toBeNull();
	});

	it('laesst eine noch nicht faellige Mail liegen', async () => {
		const mail = await legeAn({ naechsterVersuch: new Date(t0.getTime() + MINUTE_MS) });
		const a = arbeiter();
		await a.tick();
		await a.stoppe();
		expect(eigeneAufrufe()).toHaveLength(0);
		const danach = await prisma.mailWarteschlange.findUniqueOrThrow({ where: { id: mail.id } });
		expect(danach).toMatchObject({ gesendetAm: null, versuche: 0 });
	});

	it('wiederholt nach einem Fehler mit wachsendem Abstand und speichert den Fehler ohne Adresse', async () => {
		const mail = await legeAn();
		sende.mockRejectedValue(Object.assign(new Error(`Abgelehnt: ${ADRESSE}`), { name: 'SmtpFehler' }));
		const a = arbeiter();

		await a.tick();
		let z = await prisma.mailWarteschlange.findUniqueOrThrow({ where: { id: mail.id } });
		expect(z.gesendetAm).toBeNull();
		expect(z.versuche).toBe(1);
		expect(z.naechsterVersuch).toEqual(new Date(t0.getTime() + 5 * MINUTE_MS));
		expect(z.fehler).toContain('SmtpFehler');
		expect(z.fehler).not.toContain(ADRESSE);

		// Vor Ablauf des Abstands passiert nichts.
		await a.tick();
		expect(eigeneAufrufe()).toHaveLength(1);

		jetzt = new Date(t0.getTime() + 5 * MINUTE_MS);
		await a.tick();
		z = await prisma.mailWarteschlange.findUniqueOrThrow({ where: { id: mail.id } });
		expect(z.versuche).toBe(2);
		expect(z.naechsterVersuch).toEqual(new Date(jetzt.getTime() + 10 * MINUTE_MS));
		await a.stoppe();
	});

	it('holt eine Mail nach 10 Versuchen nicht mehr', async () => {
		const mail = await legeAn({ versuche: MAIL_MAX_VERSUCHE });
		const a = arbeiter();
		await a.tick();
		await a.stoppe();
		expect(eigeneAufrufe()).toHaveLength(0);
		const danach = await prisma.mailWarteschlange.findUniqueOrThrow({ where: { id: mail.id } });
		expect(danach.versuche).toBe(MAIL_MAX_VERSUCHE);
	});

	it('sendet bei zwei gleichzeitigen tick-Aufrufen genau einmal', async () => {
		await legeAn();
		const a = arbeiter();
		const b = arbeiter();
		await Promise.all([a.tick(), b.tick(), a.tick()]);
		await Promise.all([a.stoppe(), b.stoppe()]);
		expect(eigeneAufrufe()).toHaveLength(1);
	});

	it('loggt weder Adresse noch Betreff noch Text, auch nicht im Fehlerfall', async () => {
		const mail = await legeAn();
		sende.mockRejectedValue(new Error(`Abgelehnt: ${ADRESSE}`));
		const a = arbeiter();
		await a.tick();
		await a.stoppe();
		expect(log.length).toBeGreaterThan(0);
		const alles = log.join('\n');
		expect(alles).not.toContain(ADRESSE);
		expect(alles).not.toContain(mail.betreff);
		expect(alles).not.toContain(mail.text);
		expect(alles).toContain(mail.id);
	});

	it('raeumt abgelaufene Challenges und Sitzungen ab, gueltige bleiben', async () => {
		const { zugangId: zugang } = await legeMitgliedAn(
			prisma,
			{ id: verein.id, slug: 'mail-arbeiter' },
			{ art: 'ERWACHSENER' },
		);
		const alt = new Date(t0.getTime() - MINUTE_MS);
		const neu = new Date(t0.getTime() + MINUTE_MS);
		const kennung = `wartung-${Date.now()}`;
		await prisma.webauthnChallenge.createMany({
			data: [
				{ challenge: `${kennung}-alt`, vereinId: verein.id, purpose: 'authenticate', expiresAt: alt },
				{ challenge: `${kennung}-neu`, vereinId: verein.id, purpose: 'authenticate', expiresAt: neu },
			],
		});
		await prisma.session.createMany({
			data: [
				{ vereinId: verein.id, zugangId: zugang, tokenHash: `${kennung}-alt`, ablauf: alt },
				{ vereinId: verein.id, zugangId: zugang, tokenHash: `${kennung}-neu`, ablauf: neu },
			],
		});
		const a = arbeiter();
		await a.tick();
		await a.stoppe();
		const challenges = await prisma.webauthnChallenge.findMany({ where: { challenge: { startsWith: kennung } } });
		expect(challenges.map((c) => c.challenge)).toEqual([`${kennung}-neu`]);
		const sessions = await prisma.session.findMany({ where: { tokenHash: { startsWith: kennung } } });
		expect(sessions.map((s) => s.tokenHash)).toEqual([`${kennung}-neu`]);
	});

	it('stoppe wartet auf einen haengenden Versand', async () => {
		await legeAn();
		let frei!: () => void;
		// Nur die eigene Mail haengt; eine fremde, die doch faellig waere, darf frei
		// nicht ueberschreiben.
		sende.mockImplementation((m) =>
			m.empfaenger === ADRESSE ? new Promise<void>((r) => (frei = r)) : Promise.resolve(),
		);
		const a = arbeiter();
		const tick = a.tick();
		await vi.waitFor(() => expect(eigeneAufrufe()).toHaveLength(1));
		let gestoppt = false;
		const stopp = a.stoppe().then(() => (gestoppt = true));
		await new Promise((r) => setTimeout(r, 50));
		expect(gestoppt).toBe(false);
		frei();
		await stopp;
		await tick;
		expect(gestoppt).toBe(true);
	});
});
