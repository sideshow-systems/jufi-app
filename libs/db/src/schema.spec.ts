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
import { austauschAnlegen, AUSTAUSCH_TITEL, createPrismaClient, Prisma, standardKategorien } from './index.js';

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
		const zugangB = await prisma.zugang.create({ data: { vereinId: b.id, personId: erwachsenerB.id } });

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

describe('Kennungen', () => {
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

	it('Anmeldename nur kleingeschrieben', async () => {
		const a = await verein();
		const kind = await jungfischer(a.id);

		expect(
			await fehlertext(prisma.zugang.create({ data: { vereinId: a.id, personId: kind.id, anmeldename: 'Lena' } })),
		).toMatch(/zugang_kleinschreibung/);

		await prisma.zugang.create({ data: { vereinId: a.id, personId: kind.id, anmeldename: 'lena2' } });
	});

	it('E-Mail der Person nur kleingeschrieben und ohne Rand', async () => {
		const a = await verein();
		const basis = { vereinId: a.id, art: 'ERWACHSENER' as const, vorname: 'Sandra', nachname: 'Muster' };

		expect(await fehlertext(prisma.person.create({ data: { ...basis, email: 'Sandra@Example.org' } }))).toMatch(
			/person_email/,
		);
		expect(await fehlertext(prisma.person.create({ data: { ...basis, email: ' sandra@example.org' } }))).toMatch(
			/person_email/,
		);
		expect(await fehlertext(prisma.person.create({ data: { ...basis, email: 'sandra@example.org ' } }))).toMatch(
			/person_email/,
		);
		expect(await fehlertext(prisma.person.create({ data: { ...basis, email: '' } }))).toMatch(/person_email/);

		const person = await prisma.person.create({ data: { ...basis, email: 'sandra@example.org' } });
		expect(person.email).toBe('sandra@example.org');
		// Ohne Adresse bleibt erlaubt: Sie ist beim Anlegen freiwillig (Spec 3.3).
		expect((await prisma.person.create({ data: basis })).email).toBeNull();
	});

	it('E-Mail ist je Verein eindeutig, nicht vereinsuebergreifend', async () => {
		const a = await verein();
		const b = await verein();
		const email = `sandra-${eindeutig()}@example.org`;
		const daten = (vereinId: string, vorname: string) => ({
			vereinId,
			art: 'ERWACHSENER' as const,
			vorname,
			nachname: 'Muster',
			email,
		});
		await prisma.person.create({ data: daten(a.id, 'Sandra') });

		expect(await fehlercode(prisma.person.create({ data: daten(a.id, 'Petra') }))).toBe('P2002');
		await prisma.person.create({ data: daten(b.id, 'Sandra') });
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

	it('Rechte sind nie NULL', async () => {
		// Prisma legt Listenfelder ohne NOT NULL an; ein NULL wuerde in einem CHECK
		// mit cardinality(rechte) als "unbekannt" durchrutschen. Daher von Hand gesetzt.
		const a = await verein();
		const mutter = await erwachsener(a.id);

		await expect(prisma.$executeRaw`UPDATE "Person" SET rechte = NULL WHERE id = ${mutter.id}`).rejects.toThrow(
			/rechte|not-null|null value/i,
		);
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

	it('Vereinsfarbe nur als kleingeschriebenes Hex', async () => {
		const mitFarbe = (farbe: string) =>
			prisma.verein.create({
				data: {
					slug: `farbe-${eindeutig()}`,
					name: 'Erfundener Fischereiverein',
					anzeigename: 'Jungfischer Test',
					farbe,
				},
			});

		for (const farbe of ['#0F766E', '0f766e', '#0f766', '#0f766e0', 'rot']) {
			expect(await fehlertext(mitFarbe(farbe))).toMatch(/verein_farbe/);
		}
		expect((await mitFarbe('#0f766e')).farbe).toBe('#0f766e');
	});
});

describe('Besitzer einer WebAuthn-Challenge', () => {
	const challenge = () => ({ challenge: eindeutig(), purpose: 'register', expiresAt: new Date('2027-01-01') });

	it('personId ohne vereinId abgelehnt', async () => {
		const a = await verein();
		const kind = await jungfischer(a.id);

		// Ohne vereinId prueft der zusammengesetzte Fremdschluessel nichts (MATCH SIMPLE).
		expect(await fehlertext(prisma.webauthnChallenge.create({ data: { ...challenge(), personId: kind.id } }))).toMatch(
			/webauthn_challenge_besitzer/,
		);
		expect(
			await fehlertext(prisma.webauthnChallenge.create({ data: { ...challenge(), personId: 'gibt-es-nicht' } })),
		).toMatch(/webauthn_challenge_besitzer/);
	});

	it('vereinId zusammen mit adminId abgelehnt', async () => {
		const a = await verein();
		const admin = await prisma.plattformAdmin.create({ data: { benutzername: `admin-${eindeutig()}` } });

		expect(
			await fehlertext(
				prisma.webauthnChallenge.create({ data: { ...challenge(), vereinId: a.id, adminId: admin.id } }),
			),
		).toMatch(/webauthn_challenge_besitzer/);
	});

	it('gueltige Admin- und Vereinszeilen erlaubt', async () => {
		const a = await verein();
		const kind = await jungfischer(a.id);
		const admin = await prisma.plattformAdmin.create({ data: { benutzername: `admin-${eindeutig()}` } });

		await prisma.webauthnChallenge.create({ data: { ...challenge(), adminId: admin.id } });
		await prisma.webauthnChallenge.create({ data: { ...challenge() } });
		await prisma.webauthnChallenge.create({ data: { ...challenge(), vereinId: a.id, personId: kind.id } });
		await prisma.webauthnChallenge.create({ data: { ...challenge(), vereinId: a.id } });
	});
});

describe('vereinId bleibt fest', () => {
	it('Person mit Zugang laesst sich nicht in einen anderen Verein verschieben', async () => {
		const a = await verein();
		const b = await verein();
		const mutter = await erwachsener(a.id);
		const zugang = await prisma.zugang.create({ data: { vereinId: a.id, personId: mutter.id } });

		expect(await fehlercode(prisma.person.update({ where: { id: mutter.id }, data: { vereinId: b.id } }))).toBe(
			'P2003',
		);
		expect((await prisma.zugang.findUniqueOrThrow({ where: { id: zugang.id } })).vereinId).toBe(a.id);
		expect((await prisma.person.findUniqueOrThrow({ where: { id: mutter.id } })).vereinId).toBe(a.id);
	});
});

describe('Loeschen', () => {
	it('Verein loeschen entfernt alle Vereinsdaten, AdminProtokoll bleibt', async () => {
		const a = await verein('weg');
		const b = await verein('bleibt');
		const vereinId = a.id;

		const kind = await jungfischer(vereinId);
		const mutter = await erwachsener(vereinId);
		const zugang = await prisma.zugang.create({ data: { vereinId, personId: mutter.id } });
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

describe('Threads (TP3)', () => {
	it('austauschAnlegen ergibt einen veroeffentlichten, angepinnten Austausch ohne Ersteller', async () => {
		const jetzt = new Date('2026-10-20T09:30:00Z');
		const v = await prisma.verein.create({
			data: {
				slug: `austausch-${eindeutig()}`,
				name: 'Erfundener Fischereiverein 1900 e.V.',
				anzeigename: 'Jungfischer Test',
				farbe: '#1f6f8b',
				threads: { create: austauschAnlegen(jetzt) },
			},
			include: { threads: true },
		});

		expect(v.threads).toHaveLength(1);
		expect(v.threads[0]).toMatchObject({
			art: 'JUGENDSPRECHER_AUSTAUSCH',
			titel: AUSTAUSCH_TITEL,
			modus: 'CHAT',
			rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER',
			alleUntergruppen: true,
			angepinnt: true,
			erstelltVonId: null,
			veroeffentlichtAm: jetzt,
			letzteAktivitaetAm: jetzt,
			angelegtAm: jetzt,
		});
		expect(AUSTAUSCH_TITEL).toBe('Jugendsprecher-Austausch');
	});

	/** Ein gewoehnlicher Thread; `erstelltVonId` null ist nur beim Austausch erlaubt. */
	async function thread(
		vereinId: string,
		erstelltVonId: string | null,
		daten: Partial<Prisma.ThreadUncheckedCreateInput> = {},
	) {
		return prisma.thread.create({
			data: {
				vereinId,
				erstelltVonId,
				titel: 'Sommerfest',
				modus: 'KOMMENTARE',
				rollenfilter: 'JUNGFISCHER_FAMILIE',
				...daten,
			},
		});
	}

	async function modul(vereinId: string, threadId: string, typ: 'INFO' | 'TERMIN' | 'UMFRAGE' = 'INFO') {
		return prisma.threadModul.create({ data: { vereinId, threadId, typ, position: 0 } });
	}

	/** Umfrage-Modul samt Kopfzeile; Modul und Umfrage teilen sich die ID. */
	async function umfrage(
		vereinId: string,
		threadId: string,
		daten: Partial<Prisma.UmfrageModulUncheckedCreateInput> = {},
	) {
		const m = await modul(vereinId, threadId, 'UMFRAGE');
		return prisma.umfrageModul.create({
			data: { id: m.id, vereinId, threadId, frage: 'Kommst du mit?', einheit: 'JUNGFISCHER', ...daten },
		});
	}

	async function option(vereinId: string, umfrageId: string, schluessel = 'dabei') {
		return prisma.umfrageOption.create({
			data: { vereinId, umfrageId, text: 'Dabei', position: 0, schluessel },
		});
	}

	async function antwort(vereinId: string, umfrageId: string, fuerId: string, vonId: string) {
		return prisma.umfrageAntwort.create({
			data: {
				vereinId,
				umfrageId,
				fuerId,
				vonId,
				abgegebenAm: new Date('2026-10-21T10:00:00Z'),
				clientId: eindeutig(),
			},
		});
	}

	/**
	 * Legt ein Modul und dazu das Termin-Modul an und gibt das Anlegen des Termin-Moduls
	 * zurueck (ohne darauf zu warten), damit der Aufrufer es mit fehlertext() oder await
	 * abfangen kann. Das Modul entsteht vorher, weil jeder Termin ein eigenes braucht.
	 */
	async function termin(
		vereinId: string,
		threadId: string,
		daten: Omit<Prisma.TerminModulUncheckedCreateInput, 'id' | 'vereinId'>,
	) {
		const m = await modul(vereinId, threadId, 'TERMIN');
		return prisma.terminModul.create({ data: { id: m.id, vereinId, ...daten } });
	}

	it('ThreadModul zu Thread aus fremdem Verein abgelehnt', async () => {
		const a = await verein();
		const b = await verein();
		const threadA = await thread(a.id, (await erwachsener(a.id)).id);

		expect(
			await fehlercode(
				prisma.threadModul.create({ data: { vereinId: b.id, threadId: threadA.id, typ: 'INFO', position: 0 } }),
			),
		).toBe('P2003');
	});

	it('Antwort fuer Person aus fremdem Verein abgelehnt', async () => {
		const a = await verein();
		const b = await verein();
		const leiterA = await erwachsener(a.id);
		const u = await umfrage(a.id, (await thread(a.id, leiterA.id)).id);
		const kindB = await jungfischer(b.id);

		expect(await fehlercode(antwort(a.id, u.id, kindB.id, leiterA.id))).toBe('P2003');
		expect(await fehlercode(antwort(a.id, u.id, (await jungfischer(a.id)).id, (await erwachsener(b.id)).id))).toBe(
			'P2003',
		);
	});

	it('zweiter Austausch je Verein abgelehnt, je einer in zwei Vereinen erlaubt', async () => {
		const a = await verein();
		const b = await verein();
		const austausch = {
			art: 'JUGENDSPRECHER_AUSTAUSCH',
			modus: 'CHAT',
			rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER',
		} as const;

		await thread(a.id, null, austausch);
		await thread(b.id, null, austausch);
		expect(await fehlercode(thread(a.id, null, austausch))).toBe('P2002');
		expect(await prisma.thread.count({ where: { vereinId: a.id, art: 'JUGENDSPRECHER_AUSTAUSCH' } })).toBe(1);
	});

	it('zweite Teilnahme-Umfrage im Thread abgelehnt, zwei gewoehnliche erlaubt', async () => {
		const a = await verein();
		const t = await thread(a.id, (await erwachsener(a.id)).id);

		await umfrage(a.id, t.id);
		await umfrage(a.id, t.id);
		await umfrage(a.id, t.id, { teilnahme: true });
		expect(await fehlercode(umfrage(a.id, t.id, { teilnahme: true }))).toBe('P2002');

		// In einem anderen Thread ist wieder eine erlaubt.
		const t2 = await thread(a.id, (await erwachsener(a.id)).id);
		await umfrage(a.id, t2.id, { teilnahme: true });
	});

	it('zweite Antwort fuer dieselbe Person und Umfrage abgelehnt', async () => {
		const a = await verein();
		const leiter = await erwachsener(a.id);
		const kind = await jungfischer(a.id);
		const u = await umfrage(a.id, (await thread(a.id, leiter.id)).id);

		await antwort(a.id, u.id, kind.id, leiter.id);
		expect(await fehlercode(antwort(a.id, u.id, kind.id, leiter.id))).toBe('P2002');
	});

	it('Antwortoption aus anderer Umfrage abgelehnt', async () => {
		const a = await verein();
		const leiter = await erwachsener(a.id);
		const kind = await jungfischer(a.id);
		const t = await thread(a.id, leiter.id);
		const u1 = await umfrage(a.id, t.id);
		const u2 = await umfrage(a.id, t.id);
		const optionU2 = await option(a.id, u2.id);
		const antwortU1 = await antwort(a.id, u1.id, kind.id, leiter.id);

		expect(
			await fehlercode(
				prisma.umfrageAntwortOption.create({
					data: { vereinId: a.id, umfrageId: u1.id, antwortId: antwortU1.id, optionId: optionU2.id },
				}),
			),
		).toBe('P2003');
	});

	it('UmfrageModul mit threadId eines anderen Threads abgelehnt', async () => {
		const a = await verein();
		const leiter = await erwachsener(a.id);
		const t1 = await thread(a.id, leiter.id);
		const t2 = await thread(a.id, leiter.id);
		const m = await modul(a.id, t1.id, 'UMFRAGE');

		expect(
			await fehlercode(
				prisma.umfrageModul.create({
					data: { id: m.id, vereinId: a.id, threadId: t2.id, frage: 'Kommst du mit?', einheit: 'JUNGFISCHER' },
				}),
			),
		).toBe('P2003');
	});

	it('beantwortete Option laesst sich nicht loeschen', async () => {
		const a = await verein();
		const leiter = await erwachsener(a.id);
		const kind = await jungfischer(a.id);
		const u = await umfrage(a.id, (await thread(a.id, leiter.id)).id);
		const o = await option(a.id, u.id);
		const a1 = await antwort(a.id, u.id, kind.id, leiter.id);
		await prisma.umfrageAntwortOption.create({
			data: { vereinId: a.id, umfrageId: u.id, antwortId: a1.id, optionId: o.id },
		});

		expect(await fehlercode(prisma.umfrageOption.delete({ where: { id: o.id } }))).toBe('P2003');
		expect(await prisma.umfrageOption.count({ where: { id: o.id } })).toBe(1);
	});

	it('Termin: Ende vor Start, gleicher Tag 17:00-14:00 und 14:00-14:00, 24:00 abgelehnt', async () => {
		const a = await verein();
		const t = await thread(a.id, (await erwachsener(a.id)).id);
		const tag = new Date('2026-10-24');

		expect(await fehlertext(termin(a.id, t.id, { startDatum: tag, endDatum: new Date('2026-10-23') }))).toContain(
			'termin_reihenfolge',
		);
		expect(await fehlertext(termin(a.id, t.id, { startDatum: tag, beginn: '17:00', ende: '14:00' }))).toContain(
			'termin_eintaegig',
		);
		expect(await fehlertext(termin(a.id, t.id, { startDatum: tag, beginn: '14:00', ende: '14:00' }))).toContain(
			'termin_eintaegig',
		);
		expect(await fehlertext(termin(a.id, t.id, { startDatum: tag, beginn: '09:00', ende: '24:00' }))).toContain(
			'termin_uhrzeit',
		);
	});

	it('Modultitel bis 80 Zeichen, Ort und Treffpunkt bis 200 Zeichen', async () => {
		const a = await verein();
		const t = await thread(a.id, (await erwachsener(a.id)).id);
		const tag = new Date('2026-10-24');

		const gut = await prisma.threadModul.create({
			data: { vereinId: a.id, threadId: t.id, typ: 'INFO', position: 0, titel: 'x'.repeat(80) },
		});
		expect(gut.titel).toHaveLength(80);
		expect(
			await fehlertext(
				prisma.threadModul.create({
					data: { vereinId: a.id, threadId: t.id, typ: 'INFO', position: 1, titel: 'x'.repeat(81) },
				}),
			),
		).toContain('modul_titel');
		expect(
			await fehlertext(
				prisma.threadModul.create({
					data: { vereinId: a.id, threadId: t.id, typ: 'INFO', position: 2, titel: '' },
				}),
			),
		).toContain('modul_titel');

		await termin(a.id, t.id, { startDatum: tag, ort: 'o'.repeat(200), treffpunkt: 'p'.repeat(200) });
		expect(await fehlertext(termin(a.id, t.id, { startDatum: tag, ort: 'o'.repeat(201) }))).toContain('termin_ort');
		expect(await fehlertext(termin(a.id, t.id, { startDatum: tag, treffpunkt: 'p'.repeat(201) }))).toContain(
			'termin_treffpunkt',
		);
	});

	it('Termin: mehrtaegig 17:00-12:00 und Ende ohne Beginn erlaubt', async () => {
		const a = await verein();
		const t = await thread(a.id, (await erwachsener(a.id)).id);

		await termin(a.id, t.id, {
			startDatum: new Date('2026-10-23'),
			endDatum: new Date('2026-10-25'),
			beginn: '17:00',
			ende: '12:00',
		});
		await termin(a.id, t.id, { startDatum: new Date('2026-10-24'), ende: '12:00' });
	});

	it('Titel leer, mit Rand oder 121 Zeichen abgelehnt; normaler Thread ohne Ersteller abgelehnt', async () => {
		const a = await verein();
		const leiter = await erwachsener(a.id);

		for (const titel of ['', ' Sommerfest', 'Sommerfest ', 'x'.repeat(121)]) {
			expect(await fehlertext(thread(a.id, leiter.id, { titel }))).toContain('thread_titel');
		}
		await thread(a.id, leiter.id, { titel: 'x'.repeat(120) });
		expect(await fehlertext(thread(a.id, null))).toContain('thread_ersteller');
	});

	it('Verlauf: Nachricht ohne Autor, mit 2001 Zeichen, geloescht mit Text abgelehnt', async () => {
		const a = await verein();
		const leiter = await erwachsener(a.id);
		const t = await thread(a.id, leiter.id);
		const nachricht = { vereinId: a.id, threadId: t.id, art: 'NACHRICHT', stand: 1 } as const;

		expect(
			await fehlertext(prisma.verlaufEintrag.create({ data: { ...nachricht, autorId: null, text: 'Hallo' } })),
		).toContain('verlauf_nachricht');
		expect(
			await fehlertext(
				prisma.verlaufEintrag.create({ data: { ...nachricht, autorId: leiter.id, text: 'x'.repeat(2001) } }),
			),
		).toContain('verlauf_text');
		expect(
			await fehlertext(
				prisma.verlaufEintrag.create({
					data: { ...nachricht, autorId: leiter.id, text: 'Hallo', geloeschtAm: new Date(), geloeschtVonId: leiter.id },
				}),
			),
		).toContain('verlauf_nachricht');

		await prisma.verlaufEintrag.create({ data: { ...nachricht, autorId: leiter.id, text: 'x'.repeat(2000) } });
		await prisma.verlaufEintrag.create({
			data: { ...nachricht, autorId: leiter.id, text: null, geloeschtAm: new Date(), geloeschtVonId: leiter.id },
		});
	});

	it('beantwortete Umfrage laesst sich als Ganzes nicht loeschen, unbeantwortete schon', async () => {
		const a = await verein();
		const leiter = await erwachsener(a.id);
		const kind = await jungfischer(a.id);
		const t = await thread(a.id, leiter.id);
		const beantwortet = await umfrage(a.id, t.id);
		const o = await option(a.id, beantwortet.id);
		const a1 = await antwort(a.id, beantwortet.id, kind.id, leiter.id);
		await prisma.umfrageAntwortOption.create({
			data: { vereinId: a.id, umfrageId: beantwortet.id, antwortId: a1.id, optionId: o.id },
		});
		const unbeantwortet = await umfrage(a.id, t.id);
		await option(a.id, unbeantwortet.id);

		// Weder Umfrage noch Modul noch Thread: Die Antwort haelt ihre Umfrage fest (UmfrageAntwort.umfrage ist NoAction).
		expect(await fehlercode(prisma.umfrageModul.delete({ where: { id: beantwortet.id } }))).toBe('P2003');
		expect(await fehlercode(prisma.threadModul.delete({ where: { id: beantwortet.id } }))).toBe('P2003');
		expect(await fehlercode(prisma.thread.delete({ where: { id: t.id } }))).toBe('P2003');
		expect(await prisma.umfrageAntwortOption.count({ where: { antwortId: a1.id } })).toBe(1);

		await prisma.threadModul.delete({ where: { id: unbeantwortet.id } });
		expect(await prisma.umfrageOption.count({ where: { umfrageId: unbeantwortet.id } })).toBe(0);
	});

	it('Umfrage mit einer Antwort ohne Optionen laesst sich ebenfalls nicht loeschen', async () => {
		const a = await verein();
		const leiter = await erwachsener(a.id);
		const kind = await jungfischer(a.id);
		const t = await thread(a.id, leiter.id);
		const u = await umfrage(a.id, t.id);
		await option(a.id, u.id);
		// Keine Option gewaehlt (Antwort "offen"): Es gibt keinen Verweis ueber die Option,
		// die Antwort selbst muss den Schutz tragen.
		const a1 = await antwort(a.id, u.id, kind.id, leiter.id);

		expect(await fehlercode(prisma.umfrageModul.delete({ where: { id: u.id } }))).toBe('P2003');
		expect(await fehlercode(prisma.threadModul.delete({ where: { id: u.id } }))).toBe('P2003');
		expect(await fehlercode(prisma.thread.delete({ where: { id: t.id } }))).toBe('P2003');
		expect(await prisma.umfrageAntwort.count({ where: { id: a1.id } })).toBe(1);
	});

	it('Positionen, Fragetext, Optionen und Info-Text ausserhalb der Grenzen abgelehnt', async () => {
		const a = await verein();
		const t = await thread(a.id, (await erwachsener(a.id)).id);
		const u = await umfrage(a.id, t.id);
		const info = (text: string) =>
			modul(a.id, t.id).then((m) => prisma.infoModul.create({ data: { id: m.id, vereinId: a.id, text } }));
		const optionMit = (daten: Partial<Prisma.UmfrageOptionUncheckedCreateInput>) =>
			prisma.umfrageOption.create({
				data: { vereinId: a.id, umfrageId: u.id, text: 'Dabei', position: 0, schluessel: 'dabei', ...daten },
			});

		expect(
			await fehlertext(
				prisma.threadModul.create({ data: { vereinId: a.id, threadId: t.id, typ: 'INFO', position: -1 } }),
			),
		).toContain('modul_position');
		expect(await fehlertext(optionMit({ position: -1 }))).toContain('option_position');

		for (const frage of ['', '   ', 'x'.repeat(201)]) {
			expect(await fehlertext(umfrage(a.id, t.id, { frage }))).toContain('umfrage_frage');
		}
		// Die Laenge zaehlt nach dem Abzug des Rands.
		await umfrage(a.id, t.id, { frage: ` ${'x'.repeat(200)} ` });

		for (const schluessel of ['', 'Dabei', 'dabei!', 'a b', 'x'.repeat(41)]) {
			expect(await fehlertext(optionMit({ schluessel }))).toContain('option_schluessel');
		}
		for (const text of ['', '   ', 'x'.repeat(201)]) {
			expect(await fehlertext(optionMit({ text }))).toContain('option_text');
		}
		await optionMit({ schluessel: 'x'.repeat(40), text: 'x'.repeat(200) });

		expect(await fehlertext(info('x'.repeat(10001)))).toContain('info_text');
		await info('x'.repeat(10000));
	});

	it('Verlauf: Systemeintrag ohne Art oder mit Text, Loeschzeitpunkt ohne Person abgelehnt', async () => {
		const a = await verein();
		const leiter = await erwachsener(a.id);
		const t = await thread(a.id, leiter.id);
		const eintrag = { vereinId: a.id, threadId: t.id, stand: 1 } as const;

		expect(
			await fehlertext(prisma.verlaufEintrag.create({ data: { ...eintrag, art: 'SYSTEM', autorId: leiter.id } })),
		).toContain('verlauf_system');
		expect(
			await fehlertext(
				prisma.verlaufEintrag.create({
					data: { ...eintrag, art: 'SYSTEM', systemArt: 'VEROEFFENTLICHT', text: 'Hallo' },
				}),
			),
		).toContain('verlauf_system');
		expect(
			await fehlertext(
				prisma.verlaufEintrag.create({
					data: { ...eintrag, art: 'SYSTEM', systemArt: 'VEROEFFENTLICHT', geloeschtAm: new Date() },
				}),
			),
		).toContain('verlauf_geloescht');
		await prisma.verlaufEintrag.create({ data: { ...eintrag, art: 'SYSTEM', systemArt: 'VEROEFFENTLICHT' } });
	});

	it('Untergruppe loeschen nimmt die Auswahl mit, der Thread bleibt', async () => {
		const a = await verein();
		const t = await thread(a.id, (await erwachsener(a.id)).id, { alleUntergruppen: false });
		const gruppe = await prisma.untergruppe.create({ data: { vereinId: a.id, name: 'Hechte' } });
		await prisma.threadUntergruppe.create({ data: { vereinId: a.id, threadId: t.id, untergruppeId: gruppe.id } });

		await prisma.untergruppe.delete({ where: { id: gruppe.id } });

		expect(await prisma.threadUntergruppe.count({ where: { threadId: t.id } })).toBe(0);
		expect(await prisma.thread.count({ where: { id: t.id } })).toBe(1);
	});

	it('Verein loeschen mit Thread, Modulen, Antworten, Verlauf, Gelesen-Stand und Aenderung geht durch', async () => {
		const a = await verein('weg');
		const vereinId = a.id;
		const leiter = await erwachsener(vereinId);
		const kind = await jungfischer(vereinId);
		const gruppe = await prisma.untergruppe.create({ data: { vereinId, name: 'Hechte' } });
		const t = await thread(vereinId, leiter.id, { alleUntergruppen: false });
		await prisma.threadUntergruppe.create({ data: { vereinId, threadId: t.id, untergruppeId: gruppe.id } });
		const info = await modul(vereinId, t.id, 'INFO');
		await prisma.infoModul.create({ data: { id: info.id, vereinId, text: 'Bitte Angel mitbringen.' } });
		await termin(vereinId, t.id, { startDatum: new Date('2026-10-24'), beginn: '14:00', ende: '17:00' });
		const u = await umfrage(vereinId, t.id);
		const o = await option(vereinId, u.id);
		const antw = await antwort(vereinId, u.id, kind.id, leiter.id);
		await prisma.umfrageAntwortOption.create({
			data: { vereinId, umfrageId: u.id, antwortId: antw.id, optionId: o.id },
		});
		await prisma.verlaufEintrag.create({
			data: { vereinId, threadId: t.id, art: 'NACHRICHT', autorId: leiter.id, text: 'Hallo', stand: 1 },
		});
		await prisma.gelesenStand.create({
			data: {
				vereinId,
				personId: leiter.id,
				threadId: t.id,
				gelesenBis: 1,
				verlaufGelesenBis: 1,
				gelesenAm: new Date(),
			},
		});
		await prisma.aenderung.create({
			data: { vereinId, stand: 1, threadId: t.id, art: 'THREAD', objektId: t.id, urheberId: leiter.id },
		});

		await prisma.verein.delete({ where: { id: vereinId } });

		const uebrig = {
			thread: await prisma.thread.count({ where: { vereinId } }),
			threadUntergruppe: await prisma.threadUntergruppe.count({ where: { vereinId } }),
			threadModul: await prisma.threadModul.count({ where: { vereinId } }),
			infoModul: await prisma.infoModul.count({ where: { vereinId } }),
			terminModul: await prisma.terminModul.count({ where: { vereinId } }),
			umfrageModul: await prisma.umfrageModul.count({ where: { vereinId } }),
			umfrageOption: await prisma.umfrageOption.count({ where: { vereinId } }),
			umfrageAntwort: await prisma.umfrageAntwort.count({ where: { vereinId } }),
			umfrageAntwortOption: await prisma.umfrageAntwortOption.count({ where: { vereinId } }),
			verlaufEintrag: await prisma.verlaufEintrag.count({ where: { vereinId } }),
			gelesenStand: await prisma.gelesenStand.count({ where: { vereinId } }),
			aenderung: await prisma.aenderung.count({ where: { vereinId } }),
		};
		expect(uebrig).toEqual(Object.fromEntries(Object.keys(uebrig).map((k) => [k, 0])));
	});
});

describe('Dateien und Dokumente (TP4)', () => {
	async function vereinMitKategorien() {
		return prisma.verein.create({
			data: {
				slug: `dateien-${eindeutig()}`,
				name: 'Erfundener Fischereiverein 1900 e.V.',
				anzeigename: 'Jungfischer Test',
				farbe: '#1f6f8b',
				kategorien: { create: standardKategorien() },
			},
			include: { kategorien: { orderBy: { position: 'asc' } } },
		});
	}

	async function dokument(vereinId: string, kategorieId: string) {
		return prisma.dokument.create({
			data: { vereinId, kategorieId, titel: 'Gewaesserordnung', angelegtAm: new Date('2026-10-21T10:00:00Z') },
		});
	}

	/** Eine gueltige Dokument-Datei; `daten` ueberschreibt, auch die Verweise. */
	function datei(vereinId: string, vonId: string, daten: Partial<Prisma.DateiUncheckedCreateInput> = {}) {
		return prisma.datei.create({
			data: {
				vereinId,
				art: 'DATEI',
				name: 'ordnung.pdf',
				typ: 'application/pdf',
				groesse: 1234,
				sha256: 'a'.repeat(64),
				vonId,
				hochgeladenAm: new Date('2026-10-21T10:00:00Z'),
				...daten,
			},
		});
	}

	async function thread(vereinId: string, erstelltVonId: string) {
		return prisma.thread.create({
			data: { vereinId, erstelltVonId, titel: 'Sommerfest', modus: 'KOMMENTARE', rollenfilter: 'JUNGFISCHER_FAMILIE' },
		});
	}

	it('standardKategorien ergibt die drei Kategorien in dieser Reihenfolge', async () => {
		const v = await vereinMitKategorien();

		expect(v.kategorien.map((k) => [k.name, k.position])).toEqual([
			['Ordnungen', 0],
			['Merkblätter', 1],
			['Formulare', 2],
		]);
	});

	it('Datei mit Modul- und Dokumentverweis zugleich oder ohne Verweis scheitert (CHECK)', async () => {
		const v = await vereinMitKategorien();
		const p = await erwachsener(v.id);
		const t = await thread(v.id, p.id);
		const m = await prisma.threadModul.create({ data: { vereinId: v.id, threadId: t.id, typ: 'INFO', position: 0 } });
		const d = await dokument(v.id, v.kategorien[0].id);

		expect(await fehlertext(datei(v.id, p.id, { modulId: m.id, dokumentId: d.id }))).toContain('datei_ein_verweis');
		expect(await fehlertext(datei(v.id, p.id))).toContain('datei_ein_verweis');
		await datei(v.id, p.id, { dokumentId: d.id });
		await datei(v.id, p.id, { modulId: m.id });
	});

	it('zwei Dateien zum selben Dokument scheitern, zwei zum selben Modul nicht', async () => {
		const v = await vereinMitKategorien();
		const p = await erwachsener(v.id);
		const t = await thread(v.id, p.id);
		const m = await prisma.threadModul.create({ data: { vereinId: v.id, threadId: t.id, typ: 'INFO', position: 0 } });
		const d = await dokument(v.id, v.kategorien[0].id);
		await datei(v.id, p.id, { dokumentId: d.id });

		expect(await fehlercode(datei(v.id, p.id, { dokumentId: d.id }))).toBe('P2002');
		await datei(v.id, p.id, { modulId: m.id });
		await datei(v.id, p.id, { modulId: m.id });
	});

	it('Dateigroesse und Dateiname unterliegen den CHECKs', async () => {
		const v = await vereinMitKategorien();
		const p = await erwachsener(v.id);
		const d = await dokument(v.id, v.kategorien[0].id);
		const t = await thread(v.id, p.id);
		const m = await prisma.threadModul.create({ data: { vereinId: v.id, threadId: t.id, typ: 'INFO', position: 0 } });

		expect(await fehlertext(datei(v.id, p.id, { dokumentId: d.id, groesse: 0 }))).toContain('datei_groesse');
		expect(await fehlertext(datei(v.id, p.id, { dokumentId: d.id, groesse: 31457281 }))).toContain('datei_groesse');
		expect(await fehlertext(datei(v.id, p.id, { dokumentId: d.id, name: '' }))).toContain('datei_name');
		expect(await fehlertext(datei(v.id, p.id, { modulId: m.id, name: 'x'.repeat(121) }))).toContain('datei_name');
		// Ein Foto darf ohne Namen sein, eine Datei nicht.
		await datei(v.id, p.id, { modulId: m.id, art: 'FOTO', name: '' });
	});

	it('Datei mit Dokument oder Person eines fremden Vereins scheitert', async () => {
		const a = await vereinMitKategorien();
		const b = await vereinMitKategorien();
		const pa = await erwachsener(a.id);
		const pb = await erwachsener(b.id);
		const dokumentB = await dokument(b.id, b.kategorien[0].id);

		expect(await fehlercode(datei(a.id, pa.id, { dokumentId: dokumentB.id }))).toBe('P2003');
		const dokumentA = await dokument(a.id, a.kategorien[0].id);
		expect(await fehlercode(datei(a.id, pb.id, { dokumentId: dokumentA.id }))).toBe('P2003');
	});

	it('ein Dokument mit Datei laesst sich nicht loeschen, eine Kategorie mit Dokument auch nicht', async () => {
		const v = await vereinMitKategorien();
		const p = await erwachsener(v.id);
		const kategorie = v.kategorien[0];
		const d = await dokument(v.id, kategorie.id);
		await datei(v.id, p.id, { dokumentId: d.id });

		expect(await fehlercode(prisma.dokument.delete({ where: { id: d.id } }))).toBe('P2003');
		expect(await fehlercode(prisma.dokumentKategorie.delete({ where: { id: kategorie.id } }))).toBe('P2003');
		expect(await fehlercode(prisma.person.delete({ where: { id: p.id } }))).toBe('P2003');

		await prisma.datei.deleteMany({ where: { dokumentId: d.id } });
		await prisma.dokument.delete({ where: { id: d.id } });
		await prisma.dokumentKategorie.delete({ where: { id: kategorie.id } });
	});

	it('ein Thread mit Datei am Modul laesst sich nicht loeschen', async () => {
		const v = await vereinMitKategorien();
		const p = await erwachsener(v.id);
		const t = await thread(v.id, p.id);
		const m = await prisma.threadModul.create({ data: { vereinId: v.id, threadId: t.id, typ: 'INFO', position: 0 } });
		await datei(v.id, p.id, { modulId: m.id });

		expect(await fehlercode(prisma.thread.delete({ where: { id: t.id } }))).toBe('P2003');
	});

	it('ein Foto-Modul hat die Vorgabe JUGENDLEITER, und das Loeschen des Moduls nimmt die 1:1-Zeile mit', async () => {
		const v = await vereinMitKategorien();
		const p = await erwachsener(v.id);
		const t = await thread(v.id, p.id);
		const fotos = await prisma.threadModul.create({
			data: { vereinId: v.id, threadId: t.id, typ: 'FOTOS', position: 0 },
		});
		const dateien = await prisma.threadModul.create({
			data: { vereinId: v.id, threadId: t.id, typ: 'DATEIEN', position: 1 },
		});
		const fotosZeile = await prisma.fotosModul.create({ data: { id: fotos.id, vereinId: v.id } });
		await prisma.dateienModul.create({ data: { id: dateien.id, vereinId: v.id } });

		expect(fotosZeile.hochladen).toBe('JUGENDLEITER');
		await prisma.fotosModul.update({ where: { id: fotos.id }, data: { hochladen: 'ALLE' } });

		await prisma.threadModul.deleteMany({ where: { threadId: t.id } });
		expect(await prisma.fotosModul.count({ where: { vereinId: v.id } })).toBe(0);
		expect(await prisma.dateienModul.count({ where: { vereinId: v.id } })).toBe(0);
	});

	it('ein Thread mit Foto-Modul und Foto laesst sich nicht loeschen', async () => {
		const v = await vereinMitKategorien();
		const p = await erwachsener(v.id);
		const t = await thread(v.id, p.id);
		const m = await prisma.threadModul.create({ data: { vereinId: v.id, threadId: t.id, typ: 'FOTOS', position: 0 } });
		await prisma.fotosModul.create({ data: { id: m.id, vereinId: v.id } });
		await datei(v.id, p.id, { art: 'FOTO', name: '', typ: 'image/jpeg', modulId: m.id });

		// NoAction an der Datei gilt, obwohl die Kaskade das Foto-Modul vorher mitnimmt.
		expect(await fehlercode(prisma.thread.delete({ where: { id: t.id } }))).toBe('P2003');
		expect(await prisma.fotosModul.count({ where: { id: m.id } })).toBe(1);
	});

	it('ein Foto-Modul eines fremden Vereins oder ohne Kopfzeile ist nicht moeglich', async () => {
		const v = await vereinMitKategorien();
		const fremd = await vereinMitKategorien();
		const p = await erwachsener(v.id);
		const t = await thread(v.id, p.id);
		const m = await prisma.threadModul.create({ data: { vereinId: v.id, threadId: t.id, typ: 'FOTOS', position: 0 } });

		expect(await fehlercode(prisma.fotosModul.create({ data: { id: m.id, vereinId: fremd.id } }))).toBe('P2003');
		expect(await fehlercode(prisma.fotosModul.create({ data: { id: 'gibt-es-nicht', vereinId: v.id } }))).toBe('P2003');
	});

	it('Kategorienamen sind je Verein eindeutig, ohne Rand und hoechstens 40 Zeichen lang', async () => {
		const v = await vereinMitKategorien();
		const andere = await vereinMitKategorien();
		const neu = (name: string, position = 9) =>
			prisma.dokumentKategorie.create({ data: { vereinId: v.id, name, position } });

		expect(await fehlercode(neu('Ordnungen'))).toBe('P2002');
		expect(await fehlertext(neu('Formulare '))).toContain('kategorie_name');
		expect(await fehlertext(neu(''))).toContain('kategorie_name');
		expect(await fehlertext(neu('x'.repeat(41)))).toContain('kategorie_name');
		expect(await fehlertext(neu('Satzungen', -1))).toContain('kategorie_position');
		await neu('Satzungen');
		await prisma.dokumentKategorie.create({ data: { vereinId: andere.id, name: 'Satzungen', position: 9 } });
	});

	it('Dokumenttitel sind 1 bis 120 Zeichen ohne Rand', async () => {
		const v = await vereinMitKategorien();
		const neu = (titel: string) =>
			prisma.dokument.create({
				data: { vereinId: v.id, kategorieId: v.kategorien[0].id, titel, angelegtAm: new Date() },
			});

		expect(await fehlertext(neu(''))).toContain('dokument_titel');
		expect(await fehlertext(neu(' Ordnung'))).toContain('dokument_titel');
		expect(await fehlertext(neu('x'.repeat(121)))).toContain('dokument_titel');
		await neu('x'.repeat(120));
	});

	it('speicherGrenzeMb hat die Vorgabe 5120 und liegt zwischen 100 und 1048576', async () => {
		const v = await vereinMitKategorien();
		expect(v.speicherGrenzeMb).toBe(5120);

		const setze = (speicherGrenzeMb: number) =>
			prisma.verein.update({ where: { id: v.id }, data: { speicherGrenzeMb } });
		expect(await fehlertext(setze(99))).toContain('verein_speichergrenze');
		expect(await fehlertext(setze(1048577))).toContain('verein_speichergrenze');
		await setze(100);
		await setze(1048576);
	});

	it('DateiLoeschung traegt Verein und Schluessel ohne Fremdschluessel und ueberlebt den Verein', async () => {
		const v = await vereinMitKategorien();
		await prisma.dateiLoeschung.create({
			data: { schluessel: `schluessel-${eindeutig()}`, vereinId: v.id, geloeschtAm: new Date() },
		});

		await prisma.verein.delete({ where: { id: v.id } });

		expect(await prisma.dateiLoeschung.count({ where: { vereinId: v.id } })).toBe(1);
	});

	it('Loeschen des Vereins nimmt Kategorien, Dokumente und Dateien mit', async () => {
		const v = await vereinMitKategorien();
		const p = await erwachsener(v.id);
		const t = await thread(v.id, p.id);
		const m = await prisma.threadModul.create({ data: { vereinId: v.id, threadId: t.id, typ: 'INFO', position: 0 } });
		const d = await dokument(v.id, v.kategorien[0].id);
		await datei(v.id, p.id, { dokumentId: d.id });
		await datei(v.id, p.id, { modulId: m.id });

		await prisma.verein.delete({ where: { id: v.id } });

		const uebrig = {
			datei: await prisma.datei.count({ where: { vereinId: v.id } }),
			dokument: await prisma.dokument.count({ where: { vereinId: v.id } }),
			dokumentKategorie: await prisma.dokumentKategorie.count({ where: { vereinId: v.id } }),
		};
		expect(uebrig).toEqual({ datei: 0, dokument: 0, dokumentKategorie: 0 });
	});
});
