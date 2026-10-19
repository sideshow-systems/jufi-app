import type { PrismaClient, VereinStatus } from '@jufi/db';

/**
 * Legt einen erfundenen Verein an. Jede Testdatei nimmt eigene Slugs, weil alle
 * Dateien dieselbe Datenbank jufi_test_server teilen und parallel laufen.
 */
export function legeVereinAn(
	prisma: PrismaClient,
	daten: { slug: string; anzeigename?: string; farbe?: string; kontakt?: string; status?: VereinStatus },
) {
	return prisma.verein.create({
		data: {
			slug: daten.slug,
			name: `Fischereiverein ${daten.slug}`,
			anzeigename: daten.anzeigename ?? 'Jungfischer Test',
			farbe: daten.farbe ?? '#0f766e',
			kontakt: daten.kontakt,
			status: daten.status ?? 'AKTIV',
		},
	});
}
