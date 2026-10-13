import type { PrismaClient } from '@jufi/db';

/** Was die Rueckfrage vor dem Loeschen anzeigt; null, wenn es den Verein nicht gibt. */
export async function vereinZumLoeschen(
	prisma: PrismaClient,
	slug: string,
): Promise<{ anzeigename: string; personen: number } | null> {
	const verein = await prisma.verein.findUnique({
		where: { slug },
		select: { anzeigename: true, _count: { select: { personen: true } } },
	});
	return verein && { anzeigename: verein.anzeigename, personen: verein._count.personen };
}

/**
 * Loescht den Verein mit allen Daten, wenn die Bestaetigung genau der Slug ist.
 *
 * Verglichen wird nach trim(): Es faellt allein Whitespace weg (Leerzeichen, ein
 * uebriges \r aus einem Windows-Terminal), Gross-/Kleinschreibung zaehlt. Ein
 * Zeilenende soll die Bestaetigung nicht verhindern, ein anderer Wortlaut oder eine
 * andere Schreibweise sie aber nie ausloesen.
 *
 * Eine einzige deleteMany-Anweisung: Die Fremdschluessel loeschen Personen,
 * Zugaenge, Sitzungen usw. per Cascade, und Postgres macht das atomar. Das
 * AdminProtokoll hat bewusst keinen Fremdschluessel zum Verein und bleibt stehen
 * (Nachweispflicht des Auftragsverarbeiters, Spec 7.5). Verworfen: Protokolleintrag
 * fuer das Loeschen selbst -- es geschieht an der Kommandozeile, ohne angemeldeten
 * Admin, dem man es zuordnen koennte.
 */
export async function vereinLoeschen(
	prisma: PrismaClient,
	slug: string,
	bestaetigung: string,
): Promise<'geloescht' | 'abgebrochen'> {
	if (bestaetigung.trim() !== slug) return 'abgebrochen';
	const { count } = await prisma.verein.deleteMany({ where: { slug } });
	return count > 0 ? 'geloescht' : 'abgebrochen';
}
