/**
 * Sperrt die Vereinszeile bis zum Ende der laufenden Transaktion. Der Parameter ist
 * strukturell getippt, weil der Transaktions-Client aus prisma.$transaction und der aus
 * vereinDb(...).$transaction verschiedene Typen haben; Verein steht nicht in
 * VEREINS_MODELLE und geht deshalb in beiden unveraendert durch.
 */
export interface MitVereinZeile {
	verein: {
		update(args: { where: { id: string }; data: { sperrzaehler: { increment: number } } }): PromiseLike<unknown>;
	};
}

export async function sperreVereinszeile(tx: MitVereinZeile, vereinId: string): Promise<void> {
	await tx.verein.update({ where: { id: vereinId }, data: { sperrzaehler: { increment: 1 } } });
}
