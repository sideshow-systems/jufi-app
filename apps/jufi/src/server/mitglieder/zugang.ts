import { sperreVereinszeile, type EinladungArt, type Person, type VereinDb } from '@jufi/db';
import { darfEinladen, einladungsAblauf, hatGueltigeEinwilligung, hatRecht, istVolljaehrig } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { einladungsLink, erzeugeVereinsEinladung } from '../einladung.js';
import { mitgliedMail } from '../mail/texte.js';
import { legeMailAn } from '../mail/warteschlange.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';
import { alsSicht, statt404 } from './verwaltung.js';

/** Der Transaktions-Client, den db.$transaction der Vereins-Routen reicht. */
export type Transaktion = Parameters<Parameters<VereinDb['$transaction']>[0]>[0];

/**
 * Nimmt einem Kind den Zugang (Spec 4.6): zugangErlaubt false, der Zugang samt Passkeys,
 * Sitzungen und Wiederherstellungscodes weg (Kaskade in der Datenbank), offene Einladungen
 * (auch Zuruecksetzen-Links) ungueltig. Verworfen: den Zugang stehen zu lassen und nur
 * zugangErlaubt zu setzen -- die Sitzungs-Pruefung wuerde ihn zwar abweisen, aber ein
 * erneutes Erlauben liesse alte Passkeys und Sitzungen ohne neue Einladung wieder gelten.
 *
 * Idempotent; die Aufrufer halten die Vereinssperre.
 */
export async function entzieheZugang(tx: Transaktion, kindId: string): Promise<void> {
	await tx.person.update({ where: { id: kindId }, data: { zugangErlaubt: false } });
	await tx.zugang.deleteMany({ where: { personId: kindId } });
	await loescheEinladungen(tx, { personId: kindId, eingeloestAm: null });
}

/**
 * Loescht Einladungen samt ihrer noch nicht gesendeten Mails. Ohne das ginge ein Link
 * hinaus, dessen Einladung es nicht mehr gibt, und der Mailarbeiter versuchte ihn bis zur
 * Hoechstzahl der Versuche. Bezug heisst "einladung:<id>" bzw. "reset:<id>"; gesendete Mails
 * bleiben (Nachweis, und der Arbeiter raeumt sie selbst auf).
 */
async function loescheEinladungen(
	tx: Transaktion,
	where: { personId: string; eingeloestAm?: null; art?: EinladungArt },
): Promise<void> {
	const einladungen = await tx.einladung.findMany({ where, select: { id: true } });
	if (einladungen.length === 0) return;
	const bezuege = einladungen.flatMap((e) => [`einladung:${e.id}`, `reset:${e.id}`]);
	await tx.mailWarteschlange.deleteMany({ where: { bezug: { in: bezuege }, gesendetAm: null } });
	await tx.einladung.deleteMany({ where: { id: { in: einladungen.map((e) => e.id) } } });
}

/**
 * Haken fuer Wege, die einem Kind die Einwilligung nehmen koennen -- Familie loesen
 * (DELETE) und der Wechsel auf "nicht erziehungsberechtigt" (PUT) in familie.ts sowie das
 * Entfernen eines Erwachsenen in entferne: hat das Kind danach keine gueltige Einwilligung
 * mehr, verliert sein Zugang die Gueltigkeit.
 *
 * Alles wird hier frisch gelesen (Einwilligungen, Erteiler, Zuordnungen), nie aus dem
 * Aufrufer uebernommen: der Haken laeuft nach dem Schreiben und muss den Stand danach
 * sehen. Verworfen: die Gueltigkeit beim Schreiben im Aufrufer vorauszurechnen -- die
 * Regel stuende dann an jeder Aufrufstelle noch einmal.
 */
export async function entzieheZugangWennUngueltig(tx: Transaktion, kind: Person, jetzt: Date): Promise<void> {
	if (!(await hatEinwilligung(tx, kind, jetzt))) await entzieheZugang(tx, kind.id);
}

