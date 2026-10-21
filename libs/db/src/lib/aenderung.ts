import type { AenderungArt } from '../generated/client.js';
import type { VereinTx } from './verein-db.js';

/** Eine Aenderung, die die Arbeit einer Transaktion meldet; nur Kennungen, keine Inhalte. */
export interface AenderungEingabe {
	threadId: string | null;
	art: AenderungArt;
	objektId: string;
}

/**
 * Aenderungen dieser Arten sind keine Aktivitaet im Thread: Ein geloeschter Thread
 * hat keine Zeile mehr, und eine neue Zielgruppe (SICHTBARKEIT, Etappe 5) ist kein
 * Beitrag, der den Thread in der Liste nach oben schieben soll. Die Veroeffentlichung
 * gehoert nicht hierher: Sie wird als THREAD gemeldet (der Verlaufseintrag dazu als
 * VERLAUF) und schiebt den Thread nach oben, weil er fuer die Zielgruppe erst jetzt
 * erscheint.
 * LISTE (Anpinnen und Archivieren) gehoert dazu: Verworfen ist THREAD, denn jedes
 * Anpinnen schoebe den Thread nach oben und hiesse bei allen "Aushang geaendert".
 */
const OHNE_AKTIVITAET: readonly AenderungArt[] = ['GELOESCHT', 'SICHTBARKEIT', 'LISTE'];

/**
 * Fuehrt die Arbeit einer schreibenden Route unter einem eigenen Aenderungsstand aus
 * (TP3-Spec 2.6, 4.2).
 *
 * Der Zaehler steigt zuerst, noch vor der Arbeit: Das UPDATE sperrt die Vereinszeile
 * bis zum Ende der Transaktion (wie sperreVereinszeile), gleichzeitige Schreiber
 * stellen sich an und vergeben so lueckenlose Staende in Commit-Reihenfolge; eine
 * zurueckgerollte Transaktion verbraucht keinen. Verworfen: eine Postgres-Sequenz —
 * sie vergibt Nummern vor dem Commit, und eine spaeter committete kleinere Nummer
 * ueberholte einen Sync, der die groessere schon gesehen hat. Das Warten setzt
 * READ COMMITTED voraus (Postgres-Vorgabe, das Projekt setzt keine isolationLevel):
 * Unter REPEATABLE READ oder SERIALIZABLE scheiterten gleichzeitige Schreiber mit
 * 40001/P2034, statt zu warten.
 *
 * Aufrufer rufen mitAenderung als erste schreibende Anweisung der Transaktion auf.
 * Was vor der Sperre der Vereinszeile geschrieben wird, kann mit einer Transaktion
 * verklemmen, die die Sperre schon haelt und in `arbeit` dieselben Zeilen anfasst.
 *
 * Ein Stand je Transaktion, nicht je Zeile (Plan-Entscheidung 2): Die Arbeit bekommt
 * ihn vorab, denn ein Verlaufseintrag braucht seinen Stand beim Anlegen, seine ID
 * entsteht erst dabei. Darum haben die Aenderungen eine eigene ID und keinen
 * eindeutigen (vereinId, stand).
 *
 * Der Bus nach dem Commit (Etappe 5) ist Sache des Aufrufers; die Rueckgabe traegt
 * dafuer alles. `jetzt` kommt von aussen, damit die Zeit testbar bleibt.
 */
export async function mitAenderung<T>(
	tx: VereinTx,
	vereinId: string,
	urheberId: string | null,
	jetzt: Date,
	arbeit: (stand: number) => Promise<{ ergebnis: T; aenderungen: readonly AenderungEingabe[] }>,
): Promise<{ stand: number; ergebnis: T; aenderungen: readonly AenderungEingabe[] }> {
	const { aenderungsstand: stand } = await tx.verein.update({
		where: { id: vereinId },
		data: { aenderungsstand: { increment: 1 } },
		select: { aenderungsstand: true },
	});

	const { ergebnis, aenderungen } = await arbeit(stand);

	if (aenderungen.length > 0) {
		await tx.aenderung.createMany({
			data: aenderungen.map((a) => ({
				stand,
				threadId: a.threadId,
				art: a.art,
				objektId: a.objektId,
				urheberId,
				angelegtAm: jetzt,
			})),
		});
	}

	const threadIds = new Set<string>();
	for (const a of aenderungen) {
		if (a.threadId !== null && !OHNE_AKTIVITAET.includes(a.art)) threadIds.add(a.threadId);
	}
	if (threadIds.size > 0) {
		await tx.thread.updateMany({
			where: { id: { in: [...threadIds] } },
			data: { letzteAktivitaetAm: jetzt, letzteAktivitaetStand: stand },
		});
	}

	return { stand, ergebnis, aenderungen };
}

/**
 * Vermerkt eine Aenderung im Umfeld eines Vereins (Personen, Familie, Untergruppen, Rechte,
 * Zugang, Einwilligung), die keinem Thread gehoert: ein Stand, je ID eine Aenderung der Art
 * SICHTBARKEIT ohne Thread (Plan-Entscheidung 3). `objektIds` sind die geaenderten Personen
 * bzw. Untergruppen.
 *
 * Wer sie sieht, laedt alles neu: Der Sync antwortet dann `vollstaendig`, und ein Signal ohne
 * threadId geht live an alle Sockets des Vereins. Denn welche Threads eine neue Untergruppe
 * oder ein Recht beruehrt, ist Sache der Sichtbarkeitsregeln und wuerde sich je Route anders
 * berechnen.
 * Verworfen: je betroffenem Thread eine SICHTBARKEIT -- jede TP2-Route muesste selbst
 * ausrechnen, welche Threads die Aenderung beruehrt. Verworfen: keine Aenderung und nur ein
 * Live-Signal -- ein Client, der in dem Moment getrennt war, erfuehre es nie.
 *
 * Aufrufer rufen es in der Transaktion der Route spaetestens vor dem ersten Schreiben auf: Es
 * sperrt die Vereinszeile, und was davor geschrieben wird, kann verklemmen (mitAenderung). Wo
 * die Route sperreVereinszeile ruft, gleich danach
 * (die Zeile ist dann ohnehin gesperrt); wo ein Pfad ohne Wirkung enden kann, erst vor dem
 * ersten Schreiben, damit keine Aenderung ohne Wirkung entsteht (Spec 2.6). POST /personen ruft
 * es ohne sperreVereinszeile; dort sperrt erst dieser Aufruf. Den Bus melden die Aufrufer erst
 * nach dem Commit; die Rueckgabe traegt dafuer alles.
 */
export async function vermerkeUmfeld(
	tx: VereinTx,
	vereinId: string,
	urheberId: string | null,
	jetzt: Date,
	objektIds: readonly string[],
): Promise<{ stand: number; aenderungen: readonly AenderungEingabe[] }> {
	const { stand, aenderungen } = await mitAenderung(tx, vereinId, urheberId, jetzt, async () => ({
		ergebnis: undefined,
		aenderungen: objektIds.map((objektId) => ({ threadId: null, art: 'SICHTBARKEIT' as const, objektId })),
	}));
	return { stand, aenderungen };
}
