import type { Bezugsperson, Person, VereinDb } from '@jufi/db';
import {
	einsichtIn,
	hatGueltigeEinwilligung,
	hatRecht,
	warnhinweise,
	type Einsicht,
	type PersonSicht,
	type Warnhinweis,
	type Zuordnung,
} from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { MAIL_MAX_VERSUCHE } from '../mail/arbeiter.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';
import { alsSicht, ladeUmfeld, statt404 } from './verwaltung.js';

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

export function personenRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt } = deps;

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
