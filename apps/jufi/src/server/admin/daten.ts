import {
	Recht,
	sperreVereinszeile,
	type AdminAktion,
	type Prisma,
	type PrismaClient,
	type VereinStatus,
} from '@jufi/db';
import { erzeugeEinladung, erzeugeEinladungMitId } from '../einladung.js';
import { legeMailAn } from '../mail/warteschlange.js';

/**
 * Die einzige Stelle, an der der Admin Vereinstabellen liest (Spec 7.4): Zahlen
 * und Ansprechpartner, nie Kinder, Familien oder Personenlisten. Die Routen in
 * vereine.ts bekommen nur diese Funktionen, nicht den PrismaClient -- so steht
 * jede Abfrage, die der Admin an Vereinsdaten stellt, in dieser einen Datei.
 *
 * Mit dem schlichten PrismaClient statt vereinDb: Der Admin arbeitet ueber alle
 * Vereine hinweg, eine Plattform-Operation (CLAUDE.md). Die Grenze zieht hier
 * jedes select, das nur Zahlen und die Felder der Ansprechpartner nennt.
 */

export interface Kennzahlen {
	jungfischer: number;
	erwachsene: number;
	zugaenge: number;
	offeneEinladungen: number;
	/** JJJJ-MM-TT in Europe/Berlin, nur das Datum (Spec 7.3). */
	letzteAnmeldung: string | null;
}

export interface VereinZeile {
	id: string;
	slug: string;
	anzeigename: string;
	status: VereinStatus;
	kennzahlen: Kennzahlen;
}

export interface Ansprechpartner {
	personId: string;
	vorname: string;
	nachname: string;
	email: string | null;
}

export interface VereinDetails {
	id: string;
	slug: string;
	name: string;
	anzeigename: string;
	farbe: string;
	status: VereinStatus;
	angelegtAm: string;
	kennzahlen: Kennzahlen;
	ansprechpartner: Ansprechpartner[];
	ersteLeitung: { personId: string; vorname: string; nachname: string } | null;
	slugAenderbar: boolean;
	protokoll: { zeitpunkt: string; aktion: AdminAktion; admin: string }[];
}

/** Geprueft und normalisiert (vereine.ts); hier wird nur noch gespeichert. */
export interface NeuerVerein {
	name: string;
	anzeigename: string;
	slug: string;
	farbe: string;
	leitung: { vorname: string; nachname: string; email: string };
}

/** Wie viele Eintraege die Vereinsseite zeigt; aeltere bleiben in der Tabelle. */
const PROTOKOLL_ANZAHL = 20;

const ALLE_RECHTE = Object.values(Recht);

/**
 * formatToParts statt format mit einer Sprache, die zufaellig JJJJ-MM-TT schreibt
 * (en-CA, sv-SE): Das Muster haengt an den ICU-Daten der Node-Fassung, die Teile
 * nicht.
 */
const BERLINER_DATUM = new Intl.DateTimeFormat('en', {
	timeZone: 'Europe/Berlin',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

function berlinerDatum(zeitpunkt: Date): string {
	const teile = Object.fromEntries(BERLINER_DATUM.formatToParts(zeitpunkt).map((t) => [t.type, t.value]));
	return `${teile['year']}-${teile['month']}-${teile['day']}`;
}

/** Sortierung der Liste nach deutschem Alphabet, unabhaengig von der Kollation der Datenbank. */
const ALPHABET = new Intl.Collator('de');

/**
 * Prisma P2002 auf dem eindeutigen Index des Slugs. Mit dem Treiberadapter
 * (Prisma 7, adapter-pg) steht der Index unter meta.driverAdapterError.cause.constraint,
 * nicht mehr unter meta.target. Nur dieser Index zaehlt: Ein anderer
 * Eindeutigkeitsfehler waere ein Programmfehler und soll als 500 auffallen,
 * statt als "Slug vergeben" verkleidet zu werden.
 */
function istSlugVergeben(error: unknown): boolean {
	const e = error as {
		code?: unknown;
		meta?: { driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } } };
	} | null;
	if (e?.code !== 'P2002') return false;
	const constraint = e.meta?.driverAdapterError?.cause?.constraint;
	return (
		constraint?.index === 'Verein_slug_key' || (Array.isArray(constraint?.fields) && constraint.fields.includes('slug'))
	);
}

