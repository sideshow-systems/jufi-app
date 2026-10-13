import { Recht, type AdminAktion, type PrismaClient, type VereinStatus } from '@jufi/db';
import { erzeugeEinladung } from '../einladung.js';

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

export function adminDaten(prisma: PrismaClient) {
	/**
	 * Kennzahlen fuer mehrere Vereine mit vier Abfragen insgesamt statt vier je
	 * Verein: Die Liste waechst mit der Zahl der Vereine. Verworfen: _count in
	 * verein.findMany -- es zaehlt jede Relation nur einmal (Jungfischer und
	 * Erwachsene sind beide personen) und liefert kein max(angelegtAm) der Sitzungen.
	 */
	async function kennzahlen(vereinIds: string[], jetzt: Date): Promise<Map<string, Kennzahlen>> {
		const inVereinen = { vereinId: { in: vereinIds } };
		const [personen, zugaenge, einladungen, sitzungen] = await Promise.all([
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
			prisma.session.groupBy({ by: ['vereinId'], where: inVereinen, _max: { angelegtAm: true } }),
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
		for (const s of sitzungen) {
			const juengste = s._max.angelegtAm;
			zeile(s.vereinId).letzteAnmeldung = juengste ? berlinerDatum(juengste) : null;
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

			const [zahlen, ansprechpartner, hatZugang, protokoll] = await Promise.all([
				kennzahlen([id], jetzt),
				prisma.person.findMany({
					where: { vereinId: id, entferntAm: null, rechte: { has: 'JUGENDLEITER_RECHTE' } },
					select: { id: true, vorname: true, nachname: true, email: true },
					orderBy: [{ nachname: 'asc' }, { vorname: 'asc' }],
				}),
				prisma.zugang.findFirst({ where: { vereinId: id }, select: { id: true } }),
				prisma.adminProtokoll.findMany({
					where: { vereinId: id },
					select: { zeitpunkt: true, aktion: true, admin: { select: { benutzername: true } } },
					// id als zweiter Schluessel, damit gleichzeitige Eintraege eine feste Reihenfolge haben.
					orderBy: [{ zeitpunkt: 'desc' }, { id: 'desc' }],
					take: PROTOKOLL_ANZAHL,
				}),
			]);

			// Der erste Zugang entsteht erst beim Einloesen einer Einladung. Solange
			// es keinen gibt, ist die erste Einladung nicht angenommen: Der Slug steckt
			// noch in keinem Link, Cookie oder installierter App (Spec 7.3).
			const slugAenderbar = hatZugang === null;
			let ersteLeitung: VereinDetails['ersteLeitung'] = null;
			if (slugAenderbar) {
				// Die Leitung ist, wen der Admin zuletzt eingeladen hat (erstelltVonPersonId
				// null = vom Admin). Verworfen: ein eigenes Feld am Verein -- es liefe
				// auseinander, sobald die Einladung erneuert wird.
				const einladung = await prisma.einladung.findFirst({
					where: { vereinId: id, art: 'EINLADUNG', erstelltVonPersonId: null },
					orderBy: [{ angelegtAm: 'desc' }, { id: 'desc' }],
					select: { person: { select: { id: true, vorname: true, nachname: true } } },
				});
				if (einladung) {
					const { person } = einladung;
					ersteLeitung = { personId: person.id, vorname: person.vorname, nachname: person.nachname };
				}
			}

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
				ersteLeitung,
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
		): Promise<
			{ id: string; slug: string; leitung: { vorname: string }; anzeigename: string; token: string } | 'vergeben'
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
					const token = await erzeugeEinladung(tx, {
						vereinId: verein.id,
						personId: leitung.id,
						art: 'EINLADUNG',
						erstelltVonPersonId: null,
						jetzt,
					});
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
					};
				});
			} catch (error) {
				if (istSlugVergeben(error)) return 'vergeben';
				throw error;
			}
		},
	};
}

export type AdminDaten = ReturnType<typeof adminDaten>;
