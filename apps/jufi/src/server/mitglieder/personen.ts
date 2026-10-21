import { sperreVereinszeile, vermerkeUmfeld, type Bezugsperson, type Person, type VereinDb } from '@jufi/db';
import {
	einsichtIn,
	hatGueltigeEinwilligung,
	hatRecht,
	istDoppelt,
	istJugendleiter,
	istVolljaehrig,
	normalisiereEmail,
	pruefeEmail,
	pruefeGeburtsdatum,
	pruefeName,
	warnhinweise,
	wuerdeLetzteLeitungVerlieren,
	type Einsicht,
	type Warnhinweis,
	type Zuordnung,
} from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import type { Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron, text } from '../admin/asynchron.js';
import { meldeUmfeld } from '../echtzeit/umfeld.js';
import { MAIL_MAX_VERSUCHE } from '../mail/arbeiter.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';
import { alsSicht, ladeUmfeld, statt404 } from './verwaltung.js';
import { entferne, entzieheZugangWennUngueltig } from './zugang.js';

export interface PersonListe {
	id: string;
	art: 'ERWACHSENER' | 'JUNGFISCHER';
	vorname: string;
	nachname: string;
	geburtsdatum?: string;
	jugendsprecher?: boolean;
	rechte?: string[];
	email?: string;
	untergruppen?: { id: string; name: string }[];
	warnhinweise?: Warnhinweis[];
}

/** Was zu einer Person gehoert und nicht in ladeUmfeld steckt; je Anfrage einmal gelesen. */
interface Angaben {
	untergruppen: { id: string; name: string }[];
	/** Juengste nicht eingeloeste Einladung (nicht Reset), auch eine abgelaufene. */
	einladung: { id: string; ablauf: Date } | null;
	einwilligungen: { erteiltVon: string; widerrufenAm: Date | null }[];
	mailGescheitert: boolean;
}

/**
 * Je eine Abfrage fuer Untergruppen, Einladungen, Einwilligungen und Mails, nicht je
 * Person. nur grenzt auf eine Person ein (Einzelansicht), sonst gelten alle.
 */
async function ladeAngaben(db: VereinDb, nur?: string): Promise<Map<string, Angaben>> {
	const personFilter = nur ? { personId: nur } : {};
	const [mitgliedschaften, einladungen, einwilligungen] = await Promise.all([
		db.untergruppeMitglied.findMany({
			where: personFilter,
			select: { personId: true, untergruppe: { select: { id: true, name: true } } },
		}),
		db.einladung.findMany({
			where: { ...personFilter, art: 'EINLADUNG', eingeloestAm: null },
			select: { id: true, personId: true, ablauf: true },
			orderBy: [{ angelegtAm: 'desc' }, { id: 'desc' }],
		}),
		db.einwilligung.findMany({
			where: { ...(nur ? { jungfischerId: nur } : {}), widerrufenAm: null },
			select: { jungfischerId: true, erteiltVon: true, widerrufenAm: true },
		}),
	]);

	const angaben = new Map<string, Angaben>();
	const von = (id: string): Angaben => {
		let a = angaben.get(id);
		if (!a) {
			a = { untergruppen: [], einladung: null, einwilligungen: [], mailGescheitert: false };
			angaben.set(id, a);
		}
		return a;
	};
	for (const m of mitgliedschaften) von(m.personId).untergruppen.push(m.untergruppe);
	for (const e of einladungen) {
		const a = von(e.personId);
		// Nach angelegtAm absteigend sortiert: die erste ist die juengste.
		a.einladung ??= { id: e.id, ablauf: e.ablauf };
	}
	for (const w of einwilligungen) von(w.jungfischerId).einwilligungen.push(w);

	const bezuege = [...angaben.values()].flatMap((a) => (a.einladung ? [`einladung:${a.einladung.id}`] : []));
	if (bezuege.length > 0) {
		const gescheitert = await db.mailWarteschlange.findMany({
			where: { bezug: { in: bezuege }, gesendetAm: null, versuche: { gte: MAIL_MAX_VERSUCHE } },
			select: { bezug: true },
		});
		const bezugSet = new Set(gescheitert.map((m) => m.bezug));
		for (const a of angaben.values()) {
			if (a.einladung && bezugSet.has(`einladung:${a.einladung.id}`)) a.mailGescheitert = true;
		}
	}
	return angaben;
}

