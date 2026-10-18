import { passkeyLabel } from '@jufi/auth';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { berlinerDatum } from '../admin/daten.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';

const iso = (zeitpunkt: Date | null): string | null => zeitpunkt?.toISOString() ?? null;

const ENTFERNTE_PERSON = '(entfernte Person)';

/**
 * Vor- und Nachname in einem Stueck. Ein Grabstein hat beide geleert (Spec 5.8); ein leerer
 * String las sich wie ein Fehler im Auszug, darum steht dort ein Platzhalter. Verworfen:
 * die Einwilligung weglassen, denn sie bleibt als Nachweis stehen und gehoert zu den Daten.
 */
const vollerName = (p: { vorname: string; nachname: string; entferntAm: Date | null }): string =>
	p.entferntAm ? ENTFERNTE_PERSON : `${p.vorname} ${p.nachname}`.trim();

/**
 * Form des Auszugs. Das Objekt unten wird dagegen geprueft (satisfies), damit eine spaetere
 * Ergaenzung oder ein umbenanntes Feld dem Compiler auffaellt und nicht erst dem Nutzer.
 */
export interface Datenauszug {
	erstelltAm: string;
	verein: { name: string; anzeigename: string };
	person: {
		vorname: string;
		nachname: string;
		art: 'JUNGFISCHER' | 'ERWACHSENER';
		geburtsdatum: string | null;
		email: string | null;
		jugendsprecher: boolean | null;
		rechte: string[];
		angelegtAm: string;
	};
	zugang: {
		anmeldename: string | null;
		passwortGesetzt: boolean;
		totpAktiv: boolean;
		angelegtAm: string;
		letzteAnmeldungAm: string | null;
	} | null;
	passkeys: { name: string; angelegtAm: string; zuletztGenutztAm: string | null }[];
	sitzungen: { zuletztGesehen: string; ablauf: string; geraet: string | null }[];
	familie: {
		vorname: string;
		nachname: string;
		beziehung: string;
		beziehungFreitext: string | null;
		erziehungsberechtigt: boolean;
		rolle: 'kind' | 'bezugsperson';
	}[];
	untergruppen: string[];
	einwilligungen: {
		kind: string;
		art: string;
		textVersion: string;
		erteiltAm: string;
		widerrufenAm: string | null;
		erteiltVon: string;
	}[];
}

/**
 * "Meine Daten herunterladen" (Plan-Entscheidung 9): die Angaben zur angemeldeten
 * Person als JSON-Datei, und zwar die Felder, die der Plan fuer Etappe 5 festlegt. Nicht
 * darin stehen etwa zugangErlaubt, volljaehrigGeprueftAm, Wiederherstellungscodes und offene
 * Einladungen; weitere Felder ergaenzen spaetere Teilprojekte.
 *
 * Die Felder werden aufgebaut statt gestrichen (Muster aus Etappe 4, siehe /ich): Jede
 * Abfrage nennt ihre Spalten ueber select, und das Ergebnis wird Feld fuer Feld
 * zusammengesetzt. Verworfen: die ganzen Zeilen nehmen und Hash, Schluessel und Token
 * herausloeschen. Dann landete ein spaeter ergaenztes Geheimnis-Feld still im Auszug,
 * bis jemand daran denkt, es zu streichen.
 *
 * Ein schlichter GET mit Content-Disposition (Plan-Entscheidung 9), damit die Oberflaeche
 * nur einen Link braucht. Der Auszug gehoert immer der Person der Sitzung; es gibt keine
 * Id im Pfad, ueber die man an fremde Daten kaeme.
 */
