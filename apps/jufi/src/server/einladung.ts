import { generateLinkToken, hashToken } from '@jufi/auth';
import type { EinladungArt, Prisma } from '@jufi/db';
import { einladungsAblauf } from '@jufi/domain';

/**
 * Legt einen Einladungs- oder Reset-Link an und liefert das Token. Gespeichert
 * wird nur der Hash; das Token sieht nur, wer den Link weitergibt.
 *
 * Nimmt einen Transaktions-Client und keinen PrismaClient: Wer einlaedt, tut es
 * immer zusammen mit etwas anderem (Verein anlegen, Protokoll), und beides soll
 * gemeinsam gelingen oder scheitern.
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
export async function erzeugeEinladung(
	tx: Prisma.TransactionClient,
	e: { vereinId: string; personId: string; art: EinladungArt; erstelltVonPersonId: string | null; jetzt: Date },
): Promise<string> {
	await tx.einladung.deleteMany({
		where: { vereinId: e.vereinId, personId: e.personId, art: e.art, eingeloestAm: null },
	});
	const token = generateLinkToken();
	await tx.einladung.create({
		data: {
			vereinId: e.vereinId,
			personId: e.personId,
			art: e.art,
			tokenHash: hashToken(token),
			ablauf: einladungsAblauf(e.art, e.jetzt),
			erstelltVonPersonId: e.erstelltVonPersonId,
			angelegtAm: e.jetzt,
		},
	});
	return token;
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