/** Was eine erneuerte Einladung der Route mitgibt, damit sie Link und Text bauen kann. */
export interface NeueEinladung {
	token: string;
	vorname: string;
	anzeigename: string;
	slug: string;
}

/**
 * Baut Betreff und Text der Mail zu einer neuen Einladung. Kommt von der Route,
 * weil dort Link-Basis und Art des Textes (Einladung oder Notfall) bekannt sind;
 * hier wird nur eingereiht. Fehlt er, geht keine Mail (Link zum Kopieren).
 */
export type EinladungsMailBauer = (e: NeueEinladung) => { betreff: string; text: string };

/**
 * Reiht die Mail in derselben Transaktion ein wie die Einladung: Eine Einladung,
 * deren Mail verloren ging, oder eine Mail mit einem Link, den es nicht gibt,
 * waere ein Fehler, den niemand bemerkt. Mit vereinId, weil der Admin den
 * schlichten Client hat; bezug fuer den Hinweis "nicht zustellbar" (Spec 5.3).
 */
async function reiheMailEin(
	tx: Prisma.TransactionClient,
	e: {
		vereinId: string;
		empfaenger: string;
		einladungId: string;
		mail: { betreff: string; text: string };
		jetzt: Date;
	},
): Promise<void> {
	await legeMailAn(tx, {
		vereinId: e.vereinId,
		empfaenger: e.empfaenger,
		betreff: e.mail.betreff,
		text: e.mail.text,
		bezug: `einladung:${e.einladungId}`,
		jetzt: e.jetzt,
	});
}

/**
 * Die Person der ersten Leitung: wen der Admin zuletzt eingeladen hat
 * (erstelltVonPersonId null = vom Admin). Verworfen: ein eigenes Feld am Verein
 * -- es liefe auseinander, sobald die Einladung erneuert wird.
 *
 * Auch ein Notfall-Link ist eine Admin-Einladung. Vor der Annahme ist das egal:
 * Dann ist die erste Leitung der einzige Ansprechpartner, ein Notfall-Link
 * trifft also dieselbe Person. Danach fragt niemand mehr nach der ersten Leitung.
 */
function ersteLeitung(db: Prisma.TransactionClient, vereinId: string) {
	return db.einladung.findFirst({
		where: { vereinId, art: 'EINLADUNG', erstelltVonPersonId: null },
		orderBy: [{ angelegtAm: 'desc' }, { id: 'desc' }],
		select: { person: { select: { id: true, vorname: true, nachname: true, email: true } } },
	});
}

/**
 * Der erste Zugang entsteht erst beim Einloesen einer Einladung. Solange es
 * keinen gibt, ist die erste Einladung nicht angenommen: Der Slug steckt noch in
 * keinem Link, Cookie oder installierter App (Spec 7.3).
 *
 * Die Aufrufer in Transaktionen sperren vorher die Vereinszeile
 * (sperreVereinszeile): Das Einloesen sperrt sie ebenfalls, ein gleichzeitiges
 * Einloesen und eine Slug-Korrektur oder Erneuerung laufen so nacheinander und
 * die spaetere sieht den Zugang. Ohne Sperre sahe sie noch den alten Stand.
 */
async function istAngenommen(db: Prisma.TransactionClient, vereinId: string): Promise<boolean> {
	return (await db.zugang.findFirst({ where: { vereinId }, select: { id: true } })) !== null;
}