/**
 * Ob das Kind heute die Einwilligung hat, die sein Zugang braucht. Die Einwilligung nach
 * Art. 8 DSGVO braucht nur das minderjaehrige Kind (Spec 5.6); ein volljaehriges willigt
 * selbst ein, und "Familie loesen" ist fuer es ausdruecklich erlaubt. Dagegen hat ein
 * minderjaehriges Kind, das nie eine Einwilligung hatte, keine: im Zweifel die sichere Seite.
 *
 * Gemeinsam fuer den Entzug (oben) und das Einladen: beide fragen dasselbe und sollen nicht
 * auseinanderlaufen.
 */
export async function hatEinwilligung(tx: Transaktion, kind: Person, jetzt: Date): Promise<boolean> {
	if (istVolljaehrig(kind, jetzt)) return true;
	const [einwilligungen, zuordnungen] = await Promise.all([
		tx.einwilligung.findMany({ where: { jungfischerId: kind.id } }),
		tx.bezugsperson.findMany({ where: { jungfischerId: kind.id } }),
	]);
	// Entfernte Erteiler bleiben in der Map: darfEinwilligen weist sie selbst ab, und ein
	// fehlender Eintrag liefe auf dasselbe hinaus, nur schwerer lesbar.
	const erteilerIds = [...new Set(einwilligungen.map((w) => w.erteiltVon))];
	const erteiler = new Map<string, Person>(
		(await tx.person.findMany({ where: { id: { in: erteilerIds } } })).map((p) => [p.id, p]),
	);
	return hatGueltigeEinwilligung(kind, einwilligungen, erteiler, zuordnungen, jetzt);
}

/**
 * Entfernt eine Person als Grabstein (Spec 5.8, Entscheidung 3): die Zeile bleibt, damit
 * Einwilligungen als Nachweis und spaetere Antworten auf sie verweisen koennen, alles
 * Personenbezogene geht. Die E-Mail wird frei (sie gehoert niemandem mehr und blockierte
 * sonst den Unique-Index); Einwilligungen bleiben ausdruecklich stehen.
 *
 * Verknuepfungen fallen in beiden Richtungen: ein Grabstein hat weder Familie noch
 * Untergruppen. Kinder eines entfernten Erwachsenen verlieren dadurch womoeglich ihre
 * einzige gueltige Einwilligung; sie werden danach geprueft.
 *
 * Aufrufer: DELETE /personen/:id, unter sperreVereinszeile und mit geprueften Rechten.
 */
export async function entferne(tx: Transaktion, personId: string, jetzt: Date): Promise<void> {
	// Vor dem Loesen der Zuordnungen merken, welche Kinder betroffen sind.
	const alsErwachsener = await tx.bezugsperson.findMany({ where: { erwachsenerId: personId } });
	await tx.person.update({
		where: { id: personId },
		data: {
			vorname: '',
			nachname: '',
			geburtsdatum: null,
			email: null,
			rechte: [],
			jugendsprecher: false,
			entferntAm: jetzt,
		},
	});
	await tx.zugang.deleteMany({ where: { personId } });
	await loescheEinladungen(tx, { personId });
	await tx.bezugsperson.deleteMany({ where: { OR: [{ erwachsenerId: personId }, { jungfischerId: personId }] } });
	await tx.untergruppeMitglied.deleteMany({ where: { personId } });

	const kinder = await tx.person.findMany({
		where: { id: { in: alsErwachsener.map((z) => z.jungfischerId) }, entferntAm: null },
	});
	for (const kind of kinder) await entzieheZugangWennUngueltig(tx, kind, jetzt);
}

/** Ende einer Entscheidung unter der Sperre; innerhalb der Transaktion geworfen, damit nichts halb bleibt. */
export class Abbruch extends Error {
	constructor(
		readonly status: number,
		readonly antwort: object,
	) {
		super('Einladen abgebrochen');
	}
}

export const ZUGANG_NICHT_ERLAUBT = {
	fehler: 'Für dieses Kind ist der Zugang nicht erlaubt. Die Familie muss ihn erst erlauben.',
	code: 'ZUGANG_NICHT_ERLAUBT',
};
export const EINWILLIGUNG_FEHLT = {
	fehler: 'Die Einwilligung einer erziehungsberechtigten Person fehlt noch',
	code: 'EINWILLIGUNG_FEHLT',
};

