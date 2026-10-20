import { austauschAnlegen, type PrismaClient, type VereinStatus } from '@jufi/db';

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
			// Wie im echten Anlegen (legeVereinAn): Testvereine haben den Austausch, den jeder echte
			// Verein hat. Die Uhrzeit ist hier gleichgueltig (der Verein selbst bekommt auch nur die
			// Zeit der Datenbank), deshalb kein `jetzt` als Parameter, den alle Aufrufer fuellen muessten.
			threads: { create: austauschAnlegen(new Date()) },
		},
	});
}
