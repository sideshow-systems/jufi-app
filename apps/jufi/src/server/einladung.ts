import { generateLinkToken, hashToken } from '@jufi/auth';
import type { EinladungArt, Prisma, VereinDb } from '@jufi/db';
import { einladungsAblauf } from '@jufi/domain';

interface NeueEinladungEingabe {
	personId: string;
	art: EinladungArt;
	erstelltVonPersonId: string | null;
	jetzt: Date;
}

/**
 * Was beide Wege schreiben, ohne den Verein: Den setzt beim Admin der Aufrufer,
 * bei vereinDb der Client selbst (der ihn im data ablehnt).
 */
function einladungsZeile(e: NeueEinladungEingabe, token: string) {
	return {
		personId: e.personId,
		art: e.art,
		tokenHash: hashToken(token),
		ablauf: einladungsAblauf(e.art, e.jetzt),
		erstelltVonPersonId: e.erstelltVonPersonId,
		angelegtAm: e.jetzt,
	};
}

/**
 * Legt einen Einladungs- oder Reset-Link an und liefert id und Token. Gespeichert
 * wird nur der Hash; das Token sieht nur, wer den Link weitergibt. Die id
 * braucht, wer eine Mail mit bezug einreiht.
 *
 * Nimmt einen Transaktions-Client und keinen PrismaClient: Wer einlaedt, tut es
 * immer zusammen mit etwas anderem (Verein anlegen, Protokoll, Mail), und beides
 * soll gemeinsam gelingen oder scheitern.
 *
 * Offene Links derselben Art fuer dieselbe Person verschwinden vorher (Spec 3.4):
 * Sonst gaelte ein Link, den man fuer verloren hielt und deshalb ersetzt hat,
 * weiter. Geloescht statt als ungueltig markiert, weil an einem nie eingeloesten
 * Link nichts zu belegen ist. Eingeloeste bleiben stehen, und die andere Art
 * auch: Ein Reset macht eine offene Einladung nicht ueberfluessig.
 *
 * angelegtAm kommt aus jetzt statt aus der Datenbankuhr, damit "die juengste
 * Einladung" (admin/daten.ts) mit der Uhr der App rechnet, auch im Test.
 */
export async function erzeugeEinladungMitId(
	tx: Prisma.TransactionClient,
	e: NeueEinladungEingabe & { vereinId: string },
): Promise<{ id: string; token: string }> {
	await tx.einladung.deleteMany({
		where: { vereinId: e.vereinId, personId: e.personId, art: e.art, eingeloestAm: null },
	});
	const token = generateLinkToken();
	const { id } = await tx.einladung.create({
		data: { vereinId: e.vereinId, ...einladungsZeile(e, token) },
		select: { id: true },
	});
	return { id, token };
}

/** Wie erzeugeEinladungMitId, nur das Token: fuer alle, die die Einladung nicht weiter verknuepfen. */
export async function erzeugeEinladung(
	tx: Prisma.TransactionClient,
	e: NeueEinladungEingabe & { vereinId: string },
): Promise<string> {
	return (await erzeugeEinladungMitId(tx, e)).token;
}

/**
 * Dasselbe fuer Vereinsrouten ("Passwort vergessen?"), ueber vereinDb. Eine
 * eigene Funktion, weil der schlichte Client vereinId im data verlangt und
 * vereinDb es ablehnt; ein gemeinsamer Parametertyp passte zu keinem der
 * beiden. Verworfen: den Reset mit dem schlichten PrismaClient schreiben --
 * dann haette eine Vereinsroute Zugriff ueber alle Vereine hinweg (CLAUDE.md).
 */
export async function erzeugeVereinsEinladung(
	db: Pick<VereinDb, 'einladung'>,
	e: NeueEinladungEingabe,
): Promise<{ id: string; token: string }> {
	await db.einladung.deleteMany({ where: { personId: e.personId, art: e.art, eingeloestAm: null } });
	const token = generateLinkToken();
	const { id } = await db.einladung.create({ data: einladungsZeile(e, token), select: { id: true } });
	return { id, token };
}

/**
 * Das Token steht hinter dem #: Der Browser schickt das Fragment nicht mit, also
 * landet es weder im Log des Proxys noch im Referer. Die Seite liest es selbst
 * und schickt es im Body.
 */
export function einladungsLink(basisUrl: string, slug: string, token: string): string {
	return `${basisUrl}/${slug}/einladung#${token}`;
}

/**
 * Fertiger Text zum Kopieren in einen Messenger (bis Etappe 3 der einzige Weg;
 * dann geht er per Mail). Die 14 Tage stehen als Text im Satz statt aus
 * EINLADUNG_GUELTIG_MS gerechnet, damit der Satz wortgleich bleibt; wer die
 * Dauer in libs/domain aendert, muss ihn mitziehen.
 */
export function leitungsEinladungsText(t: { vorname: string; anzeigename: string; link: string }): string {
	return (
		`Hallo ${t.vorname}, du bist als Leitung von „${t.anzeigename}“ in die JuFi App eingeladen. ` +
		`Richte hier deinen Zugang ein – der Link gilt 14 Tage und nur für dich:\n${t.link}`
	);
}

/**
 * Text fuer den Notfall-Link. Eigener Text statt leitungsEinladungsText, weil
 * derselbe Link bei vorhandenem Zugang die Zugangsdaten loescht (Spec 4.4): Wer
 * ihn bekommt, soll vorher lesen, warum er kommt und was das Einloesen bewirkt.
 * Die 14 Tage stehen wortgleich wie dort.
 */
export function notfallLinkText(t: { vorname: string; anzeigename: string; link: string }): string {
	return (
		`Hallo ${t.vorname}, für „${t.anzeigename}“ in der JuFi App gibt es einen neuen Zugangslink für dich. ` +
		`Altes Passwort, Passkeys und alle angemeldeten Geräte werden dabei gelöscht. ` +
		`Richte hier deinen Zugang neu ein – der Link gilt 14 Tage und nur für dich:\n${t.link}`
	);
}
