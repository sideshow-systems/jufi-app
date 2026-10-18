import type { Person, VereinDb } from '@jufi/db';
import { hatGueltigeEinwilligung, istVolljaehrig } from '@jufi/domain';

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
async function loescheEinladungen(tx: Transaktion, where: { personId: string; eingeloestAm?: null }): Promise<void> {
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
	// Die Einwilligung nach Art. 8 DSGVO braucht nur das minderjaehrige Kind (Spec 5.6); ein
	// volljaehriges willigt selbst ein, und "Familie loesen" ist fuer es ausdruecklich erlaubt.
	// Dagegen bleibt ein minderjaehriges Kind, das nie eine Einwilligung hatte, ohne Zugang:
	// im Zweifel die sichere Seite.
	if (istVolljaehrig(kind, jetzt)) return;
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
	if (!hatGueltigeEinwilligung(kind, einwilligungen, erteiler, zuordnungen, jetzt)) {
		await entzieheZugang(tx, kind.id);
	}
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
