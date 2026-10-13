/**
 * Regeln, die die Datenbank selbst durchsetzt: Mandantentrennung per
 * zusammengesetztem Fremdschluessel, Eindeutigkeit je Verein, CHECKs und
 * Loeschverhalten. Laeuft gegen jufi_test_db (test-setup.ts).
 *
 * Jeder Test legt eigene Vereine mit eindeutigem Slug an, damit die Tests
 * unabhaengig voneinander und in beliebiger Reihenfolge laufen.
 */

import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient, Prisma } from './index.js';

const prisma = createPrismaClient();

afterAll(async () => {
	await prisma.$disconnect();
});

function eindeutig(): string {
	return randomBytes(4).toString('hex');
}

async function verein(stamm = 'verein') {
	return prisma.verein.create({
		data: {
			slug: `${stamm}-${eindeutig()}`,
			name: 'Erfundener Fischereiverein 1900 e.V.',
			anzeigename: 'Jungfischer Test',
			farbe: '#1f6f8b',
		},
	});
}

async function jungfischer(vereinId: string, vorname = 'Lena') {
	return prisma.person.create({
		data: { vereinId, art: 'JUNGFISCHER', vorname, nachname: 'Muster', geburtsdatum: new Date('2014-05-01') },
	});
}

async function erwachsener(vereinId: string, vorname = 'Sandra') {
	return prisma.person.create({
		data: { vereinId, art: 'ERWACHSENER', vorname, nachname: 'Muster' },
	});
}

/** Prisma-Fehlercode, z.B. P2002 (eindeutig) oder P2003 (Fremdschluessel). */
async function fehlercode(vorgang: Promise<unknown>): Promise<string> {
	try {
		await vorgang;
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code;
		throw e;
	}
	throw new Error('Vorgang wurde nicht abgelehnt');
}

/**
 * Fehlertext eines abgelehnten Vorgangs. CHECK-Verletzungen erkennt man an der
 * Bezeichnung des Constraints, die Postgres in die Meldung schreibt.
 */
async function fehlertext(vorgang: Promise<unknown>): Promise<string> {
	try {
		await vorgang;
	} catch (e) {
		const meta = e instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(e.meta) : '';
		return `${(e as Error).message} ${meta}`;
	}
	throw new Error('Vorgang wurde nicht abgelehnt');
}

describe('Mandantentrennung', () => {
	it('Bezugsperson mit Erwachsenem aus fremdem Verein wird abgelehnt', async () => {
		const a = await verein();
		const b = await verein();
		const kindA = await jungfischer(a.id);
		const erwachsenerB = await erwachsener(b.id);

		expect(
			await fehlercode(
				prisma.bezugsperson.create({
					data: {
						vereinId: a.id,
						erwachsenerId: erwachsenerB.id,
						jungfischerId: kindA.id,
						beziehung: 'MUTTER',
						erziehungsberechtigt: true,
					},
				}),
			),
		).toBe('P2003');
		expect(await prisma.bezugsperson.count({ where: { jungfischerId: kindA.id } })).toBe(0);
	});

	it('UntergruppeMitglied mit Person aus fremdem Verein wird abgelehnt', async () => {
		const a = await verein();
		const b = await verein();
		const gruppeA = await prisma.untergruppe.create({ data: { vereinId: a.id, name: 'Hechte' } });
		const kindB = await jungfischer(b.id);

		// Beide Richtungen: vereinId passt zur Gruppe, aber nicht zur Person — und umgekehrt.
		expect(
			await fehlercode(
				prisma.untergruppeMitglied.create({ data: { vereinId: a.id, untergruppeId: gruppeA.id, personId: kindB.id } }),
			),
		).toBe('P2003');
		expect(
			await fehlercode(
				prisma.untergruppeMitglied.create({ data: { vereinId: b.id, untergruppeId: gruppeA.id, personId: kindB.id } }),
			),
		).toBe('P2003');
	});

	it('Session mit Zugang aus fremdem Verein wird abgelehnt', async () => {
		const a = await verein();
		const b = await verein();
		const erwachsenerB = await erwachsener(b.id);
		const zugangB = await prisma.zugang.create({
			data: { vereinId: b.id, personId: erwachsenerB.id, email: `sandra-${eindeutig()}@example.org` },
		});

		expect(
			await fehlercode(
				prisma.session.create({
					data: {
						vereinId: a.id,
						zugangId: zugangB.id,
						tokenHash: eindeutig(),
						ablauf: new Date('2027-01-01'),
					},
				}),
			),
		).toBe('P2003');
	});
});