function datum(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Baut die Antwort je Einsicht Feld fuer Feld AUF, statt aus der vollen Zeile
 * Felder zu streichen: ein spaeter ergaenztes Feld bleibt so unsichtbar, bis jemand
 * es hier bewusst fuer eine Einsicht freigibt. Verworfen: Streichen -- ein neues
 * Feld waere dann fuer Betreuer sofort sichtbar.
 *
 * Verwaltung = Recht MITGLIEDER. VOLL ohne dieses Recht (die eigene Person, die
 * Familie) zeigt Geburtsdatum, Rechte und Untergruppen, aber weder Verwaltungs-
 * hinweise noch Einladungs- und Zugangsstand: die gehen die Familie nichts an.
 * Die Adresse sieht ausser der Verwaltung nur die Person selbst; Familienmitglieder
 * untereinander bekommen sie nicht (im Zweifel weggelassen).
 */
function baueListe(
	betrachter: Person,
	p: Person,
	einsicht: Einsicht,
	a: Angaben | undefined,
	hinweise: Warnhinweis[],
): PersonListe {
	const verwaltung = hatRecht(betrachter, 'MITGLIEDER');
	const antwort: PersonListe = { id: p.id, art: p.art, vorname: p.vorname, nachname: p.nachname };
	if (einsicht === 'NAME') return antwort;

	if (p.geburtsdatum) antwort.geburtsdatum = datum(p.geburtsdatum);
	antwort.jugendsprecher = p.jugendsprecher;
	antwort.rechte = [...p.rechte];
	antwort.untergruppen = a?.untergruppen ?? [];
	if (einsicht === 'VOLL' && (verwaltung || betrachter.id === p.id) && p.email) antwort.email = p.email;

	if (verwaltung) {
		antwort.warnhinweise = hinweise;
	} else if (einsicht === 'LESEN') {
		// Betreuer sehen, was ihre Aufsicht betrifft (Familie, Volljaehrigkeit), aber weder
		// Einwilligungsstand noch Einladung und Mailversand: die gehoeren der Verwaltung (Spec 5.2).
		antwort.warnhinweise = hinweise.filter((h) => h.art === 'OHNE_FAMILIE' || h.art === 'VOLLJAEHRIG');
	}
	return antwort;
}

/**
 * Ende einer Schreib-Route mit Status und Antwort. Innerhalb der Transaktion
 * geworfen, damit alles zurueckgenommen wird, was bis dahin geschrieben wurde.
 * Verworfen: ein Rueckgabewert aus der Transaktion -- die Person bliebe dann bei
 * einer Ablehnung nach dem ersten Schreibschritt halb angelegt.
 */
class Abbruch extends Error {
	constructor(
		readonly status: number,
		readonly antwort: object,
	) {
		super('Schreiben abgebrochen');
	}
}

const EMAIL_VERGEBEN = {
	fehler: 'Diese E-Mail-Adresse gehört im Verein schon jemand anderem',
	code: 'EMAIL_VERGEBEN',
	feld: 'email',
};
const EMAIL_MIT_ZUGANG = {
	fehler: 'Wer sich schon anmelden kann, behält seine Adresse: sie ist die Kennung',
	code: 'EMAIL_MIT_ZUGANG',
	feld: 'email',
};
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

function ungueltig(fehler: string, feld: string): Abbruch {
	return new Abbruch(400, { fehler, feld });
}

/**
 * Entscheidet die Datenbank, nicht eine Vorabpruefung: zwei gleichzeitige Anfragen
 * mit derselben Adresse sehen beide "frei", nur der Unique-Index (vereinId, email)
 * lehnt die zweite ab. Verworfen: error.meta.target auswerten -- dessen Form haengt
 * vom Treiber-Adapter ab; es gibt am Person-Schreiben nur diesen einen Index.
 */
function istEindeutigVerletzt(error: unknown): boolean {
	return (error as { code?: unknown } | null)?.code === 'P2002';
}

/** Name wie gespeichert: ohne Rand, 1 bis 60 Zeichen. */
function liesName(wert: unknown, feld: 'vorname' | 'nachname'): string {
	const name = text(wert).trim();
	if (!pruefeName(name))
		throw ungueltig(`${feld === 'vorname' ? 'Vorname' : 'Nachname'} braucht 1 bis 60 Zeichen`, feld);
	return name;
}

/** Kalenderdatum JJJJ-MM-TT; "2015-02-31" ist ungueltig statt still der 3. Maerz. */
function liesDatum(wert: unknown, jetzt: Date): Date {
	const roh = text(wert);
	const d = new Date(`${roh}T00:00:00.000Z`);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(roh) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== roh) {
		throw ungueltig('Bitte ein Geburtsdatum im Format JJJJ-MM-TT angeben', 'geburtsdatum');
	}
	if (!pruefeGeburtsdatum(d, jetzt))
		throw ungueltig('Das Geburtsdatum liegt in der Zukunft oder zu weit zurück', 'geburtsdatum');
	return d;
}

