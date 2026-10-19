import { passkeyLabel } from '@jufi/auth';
import { istErziehungsberechtigt } from '@jufi/domain';
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

/** Eine noch gueltige Einladung oder ein Reset-Link; nie das Token und nie sein Hash. */
interface OffeneEinladung {
	art: 'EINLADUNG' | 'RESET';
	angelegtAm: string;
	ablauf: string;
}

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
		zugangErlaubt: boolean | null;
		volljaehrigGeprueftAm: string | null;
		rechte: string[];
		angelegtAm: string;
	};
	zugang: {
		anmeldename: string | null;
		passwortGesetzt: boolean;
		totpAktiv: boolean;
		totpAktivAm: string | null;
		angelegtAm: string;
		letzteAnmeldungAm: string | null;
	} | null;
	wiederherstellungscodes: { eingerichtet: boolean; unbenutzt: number };
	offeneEinladungen: OffeneEinladung[];
	passkeys: { name: string; angelegtAm: string; zuletztGenutztAm: string | null }[];
	sitzungen: { angelegtAm: string; zuletztGesehen: string; ablauf: string; geraet: string | null }[];
	familie: {
		vorname: string;
		nachname: string;
		beziehung: string;
		beziehungFreitext: string | null;
		erziehungsberechtigt: boolean;
		rolle: 'kind' | 'bezugsperson';
		angelegtAm: string;
		/** Nur bei rolle kind; ueber eine Bezugsperson gibt der Auszug diese Angaben nicht her. */
		zugangErlaubt: boolean | null;
		/**
		 * Nur bei rolle kind und nur, wenn die Person heute fuer das Kind erziehungsberechtigt ist
		 * (Kind minderjaehrig, nicht entfernt); sonst null. Gilt ebenso fuer offeneEinladungen.
		 */
		volljaehrigGeprueftAm: string | null;
		offeneEinladungen: OffeneEinladung[] | null;
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
 * Person als JSON-Datei. Alles, was die App ueber die Person und ihre Kinder speichert
 * und was ihr etwas sagt, steht darin; weitere Felder ergaenzen spaetere Teilprojekte.
 * Bewusst nicht darin: Ids und andere technische Schluessel, Passkey-Zaehler, Transporte und
 * Sicherungsstand, der rohe User-Agent, Abschriften verschickter Mails (sie tragen den
 * Einladungslink) und Einladungen, die die Person fuer andere erstellt hat (Daten der anderen).
 *
 * Geheimnisse bleiben draussen, auch wo ein Hinweis darauf drin steht: Von den
 * Wiederherstellungscodes steht nur, ob es welche gibt und wie viele noch unbenutzt sind, von
 * offenen Einladungen nur Art, Erzeugung und Ablauf. Die Abfragen nennen weder codeHash noch
 * tokenHash, damit sie gar nicht erst im Speicher des Auszugs landen.
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

			const [passkeys, sitzungen, codes, bezuege, gruppen, einwilligungen] = await Promise.all([
				db.passkey.findMany({
					where: { zugangId: zugang.id },
					select: { label: true, createdAt: true, lastUsedAt: true },
					orderBy: { createdAt: 'asc' },
				}),
				db.session.findMany({
					where: { zugangId: zugang.id },
					select: { angelegtAm: true, zuletztGesehen: true, ablauf: true, userAgent: true },
					orderBy: { zuletztGesehen: 'desc' },
				}),
				// Nur verwendetAm: Die Codes (gehasht) werden nicht einmal gelesen.
				db.recoveryCode.findMany({ where: { zugangId: zugang.id }, select: { verwendetAm: true } }),
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
						jungfischerId: true,
						angelegtAm: true,
						beziehung: true,
						beziehungFreitext: true,
						erziehungsberechtigt: true,
						erwachsener: { select: { vorname: true, nachname: true } },
						jungfischer: {
							select: {
								vorname: true,
								nachname: true,
								zugangErlaubt: true,
								volljaehrigGeprueftAm: true,
								geburtsdatum: true,
								entferntAm: true,
							},
						},
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

			// Nach den Bezuegen, weil die Kinder erst daraus hervorgehen. Offen heisst wie in der
			// Verwaltung (admin/daten.ts): nicht eingeloest und nicht abgelaufen. Verworfen: auch
			// eingeloeste und abgelaufene; sie sind erledigt und sagen der Person nichts mehr.
			//
			// Linkstand und Volljaehrigkeitspruefung eines Kindes nur, wo die Person heute fuer das Kind
			// einwilligen und den Zugang steuern darf: gleiche Linie wie /einladung/pruefen, das ein Kind
			// sonst nicht nennt ("gaebe einen Namen preis"). Eine Grossmutter ohne Erziehungsberechtigung
			// erfuehre sonst, wann dem Enkel ein Link erzeugt wurde; die Mutter eines Volljaehrigen
			// duerfte den Zugang laut Spec 5.6 nicht mehr steuern und sieht den Linkstand auch in
			// /meine-jungfischer nicht. Verworfen: jedem zugeordneten Erwachsenen alles zeigen, weil
			// Zuordnung allein nur zum Handeln fuer das Kind berechtigt (darfFuerKindHandeln).
			// zugangErlaubt bleibt fuer jedes zugeordnete Kind, das zeigt /meine-jungfischer ohnehin.
			const steuertKind = (b: (typeof bezuege)[number]): boolean =>
				b.erwachsenerId === person.id &&
				istErziehungsberechtigt(
					b,
					{
						id: b.jungfischerId,
						art: 'JUNGFISCHER',
						rechte: [],
						geburtsdatum: b.jungfischer.geburtsdatum,
						entferntAm: b.jungfischer.entferntAm,
					},
					zeit,
				);
			const kinderIds = bezuege.filter(steuertKind).map((b) => b.jungfischerId);
			const einladungen = await db.einladung.findMany({
				where: { personId: { in: [person.id, ...kinderIds] }, eingeloestAm: null, ablauf: { gt: zeit } },
				select: { personId: true, art: true, angelegtAm: true, ablauf: true },
				orderBy: [{ angelegtAm: 'asc' }, { id: 'asc' }],
			});
			const offeneEinladungen = (personId: string): OffeneEinladung[] =>
				einladungen
					.filter((e) => e.personId === personId)
					.map((e) => ({ art: e.art, angelegtAm: e.angelegtAm.toISOString(), ablauf: e.ablauf.toISOString() }));

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
					// Ebenso nur bei Jungfischern bedeutsam (siehe Schema).
					zugangErlaubt: person.art === 'JUNGFISCHER' ? person.zugangErlaubt : null,
					volljaehrigGeprueftAm: iso(person.volljaehrigGeprueftAm),
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
					totpAktivAm: iso(zugang.totpAktivAm),
					angelegtAm: zugang.angelegtAm.toISOString(),
					letzteAnmeldungAm: iso(zugang.letzteAnmeldungAm),
				},
				wiederherstellungscodes: {
					eingerichtet: codes.length > 0,
					unbenutzt: codes.filter((c) => c.verwendetAm === null).length,
				},
				offeneEinladungen: offeneEinladungen(person.id),
				passkeys: passkeys.map((p) => ({
					name: p.label,
					angelegtAm: p.createdAt.toISOString(),
					zuletztGenutztAm: iso(p.lastUsedAt),
				})),
				sitzungen: sitzungen.map((s) => ({
					angelegtAm: s.angelegtAm.toISOString(),
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
						angelegtAm: b.angelegtAm.toISOString(),
						// Nur beim Kind: Zugang und Einladungen einer Bezugsperson gehen das Kind nichts an.
						// null statt Weglassen, damit die Form fuer beide Richtungen gleich bleibt.
						zugangErlaubt: istKind ? b.jungfischer.zugangErlaubt : null,
						// Pruefung und Linkstand nur bei Erziehungsberechtigung eines Minderjaehrigen (siehe steuertKind).
						volljaehrigGeprueftAm: steuertKind(b) ? iso(b.jungfischer.volljaehrigGeprueftAm) : null,
						offeneEinladungen: steuertKind(b) ? offeneEinladungen(b.jungfischerId) : null,
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