describe('Kennungen im Zugang', () => {
	it('gleiche E-Mail in zwei Vereinen erlaubt, im selben Verein abgelehnt', async () => {
		const a = await verein();
		const b = await verein();
		const email = `sandra-${eindeutig()}@example.org`;
		await prisma.zugang.create({ data: { vereinId: a.id, personId: (await erwachsener(a.id)).id, email } });
		await prisma.zugang.create({ data: { vereinId: b.id, personId: (await erwachsener(b.id)).id, email } });

		const zweite = await erwachsener(a.id, 'Petra');
		expect(await fehlercode(prisma.zugang.create({ data: { vereinId: a.id, personId: zweite.id, email } }))).toBe(
			'P2002',
		);
	});

	it('gleicher Anmeldename im selben Verein abgelehnt', async () => {
		const a = await verein();
		await prisma.zugang.create({
			data: { vereinId: a.id, personId: (await jungfischer(a.id)).id, anmeldename: 'lena' },
		});

		const zweite = await jungfischer(a.id, 'Lena');
		expect(
			await fehlercode(prisma.zugang.create({ data: { vereinId: a.id, personId: zweite.id, anmeldename: 'lena' } })),
		).toBe('P2002');
	});

	it('E-Mail und Anmeldename nur kleingeschrieben', async () => {
		const a = await verein();
		const mutter = await erwachsener(a.id);
		const kind = await jungfischer(a.id);

		expect(
			await fehlertext(
				prisma.zugang.create({ data: { vereinId: a.id, personId: mutter.id, email: 'Sandra@Example.org' } }),
			),
		).toMatch(/zugang_kleinschreibung/);
		expect(
			await fehlertext(prisma.zugang.create({ data: { vereinId: a.id, personId: kind.id, anmeldename: 'Lena' } })),
		).toMatch(/zugang_kleinschreibung/);

		await prisma.zugang.create({ data: { vereinId: a.id, personId: kind.id, anmeldename: 'lena2' } });
	});

	it('Zugang ohne E-Mail und ohne Anmeldename abgelehnt', async () => {
		const a = await verein();
		const mutter = await erwachsener(a.id);

		expect(await fehlertext(prisma.zugang.create({ data: { vereinId: a.id, personId: mutter.id } }))).toMatch(
			/zugang_kennung/,
		);
	});
});