/** Leer = keine Adresse (null), sonst normalisiert und geprueft. */
function liesEmail(wert: unknown): string | null {
	if (wert === null || wert === undefined) return null;
	if (typeof wert !== 'string') throw ungueltig('Bitte eine gültige E-Mail-Adresse angeben', 'email');
	const email = normalisiereEmail(wert);
	if (email === '') return null;
	if (!pruefeEmail(email)) throw ungueltig('Bitte eine gültige E-Mail-Adresse angeben', 'email');
	return email;
}

export function personenRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, bus } = deps;

	/** Alles, was die Regeln und Serialisierer fuer die Anfrage brauchen. */
	async function laden(db: VereinDb, betrachter: Person, nur?: string) {
		const umfeld = await ladeUmfeld(db);
		const { personen } = umfeld;
		const angaben = await ladeAngaben(db, nur);
		const jetztWert = jetzt();
		const sichten = new Map<string, Person>(personen.map((p) => [p.id, p]));
		// Eine Zuordnung zaehlt nur, wenn beide Enden nicht entfernt sind. Ohne das verbaende
		// ein entferntes gemeinsames Kind seine Erwachsenen weiter (teilenKind kennt entfernte
		// Kinder nur, wenn sie in der Map stehen) und entfernte Erwachsene zaehlten als Familie.
		const zuordnungen: Bezugsperson[] = umfeld.zuordnungen.filter(
			(z) => sichten.has(z.erwachsenerId) && sichten.has(z.jungfischerId),
		);
		const betrachterSicht = alsSicht(betrachter);

		const hinweiseFuer = (p: Person): Warnhinweis[] => {
			const a = angaben.get(p.id);
			const aktiv: Zuordnung[] = zuordnungen;
			const einladungOffen = a?.einladung && a.einladung.ablauf > jetztWert ? a.einladung : null;
			return warnhinweise(
				{
					person: p,
					zuordnungen: aktiv,
					hatGueltigeEinwilligung:
						p.art === 'JUNGFISCHER' && hatGueltigeEinwilligung(p, a?.einwilligungen ?? [], sichten, aktiv, jetztWert),
					offeneEinladungAblauf: einladungOffen?.ablauf ?? null,
					einladungsmailGescheitert: !!einladungOffen && !!a?.mailGescheitert,
					volljaehrigGeprueftAm: p.volljaehrigGeprueftAm,
				},
				jetztWert,
			);
		};
		const einsichtFuer = (p: Person) => einsichtIn(betrachterSicht, p, zuordnungen, sichten);
		return { personen, zuordnungen, angaben, sichten, hinweiseFuer, einsichtFuer, jetztWert };
	}

	/**
	 * Nur Verwaltung (MITGLIEDER); wer das Recht nicht hat, bekommt 404 wie bei etwas, das
	 * es nicht gibt (Rahmen-Spec 8). true = abgewiesen.
	 */
	function nurVerwaltung(res: Response): boolean {
		if (hatRecht(mitgliedKontext(res).person, 'MITGLIEDER')) return false;
		statt404(res);
		return true;
	}

	function antworteAbbruch(res: Response, error: unknown): void {
		if (error instanceof Abbruch) {
			res.status(error.status).json(error.antwort);
			return;
		}
		if (istEindeutigVerletzt(error)) {
			res.status(409).json(EMAIL_VERGEBEN);
			return;
		}
		throw error;
	}

	// Rechte setzt keiner dieser Wege: der Body wird Feld fuer Feld gelesen, nicht
	// durchgereicht, ein "rechte" darin wird also nie gelesen. Rechte vergibt allein die
	// eigene Route dafuer (JUGENDLEITER_RECHTE, Spec 5.4). Verworfen: rechte im Body mit
	// 400 abzulehnen -- ein Formular, das mehr schickt, soll nicht scheitern, aber auch
	// nichts bewirken.
	router.post(
		'/personen',
		brauchtMitglied,
		asynchron(async (req, res) => {
			if (nurVerwaltung(res)) return;
			const { verein, db } = vereinsKontext(res);
			const { person: handelnder } = mitgliedKontext(res);
			const body = (req.body ?? {}) as Record<string, unknown>;
			try {
				const art = body['art'];
				if (art !== 'ERWACHSENER' && art !== 'JUNGFISCHER')
					throw ungueltig('Bitte Jungfischer oder Erwachsene wählen', 'art');
				const vorname = liesName(body['vorname'], 'vorname');
				const nachname = liesName(body['nachname'], 'nachname');
				const hatDatum =
					body['geburtsdatum'] !== undefined && body['geburtsdatum'] !== null && body['geburtsdatum'] !== '';
				if (art === 'ERWACHSENER' && hatDatum) {
					throw ungueltig('Erwachsene haben kein Geburtsdatum', 'geburtsdatum');
				}
				const geburtsdatum = art === 'JUNGFISCHER' ? liesDatum(body['geburtsdatum'], jetzt()) : null;
				const email = liesEmail(body['email']);

				const roheIds: unknown = body['untergruppenIds'] ?? [];
				if (!Array.isArray(roheIds) || roheIds.some((i) => typeof i !== 'string')) {
					throw ungueltig('Untergruppen ungültig', 'untergruppenIds');
				}
				const untergruppenIds = [...new Set(roheIds as string[])];
				if (art === 'ERWACHSENER' && untergruppenIds.length > 0) {
					throw ungueltig('Nur Jungfischer gehören zu Untergruppen', 'untergruppenIds');
				}
				if (untergruppenIds.length > 0) {
					// Ueber vereinDb gezaehlt: eine Untergruppe eines anderen Vereins findet sich nicht.
					const vorhanden = await db.untergruppe.count({ where: { id: { in: untergruppenIds } } });
					if (vorhanden !== untergruppenIds.length)
						throw ungueltig('Eine Untergruppe gibt es nicht', 'untergruppenIds');
				}

				// Nur ein Hinweis, keine Sperre (Spec 5.3): es kann wirklich zwei gleichnamige Kinder
				// mit demselben Geburtstag geben, darum laesst trotzdem die Anlage zu. Die Pruefung
				// ist nicht gesperrt; zwei gleichzeitige Anlagen duerfen beide durch, es ist ein Rat.
				if (body['trotzdem'] !== true) {
					const kandidaten = await db.person.findMany({
						where: { entferntAm: null },
						select: { id: true, vorname: true, nachname: true, geburtsdatum: true },
					});
					const treffer = kandidaten.find((k) => istDoppelt(k, { vorname, nachname, geburtsdatum }));
					if (treffer) {
						throw new Abbruch(409, {
							fehler: 'Diese Person gibt es vielleicht schon',
							code: 'DOPPELT',
							person: { id: treffer.id, vorname: treffer.vorname, nachname: treffer.nachname },
						});
					}
				}

				// Ohne Vereinssperre: angenommen oder nicht entscheidet hier allein der Unique-Index, und
				// die Sperre liesse die zweite Anfrage nur warten, nicht anders ausgehen.
				//
				// Die ID steht vorab fest, damit die Aenderung die erste schreibende Anweisung ist: Was vor
				// der Zeile des Vereins geschrieben wird, kann mit einer Transaktion verklemmen, die sie
				// schon haelt (mitAenderung). Verworfen: die Aenderung nach dem Anlegen -- dann kennt sie
				// die ID von selbst, steht aber hinter dem Schreiben der Person.
				const id = randomUUID();
				const vermerk = await db.$transaction(async (tx) => {
					const vermerk = await vermerkeUmfeld(tx, verein.id, handelnder.id, jetzt(), [id]);
					await tx.person.create({
						data: { id, art, vorname, nachname, geburtsdatum, email },
						select: { id: true },
					});
					if (untergruppenIds.length > 0) {
						await tx.untergruppeMitglied.createMany({
							data: untergruppenIds.map((untergruppeId) => ({ untergruppeId, personId: id })),
						});
					}
					return vermerk;
				});
				meldeUmfeld(bus, verein.id, vermerk);
				res.status(201).json({ id });
			} catch (error) {
				antworteAbbruch(res, error);
			}
		}),
	);

	router.patch(
		'/personen/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			if (nurVerwaltung(res)) return;
			const { verein, db } = vereinsKontext(res);
			const { person: handelnder } = mitgliedKontext(res);
			const id = req.params['id'] ?? '';
			const body = (req.body ?? {}) as Record<string, unknown>;
			try {
				const vermerk = await db.$transaction(async (tx) => {
					// Die Entscheidung "darf ich diese Person aendern" liest Rechte und Art; die Sperre
					// haelt eine gleichzeitige Rechtevergabe an, bis hier fertig ist.
					await sperreVereinszeile(tx, verein.id);
					const ziel = await tx.person.findFirst({ where: { id, entferntAm: null } });
					// Erwachsene mit Rechten aendert nur, wer Rechte verwalten darf (Spec 5.4). 404 statt
					// 403: sonst verriete die Antwort, wer im Verein Jugendleiter ist.
					if (!ziel || (istJugendleiter(ziel) && !hatRecht(handelnder, 'JUGENDLEITER_RECHTE'))) {
						throw new Abbruch(404, NICHT_GEFUNDEN);
					}
					const aenderung: {
						vorname?: string;
						nachname?: string;
						geburtsdatum?: Date;
						volljaehrigGeprueftAm?: null;
						email?: string | null;
						jugendsprecher?: boolean;
					} = {};
					if ('vorname' in body) aenderung.vorname = liesName(body['vorname'], 'vorname');
					if ('nachname' in body) aenderung.nachname = liesName(body['nachname'], 'nachname');
					if ('geburtsdatum' in body) {
						if (ziel.art !== 'JUNGFISCHER') throw ungueltig('Erwachsene haben kein Geburtsdatum', 'geburtsdatum');
						aenderung.geburtsdatum = liesDatum(body['geburtsdatum'], jetzt());
					}
					if ('email' in body) {
						aenderung.email = liesEmail(body['email']);
						// Die Adresse Erwachsener ist ihre Kennung und das Ziel von "Passwort vergessen". Wer sie
						// still aendert, koennte per Reset-Link ein Elternteil uebernehmen, darum gilt sie mit
						// Zugang als fest. Verworfen: aendern erlauben und dafuer Sitzungen und Passkeys loeschen
						// sowie die alte Adresse benachrichtigen -- groesserer Umfang, kommt mit echtem Mailversand
						// in Etappe 6. Ohne Zugang (Tippfehler vor der Einladung) und bei Jungfischern (dort nur
						// Benachrichtigung) bleibt sie aenderbar.
						if (
							ziel.art === 'ERWACHSENER' &&
							aenderung.email !== ziel.email &&
							(await tx.zugang.count({ where: { personId: ziel.id } })) > 0
						) {
							throw new Abbruch(409, EMAIL_MIT_ZUGANG);
						}
					}
					if ('jugendsprecher' in body) {
						if (typeof body['jugendsprecher'] !== 'boolean') throw ungueltig('Ja oder nein erwartet', 'jugendsprecher');
						if (ziel.art !== 'JUNGFISCHER')
							throw ungueltig('Nur Jungfischer können Jugendsprecher sein', 'jugendsprecher');
						aenderung.jugendsprecher = body['jugendsprecher'];
					}
					const datumGeaendert =
						aenderung.geburtsdatum !== undefined && aenderung.geburtsdatum.getTime() !== ziel.geburtsdatum?.getTime();
					// Ein neues Datum macht die Quittung "Belassen" hinfaellig: sie galt dem alten Datum, und ohne
					// Zuruecksetzen erschiene der Hinweis "Volljaehrig seit" nie wieder.
					if (datumGeaendert) aenderung.volljaehrigGeprueftAm = null;
					// Ein Body ohne Aenderung schreibt nichts und meldet darum auch nichts.
					if (Object.keys(aenderung).length === 0) return undefined;
					const vermerk = await vermerkeUmfeld(tx, verein.id, handelnder.id, jetzt(), [ziel.id]);
					await tx.person.update({ where: { id: ziel.id }, data: aenderung });
					// Ein falsches Geburtsjahr kann ein Kind volljaehrig gemacht haben; die Korrektur macht es
					// wieder minderjaehrig, und dann zaehlt die Einwilligung. Fehlt sie, verliert es den Zugang.
					if (datumGeaendert && aenderung.geburtsdatum) {
						await entzieheZugangWennUngueltig(tx, { ...ziel, geburtsdatum: aenderung.geburtsdatum }, jetzt());
					}
					return vermerk;
				});
				if (vermerk) meldeUmfeld(bus, verein.id, vermerk);
				res.json({ ok: true });
			} catch (error) {
				antworteAbbruch(res, error);
			}
		}),
	);

	router.post(
		'/personen/:id/volljaehrig-belassen',
		brauchtMitglied,
		asynchron(async (req, res) => {
			if (nurVerwaltung(res)) return;
			const { verein, db } = vereinsKontext(res);
			const { person: handelnder } = mitgliedKontext(res);
			const id = req.params['id'] ?? '';
			const zeit = jetzt();
			try {
				const vermerk = await db.$transaction(async (tx) => {
					await sperreVereinszeile(tx, verein.id);
					const ziel = await tx.person.findFirst({ where: { id, entferntAm: null, art: 'JUNGFISCHER' } });
					if (!ziel) throw new Abbruch(404, NICHT_GEFUNDEN);
					if (!istVolljaehrig(ziel, zeit)) {
						throw new Abbruch(409, { fehler: 'Das Kind ist noch nicht volljährig', code: 'NOCH_MINDERJAEHRIG' });
					}
					// Ein zweites "Belassen" behaelt den ersten Zeitpunkt: er belegt, wann die Verwaltung hingesehen hat.
					// Es aendert nichts und meldet darum auch nichts.
					if (ziel.volljaehrigGeprueftAm) return undefined;
					const vermerk = await vermerkeUmfeld(tx, verein.id, handelnder.id, zeit, [ziel.id]);
					await tx.person.update({ where: { id: ziel.id }, data: { volljaehrigGeprueftAm: zeit } });
					return vermerk;
				});
				if (vermerk) meldeUmfeld(bus, verein.id, vermerk);
				res.json({ ok: true });
			} catch (error) {
				antworteAbbruch(res, error);
			}
		}),
	);

	router.delete(
		'/personen/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			if (nurVerwaltung(res)) return;
			const { person: handelnder } = mitgliedKontext(res);
			const { verein, db } = vereinsKontext(res);
			const zielId = req.params['id'] ?? '';
			const zeit = jetzt();
			try {
				const { folgeangebot, vermerk } = await db.$transaction(async (tx) => {
					// Angenommen oder nicht haengt an Rechten, Entfernt-Stand und der Leitung; dazu gehoert auch
					// eine Einloesung der Einladung dieser Person, die entweder vorher fertig ist oder an der
					// Sperre wartet und dann ein 404 sieht.
					await sperreVereinszeile(tx, verein.id);
					// Erst jetzt gelesen, auch der Handelnde (wie in rechte.ts): hat eine andere Anfrage ihm
					// MITGLIEDER entzogen oder ihn entfernt, waere sein Stand aus der Sitzung veraltet, und
					// sein Entfernen hebelte den Entzug aus.
					const erwachsene = await tx.person.findMany({ where: { art: 'ERWACHSENER', entferntAm: null } });
					const ich = erwachsene.find((p) => p.id === handelnder.id);
					if (!ich || !hatRecht(ich, 'MITGLIEDER')) throw new Abbruch(404, NICHT_GEFUNDEN);
					// Vor allen Rechtepruefungen: die eigene Person zu nennen verraet nichts.
					if (zielId === ich.id) {
						throw new Abbruch(409, {
							fehler: 'Du kannst dich nicht selbst entfernen',
							code: 'SELBST',
						});
					}
					const ziel = await tx.person.findFirst({ where: { id: zielId, entferntAm: null } });
					// 404 statt 403 bei Personen mit Rechten, sonst verriete die Antwort, wer Jugendleiter ist.
					if (!ziel || (istJugendleiter(ziel) && !hatRecht(ich, 'JUGENDLEITER_RECHTE'))) {
						throw new Abbruch(404, NICHT_GEFUNDEN);
					}
					// Nur wer selbst Leitung ist, kann sie verlieren: ein Verein, der schon ohne Leitung dasteht
					// (Notfall-Link ausstehend), soll Jungfischer trotzdem entfernen koennen. Ueber die Routen
					// ist der Fall sonst kaum erreichbar (wer ein Leitungsrecht entfernt, hat es selbst und ist
					// nicht das Ziel); bleibt als Netz, falls sich die Rechte-Regeln aendern.
					if (
						hatRecht(ziel, 'JUGENDLEITER_RECHTE') &&
						wuerdeLetzteLeitungVerlieren(erwachsene.map(alsSicht), ziel.id, [])
					) {
						throw new Abbruch(409, {
							fehler: 'Der Verein braucht mindestens eine Person mit Recht zum Vergeben von Rechten',
							code: 'LETZTE_LEITUNG',
						});
					}

					const vermerk = await vermerkeUmfeld(tx, verein.id, ich.id, zeit, [ziel.id]);
					// Vor dem Entfernen merken, wer zum Kind gehoerte: danach sind die Zuordnungen weg.
					const bisherige =
						ziel.art === 'JUNGFISCHER'
							? (await tx.bezugsperson.findMany({ where: { jungfischerId: ziel.id } })).map((z) => z.erwachsenerId)
							: [];
					await entferne(tx, ziel.id, zeit);

					// Erwachsene ohne Kind und ohne Rechte brauchen die Verwaltung nicht mehr (Spec 5.8). Nur
					// ein Angebot: ob sie gehen, entscheidet die Verwaltung. Verworfen: sie gleich mitzuentfernen
					// -- ein Grossvater, der spaeter ein anderes Enkelkind bekommt, waere dann weg.
					if (bisherige.length === 0) return { folgeangebot: [], vermerk };
					const [kandidaten, weiterhin] = await Promise.all([
						tx.person.findMany({
							where: { id: { in: bisherige }, entferntAm: null },
							orderBy: [{ nachname: 'asc' }, { vorname: 'asc' }, { id: 'asc' }],
						}),
						// Ein entferntes Kind zaehlt nicht, auch falls eine alte Zuordnung auf seinen Grabstein blieb.
						tx.bezugsperson.findMany({
							where: { erwachsenerId: { in: bisherige }, jungfischer: { entferntAm: null } },
						}),
					]);
					const mitKind = new Set(weiterhin.map((z) => z.erwachsenerId));
					const folgeangebot = kandidaten
						.filter((e) => !istJugendleiter(e) && !mitKind.has(e.id))
						.map((e) => ({ id: e.id, vorname: e.vorname, nachname: e.nachname }));
					return { folgeangebot, vermerk };
				});
				meldeUmfeld(bus, verein.id, vermerk);
				res.json({ folgeangebot });
			} catch (error) {
				antworteAbbruch(res, error);
			}
		}),
	);

	router.get(
		'/personen',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { db } = vereinsKontext(res);
			const { person: betrachter } = mitgliedKontext(res);
			const u = await laden(db, betrachter);
			const liste: PersonListe[] = [];
			for (const p of u.personen) {
				const einsicht = u.einsichtFuer(p);
				if (!einsicht) continue;
				liste.push(baueListe(betrachter, p, einsicht, u.angaben.get(p.id), u.hinweiseFuer(p)));
			}
			res.json({ personen: liste });
		}),
	);

	router.get(
		'/personen/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { db } = vereinsKontext(res);
			const { person: betrachter } = mitgliedKontext(res);
			const id = req.params['id'] ?? '';
			const u = await laden(db, betrachter, id);
			const p = u.personen.find((x) => x.id === id);
			const einsicht = p ? u.einsichtFuer(p) : null;
			if (!p || !einsicht) {
				statt404(res);
				return;
			}
			const a = u.angaben.get(p.id);
			const antwort: PersonListe & {
				familie?: ReturnType<typeof familieVon>;
				einladung?: { offen: boolean; ablauf: string | null; mailNichtZugestellt: boolean } | null;
				zugang?: { vorhanden: boolean; letzteAnmeldungAm: string | null; erlaubt: boolean } | null;
			} = baueListe(betrachter, p, einsicht, a, u.hinweiseFuer(p));

			if (einsicht !== 'NAME') {
				antwort.familie = familieVon(p, u.zuordnungen, u.sichten, (x) => !!u.einsichtFuer(x));
			}
			if (hatRecht(betrachter, 'MITGLIEDER')) {
				const einladung = a?.einladung ?? null;
				const offen = !!einladung && einladung.ablauf > u.jetztWert;
				antwort.einladung = {
					offen,
					ablauf: einladung ? einladung.ablauf.toISOString() : null,
					mailNichtZugestellt: offen && !!a?.mailGescheitert,
				};
				const zugang = await db.zugang.findFirst({ where: { personId: p.id }, select: { letzteAnmeldungAm: true } });
				antwort.zugang = {
					vorhanden: !!zugang,
					letzteAnmeldungAm: zugang?.letzteAnmeldungAm ? zugang.letzteAnmeldungAm.toISOString() : null,
					erlaubt: p.zugangErlaubt,
				};
			}
			res.json(antwort);
		}),
	);
}