/**
 * Sperrt die Vereinszeile; false, wenn es den Verein nicht gibt. Der Zaehler-
 * Update wirft P2025 fuer eine unbekannte id, und die Route soll dafuer 404
 * antworten statt 500.
 */
async function sperreWennVorhanden(tx: Prisma.TransactionClient, vereinId: string): Promise<boolean> {
	try {
		await sperreVereinszeile(tx, vereinId);
		return true;
	} catch (error) {
		if ((error as { code?: unknown } | null)?.code === 'P2025') return false;
		throw error;
	}
}

export function adminDaten(prisma: PrismaClient) {
	/**
	 * Kennzahlen fuer mehrere Vereine mit vier Abfragen insgesamt statt vier je
	 * Verein: Die Liste waechst mit der Zahl der Vereine. Verworfen: _count in
	 * verein.findMany -- es zaehlt jede Relation nur einmal (Jungfischer und
	 * Erwachsene sind beide personen) und liefert kein max(letzteAnmeldungAm) der Zugaenge.
	 */
	async function kennzahlen(vereinIds: string[], jetzt: Date): Promise<Map<string, Kennzahlen>> {
		const inVereinen = { vereinId: { in: vereinIds } };
		const [personen, zugaenge, einladungen, anmeldungen] = await Promise.all([
			// Grabsteine (Spec 5.8) sind keine Mitglieder mehr.
			prisma.person.groupBy({
				by: ['vereinId', 'art'],
				where: { ...inVereinen, entferntAm: null },
				_count: { _all: true },
			}),
			prisma.zugang.groupBy({ by: ['vereinId'], where: inVereinen, _count: { _all: true } }),
			prisma.einladung.groupBy({
				by: ['vereinId'],
				where: { ...inVereinen, eingeloestAm: null, ablauf: { gt: jetzt } },
				_count: { _all: true },
			}),
			// Vom Zugang statt aus den Sitzungen: Die laufen ab und werden beim Abmelden
			// geloescht, die letzte Anmeldung soll dadurch nicht verschwinden.
			prisma.zugang.groupBy({ by: ['vereinId'], where: inVereinen, _max: { letzteAnmeldungAm: true } }),
		]);

		const ergebnis = new Map<string, Kennzahlen>(
			vereinIds.map((id) => [
				id,
				{ jungfischer: 0, erwachsene: 0, zugaenge: 0, offeneEinladungen: 0, letzteAnmeldung: null },
			]),
		);
		const zeile = (vereinId: string) => ergebnis.get(vereinId) as Kennzahlen;
		for (const p of personen) {
			if (p.art === 'JUNGFISCHER') zeile(p.vereinId).jungfischer = p._count._all;
			else zeile(p.vereinId).erwachsene = p._count._all;
		}
		for (const z of zugaenge) zeile(z.vereinId).zugaenge = z._count._all;
		for (const e of einladungen) zeile(e.vereinId).offeneEinladungen = e._count._all;
		for (const a of anmeldungen) {
			const juengste = a._max.letzteAnmeldungAm;
			zeile(a.vereinId).letzteAnmeldung = juengste ? berlinerDatum(juengste) : null;
		}
		return ergebnis;
	}

	return {
		async vereinsliste(jetzt: Date): Promise<VereinZeile[]> {
			const vereine = await prisma.verein.findMany({
				select: { id: true, slug: true, anzeigename: true, status: true },
			});
			const zahlen = await kennzahlen(
				vereine.map((v) => v.id),
				jetzt,
			);
			return vereine
				.map((v) => ({ ...v, kennzahlen: zahlen.get(v.id) as Kennzahlen }))
				.sort((a, b) => ALPHABET.compare(a.anzeigename, b.anzeigename) || a.slug.localeCompare(b.slug));
		},

		async vereinsdetails(id: string, jetzt: Date): Promise<VereinDetails | null> {
			const verein = await prisma.verein.findUnique({
				where: { id },
				select: {
					id: true,
					slug: true,
					name: true,
					anzeigename: true,
					farbe: true,
					status: true,
					angelegtAm: true,
				},
			});
			if (!verein) return null;

			const [zahlen, ansprechpartner, angenommen, protokoll] = await Promise.all([
				kennzahlen([id], jetzt),
				prisma.person.findMany({
					where: { vereinId: id, entferntAm: null, rechte: { has: 'JUGENDLEITER_RECHTE' } },
					select: { id: true, vorname: true, nachname: true, email: true },
					orderBy: [{ nachname: 'asc' }, { vorname: 'asc' }],
				}),
				istAngenommen(prisma, id),
				prisma.adminProtokoll.findMany({
					where: { vereinId: id },
					select: { zeitpunkt: true, aktion: true, admin: { select: { benutzername: true } } },
					// id als zweiter Schluessel, damit gleichzeitige Eintraege eine feste Reihenfolge haben.
					orderBy: [{ zeitpunkt: 'desc' }, { id: 'desc' }],
					take: PROTOKOLL_ANZAHL,
				}),
			]);

			let leitung: VereinDetails['ersteLeitung'] = null;
			if (!angenommen) {
				const einladung = await ersteLeitung(prisma, id);
				if (einladung) {
					const { person } = einladung;
					leitung = { personId: person.id, vorname: person.vorname, nachname: person.nachname };
				}
			}
			// Dieselbe Bedingung wie in korrigiereSlug: Ohne Admin-Einladung (Demo-Verein
			// aus dem Seed) antwortet die Korrektur 404, also darf die Oberflaeche sie
			// nicht anbieten.
			const slugAenderbar = leitung !== null;

			return {
				id: verein.id,
				slug: verein.slug,
				name: verein.name,
				anzeigename: verein.anzeigename,
				farbe: verein.farbe,
				status: verein.status,
				angelegtAm: verein.angelegtAm.toISOString(),
				kennzahlen: zahlen.get(id) as Kennzahlen,
				ansprechpartner: ansprechpartner.map((p) => ({
					personId: p.id,
					vorname: p.vorname,
					nachname: p.nachname,
					email: p.email,
				})),
				ersteLeitung: leitung,
				slugAenderbar,
				protokoll: protokoll.map((p) => ({
					zeitpunkt: p.zeitpunkt.toISOString(),
					aktion: p.aktion,
					admin: p.admin.benutzername,
				})),
			};
		},

		/**
		 * Verein, erste Leitung, Einladung und Protokoll in einer Transaktion: Ohne
		 * Leitung oder Einladung kaeme niemand in den Verein, ohne Protokoll fehlte
		 * der Nachweis (Spec 7.5). 'vergeben', wenn ein anderer Verein den Slug hat
		 * -- auch wenn er ihn erst in diesem Moment bekommen hat.
		 *
		 * Kein Nachsehen vor dem Anlegen: Zwischen Nachsehen und Anlegen koennte ein
		 * zweiter Admin-Klick denselben Slug nehmen. Der eindeutige Index entscheidet
		 * in einem Schritt; die zweite Transaktion wartet auf die erste und scheitert
		 * dann mit P2002, ihre Leitung und ihr Protokoll gehen mit zurueck.
		 */
		async legeVereinAn(
			eingabe: NeuerVerein,
			adminId: string,
			jetzt: Date,
			mail?: EinladungsMailBauer,
		): Promise<
			| {
					id: string;
					slug: string;
					leitung: { vorname: string };
					anzeigename: string;
					token: string;
					mailEingereiht: boolean;
			  }
			| 'vergeben'
		> {
			try {
				return await prisma.$transaction(async (tx) => {
					const verein = await tx.verein.create({
						data: {
							slug: eingabe.slug,
							name: eingabe.name,
							anzeigename: eingabe.anzeigename,
							farbe: eingabe.farbe,
							angelegtAm: jetzt,
						},
						select: { id: true, slug: true, anzeigename: true },
					});
					const leitung = await tx.person.create({
						data: {
							vereinId: verein.id,
							art: 'ERWACHSENER',
							vorname: eingabe.leitung.vorname,
							nachname: eingabe.leitung.nachname,
							email: eingabe.leitung.email,
							rechte: ALLE_RECHTE,
							angelegtAm: jetzt,
						},
						select: { id: true, vorname: true },
					});
					const { id: einladungId, token } = await erzeugeEinladungMitId(tx, {
						vereinId: verein.id,
						personId: leitung.id,
						art: 'EINLADUNG',
						erstelltVonPersonId: null,
						jetzt,
					});
					// Die Adresse ist beim Anlegen Pflicht (vereine.ts), es gibt also immer eine.
					if (mail) {
						await reiheMailEin(tx, {
							vereinId: verein.id,
							empfaenger: eingabe.leitung.email,
							einladungId,
							mail: mail({ token, vorname: leitung.vorname, anzeigename: verein.anzeigename, slug: verein.slug }),
							jetzt,
						});
					}
					await tx.adminProtokoll.create({
						data: {
							adminId,
							zeitpunkt: jetzt,
							aktion: 'VEREIN_ANGELEGT',
							vereinId: verein.id,
							vereinSlug: verein.slug,
							betroffenePersonId: leitung.id,
						},
					});
					return {
						id: verein.id,
						slug: verein.slug,
						leitung: { vorname: leitung.vorname },
						anzeigename: verein.anzeigename,
						token,
						mailEingereiht: mail !== undefined,
					};
				});
			} catch (error) {
				if (istSlugVergeben(error)) return 'vergeben';
				throw error;
			}
		},

		/** Fuer Routen, die vor dem Pruefen der Eingabe wissen muessen, ob es den Verein gibt. */
		async gibtVerein(id: string): Promise<boolean> {
			return (await prisma.verein.findUnique({ where: { id }, select: { id: true } })) !== null;
		},

		/**
		 * Sperren und entsperren. 'unveraendert' ohne Protokolleintrag: Ein zweiter
		 * Klick auf "sperren" hat nichts getan, und das Protokoll belegt Handlungen.
		 * Die Sitzungen des Vereins bleiben (Spec 7.3); sie wirken erst nach dem
		 * Entsperren wieder, weil vereinAusSlug gesperrte Vereine nicht findet.
		 *
		 * updateMany mit dem alten Status in der Bedingung statt Lesen und dann
		 * Schreiben: Zwei gleichzeitige Klicks saehen sonst beide "aktiv" und
		 * schrieben beide einen Eintrag. So wartet der zweite auf die Zeilensperre
		 * des ersten, findet den Status schon gesetzt und aendert nichts.
		 */
		async setzeStatus(
			id: string,
			status: VereinStatus,
			adminId: string,
			jetzt: Date,
		): Promise<'geaendert' | 'unveraendert' | null> {
			return prisma.$transaction(async (tx) => {
				const { count } = await tx.verein.updateMany({ where: { id, status: { not: status } }, data: { status } });
				const verein = await tx.verein.findUnique({ where: { id }, select: { slug: true } });
				if (!verein) return null;
				if (count === 0) return 'unveraendert';
				await tx.adminProtokoll.create({
					data: {
						adminId,
						zeitpunkt: jetzt,
						aktion: status === 'GESPERRT' ? 'GESPERRT' : 'ENTSPERRT',
						vereinId: id,
						vereinSlug: verein.slug,
					},
				});
				return 'geaendert';
			});
		},

		/**
		 * Neuer Slug vor der Annahme der ersten Einladung (Spec 7.3). Die offene
		 * Einladung zeigte auf den alten Slug und fuehrte nach der Korrektur ins
		 * Leere; deshalb wird sie gleich mit erneuert, mit zwei Protokolleintraegen.
		 * Der Slug kommt geprueft aus vereine.ts.
		 *
		 * 'fest' vor 'vergeben': Nach der Annahme ist jeder neue Slug falsch, ob
		 * frei oder nicht. 'vergeben' entscheidet wie beim Anlegen der eindeutige
		 * Index in einem Schritt statt eines Nachsehens vorher.
		 *
		 * Der eigene, unveraenderte Slug laeuft durch: Der Index stoert sich nicht an
		 * derselben Zeile, und das Ergebnis -- eine erneuerte Einladung -- schadet
		 * nicht. Verworfen: ein eigener Fehler dafuer, eine Regel mehr fuer einen
		 * Klick, den die Oberflaeche ohnehin kaum anbietet.
		 *
		 * null auch, wenn es keine Admin-Einladung gibt: Dann gibt es keine erste
		 * Leitung, deren Einladung umzustellen waere. Vereine aus der Admin-Seite
		 * haben immer eine; ohne sie (von Hand angelegt) ist die Aktion nicht vorgesehen.
		 */
		async korrigiereSlug(
			id: string,
			slug: string,
			adminId: string,
			jetzt: Date,
		): Promise<{ token: string; vorname: string; anzeigename: string } | 'fest' | 'vergeben' | null> {
			try {
				return await prisma.$transaction(async (tx) => {
					if (!(await sperreWennVorhanden(tx, id))) return null;
					const verein = await tx.verein.findUnique({ where: { id }, select: { anzeigename: true } });
					if (!verein) return null;
					if (await istAngenommen(tx, id)) return 'fest';
					const einladung = await ersteLeitung(tx, id);
					if (!einladung) return null;
					const { person } = einladung;

					await tx.verein.update({ where: { id }, data: { slug } });
					const token = await erzeugeEinladung(tx, {
						vereinId: id,
						personId: person.id,
						art: 'EINLADUNG',
						erstelltVonPersonId: null,
						jetzt,
					});
					const eintrag = { adminId, zeitpunkt: jetzt, vereinId: id, vereinSlug: slug };
					await tx.adminProtokoll.create({ data: { ...eintrag, aktion: 'SLUG_KORRIGIERT' } });
					await tx.adminProtokoll.create({
						data: { ...eintrag, aktion: 'ERSTE_EINLADUNG_ERNEUERT', betroffenePersonId: person.id },
					});
					return { token, vorname: person.vorname, anzeigename: verein.anzeigename };
				});
			} catch (error) {
				if (istSlugVergeben(error)) return 'vergeben';
				throw error;
			}
		},

		/**
		 * Neuer Link fuer die erste Leitung, solange sie noch nicht angenommen hat
		 * (verloren, abgelaufen). Danach ist das Sache des Vereins oder des
		 * Notfall-Links. null wie bei korrigiereSlug auch ohne Admin-Einladung.
		 */
		async erneuereErsteEinladung(
			id: string,
			adminId: string,
			jetzt: Date,
			mail?: EinladungsMailBauer,
		): Promise<(NeueEinladung & { mailEingereiht: boolean }) | 'angenommen' | 'gesperrt' | 'ohneAdresse' | null> {
			return prisma.$transaction(async (tx) => {
				if (!(await sperreWennVorhanden(tx, id))) return null;
				const verein = await tx.verein.findUnique({
					where: { id },
					select: { slug: true, anzeigename: true, status: true },
				});
				if (!verein) return null;
				// Ein Link fuer einen gesperrten Verein fuehrte ins Leere (vereinAusSlug
				// findet ihn nicht); erst entsperren, dann einladen.
				if (verein.status === 'GESPERRT') return 'gesperrt';
				if (await istAngenommen(tx, id)) return 'angenommen';
				const einladung = await ersteLeitung(tx, id);
				if (!einladung) return null;
				const { person } = einladung;
				// Vor dem ersten Schreiben: ohne Adresse soll der Klick nichts veraendern,
				// auch die offene Einladung nicht ersetzen.
				if (mail && !person.email) return 'ohneAdresse';

				const { id: einladungId, token } = await erzeugeEinladungMitId(tx, {
					vereinId: id,
					personId: person.id,
					art: 'EINLADUNG',
					erstelltVonPersonId: null,
					jetzt,
				});
				const neu = { token, vorname: person.vorname, anzeigename: verein.anzeigename, slug: verein.slug };
				if (mail && person.email) {
					await reiheMailEin(tx, { vereinId: id, empfaenger: person.email, einladungId, mail: mail(neu), jetzt });
				}
				await tx.adminProtokoll.create({
					data: {
						adminId,
						zeitpunkt: jetzt,
						aktion: 'ERSTE_EINLADUNG_ERNEUERT',
						vereinId: id,
						vereinSlug: verein.slug,
						betroffenePersonId: person.id,
					},
				});
				return { ...neu, mailEingereiht: mail !== undefined };
			});
		},

		/**
		 * Einladungslink fuer einen Ansprechpartner dieses Vereins, fuer niemanden
		 * sonst (Spec 7.3): nicht fuer Kinder, Eltern, Verwaltung ohne
		 * "Jugendleiter & Rechte verwalten", Entfernte oder Personen anderer Vereine.
		 * Alle diese Faelle sind null, damit der Admin nicht ueber die Antwort
		 * erfaehrt, wer es sonst gibt. Die Bedingung steht in derselben Abfrage wie
		 * der Verein, damit eine personId aus einem fremden Verein nie passt.
		 *
		 * Art EINLADUNG statt RESET: Spec 4.1 fuehrt den Notfall-Link unter den
		 * Einladungen, und erzeugeEinladung ersetzt so auch einen frueheren
		 * Notfall-Link an dieselbe Person, statt ihn weiter gelten zu lassen.
		 */
		async notfallLink(
			id: string,
			personId: string,
			adminId: string,
			jetzt: Date,
			mail?: EinladungsMailBauer,
		): Promise<(NeueEinladung & { mailEingereiht: boolean }) | 'gesperrt' | 'ohneAdresse' | null> {
			return prisma.$transaction(async (tx) => {
				if (!(await sperreWennVorhanden(tx, id))) return null;
				const person = await tx.person.findFirst({
					where: { id: personId, vereinId: id, entferntAm: null, rechte: { has: 'JUGENDLEITER_RECHTE' } },
					select: {
						id: true,
						vorname: true,
						email: true,
						verein: { select: { slug: true, anzeigename: true, status: true } },
					},
				});
				if (!person) return null;
				// Nach dem Personenpruefen: Fuer eine fremde Person bleibt es 404, auch im
				// gesperrten Verein; "gesperrt" sagt nur, was der Admin ohnehin sieht.
				if (person.verein.status === 'GESPERRT') return 'gesperrt';
				// Nach "gesperrt" und vor dem ersten Schreiben, wie beim Erneuern.
				if (mail && !person.email) return 'ohneAdresse';

				const { id: einladungId, token } = await erzeugeEinladungMitId(tx, {
					vereinId: id,
					personId: person.id,
					art: 'EINLADUNG',
					erstelltVonPersonId: null,
					jetzt,
				});
				const neu = {
					token,
					vorname: person.vorname,
					anzeigename: person.verein.anzeigename,
					slug: person.verein.slug,
				};
				if (mail && person.email) {
					await reiheMailEin(tx, { vereinId: id, empfaenger: person.email, einladungId, mail: mail(neu), jetzt });
				}
				await tx.adminProtokoll.create({
					data: {
						adminId,
						zeitpunkt: jetzt,
						aktion: 'NOTFALL_LINK',
						vereinId: id,
						vereinSlug: person.verein.slug,
						betroffenePersonId: person.id,
					},
				});
				return { ...neu, mailEingereiht: mail !== undefined };
			});
		},
	};
}

export type AdminDaten = ReturnType<typeof adminDaten>;