export function datenauszugRouten(router: Router, deps: Pick<VolleAppDeps, 'jetzt'>): void {
	const { jetzt } = deps;

	router.get(
		'/ich/daten',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person, zugang } = mitgliedKontext(res);
			const zeit = jetzt();

			const [passkeys, sitzungen, bezuege, gruppen, einwilligungen] = await Promise.all([
				db.passkey.findMany({
					where: { zugangId: zugang.id },
					select: { label: true, createdAt: true, lastUsedAt: true },
					orderBy: { createdAt: 'asc' },
				}),
				db.session.findMany({
					where: { zugangId: zugang.id },
					select: { zuletztGesehen: true, ablauf: true, userAgent: true },
					orderBy: { zuletztGesehen: 'desc' },
				}),
				// Ein Erwachsener sieht seine Kinder, ein Jungfischer seine Bezugspersonen; beide
				// Richtungen in einer Abfrage, weil eine Person nur auf einer Seite stehen kann.
				// Entfernte Personen fehlen: Der Grabstein hat keine Namen mehr und gehoert nicht
				// mehr zur Familie (Spec 5.8). Ueber die anderen nur Name und Beziehung, nie Adresse.
				db.bezugsperson.findMany({
					where: {
						OR: [
							{ erwachsenerId: person.id, jungfischer: { entferntAm: null } },
							{ jungfischerId: person.id, erwachsener: { entferntAm: null } },
						],
					},
					select: {
						erwachsenerId: true,
						beziehung: true,
						beziehungFreitext: true,
						erziehungsberechtigt: true,
						erwachsener: { select: { vorname: true, nachname: true } },
						jungfischer: { select: { vorname: true, nachname: true } },
					},
					orderBy: { angelegtAm: 'asc' },
				}),
				db.untergruppeMitglied.findMany({
					where: { personId: person.id },
					select: { untergruppe: { select: { name: true } } },
				}),
				// Die erteilten und, bei Jungfischern, die fuer sie erteilten.
				db.einwilligung.findMany({
					where: { OR: [{ erteiltVon: person.id }, { jungfischerId: person.id }] },
					select: {
						art: true,
						textVersion: true,
						erteiltAm: true,
						widerrufenAm: true,
						erteiltVon: true,
						jungfischer: { select: { vorname: true, nachname: true, entferntAm: true } },
						erteiltVonPerson: { select: { vorname: true, nachname: true, entferntAm: true } },
					},
					orderBy: { erteiltAm: 'asc' },
				}),
			]);

			const auszug = {
				erstelltAm: zeit.toISOString(),
				verein: { name: verein.name, anzeigename: verein.anzeigename },
				person: {
					vorname: person.vorname,
					nachname: person.nachname,
					art: person.art,
					// @db.Date: nur der Tag, ohne die Uhrzeit, die ein ISO-Zeitpunkt vortaeuschte.
					geburtsdatum: person.geburtsdatum?.toISOString().slice(0, 10) ?? null,
					email: person.email,
					// Nur Jungfischer haben die Angabe; bei Erwachsenen waere false eine Antwort, die es nicht gibt.
					jugendsprecher: person.art === 'JUNGFISCHER' ? person.jugendsprecher : null,
					rechte: person.rechte,
					angelegtAm: person.angelegtAm.toISOString(),
				},
				// Wer angemeldet ist, hat einen Zugang; null aus der Spezifikation (Person ohne Zugang) kommt
				// auf diesem Weg darum nie vor.
				zugang: {
					anmeldename: zugang.anmeldename,
					// Nur ob etwas gesetzt ist, nie der Hash und nie das Geheimnis.
					passwortGesetzt: zugang.passwortHash !== null,
					totpAktiv: zugang.totpAktivAm !== null,
					angelegtAm: zugang.angelegtAm.toISOString(),
					letzteAnmeldungAm: iso(zugang.letzteAnmeldungAm),
				},
				passkeys: passkeys.map((p) => ({
					name: p.label,
					angelegtAm: p.createdAt.toISOString(),
					zuletztGenutztAm: iso(p.lastUsedAt),
				})),
				sitzungen: sitzungen.map((s) => ({
					zuletztGesehen: s.zuletztGesehen.toISOString(),
					ablauf: s.ablauf.toISOString(),
					// Die geratene Bezeichnung statt des rohen User-Agents, wie bei den Passkeys: Der
					// Text ist lesbar, und der Auszug traegt keine Browser-Kennung, die niemand braucht.
					geraet: s.userAgent === null ? null : passkeyLabel(s.userAgent),
				})),
				familie: bezuege.map((b) => {
					const istKind = b.erwachsenerId === person.id;
					const andere = istKind ? b.jungfischer : b.erwachsener;
					return {
						vorname: andere.vorname,
						nachname: andere.nachname,
						beziehung: b.beziehung,
						beziehungFreitext: b.beziehungFreitext,
						erziehungsberechtigt: b.erziehungsberechtigt,
						rolle: istKind ? ('kind' as const) : ('bezugsperson' as const),
					};
				}),
				untergruppen: gruppen.map((g) => g.untergruppe.name).sort((a, b) => a.localeCompare(b, 'de')),
				einwilligungen: einwilligungen.map((e) => ({
					kind: vollerName(e.jungfischer),
					art: e.art,
					textVersion: e.textVersion,
					erteiltAm: e.erteiltAm.toISOString(),
					widerrufenAm: iso(e.widerrufenAm),
					erteiltVon: e.erteiltVon === person.id ? 'ich' : vollerName(e.erteiltVonPerson),
				})),
			} satisfies Datenauszug;

			// Berliner Tag statt UTC: Eine Datei, die um 00:30 Ortszeit entsteht, soll das Datum von
			// heute tragen, nicht von gestern. Wie die uebrigen Tagesangaben der App (admin/daten.ts).
			// Der Slug besteht nur aus a-z, 0-9 und Bindestrich (pruefeSlug), braucht also kein Escaping
			// im Dateinamen.
			const dateiname = `jufi-meine-daten-${verein.slug}-${berlinerDatum(zeit)}.json`;
			// no-store: Der Auszug enthaelt Personendaten und soll in keinem gemeinsamen Cache liegen.
			// Text statt res.json, damit der Auszug lesbar eingerueckt ist; wer ihn oeffnet, ist ein Mensch.
			res
				.status(200)
				.set({
					'Content-Type': 'application/json; charset=utf-8',
					'Content-Disposition': `attachment; filename="${dateiname}"`,
					'Cache-Control': 'no-store',
				})
				.send(JSON.stringify(auszug, null, 2));
		}),
	);
}