interface EinladungsAuftrag {
	ich: Person;
	ziel: Person & { zugang: { id: string } | null };
	stand: { slug: string; anzeigename: string };
	mail: boolean;
	zeit: Date;
	basisUrl: string;
}

/**
 * Einladen eines Kindes mit seinen Voraussetzungen (Zugang erlaubt, Einwilligung gueltig),
 * gemeinsam fuer die Verwaltung (POST /personen/:id/einladung) und die Familie
 * (POST /meine-jungfischer/:kindId/einladung). Nur die Berechtigung unterscheidet die Wege
 * und bleibt darum bei der Route. Verworfen: die Voraussetzungen je Route zu wiederholen --
 * ein Weg liesse sie beim naechsten Umbau leicht aus.
 *
 * Der Aufrufer haelt die Vereinssperre und hat alles frisch gelesen.
 */
export async function erzeugeEinladungFuerKind(tx: Transaktion, a: EinladungsAuftrag) {
	if (!a.ziel.zugangErlaubt) throw new Abbruch(409, ZUGANG_NICHT_ERLAUBT);
	if (!(await hatEinwilligung(tx, a.ziel, a.zeit))) throw new Abbruch(409, EINWILLIGUNG_FEHLT);
	return legeEinladungAn(tx, a);
}

async function legeEinladungAn(tx: Transaktion, a: EinladungsAuftrag) {
	const { ich, ziel, stand, zeit } = a;
	if (a.mail && !ziel.email) {
		throw new Abbruch(400, { fehler: 'Für diese Person ist keine E-Mail-Adresse hinterlegt', feld: 'mail' });
	}
	const art: EinladungArt = ziel.zugang ? 'RESET' : 'EINLADUNG';
	// Die ungesendeten Mails der ersetzten Einladung gehen mit: sonst ginge noch ein Link
	// hinaus, den es nicht mehr gibt. erzeugeVereinsEinladung loescht nur die Einladung.
	await loescheEinladungen(tx, { personId: ziel.id, eingeloestAm: null, art });
	const { id, token } = await erzeugeVereinsEinladung(tx, {
		personId: ziel.id,
		art,
		erstelltVonPersonId: ich.id,
		jetzt: zeit,
	});
	const link = einladungsLink(a.basisUrl, stand.slug, token);
	const mail = mitgliedMail({ vorname: ziel.vorname, anzeigename: stand.anzeigename, link, art });
	if (a.mail && ziel.email) {
		await legeMailAn(tx, { empfaenger: ziel.email, ...mail, bezug: `einladung:${id}`, jetzt: zeit });
	}
	return { link, text: mail.text, ablauf: einladungsAblauf(art, zeit).toISOString() };
}

/**
 * Einladen und Zugangslink aus der Verwaltung (Spec 4.1). Die Art folgt dem Zugang der Person:
 * ohne Zugang eine Einladung, mit Zugang ein Reset -- derselbe Knopf, damit die Verwaltung nicht
 * wissen muss, wo die Person steht. Das Token geht nur in der Antwort (und in der Mail) hinaus.
 *
 * Alles unter sperreVereinszeile, Handelnder und Ziel frisch gelesen: ob die Einladung
 * angenommen wird, haengt an Rechten, Familie und Einwilligung, und jedes davon kann eine
 * gleichzeitige Anfrage aendern (wie in rechte.ts).
 */
