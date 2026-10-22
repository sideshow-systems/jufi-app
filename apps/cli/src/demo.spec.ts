import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
	baueUmfeld,
	brauchtMitfahrt,
	EINWILLIGUNG_TEXT_VERSION,
	gefragte,
	istArchiviert,
	kinderImThread,
	siehtThread,
	teilnahmeOptionen,
	threadSegment,
	type TerminDaten,
	type ThreadKopf,
} from '@jufi/domain';
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
			threads: await prisma.thread.count(),
			module: await prisma.threadModul.count(),
			helferPositionen: await prisma.helferPosition.count(),
			helferEintraege: await prisma.helferEintrag.count(),
			fahrten: await prisma.fahrtModul.count(),
			autos: await prisma.auto.count(),
			mitfahrten: await prisma.mitfahrt.count(),
			aenderungen: await prisma.aenderung.count(),
			aenderungsstand: (await prisma.verein.findUniqueOrThrow({ where: { slug: 'demo' } })).aenderungsstand,
		};
	}

	/** Kopf, Termine und Umfeld aus der Datenbank wie ladeThread und ladeThreadUmfeld der App (die liegen in apps/jufi). */
	async function laden(vereinId: string) {
		const [personen, zuordnungen, mitgliedschaften] = await Promise.all([
			prisma.person.findMany({ where: { vereinId, entferntAm: null } }),
			prisma.bezugsperson.findMany({ where: { vereinId } }),
			prisma.untergruppeMitglied.findMany({ where: { vereinId } }),
		]);
		const umfeld = baueUmfeld(personen, zuordnungen, mitgliedschaften);
		const zeilen = await prisma.thread.findMany({
			where: { vereinId },
			include: { untergruppen: true, module: { include: { termin: true } } },
		});
		const tag = (d: Date) => d.toISOString().slice(0, 10);
		const thread = (titel: string) => {
			const z = zeilen.find((t) => t.titel === titel)!;
			const kopf: ThreadKopf = {
				id: z.id,
				art: z.art,
				titel: z.titel,
				modus: z.modus,
				rollenfilter: z.rollenfilter,
				alleUntergruppen: z.alleUntergruppen,
				untergruppenIds: z.untergruppen.map((u) => u.untergruppeId),
				angepinnt: z.angepinnt,
				archivModus: z.archivModus,
				veroeffentlichtAm: z.veroeffentlichtAm,
				erstelltVonId: z.erstelltVonId,
			};
			const termine: TerminDaten[] = z.module.flatMap((m) =>
				m.termin
					? [
							{
								modulId: m.id,
								startDatum: tag(m.termin.startDatum),
								endDatum: m.termin.endDatum ? tag(m.termin.endDatum) : null,
								beginn: m.termin.beginn,
								ende: m.termin.ende,
								ort: m.termin.ort,
								treffpunkt: m.termin.treffpunkt,
							},
						]
					: [],
			);
			return { kopf, termine };
		};
		const person = (vorname: string) => [...umfeld.personen.values()].find((p) => p.vorname === vorname)!;
		return { umfeld, thread, person };
	}

	it('legt 11 Personen, 7 Familienzuordnungen, 2 Untergruppen und 2 Einwilligungen an', async () => {
		const ergebnis = await demoEinspielen(prisma, BEZUGSTAG);

		expect(ergebnis.personen).toBe(11);
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug: 'demo' } });
		expect(ergebnis.vereinId).toBe(verein.id);
		expect(verein).toMatchObject({
			name: 'Jungfischer Demo e.V.',
			anzeigename: 'Jungfischer Demo',
			farbe: '#0f766e',
		});
		expect(await prisma.person.count({ where: { vereinId: verein.id } })).toBe(11);
		expect(await prisma.bezugsperson.count({ where: { vereinId: verein.id } })).toBe(7);
		const gruppen = await prisma.untergruppe.findMany({
			where: { vereinId: verein.id },
			include: { mitglieder: { include: { person: true } } },
		});
		const mitglieder = Object.fromEntries(
			gruppen.map((g) => [g.name, g.mitglieder.map((m) => m.person.vorname).sort()]),
		);
		expect(mitglieder).toEqual({ Ältere: ['Jonas', 'Lena'], Jüngere: ['Max', 'Tim'] });
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
		// Der Text steht in den Vereinseinstellungen im Feld Kontakt und auf der Startseite bei Ansprechpartner; die Adresse liegt unter example.org (RFC 2606).
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

	it('der Demo-Verein hat fuenf Threads, darunter den Austausch', async () => {
		const { vereinId, threads } = await demoEinspielen(prisma, BEZUGSTAG);

		const zeilen = await prisma.thread.findMany({ where: { vereinId }, orderBy: { titel: 'asc' } });
		expect(zeilen.map((t) => t.titel).sort()).toEqual(
			['Jugendsprecher-Austausch', 'Wichtige Infos', 'Zeltlager 2027', '🎣 Fischerfest', '🎳 Bowling'].sort(),
		);
		const austausch = zeilen.filter((t) => t.art === 'JUGENDSPRECHER_AUSTAUSCH');
		expect(austausch).toHaveLength(1);
		expect(austausch[0]).toMatchObject({ veroeffentlichtAm: BEZUGSTAG, erstelltVonId: null });

		const thomas = await prisma.person.findFirstOrThrow({ where: { vereinId, vorname: 'Thomas' } });
		const infos = zeilen.find((t) => t.titel === 'Wichtige Infos')!;
		expect(infos).toMatchObject({
			art: 'NORMAL',
			modus: 'AUSHANG',
			angepinnt: true,
			veroeffentlichtAm: BEZUGSTAG,
			erstelltVonId: thomas.id,
		});
		const bowling = zeilen.find((t) => t.titel === '🎳 Bowling')!;
		expect(bowling).toMatchObject({
			modus: 'KOMMENTARE',
			rollenfilter: 'JUNGFISCHER_FAMILIE',
			alleUntergruppen: true,
			angepinnt: false,
			erstelltVonId: thomas.id,
		});
		const zeltlager = zeilen.find((t) => t.titel === 'Zeltlager 2027')!;
		const fischerfest = zeilen.find((t) => t.titel === '🎣 Fischerfest')!;

		// Die Rueckgabe traegt die Adressen der Threads in der Reihenfolge der Demo: Segment aus ID und Titel,
		// wie die App es bildet.
		expect(threads).toEqual([
			{ titel: 'Wichtige Infos', segment: threadSegment(infos.id, 'Wichtige Infos') },
			{ titel: '🎳 Bowling', segment: threadSegment(bowling.id, '🎳 Bowling') },
			{ titel: 'Zeltlager 2027', segment: threadSegment(zeltlager.id, 'Zeltlager 2027') },
			{ titel: '🎣 Fischerfest', segment: threadSegment(fischerfest.id, '🎣 Fischerfest') },
			{ titel: 'Jugendsprecher-Austausch', segment: threadSegment(austausch[0].id, 'Jugendsprecher-Austausch') },
		]);
	});

	it('Wichtige Infos haben Info-Text mit Liste und Link und den Termin am naechsten Freitag', async () => {
		const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

		const thread = await prisma.thread.findFirstOrThrow({ where: { vereinId, titel: 'Wichtige Infos' } });
		const module = await prisma.threadModul.findMany({
			where: { threadId: thread.id },
			orderBy: { position: 'asc' },
			include: { info: true, termin: true },
		});
		expect(module.map((m) => m.typ)).toEqual(['INFO', 'TERMIN']);
		expect(module[0].info!.text).toMatch(/^- /m);
		expect(module[0].info!.text).toMatch(/\]\(https:\/\//);
		// 12.10.2026 ist ein Montag; der naechste Freitag ist der 16.10.
		expect(module[1].termin).toMatchObject({
			startDatum: new Date('2026-10-16T00:00:00Z'),
			endDatum: null,
			beginn: '17:00',
			ende: '18:30',
			ort: 'Vereinsheim',
			treffpunkt: null,
		});
		expect(module[1].titel).toBe('Nächste Gruppenstunde');
	});

	it('Bowling hat Info-Text, Termin am uebernaechsten Samstag, eine Teilnahme-Umfrage, eine Helferliste und zuletzt eine Fahrgemeinschaft', async () => {
		const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

		const thread = await prisma.thread.findFirstOrThrow({ where: { vereinId, titel: '🎳 Bowling' } });
		const module = await prisma.threadModul.findMany({
			where: { threadId: thread.id },
			orderBy: { position: 'asc' },
			include: { info: true, termin: true, umfrage: { include: { optionen: { orderBy: { position: 'asc' } } } } },
		});
		expect(module.map((m) => m.typ)).toEqual(['INFO', 'TERMIN', 'UMFRAGE', 'HELFER', 'FAHRT']);
		// Der naechste Samstag ist der 17.10., der uebernaechste der 24.10.
		expect(module[1].termin).toMatchObject({
			startDatum: new Date('2026-10-24T00:00:00Z'),
			beginn: '14:00',
			ende: '17:00',
			ort: 'Bowlingcenter',
			treffpunkt: '13:30 am Vereinsheim',
		});
		const umfrage = module[2].umfrage!;
		expect(umfrage).toMatchObject({
			frage: 'Kommst du mit?',
			einheit: 'JUNGFISCHER',
			teilnahme: true,
			mehrfach: false,
			ergebnisse: 'ALLE',
		});
		expect(umfrage.optionen.map((o) => o.schluessel)).toEqual(
			teilnahmeOptionen(umfrage.vielleicht).map((o) => o.schluessel),
		);
		// Nur Lena und Max haben zugesagt, die Fahrgemeinschaft braucht sie; Tim und Jonas sind noch offen.
		const antworten = await prisma.umfrageAntwort.findMany({
			where: { umfrageId: umfrage.id },
			include: { fuer: true, von: true, optionen: { include: { option: true } } },
		});
		expect(
			antworten.map((a) => [a.fuer.vorname, a.von.vorname, a.optionen.map((o) => o.option.schluessel)]).sort(),
		).toEqual([
			['Lena', 'Lena', ['dabei']],
			// Max hat keine Einwilligung und also keinen Zugang; fuer ihn sagt die Mutter zu.
			['Max', 'Sandra', ['dabei']],
		]);
	});

	it('die Fahrgemeinschaft von Bowling: Sandra faehrt hin mit Lena, Max braucht noch eine Mitfahrt', async () => {
		const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

		const bowling = await prisma.thread.findFirstOrThrow({ where: { vereinId, titel: '🎳 Bowling' } });
		const modul = await prisma.threadModul.findFirstOrThrow({
			where: { threadId: bowling.id, typ: 'FAHRT' },
			include: {
				fahrt: {
					include: {
						autos: { include: { fahrer: true } },
						mitfahrten: { include: { kind: true, von: true } },
					},
				},
			},
		});
		// Nach der Helferliste, ohne eigene Ueberschrift: Die Seite zeigt dann "Fahrgemeinschaft".
		expect(modul).toMatchObject({ position: 4, titel: null });
		const fahrt = modul.fahrt!;
		expect(fahrt).toMatchObject({ hin: true, rueck: true });

		expect(fahrt.autos).toHaveLength(1);
		const [auto] = fahrt.autos;
		// Der Abfahrtstag ist der Tag des Termins (Samstag, 24.10.2026), wie ihn das Formular vorbelegt.
		expect(auto).toMatchObject({
			richtung: 'HIN',
			plaetze: 3,
			abfahrtTag: new Date('2026-10-24T00:00:00Z'),
			abfahrtZeit: '13:00',
			ort: 'Vereinsheim',
			notiz: null,
			angelegtAm: BEZUGSTAG,
			fahrer: { vorname: 'Sandra' },
		});
		expect(fahrt.mitfahrten.map((m) => [m.richtung, m.kind.vorname, m.von.vorname, m.autoId === auto.id])).toEqual([
			['HIN', 'Lena', 'Sandra', true],
		]);

		// "Braucht noch Mitfahrt" so, wie die App sie bildet: die zugesagten Kinder ohne Eintrag. Hin ist es Max,
		// zurueck sind es beide; Tim und Jonas haben nicht zugesagt und stehen dort nicht.
		const { umfeld, thread } = await laden(vereinId);
		const dabei = new Set(
			(
				await prisma.umfrageAntwort.findMany({
					where: {
						umfrage: { threadId: bowling.id, teilnahme: true },
						optionen: { some: { option: { schluessel: 'dabei' } } },
					},
				})
			).map((a) => a.fuerId),
		);
		const betrachtete = kinderImThread(thread('🎳 Bowling').kopf, umfeld).filter((k) => dabei.has(k.id));
		const daten = { modulId: modul.id, titel: null, hin: true, rueck: true, autos: [], mitfahrten: fahrt.mitfahrten };
		expect(brauchtMitfahrt(daten, 'HIN', betrachtete).map((k) => k.vorname)).toEqual(['Max']);
		expect(brauchtMitfahrt(daten, 'RUECK', betrachtete).map((k) => k.vorname)).toEqual(['Lena', 'Max']);
	});

	it('die Frist der Bowling-Umfrage ist Donnerstag 18:00 Berliner Zeit vor dem Termin und nach dem Bezugstag', async () => {
		const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

		const umfrage = await prisma.umfrageModul.findFirstOrThrow({ where: { vereinId, teilnahme: true } });
		const termin = await prisma.terminModul.findFirstOrThrow({ where: { modul: { threadId: umfrage.threadId } } });
		expect(umfrage.frist).not.toBeNull();
		expect(umfrage.frist!.getTime()).toBeGreaterThan(BEZUGSTAG.getTime());
		expect(umfrage.frist!.getTime()).toBeLessThan(termin.startDatum.getTime());
		// Donnerstag, 22.10.2026, noch Sommerzeit: 18:00 Berlin sind 16:00 UTC.
		expect(umfrage.frist).toEqual(new Date('2026-10-22T16:00:00Z'));
	});

	it('die Helferliste von Bowling fragt Erwachsene nach Fahrern und Snacks, Sandra bringt Gemuesesticks', async () => {
		const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

		const bowling = await prisma.thread.findFirstOrThrow({ where: { vereinId, titel: '🎳 Bowling' } });
		const modul = await prisma.threadModul.findFirstOrThrow({
			where: { threadId: bowling.id, typ: 'HELFER' },
			include: {
				helfer: {
					include: {
						positionen: {
							orderBy: { position: 'asc' },
							include: { eintraege: { include: { fuer: true, von: true } } },
						},
					},
				},
			},
		});
		// Das letzte Modul: Mitbringen kommt nach Termin und Zusage, wie ein Ersteller es anordnete.
		expect(modul).toMatchObject({ position: 3, titel: 'Mitbringen und fahren' });
		const helfer = modul.helfer!;
		expect(helfer.einheit).toBe('ERWACHSENER');
		// Fuenf Berliner Tage nach dem Bezugstag, 18:00 wie die Vorgabe des Editors: Samstag, 17.10.2026,
		// noch Sommerzeit, also 16:00 UTC; damit vor dem Termin am 24.10.
		expect(helfer.frist).toEqual(new Date('2026-10-17T16:00:00Z'));
		expect(helfer.positionen.map((p) => [p.text, p.anzahl])).toEqual([
			['Fahrer', 2],
			['Snacks', 3],
		]);
		// Schluessel wie der Server sie im Editor vergibt (neuerSchluessel in apps/jufi).
		for (const p of helfer.positionen) expect(p.schluessel).toMatch(/^o[a-z0-9]{8}$/);
		expect(new Set(helfer.positionen.map((p) => p.schluessel)).size).toBe(2);

		const [fahrer, snacks] = helfer.positionen;
		expect(fahrer.eintraege).toEqual([]);
		expect(snacks.eintraege).toHaveLength(1);
		expect(snacks.eintraege[0]).toMatchObject({
			notiz: 'Gemüsesticks',
			eingetragenAm: BEZUGSTAG,
			fuer: { vorname: 'Sandra' },
			von: { vorname: 'Sandra' },
		});

		// Der Eintrag ist einer, den die App auch annaehme: Sandra ist als Mutter von Lena und Max gefragt.
		const { umfeld, thread, person } = await laden(vereinId);
		const ids = gefragte(helfer, thread('🎳 Bowling').kopf, umfeld).map((p) => p.id);
		expect(ids).toContain(person('Sandra').id);
		expect(ids).not.toContain(person('Lena').id);
	});

	it('Termine und Frist rechnen mit der Berliner Wandzeit, auch ueber die Zeitumstellung', async () => {
		// Montag 26.10.2026, einen Tag nach der Umstellung auf Winterzeit: der naechste Freitag ist der 30.10., der
		// uebernaechste Samstag der 7.11. und die Frist Donnerstag 5.11., 18:00 Berlin = 17:00 UTC.
		const { vereinId } = await demoEinspielen(prisma, new Date('2026-10-26T12:00:00Z'));

		const umfrage = await prisma.umfrageModul.findFirstOrThrow({ where: { vereinId, teilnahme: true } });
		expect(umfrage.frist).toEqual(new Date('2026-11-05T17:00:00Z'));
		// Die Helferliste fuenf Tage spaeter: Samstag 31.10., schon Winterzeit, 18:00 Berlin = 17:00 UTC.
		const helfer = await prisma.helferModul.findFirstOrThrow({ where: { vereinId } });
		expect(helfer.frist).toEqual(new Date('2026-10-31T17:00:00Z'));
		// Nur die Threads, die dem Bezugstag folgen; Zeltlager und Fischerfest haben ihre eigenen Termine.
		const termine = await prisma.terminModul.findMany({
			where: { vereinId, modul: { thread: { titel: { in: ['Wichtige Infos', '🎳 Bowling'] } } } },
			orderBy: { startDatum: 'asc' },
		});
		expect(termine.map((t) => t.startDatum.toISOString().slice(0, 10))).toEqual(['2026-10-30', '2026-11-07']);
	});

	it('der Austausch hat eine Nachricht von Jonas und eine von Thomas mit aufsteigenden Staenden', async () => {
		const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

		const austausch = await prisma.thread.findFirstOrThrow({ where: { vereinId, art: 'JUGENDSPRECHER_AUSTAUSCH' } });
		const verlauf = await prisma.verlaufEintrag.findMany({
			where: { threadId: austausch.id },
			include: { autor: true },
			orderBy: { stand: 'asc' },
		});
		expect(verlauf.map((e) => [e.art, e.autor!.vorname])).toEqual([
			['NACHRICHT', 'Jonas'],
			['NACHRICHT', 'Thomas'],
		]);
		expect(verlauf[0].stand).toBeLessThan(verlauf[1].stand);
		expect(verlauf.every((e) => e.text !== null && e.geloeschtAm === null)).toBe(true);
		expect(austausch.letzteAktivitaetStand).toBe(verlauf[1].stand);
		expect(austausch.letzteAktivitaetAm).toEqual(BEZUGSTAG);
	});

	it('der Vereinsstand ist der groesste Stand, und jeder Stand gehoert zu genau einem Thread', async () => {
		const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

		const verein = await prisma.verein.findUniqueOrThrow({ where: { id: vereinId } });
		const aenderungen = await prisma.aenderung.findMany({ where: { vereinId }, orderBy: { stand: 'asc' } });
		expect(verein.aenderungsstand).toBe(Math.max(...aenderungen.map((a) => a.stand)));
		// Lueckenlos, wie mitAenderung sie vergibt: jede Zahl von 1 bis zum Vereinsstand kommt vor.
		const staende = [...new Set(aenderungen.map((a) => a.stand))];
		expect(staende).toEqual(Array.from({ length: verein.aenderungsstand }, (_, i) => i + 1));
		// Ein Stand ist eine Transaktion, und die betrifft einen Thread (wie bei den Schreibrouten).
		for (const stand of staende) {
			const threadIds = new Set(aenderungen.filter((a) => a.stand === stand).map((a) => a.threadId));
			expect(threadIds.size).toBe(1);
			expect(threadIds.has(null)).toBe(false);
		}

		const threads = await prisma.thread.findMany({ where: { vereinId } });
		const eintraege = await prisma.verlaufEintrag.findMany({ where: { vereinId } });
		const antworten = await prisma.umfrageAntwort.findMany({ where: { vereinId } });
		const module = await prisma.threadModul.findMany({ where: { vereinId } });
		const helferListen = await prisma.helferModul.findMany({ where: { vereinId } });
		const fahrten = await prisma.fahrtModul.findMany({ where: { vereinId } });
		// Helfer-Eintrag, Auto und Mitfahrt schreiben ANTWORT mit dem Modul als Objekt (TP4-Spec 8), die Umfrage
		// ihre Antwortzeile.
		const objekte = {
			THREAD: threads,
			MODUL: module,
			ANTWORT: [...antworten, ...helferListen, ...fahrten],
			VERLAUF: eintraege,
		} as Record<string, { id: string }[] | undefined>;
		for (const a of aenderungen) {
			expect(objekte[a.art]?.map((o) => o.id)).toContain(a.objektId);
			if (a.art === 'VERLAUF') {
				expect(eintraege.find((e) => e.id === a.objektId)!.stand).toBe(a.stand);
			}
		}
		// letzteAktivitaetStand zeigt auf den letzten Stand des Threads.
		for (const t of threads) {
			const eigene = aenderungen.filter((a) => a.threadId === t.id).map((a) => a.stand);
			expect(t.letzteAktivitaetStand).toBe(Math.max(...eigene));
			expect(t.letzteAktivitaetAm).toEqual(BEZUGSTAG);
		}
		expect(aenderungen.every((a) => a.angelegtAm.getTime() === BEZUGSTAG.getTime())).toBe(true);
	});

	it('jeder Thread hat eine THREAD-Aenderung und je Modul eine MODUL-Aenderung, der Austausch ohne Urheber', async () => {
		const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

		const threads = await prisma.thread.findMany({
			where: { vereinId },
			include: { module: { select: { id: true } } },
		});
		const aenderungen = await prisma.aenderung.findMany({ where: { vereinId } });
		for (const t of threads) {
			const eigene = aenderungen.filter((a) => a.threadId === t.id);
			const threadAenderungen = eigene.filter((a) => a.art === 'THREAD');
			expect(threadAenderungen.map((a) => a.objektId)).toEqual([t.id]);
			expect(
				eigene
					.filter((a) => a.art === 'MODUL')
					.map((a) => a.objektId)
					.sort(),
			).toEqual(t.module.map((m) => m.id).sort());
			// Thread und Module teilen sich den Stand des Anlegens, wie in der Route.
			for (const a of eigene.filter((a) => a.art === 'MODUL')) expect(a.stand).toBe(threadAenderungen[0].stand);
			if (t.art === 'JUGENDSPRECHER_AUSTAUSCH') {
				expect(t.module).toHaveLength(0);
				expect(threadAenderungen[0].urheberId).toBeNull();
			} else {
				expect(threadAenderungen[0].urheberId).toBe(t.erstelltVonId);
			}
		}
		expect(threads.reduce((summe, t) => summe + t.module.length, 0)).toBe(12);
		// Antworten, Helfer-Eintraege, Autos, Mitfahrten und Nachrichten haben eigene Staende. Objekt ist bei der
		// Antwort die Antwortzeile (schreibeAntwort), bei Helfer-Eintrag, Auto und Mitfahrt das Modul (TP4-Spec 8).
		const antworten = await prisma.umfrageAntwort.findMany({ where: { vereinId } });
		const helferEintraege = await prisma.helferEintrag.findMany({ where: { vereinId }, include: { position: true } });
		expect(helferEintraege).toHaveLength(1);
		const autos = await prisma.auto.findMany({ where: { vereinId } });
		const mitfahrten = await prisma.mitfahrt.findMany({ where: { vereinId } });
		expect(autos).toHaveLength(1);
		expect(mitfahrten).toHaveLength(1);
		const antwortAenderungen = aenderungen.filter((a) => a.art === 'ANTWORT');
		const paar = (objektId: string, urheberId: string | null) => `${objektId}/${urheberId}`;
		expect(antwortAenderungen.map((a) => paar(a.objektId, a.urheberId)).sort()).toEqual(
			[
				...antworten.map((a) => paar(a.id, a.vonId)),
				...helferEintraege.map((e) => paar(e.position.modulId, e.vonId)),
				...autos.map((a) => paar(a.modulId, a.fahrerId)),
				...mitfahrten.map((m) => paar(m.modulId, m.vonId)),
			].sort(),
		);
		expect(aenderungen.filter((a) => a.art === 'VERLAUF')).toHaveLength(4);
	});

	it('Tim ist 11, ohne Familie und ohne Einwilligung, und gehoert zu den Juengeren', async () => {
		const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

		const tim = await prisma.person.findFirstOrThrow({
			where: { vereinId, vorname: 'Tim' },
			include: { untergruppen: { include: { untergruppe: true } } },
		});
		expect(tim).toMatchObject({ art: 'JUNGFISCHER', nachname: 'Schmid', jugendsprecher: false });
		expect(alterAn(tim.geburtsdatum as Date, BEZUGSTAG)).toBe(11);
		expect(tim.untergruppen.map((m) => m.untergruppe.name)).toEqual(['Jüngere']);
		expect(await prisma.bezugsperson.count({ where: { jungfischerId: tim.id } })).toBe(0);
		expect(await prisma.einwilligung.count({ where: { jungfischerId: tim.id } })).toBe(0);
	});

	describe('Zeltlager und Fischerfest', () => {
		it('das Zeltlager traegt das Jahr nach dem Bezugstag in Titel und Termin', async () => {
			const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

			const zeltlager = await prisma.thread.findFirstOrThrow({
				where: { vereinId, titel: { startsWith: 'Zeltlager' } },
				include: { module: { orderBy: { position: 'asc' }, include: { info: true, termin: true } } },
			});
			expect(zeltlager.titel).toBe('Zeltlager 2027');
			expect(zeltlager).toMatchObject({ modus: 'CHAT', rollenfilter: 'JUNGFISCHER_FAMILIE', alleUntergruppen: false });
			const termin = zeltlager.module.find((m) => m.typ === 'TERMIN')!.termin!;
			expect(termin).toMatchObject({
				startDatum: new Date('2027-08-02T00:00:00Z'),
				endDatum: new Date('2027-08-08T00:00:00Z'),
				ort: 'Zeltplatz am See',
			});
			expect(zeltlager.module.find((m) => m.typ === 'INFO')!.info!.text).not.toBe('');
		});

		it('das Jahr des Zeltlagers ist das Berliner Jahr: Silvester 23:30 UTC ist schon Neujahr', async () => {
			const { vereinId } = await demoEinspielen(prisma, new Date('2026-12-31T23:30:00Z'));

			const zeltlager = await prisma.thread.findFirstOrThrow({
				where: { vereinId, titel: { startsWith: 'Zeltlager' } },
			});
			expect(zeltlager.titel).toBe('Zeltlager 2028');
		});

		it('die Pizza-Umfrage hat drei Optionen mit Schluesseln wie der Editor sie vergibt, und zwei Antworten', async () => {
			const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

			const umfrage = await prisma.umfrageModul.findFirstOrThrow({
				where: { vereinId, frage: 'Welche Pizza am Ankunftsabend?' },
				include: {
					optionen: { orderBy: { position: 'asc' } },
					antworten: { include: { optionen: { include: { option: true } }, fuer: true, von: true } },
				},
			});
			expect(umfrage).toMatchObject({
				einheit: 'PERSON',
				teilnahme: false,
				mehrfach: false,
				ergebnisse: 'ALLE',
				frist: null,
			});
			expect(umfrage.optionen.map((o) => o.text)).toEqual(['Margherita', 'Salami', 'Funghi']);
			// "o" und acht Zeichen aus a-z0-9, nie ein fester Schluessel der Teilnahme.
			for (const o of umfrage.optionen) expect(o.schluessel).toMatch(/^o[a-z0-9]{8}$/);
			expect(new Set(umfrage.optionen.map((o) => o.schluessel)).size).toBe(3);

			const antworten = umfrage.antworten
				.map((a) => [a.fuer.vorname, a.von.vorname, a.optionen.map((o) => o.option.text)])
				.sort();
			expect(antworten).toEqual([
				['Lena', 'Lena', ['Salami']],
				['Thomas', 'Thomas', ['Margherita']],
			]);
		});

		it('das Zeltlager hat zwei Nachrichten, von Lena und von Thomas', async () => {
			const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

			const zeltlager = await prisma.thread.findFirstOrThrow({
				where: { vereinId, titel: { startsWith: 'Zeltlager' } },
			});
			const verlauf = await prisma.verlaufEintrag.findMany({
				where: { threadId: zeltlager.id },
				include: { autor: true },
				orderBy: { stand: 'asc' },
			});
			expect(verlauf.map((e) => [e.art, e.autor!.vorname])).toEqual([
				['NACHRICHT', 'Lena'],
				['NACHRICHT', 'Thomas'],
			]);
			expect(verlauf.every((e) => e.text !== null && e.geloeschtAm === null)).toBe(true);
		});

		it('das Fischerfest ist ein Kommentar-Thread mit Termin vor 14 Tagen und automatischem Archiv', async () => {
			const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

			const fest = await prisma.thread.findFirstOrThrow({
				where: { vereinId, titel: '🎣 Fischerfest' },
				include: { module: { orderBy: { position: 'asc' }, include: { info: true, termin: true } } },
			});
			expect(fest).toMatchObject({
				modus: 'KOMMENTARE',
				rollenfilter: 'JUNGFISCHER_FAMILIE',
				archivModus: 'AUTOMATISCH',
				angepinnt: false,
			});
			// 12.10.2026 minus 14 Tage.
			expect(fest.module.find((m) => m.typ === 'TERMIN')!.termin).toMatchObject({
				startDatum: new Date('2026-09-28T00:00:00Z'),
				endDatum: null,
				beginn: '10:00',
				ende: '16:00',
				ort: 'Vereinsweiher',
			});
			expect(fest.module.find((m) => m.typ === 'INFO')!.info!.text).not.toBe('');
		});

		it('das Zeltlager sieht nur, wer zu den Aelteren gehoert: Lena ja, Max nein', async () => {
			const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

			const { umfeld, thread, person } = await laden(vereinId);
			const { kopf } = thread('Zeltlager 2027');
			expect(siehtThread(person('Lena'), kopf, umfeld)).toBe(true);
			expect(siehtThread(person('Max'), kopf, umfeld)).toBe(false);
			// Tim ist bei den Juengeren und sieht es ebenso wenig; seine Familie gibt es nicht.
			expect(siehtThread(person('Tim'), kopf, umfeld)).toBe(false);
			// Die Mutter von Lena und Max sieht es ueber Lena.
			expect(siehtThread(person('Sandra'), kopf, umfeld)).toBe(true);
		});

		it('das Fischerfest ist archiviert, Bowling nicht', async () => {
			const { vereinId } = await demoEinspielen(prisma, BEZUGSTAG);

			const { thread } = await laden(vereinId);
			const fest = thread('🎣 Fischerfest');
			const bowling = thread('🎳 Bowling');
			expect(istArchiviert(fest.kopf, fest.termine, BEZUGSTAG)).toBe(true);
			expect(istArchiviert(bowling.kopf, bowling.termine, BEZUGSTAG)).toBe(false);
		});
	});

	it('zweimal einspielen ergibt denselben Stand', async () => {
		await demoEinspielen(prisma, BEZUGSTAG);
		const erster = await zaehlung();
		await demoEinspielen(prisma, BEZUGSTAG);

		expect(await zaehlung()).toEqual(erster);
		expect(erster.vereine).toBe(1);
		expect(erster.personen).toBe(11);
		expect(erster.threads).toBe(5);
		expect(erster.aenderungsstand).toBe(16);
		// 5 Threads, 12 Module, 4 Antworten, 1 Helfer-Eintrag, 1 Auto, 1 Mitfahrt und 4 Nachrichten.
		expect(erster.aenderungen).toBe(28);
		expect(erster.module).toBe(12);
		expect(erster.helferPositionen).toBe(2);
		expect(erster.helferEintraege).toBe(1);
		expect(erster.fahrten).toBe(1);
		expect(erster.autos).toBe(1);
		expect(erster.mitfahrten).toBe(1);
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
		expect(alter).toEqual({ Lena: 14, Max: 12, Jonas: 17, Tim: 11 });
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

			expect(ergebnis.personen).toBe(11);
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
