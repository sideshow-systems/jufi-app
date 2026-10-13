import { hashToken } from '@jufi/auth';
import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { EINRICHTUNG_GUELTIG_MS } from '@jufi/domain';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAnlegen, adminZuruecksetzen } from './admin.js';
import { CliFehler } from './fehler.js';
import { fuehreAus, type Abhaengigkeiten } from './main.js';

const JETZT = new Date('2026-10-13T10:00:00Z');
const BASIS = 'https://jufi.example.org';

describe('admin anlegen und zuruecksetzen', () => {
	const prisma: PrismaClient = createPrismaClientFromEnv();
	const ausgabe: string[] = [];
	const deps: Abhaengigkeiten = {
		prisma: () => prisma,
		jetzt: () => JETZT,
		ausgabe: (s) => {
			ausgabe.push(s);
		},
		basisUrl: () => BASIS,
		frage: () => Promise.reject(new Error('admin-Befehle fragen nichts')),
	};

	// AdminProtokoll haengt per Restrict am Admin; ohne es zuerst zu leeren, scheiterte das Aufraeumen.
	beforeEach(async () => {
		ausgabe.length = 0;
		await prisma.adminProtokoll.deleteMany();
		await prisma.plattformAdmin.deleteMany();
	});

	afterAll(async () => {
		await prisma.adminProtokoll.deleteMany();
		await prisma.plattformAdmin.deleteMany();
		await prisma.$disconnect();
	});

	/** Der Link steht in der letzten Ausgabezeile; Token ist der Teil hinter dem #. */
	function tokenAusLink(link: string): string {
		expect(link.startsWith(`${BASIS}/admin/einrichten#`)).toBe(true);
		return link.slice(link.indexOf('#') + 1);
	}

	it('admin anlegen gibt einen Link aus, dessen Token zur gespeicherten Einrichtung passt', async () => {
		expect(await fuehreAus(['admin', 'anlegen', 'florian'], deps)).toBe(0);

		expect(ausgabe).toHaveLength(2);
		expect(ausgabe[0]).toBe('Admin florian angelegt. Einrichtungslink (1 Stunde gültig, nur einmal):');
		const token = tokenAusLink(ausgabe[1]);

		const admin = await prisma.plattformAdmin.findUniqueOrThrow({
			where: { benutzername: 'florian' },
			include: { einrichtungen: true },
		});
		expect(admin.passwortHash).toBeNull();
		expect(admin.einrichtungen).toHaveLength(1);
		const [einrichtung] = admin.einrichtungen;
		expect(einrichtung.tokenHash).toBe(hashToken(token));
		expect(einrichtung.ablauf).toEqual(new Date(JETZT.getTime() + EINRICHTUNG_GUELTIG_MS));
		expect(einrichtung.eingeloestAm).toBeNull();
		// Das Token selbst wird nie gespeichert.
		expect(JSON.stringify(admin)).not.toContain(token);
	});

	it('doppelter Name ist Exit 1', async () => {
		expect(await fuehreAus(['admin', 'anlegen', 'florian'], deps)).toBe(0);
		ausgabe.length = 0;

		expect(await fuehreAus(['admin', 'anlegen', 'florian'], deps)).toBe(1);
		expect(ausgabe).toEqual(['Admin florian gibt es schon.']);
		// Die zweite Einrichtung darf nicht entstehen: Sonst lieferte der Befehl auf Zuruf einen Link fuer einen fremden Admin.
		expect(await prisma.adminEinrichtung.count()).toBe(1);
	});

	it('Name wird normalisiert', async () => {
		expect(await fuehreAus(['admin', 'anlegen', ' Florian '], deps)).toBe(0);
		expect(ausgabe[0]).toBe('Admin florian angelegt. Einrichtungslink (1 Stunde gültig, nur einmal):');
		expect(await prisma.plattformAdmin.findMany({ select: { benutzername: true } })).toEqual([
			{ benutzername: 'florian' },
		]);

		// Derselbe Name in anderer Schreibweise ist derselbe Admin.
		ausgabe.length = 0;
		expect(await fuehreAus(['admin', 'anlegen', 'FLORIAN'], deps)).toBe(1);
		expect(ausgabe).toEqual(['Admin florian gibt es schon.']);
	});

	it('ungueltiger Name ist Exit 1', async () => {
		for (const name of ['ab', 'a'.repeat(31), 'flo rian', 'Flo@rian', '']) {
			ausgabe.length = 0;
			expect(await fuehreAus(['admin', 'anlegen', name], deps), name).toBe(1);
			expect(ausgabe).toEqual([
				'Benutzername: 3 bis 30 Zeichen, Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.',
			]);
		}
		expect(await prisma.plattformAdmin.count()).toBe(0);
	});

	it('ohne BASIS_URL bricht admin anlegen mit Meldung ab und legt nichts an', async () => {
		const ohne: Abhaengigkeiten = {
			...deps,
			basisUrl: () => {
				throw new CliFehler('BASIS_URL fehlt.');
			},
		};
		expect(await fuehreAus(['admin', 'anlegen', 'florian'], ohne)).toBe(1);
		expect(ausgabe).toEqual(['BASIS_URL fehlt.']);
		expect(await prisma.plattformAdmin.count()).toBe(0);
		expect(await prisma.adminEinrichtung.count()).toBe(0);
	});

	it('ohne BASIS_URL bricht auch admin zuruecksetzen ab und laesst den Admin unberuehrt', async () => {
		await adminAnlegen(prisma, 'florian', JETZT);
		await prisma.plattformAdmin.update({ where: { benutzername: 'florian' }, data: { passwortHash: 'hash' } });
		const ohne: Abhaengigkeiten = {
			...deps,
			basisUrl: () => {
				throw new CliFehler('BASIS_URL fehlt.');
			},
		};
		expect(await fuehreAus(['admin', 'zuruecksetzen', 'florian'], ohne)).toBe(1);
		const admin = await prisma.plattformAdmin.findUniqueOrThrow({ where: { benutzername: 'florian' } });
		expect(admin.passwortHash).toBe('hash');
	});

	async function adminMitZugangsdaten() {
		const anfangsToken = await adminAnlegen(prisma, 'florian', JETZT);
		const admin = await prisma.plattformAdmin.update({
			where: { benutzername: 'florian' },
			data: { passwortHash: 'argon2-hash', totpGeheimnis: 'verschluesselt', totpAktivAm: JETZT },
		});
		await prisma.adminPasskey.create({
			data: { adminId: admin.id, credentialId: 'cred-1', publicKey: 'pk', label: 'Mac' },
		});
		await prisma.adminSession.create({
			data: { adminId: admin.id, tokenHash: 'sitzung-1', ablauf: new Date(JETZT.getTime() + 3600_000) },
		});
		await prisma.adminRecoveryCode.create({ data: { adminId: admin.id, codeHash: 'code-1' } });
		await prisma.webauthnChallenge.create({
			data: { adminId: admin.id, challenge: 'challenge-1', purpose: 'authenticate', expiresAt: JETZT },
		});
		return { admin, anfangsToken };
	}

	it('zuruecksetzen loescht Zugangsdaten und Sitzungen und gibt einen neuen Link aus', async () => {
		const { admin, anfangsToken } = await adminMitZugangsdaten();
		// Die offene Einrichtung aus "anlegen" muss mit weg: Sonst bliebe ein alter Link neben dem neuen gueltig.
		expect(await prisma.adminEinrichtung.count({ where: { adminId: admin.id } })).toBe(1);

		expect(await fuehreAus(['admin', 'zuruecksetzen', 'florian'], deps)).toBe(0);

		expect(ausgabe).toHaveLength(2);
		expect(ausgabe[0]).toBe(
			'Admin florian zurückgesetzt: Passwort, Passkeys, TOTP und Sitzungen gelöscht. Neuer Einrichtungslink (1 Stunde gültig, nur einmal):',
		);
		const token = tokenAusLink(ausgabe[1]);

		const danach = await prisma.plattformAdmin.findUniqueOrThrow({
			where: { id: admin.id },
			include: {
				passkeys: true,
				sessions: true,
				recoveryCodes: true,
				webauthnChallenges: true,
				einrichtungen: true,
			},
		});
		expect(danach.passwortHash).toBeNull();
		expect(danach.totpGeheimnis).toBeNull();
		expect(danach.totpAktivAm).toBeNull();
		expect(danach.passkeys).toEqual([]);
		expect(danach.sessions).toEqual([]);
		expect(danach.recoveryCodes).toEqual([]);
		expect(danach.webauthnChallenges).toEqual([]);
		expect(danach.einrichtungen).toHaveLength(1);
		expect(danach.einrichtungen[0].tokenHash).toBe(hashToken(token));
		expect(danach.einrichtungen[0].tokenHash).not.toBe(hashToken(anfangsToken));
		expect(danach.einrichtungen[0].ablauf).toEqual(new Date(JETZT.getTime() + EINRICHTUNG_GUELTIG_MS));
		// Derselbe Admin, nicht neu angelegt: Das Protokoll haengt an seiner id.
		expect(danach.benutzername).toBe('florian');
	});

	it('zuruecksetzen laesst andere Admins unberuehrt', async () => {
		await adminMitZugangsdaten();
		const fremd = await prisma.plattformAdmin.create({
			data: { benutzername: 'anna', passwortHash: 'anderer-hash' },
		});
		await prisma.adminSession.create({
			data: { adminId: fremd.id, tokenHash: 'sitzung-anna', ablauf: new Date(JETZT.getTime() + 3600_000) },
		});

		await adminZuruecksetzen(prisma, 'florian', JETZT);

		expect((await prisma.plattformAdmin.findUniqueOrThrow({ where: { id: fremd.id } })).passwortHash).toBe(
			'anderer-hash',
		);
		expect(await prisma.adminSession.count({ where: { adminId: fremd.id } })).toBe(1);
	});

	it('zuruecksetzen normalisiert den Namen', async () => {
		await adminAnlegen(prisma, 'florian', JETZT);
		expect(await fuehreAus(['admin', 'zuruecksetzen', ' Florian '], deps)).toBe(0);
		expect(ausgabe[0]).toContain('Admin florian zurückgesetzt');
	});

	it('zuruecksetzen unbekannt ist Exit 1', async () => {
		expect(await fuehreAus(['admin', 'zuruecksetzen', 'niemand'], deps)).toBe(1);
		expect(ausgabe).toEqual(['Admin niemand gibt es nicht.']);
		expect(await prisma.adminEinrichtung.count()).toBe(0);
	});

	it('adminAnlegen wirft CliFehler bei doppeltem Namen', async () => {
		await adminAnlegen(prisma, 'florian', JETZT);
		await expect(adminAnlegen(prisma, 'florian', JETZT)).rejects.toBeInstanceOf(CliFehler);
	});
});