export function einladenRouten(router: Router, deps: Pick<VolleAppDeps, 'jetzt' | 'umgebung'>): void {
	const { jetzt, umgebung } = deps;

	router.post(
		'/personen/:id/einladung',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			const { verein, db } = vereinsKontext(res);
			const zielId = req.params['id'] ?? '';
			const mailRoh = ((req.body ?? {}) as Record<string, unknown>)['mail'];
			const zeit = jetzt();
			try {
				const ergebnis = await db.$transaction(async (tx) => {
					await sperreVereinszeile(tx, verein.id);
					// Erneut gelesen: der Slug steht im Link, und der Admin kann ihn zwischen vereinAusSlug
					// und der Sperre korrigiert oder den Verein gesperrt haben.
					const stand = await tx.verein.findFirst({ select: { slug: true, anzeigename: true, status: true } });
					const ich = await tx.person.findFirst({ where: { id: handelnder.id, entferntAm: null } });
					const ziel = await tx.person.findFirst({
						where: { id: zielId, entferntAm: null },
						include: { zugang: { select: { id: true } } },
					});
					const zuordnungen = ziel ? await tx.bezugsperson.findMany({ where: { jungfischerId: ziel.id } }) : [];
					// Eine Antwort fuer alles, was die Person nicht sehen oder einladen darf (404, Rahmen-Spec 8).
					if (
						!stand ||
						stand.status !== 'AKTIV' ||
						!ich ||
						!ziel ||
						!darfEinladen(alsSicht(ich), alsSicht(ziel), zuordnungen, zeit)
					) {
						throw new Abbruch(404, { fehler: 'nicht gefunden' });
					}
					if (mailRoh !== undefined && typeof mailRoh !== 'boolean') {
						throw new Abbruch(400, { fehler: 'mail erwartet ja oder nein', feld: 'mail' });
					}
					const auftrag = { ich, ziel, stand, mail: mailRoh === true, zeit, basisUrl: umgebung.basisUrl };
					return ziel.art === 'JUNGFISCHER'
						? await erzeugeEinladungFuerKind(tx, auftrag)
						: await legeEinladungAn(tx, auftrag);
				});
				res.status(201).json(ergebnis);
			} catch (error) {
				if (error instanceof Abbruch) return void res.status(error.status).json(error.antwort);
				throw error;
			}
		}),
	);
}

/**
 * Route der Verwaltung zum Erlauben und Entziehen des Zugangs eines Kindes (Spec 4.6).
 * Entziehen darf immer; Erlauben setzt nur das Kennzeichen -- der Zugang selbst entsteht erst
 * wieder ueber eine neue Einladung. Verworfen: Erlauben ohne Einwilligungspruefung, weil die
 * Verwaltung dann Art. 8 aushebeln koennte.
 */
export function zugangRouten(router: Router, deps: Pick<VolleAppDeps, 'jetzt'>): void {
	router.post(
		'/personen/:id/zugang',
		brauchtMitglied,
		asynchron(async (req, res) => {
			if (!hatRecht(mitgliedKontext(res).person, 'MITGLIEDER')) return statt404(res);
			const erlaubt = ((req.body ?? {}) as Record<string, unknown>)['erlaubt'];
			if (typeof erlaubt !== 'boolean') {
				return void res.status(400).json({ fehler: 'Ja oder nein erwartet', feld: 'erlaubt' });
			}
			const { verein, db } = vereinsKontext(res);
			const { person: handelnder } = mitgliedKontext(res);
			const zielId = req.params['id'] ?? '';
			const jetzt = deps.jetzt();
			try {
				await db.$transaction(async (tx) => {
					await sperreVereinszeile(tx, verein.id);
					// Auch der Handelnde frisch: hat eine andere Anfrage ihm MITGLIEDER entzogen, gilt der
					// Sitzungsstand nicht mehr (wie in rechte.ts).
					const ich = await tx.person.findFirst({ where: { id: handelnder.id, art: 'ERWACHSENER', entferntAm: null } });
					const ziel = await tx.person.findFirst({ where: { id: zielId, art: 'JUNGFISCHER', entferntAm: null } });
					if (!ich || !hatRecht(ich, 'MITGLIEDER') || !ziel) throw new Abbruch(404, { fehler: 'nicht gefunden' });
					if (!erlaubt) {
						await entzieheZugang(tx, ziel.id);
						return;
					}
					if (!(await hatEinwilligung(tx, ziel, jetzt))) throw new Abbruch(409, EINWILLIGUNG_FEHLT);
					await tx.person.update({ where: { id: ziel.id }, data: { zugangErlaubt: true } });
				});
				res.json({ ok: true });
			} catch (error) {
				if (error instanceof Abbruch) return void res.status(error.status).json(error.antwort);
				throw error;
			}
		}),
	);
}
