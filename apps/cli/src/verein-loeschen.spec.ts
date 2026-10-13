import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fuehreAus, type Abhaengigkeiten } from './main.js';
import { vereinLoeschen, vereinZumLoeschen } from './verein-loeschen.js';

const JETZT = new Date('2026-10-13T10:00:00Z');

describe('verein loeschen', () => {
	const prisma: PrismaClient = createPrismaClientFromEnv();
	const ausgabe: string[] = [];
	const fragen: string[] = [];
	let antwort = '';
	const deps: Abhaengigkeiten = {
		prisma: () => prisma,
		jetzt: () => JETZT,
		ausgabe: (s) => {
			ausgabe.push(s);
		},
		basisUrl: () => 'https://jufi.example.org',
		frage: (text) => {
			fragen.push(text);
			return Promise.resolve(antwort);
		},
	};

	async function aufraeumen() {
		// Das Protokoll haengt per Restrict am Admin, also zuerst leeren.
		await prisma.adminProtokoll.deleteMany();
		await prisma.plattformAdmin.deleteMany();
		await prisma.verein.deleteMany();
	}

	beforeEach(async () => {
		ausgabe.length = 0;
		fragen.length = 0;
		antwort = '';
		await aufraeumen();
	});

	afterAll(async () => {
		await aufraeumen();
		await prisma.$disconnect();
	});

	/** Ein Verein mit Daten in jeder Tabelle, die am Verein haengt, damit eine Sperre durch einen Fremdschluessel auffaellt. */
	async function vereinMitDaten(slug: string, anzeigename: string) {
		const verein = await prisma.verein.create({
			data: { slug, name: `${anzeigename} e.V.`, anzeigename, farbe: '#1d4ed8' },
		});
		const vereinId = verein.id;
		const leitung = await prisma.person.create({
			data: {
				vereinId,
				art: 'ERWACHSENER',
				vorname: 'Erika',
				nachname: 'Leitung',
				email: `erika@${slug}.example.org`,
				rechte: ['JUGENDLEITER_RECHTE'],
			},
		});
		const kind = await prisma.person.create({
			data: { vereinId, art: 'JUNGFISCHER', vorname: 'Kai', nachname: 'Kind', geburtsdatum: new Date('2014-03-01') },
		});
		await prisma.bezugsperson.create({
			data: {
				vereinId,
				erwachsenerId: leitung.id,
				jungfischerId: kind.id,
				beziehung: 'MUTTER',
				erziehungsberechtigt: true,
			},
		});
		const gruppe = await prisma.untergruppe.create({
			data: { vereinId, name: 'Jüngere', mitglieder: { create: [{ personId: kind.id }] } },
		});
		const zugang = await prisma.zugang.create({ data: { vereinId, personId: leitung.id } });
		await prisma.passkey.create({
			data: { vereinId, zugangId: zugang.id, credentialId: `cred-${slug}`, publicKey: 'pk', label: 'Mac' },
		});
		await prisma.recoveryCode.create({ data: { vereinId, zugangId: zugang.id, codeHash: `code-${slug}` } });
		await prisma.session.create({
			data: { vereinId, zugangId: zugang.id, tokenHash: `sitzung-${slug}`, ablauf: new Date('2027-01-01') },
		});
		await prisma.webauthnChallenge.create({
			data: { vereinId, personId: leitung.id, challenge: `challenge-${slug}`, purpose: 'register', expiresAt: JETZT },
		});
		await prisma.einladung.create({
			data: {
				vereinId,
				personId: kind.id,
				art: 'EINLADUNG',
				tokenHash: `einladung-${slug}`,
				ablauf: new Date('2027-01-01'),
				erstelltVonPersonId: leitung.id,
			},
		});
		await prisma.einwilligung.create({
			data: {
				vereinId,
				jungfischerId: kind.id,
				erteiltVon: leitung.id,
				art: 'DSGVO_ART8',
				textVersion: '1',
			},
		});
		await prisma.mailWarteschlange.create({
			data: { vereinId, empfaenger: `erika@${slug}.example.org`, betreff: 'Hallo', text: 'Text' },
		});
		await prisma.vereinLogo.create({
			data: {
				vereinId,
				bild: Buffer.from('x'),
				mimeType: 'image/png',
				icon192: Buffer.from('x'),
				icon512: Buffer.from('x'),
			},
		});
		return { vereinId, gruppeId: gruppe.id };
	}

	async function zeilen(vereinId: string) {
		const where = { vereinId };
		return {
			personen: await prisma.person.count({ where }),
			bezugspersonen: await prisma.bezugsperson.count({ where }),
			untergruppen: await prisma.untergruppe.count({ where }),
			mitglieder: await prisma.untergruppeMitglied.count({ where }),
			zugaenge: await prisma.zugang.count({ where }),
			passkeys: await prisma.passkey.count({ where }),
			recoveryCodes: await prisma.recoveryCode.count({ where }),
			sessions: await prisma.session.count({ where }),
			challenges: await prisma.webauthnChallenge.count({ where }),
			einladungen: await prisma.einladung.count({ where }),
			einwilligungen: await prisma.einwilligung.count({ where }),
			mails: await prisma.mailWarteschlange.count({ where }),
			logos: await prisma.vereinLogo.count({ where }),
		};
	}

	it('vereinZumLoeschen nennt Anzeigenamen und Zahl der Personen, unbekannt ist null', async () => {
		await vereinMitDaten('angler', 'Angler Nord');
		expect(await vereinZumLoeschen(prisma, 'angler')).toEqual({ anzeigename: 'Angler Nord', personen: 2 });
		expect(await vereinZumLoeschen(prisma, 'gibtsnicht')).toBeNull();
	});

	it('verein loeschen mit richtiger Bestaetigung loescht alles des Vereins und laesst andere stehen', async () => {
		const weg = await vereinMitDaten('angler', 'Angler Nord');
		const bleibt = await vereinMitDaten('petri', 'Petri Sued');
		const vorher = await zeilen(bleibt.vereinId);
		expect((await zeilen(weg.vereinId)).personen).toBe(2);

		expect(await vereinLoeschen(prisma, 'angler', 'angler')).toBe('geloescht');

		expect(await prisma.verein.count({ where: { slug: 'angler' } })).toBe(0);
		expect(Object.values(await zeilen(weg.vereinId)).every((n) => n === 0)).toBe(true);
		expect(await prisma.verein.count({ where: { slug: 'petri' } })).toBe(1);
		expect(await zeilen(bleibt.vereinId)).toEqual(vorher);
	});

	it('falsche Bestaetigung loescht nichts', async () => {
		const verein = await vereinMitDaten('angler', 'Angler Nord');
		const vorher = await zeilen(verein.vereinId);

		for (const falsch of ['', 'ja', 'Angler Nord', 'ANGLER', 'angle', 'angler2']) {
			expect(await vereinLoeschen(prisma, 'angler', falsch), falsch).toBe('abgebrochen');
		}

		expect(await prisma.verein.count({ where: { slug: 'angler' } })).toBe(1);
		expect(await zeilen(verein.vereinId)).toEqual(vorher);
	});

	it('Whitespace um die Antwort zaehlt nicht, sonst scheiterte die Bestaetigung am Zeilenende', async () => {
		await vereinMitDaten('angler', 'Angler Nord');
		expect(await vereinLoeschen(prisma, 'angler', ' angler\r\n')).toBe('geloescht');
	});

	it('Protokolleintraege ueberleben das Loeschen', async () => {
		const admin = await prisma.plattformAdmin.create({ data: { benutzername: 'florian' } });
		const verein = await vereinMitDaten('angler', 'Angler Nord');
		await prisma.adminProtokoll.create({
			data: {
				adminId: admin.id,
				aktion: 'VEREIN_ANGELEGT',
				vereinId: verein.vereinId,
				vereinSlug: 'angler',
			},
		});

		expect(await vereinLoeschen(prisma, 'angler', 'angler')).toBe('geloescht');

		const protokoll = await prisma.adminProtokoll.findMany();
		expect(protokoll).toHaveLength(1);
		expect(protokoll[0]).toMatchObject({ vereinId: verein.vereinId, vereinSlug: 'angler' });
	});

	it('Befehl: fragt mit Anzeigenamen, Slug und Personenzahl und meldet das Loeschen', async () => {
		await vereinMitDaten('angler', 'Angler Nord');
		antwort = 'angler';

		expect(await fuehreAus(['verein', 'loeschen', 'angler'], deps)).toBe(0);

		expect(fragen).toEqual([
			'Verein „Angler Nord" (angler) mit 2 Personen endgültig löschen? Zur Bestätigung den Slug eintippen: ',
		]);
		expect(ausgabe).toEqual(['Verein angler gelöscht.']);
		expect(await prisma.verein.count()).toBe(0);
	});

	it('Befehl: falsche Antwort ist Exit 1 und loescht nichts', async () => {
		await vereinMitDaten('angler', 'Angler Nord');
		antwort = 'nein';

		expect(await fuehreAus(['verein', 'loeschen', 'angler'], deps)).toBe(1);

		expect(ausgabe).toEqual(['Abgebrochen, nichts gelöscht.']);
		expect(await prisma.verein.count()).toBe(1);
	});

	it('Befehl: unbekannter Verein ist Exit 1 und fragt gar nicht erst', async () => {
		expect(await fuehreAus(['verein', 'loeschen', 'gibtsnicht'], deps)).toBe(1);
		expect(ausgabe).toEqual(['Verein gibtsnicht gibt es nicht.']);
		expect(fragen).toEqual([]);
	});
});