/**
 * Fuer ein Kind seine Erwachsenen, fuer einen Erwachsenen seine Kinder; vorname und
 * nachname sind immer die der Gegenseite. Entfernte fehlen (nicht in sichten) und
 * wer dem Betrachter nicht sichtbar ist ebenso, damit die Familie keine Namen
 * verraet, die die Liste verschweigt.
 */
function familieVon(
	p: Person,
	zuordnungen: readonly Bezugsperson[],
	sichten: ReadonlyMap<string, Person>,
	sichtbar: (gegenueber: Person) => boolean,
) {
	const eintraege = [];
	for (const z of zuordnungen) {
		const eigene = p.art === 'JUNGFISCHER' ? z.jungfischerId === p.id : z.erwachsenerId === p.id;
		if (!eigene) continue;
		const gegenueberId = p.art === 'JUNGFISCHER' ? z.erwachsenerId : z.jungfischerId;
		const gegenueber = sichten.get(gegenueberId);
		if (!gegenueber || !sichtbar(gegenueber)) continue;
		eintraege.push({
			erwachsenerId: z.erwachsenerId,
			jungfischerId: z.jungfischerId,
			vorname: gegenueber.vorname,
			nachname: gegenueber.nachname,
			beziehung: z.beziehung,
			beziehungFreitext: z.beziehungFreitext,
			erziehungsberechtigt: z.erziehungsberechtigt,
		});
	}
	return eintraege;
}