describe('Felder je Art der Person', () => {
	it('Jungfischer ohne Geburtsdatum abgelehnt, als Grabstein erlaubt', async () => {
		const a = await verein();

		expect(
			await fehlertext(
				prisma.person.create({ data: { vereinId: a.id, art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Muster' } }),
			),
		).toMatch(/person_art_felder/);

		const grabstein = await prisma.person.create({
			data: { vereinId: a.id, art: 'JUNGFISCHER', vorname: '', nachname: '', entferntAm: new Date('2026-10-01') },
		});
		expect(grabstein.geburtsdatum).toBeNull();
	});

	it('Erwachsener mit Geburtsdatum oder als Jugendsprecher abgelehnt', async () => {
		const a = await verein();
		const basis = { vereinId: a.id, art: 'ERWACHSENER' as const, vorname: 'Hans', nachname: 'Muster' };

		expect(
			await fehlertext(prisma.person.create({ data: { ...basis, geburtsdatum: new Date('1960-01-01') } })),
		).toMatch(/person_art_felder/);
		expect(await fehlertext(prisma.person.create({ data: { ...basis, jugendsprecher: true } }))).toMatch(
			/person_art_felder/,
		);
		expect(
			await fehlertext(prisma.person.create({ data: { ...basis, volljaehrigGeprueftAm: new Date('2026-10-01') } })),
		).toMatch(/person_art_felder/);
	});

	it('Jungfischer mit Rechten abgelehnt', async () => {
		const a = await verein();

		expect(
			await fehlertext(
				prisma.person.create({
					data: {
						vereinId: a.id,
						art: 'JUNGFISCHER',
						vorname: 'Lena',
						nachname: 'Muster',
						geburtsdatum: new Date('2010-01-01'),
						rechte: ['MITGLIEDER'],
					},
				}),
			),
		).toMatch(/person_art_felder/);

		// Gegenprobe: derselbe Satz Rechte ist beim Erwachsenen in Ordnung.
		await prisma.person.create({
			data: { vereinId: a.id, art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Muster', rechte: ['MITGLIEDER'] },
		});
	});
});

describe('Familie', () => {
	it('ANDERE ohne Freitext abgelehnt, MUTTER mit Freitext abgelehnt', async () => {
		const a = await verein();
		const kind = await jungfischer(a.id);
		const zuordnung = async (beziehung: 'ANDERE' | 'MUTTER', beziehungFreitext?: string) =>
			prisma.bezugsperson.create({
				data: {
					vereinId: a.id,
					erwachsenerId: (await erwachsener(a.id)).id,
					jungfischerId: kind.id,
					beziehung,
					beziehungFreitext,
					erziehungsberechtigt: false,
				},
			});

		expect(await fehlertext(zuordnung('ANDERE'))).toMatch(/bezugsperson_freitext/);
		expect(await fehlertext(zuordnung('ANDERE', '   '))).toMatch(/bezugsperson_freitext/);
		expect(await fehlertext(zuordnung('MUTTER', 'Mama'))).toMatch(/bezugsperson_freitext/);

		await zuordnung('ANDERE', 'Patenonkel');
		await zuordnung('MUTTER');
	});
});

describe('Verein', () => {
	it('Slug mit Grossbuchstaben und Anzeigename ueber 24 Zeichen abgelehnt', async () => {
		const daten = { name: 'Erfundener Fischereiverein', farbe: '#1f6f8b' };

		expect(
			await fehlertext(
				prisma.verein.create({ data: { ...daten, slug: `Gross-${eindeutig()}`, anzeigename: 'Jungfischer Test' } }),
			),
		).toMatch(/verein_slug/);
		expect(
			await fehlertext(
				prisma.verein.create({ data: { ...daten, slug: `lang-${eindeutig()}`, anzeigename: 'x'.repeat(25) } }),
			),
		).toMatch(/verein_anzeigename/);

		await prisma.verein.create({ data: { ...daten, slug: `genau-${eindeutig()}`, anzeigename: 'x'.repeat(24) } });
	});
});

describe('Loeschen', () => {
	it('Verein loeschen entfernt alle Vereinsdaten, AdminProtokoll bleibt', async () => {
		const a = await verein('weg');
		const b = await verein('bleibt');
		const vereinId = a.id;

		const kind = await jungfischer(vereinId);
		const mutter = await erwachsener(vereinId);
		const zugang = await prisma.zugang.create({
			data: { vereinId, personId: mutter.id, email: `sandra-${eindeutig()}@example.org` },
		});
		const gruppe = await prisma.untergruppe.create({ data: { vereinId, name: 'Hechte' } });
		const admin = await prisma.plattformAdmin.create({ data: { benutzername: `admin-${eindeutig()}` } });

		await prisma.vereinLogo.create({
			data: {
				vereinId,
				bild: Buffer.from('bild'),
				mimeType: 'image/png',
				icon192: Buffer.from('192'),
				icon512: Buffer.from('512'),
			},
		});
		await prisma.bezugsperson.create({
			data: {
				vereinId,
				erwachsenerId: mutter.id,
				jungfischerId: kind.id,
				beziehung: 'MUTTER',
				erziehungsberechtigt: true,
			},
		});
		await prisma.untergruppeMitglied.create({ data: { vereinId, untergruppeId: gruppe.id, personId: kind.id } });
		await prisma.passkey.create({
			data: {
				vereinId,
				zugangId: zugang.id,
				credentialId: eindeutig(),
				publicKey: 'pk',
				transports: [],
				label: 'iPhone',
			},
		});
		await prisma.recoveryCode.create({ data: { vereinId, zugangId: zugang.id, codeHash: eindeutig() } });
		await prisma.session.create({
			data: { vereinId, zugangId: zugang.id, tokenHash: eindeutig(), ablauf: new Date('2027-01-01') },
		});
		await prisma.webauthnChallenge.create({
			data: {
				vereinId,
				personId: kind.id,
				challenge: eindeutig(),
				purpose: 'register',
				expiresAt: new Date('2027-01-01'),
			},
		});
		await prisma.einladung.create({
			data: {
				vereinId,
				personId: kind.id,
				art: 'EINLADUNG',
				tokenHash: eindeutig(),
				ablauf: new Date('2027-01-01'),
				erstelltVonPersonId: mutter.id,
			},
		});
		// Die Einwilligung verhindert das harte Loeschen einer Person (NO ACTION);
		// das Loeschen des ganzen Vereins muss trotzdem durchgehen.
		await prisma.einwilligung.create({
			data: { vereinId, jungfischerId: kind.id, erteiltVon: mutter.id, art: 'DSGVO_ART8', textVersion: '2026-10' },
		});
		await prisma.mailWarteschlange.create({
			data: { vereinId, empfaenger: 'sandra@example.org', betreff: 'Einladung', text: 'Hallo' },
		});
		await prisma.adminProtokoll.create({
			data: { adminId: admin.id, aktion: 'VEREIN_ANGELEGT', vereinId, vereinSlug: a.slug },
		});
		const personB = await erwachsener(b.id);

		await prisma.verein.delete({ where: { id: vereinId } });

		const uebrig = {
			verein: await prisma.verein.count({ where: { id: vereinId } }),
			vereinLogo: await prisma.vereinLogo.count({ where: { vereinId } }),
			person: await prisma.person.count({ where: { vereinId } }),
			bezugsperson: await prisma.bezugsperson.count({ where: { vereinId } }),
			untergruppe: await prisma.untergruppe.count({ where: { vereinId } }),
			untergruppeMitglied: await prisma.untergruppeMitglied.count({ where: { vereinId } }),
			zugang: await prisma.zugang.count({ where: { vereinId } }),
			passkey: await prisma.passkey.count({ where: { vereinId } }),
			recoveryCode: await prisma.recoveryCode.count({ where: { vereinId } }),
			session: await prisma.session.count({ where: { vereinId } }),
			webauthnChallenge: await prisma.webauthnChallenge.count({ where: { vereinId } }),
			einladung: await prisma.einladung.count({ where: { vereinId } }),
			einwilligung: await prisma.einwilligung.count({ where: { vereinId } }),
			mailWarteschlange: await prisma.mailWarteschlange.count({ where: { vereinId } }),
		};
		expect(uebrig).toEqual(Object.fromEntries(Object.keys(uebrig).map((k) => [k, 0])));

		expect(await prisma.adminProtokoll.count({ where: { vereinId } })).toBe(1);
		expect(await prisma.person.findUnique({ where: { id: personB.id } })).not.toBeNull();
	});

	it('Person mit Einwilligung laesst sich nicht hart loeschen', async () => {
		const a = await verein();
		const kind = await jungfischer(a.id);
		const mutter = await erwachsener(a.id);
		await prisma.einwilligung.create({
			data: {
				vereinId: a.id,
				jungfischerId: kind.id,
				erteiltVon: mutter.id,
				art: 'DSGVO_ART8',
				textVersion: '2026-10',
			},
		});

		expect(await fehlercode(prisma.person.delete({ where: { id: kind.id } }))).toBe('P2003');
		expect(await fehlercode(prisma.person.delete({ where: { id: mutter.id } }))).toBe('P2003');
		expect(await prisma.person.count({ where: { id: { in: [kind.id, mutter.id] } } })).toBe(2);
	});
});
