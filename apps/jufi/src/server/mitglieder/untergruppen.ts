import { sperreVereinszeile } from '@jufi/db';
import { hatRecht, istJugendleiter } from '@jufi/domain';
import type { Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron, text } from '../admin/asynchron.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';
import { statt404 } from './verwaltung.js';

const NAME_MAX = 40;
const NAME_VERGEBEN = { fehler: 'Diese Untergruppe gibt es schon', code: 'NAME_VERGEBEN', feld: 'name' };
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

/** ID-Listen aus dem Body sind beliebig lang; eine Obergrenze haelt die Abfrage klein. */
const IDS_MAX = 200;

/** Ende einer Entscheidung unter der Sperre; innerhalb der Transaktion geworfen, damit nichts halb bleibt. */
class Abbruch extends Error {
	constructor(
		readonly status: number,
		readonly antwort: object,
	) {
		super('Untergruppen abgebrochen');
	}
}

/** Name wie gespeichert: ohne Rand, 1 bis 40 Zeichen. */
function liesName(wert: unknown): string {
	const name = text(wert).trim();
	if (name === '' || name.length > NAME_MAX) {
		throw new Abbruch(400, { fehler: `Der Name braucht 1 bis ${NAME_MAX} Zeichen`, feld: 'name' });
	}
	return name;
}

/**
 * Die Vorabsuche unter der Sperre faengt die gewoehnliche Doppelung ab und kennt dabei
 * die Schreibweise, die der Unique-Index nicht kennt. P2002 ist der Weg an der Sperre
 * vorbei (CLI, Admin, ein kuenftiger Schreibweg ohne sie): dort lehnt der Index
 * (vereinId, name) die zweite Zeile ab. Die Vorabsuche ersetzt die Datenbank nicht.
 * Verworfen: nur die Datenbank -- ihr Index unterscheidet "Hechte" von "hechte".
 */
function istEindeutigVerletzt(error: unknown): boolean {
	return (error as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Gleicher Name ohne Schreibweise-Unterschied. Im Code statt mit mode: 'insensitive':
 * Prisma uebersetzt das in ILIKE, und dort wirken _ und % als Platzhalter -- "Hecht_1"
 * waere dann ein Duplikat von "HechtX1". Der Verein hat wenige Gruppen, der Vergleich im
 * Speicher kostet nichts.
 */
async function nameVergeben(
	tx: { untergruppe: { findMany: (a: object) => Promise<{ name: string }[]> } },
	name: string,
	ausser?: string,
): Promise<boolean> {
	const klein = name.toLowerCase();
	const alle = await tx.untergruppe.findMany(ausser ? { where: { id: { not: ausser } } } : {});
	return alle.some((g) => g.name.toLowerCase() === klein);
}

function antworteAbbruch(res: Response, error: unknown): void {
	if (error instanceof Abbruch) return void res.status(error.status).json(error.antwort);
	if (istEindeutigVerletzt(error)) return void res.status(409).json(NAME_VERGEBEN);
	// P2003: die Gruppe verschwand zwischen Zaehlen und Anlegen -- nur ueber einen Weg an der Sperre
	// vorbei (CLI, Admin) moeglich; fuer den Aufrufer ist sie dann schlicht nicht mehr da.
	if ((error as { code?: unknown } | null)?.code === 'P2003') return void res.status(404).json(NICHT_GEFUNDEN);
	throw error;
}

export function untergruppenRouten(router: Router, _deps: VolleAppDeps): void {
	router.get(
		'/untergruppen',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			// Lesen duerfen alle Jugendleiter (auch Betreuer ohne MITGLIEDER), die Eltern nicht.
			const { person: handelnder } = mitgliedKontext(res);
			if (!istJugendleiter(handelnder)) return statt404(res);
			const { db } = vereinsKontext(res);
			const gruppen = await db.untergruppe.findMany({
				orderBy: [{ name: 'asc' }, { id: 'asc' }],
				include: { mitglieder: { select: { person: { select: { entferntAm: true } } } } },
			});
			// Entfernte Kinder zaehlen nicht mit: die Zahl soll zur Mitgliederliste passen, die sie nicht zeigt.
			res.json({
				untergruppen: gruppen.map((g) => ({
					id: g.id,
					name: g.name,
					mitglieder: g.mitglieder.filter((m) => m.person.entferntAm === null).length,
				})),
			});
		}),
	);

	router.post(
		'/untergruppen',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			if (!hatRecht(handelnder, 'MITGLIEDER')) return statt404(res);
			const { verein, db } = vereinsKontext(res);
			try {
				const name = liesName(((req.body ?? {}) as Record<string, unknown>)['name']);
				const id = await db.$transaction(async (tx) => {
					await sperreVereinszeile(tx, verein.id);
					if (await nameVergeben(tx, name)) throw new Abbruch(409, NAME_VERGEBEN);
					return (await tx.untergruppe.create({ data: { name } })).id;
				});
				res.status(201).json({ id });
			} catch (error) {
				antworteAbbruch(res, error);
			}
		}),
	);

	router.patch(
		'/untergruppen/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			if (!hatRecht(handelnder, 'MITGLIEDER')) return statt404(res);
			const { verein, db } = vereinsKontext(res);
			const id = req.params['id'] ?? '';
			try {
				const name = liesName(((req.body ?? {}) as Record<string, unknown>)['name']);
				await db.$transaction(async (tx) => {
					await sperreVereinszeile(tx, verein.id);
					if (!(await tx.untergruppe.findFirst({ where: { id } }))) throw new Abbruch(404, NICHT_GEFUNDEN);
					// Die eigene Zeile ausgenommen, sonst waere "hechte" statt "Hechte" ein Duplikat seiner selbst.
					if (await nameVergeben(tx, name, id)) throw new Abbruch(409, NAME_VERGEBEN);
					await tx.untergruppe.update({ where: { id }, data: { name } });
				});
				res.status(204).end();
			} catch (error) {
				antworteAbbruch(res, error);
			}
		}),
	);

	router.delete(
		'/untergruppen/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			if (!hatRecht(handelnder, 'MITGLIEDER')) return statt404(res);
			const { verein, db } = vereinsKontext(res);
			const id = req.params['id'] ?? '';
			// Unter der Sperre, weil ein gleichzeitiges PUT die Gruppe zaehlt und dann Mitgliedschaften
			// anlegt: ohne die Sperre loeschte sie dazwischen, und der zusammengesetzte Fremdschluessel
			// liesse das PUT als 500 scheitern. Die Mitgliedschaften gehen per ON DELETE CASCADE mit,
			// die Personen bleiben (Spec 5.5). deleteMany statt delete: "gibt es nicht oder gehoert
			// einem anderen Verein" ist beides count 0 und damit 404, ohne Prisma-Fehler.
			const geloescht = await db.$transaction(async (tx) => {
				await sperreVereinszeile(tx, verein.id);
				return tx.untergruppe.deleteMany({ where: { id } });
			});
			if (geloescht.count === 0) return statt404(res);
			res.status(204).end();
		}),
	);

	router.put(
		'/personen/:id/untergruppen',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			if (!hatRecht(handelnder, 'MITGLIEDER')) return statt404(res);
			const { verein, db } = vereinsKontext(res);
			const personId = req.params['id'] ?? '';
			const roh = ((req.body ?? {}) as Record<string, unknown>)['untergruppenIds'];
			if (!Array.isArray(roh) || roh.length > IDS_MAX || !roh.every((i) => typeof i === 'string')) {
				return void res.status(400).json({ fehler: 'Eine Liste von Untergruppen erwartet', feld: 'untergruppenIds' });
			}
			const ids = [...new Set(roh as string[])];
			try {
				await db.$transaction(async (tx) => {
					// Angenommen oder nicht haengt an Person und Gruppen; die Sperre haelt ein gleichzeitiges
					// Loeschen einer Gruppe (DELETE ebenfalls unter der Sperre) oder Entfernen des Kindes an.
					await sperreVereinszeile(tx, verein.id);
					const kind = await tx.person.findFirst({ where: { id: personId, art: 'JUNGFISCHER', entferntAm: null } });
					if (!kind) throw new Abbruch(404, NICHT_GEFUNDEN);
					// Eine unbekannte oder fremde Gruppe ist fuer vereinDb dasselbe: nicht da. Die ganze Anfrage
					// scheitert dann, statt die uebrigen zu setzen -- ein Teilerfolg wuerde die Menge
					// ersetzen, ohne dass die Verwaltung gemerkt haette, dass eine Auswahl nicht galt.
					const gefunden = await tx.untergruppe.count({ where: { id: { in: ids } } });
					if (gefunden !== ids.length) throw new Abbruch(404, NICHT_GEFUNDEN);
					await tx.untergruppeMitglied.deleteMany({ where: { personId } });
					if (ids.length > 0) {
						await tx.untergruppeMitglied.createMany({
							data: ids.map((untergruppeId) => ({ untergruppeId, personId })),
						});
					}
				});
				res.json({ untergruppenIds: ids.sort() });
			} catch (error) {
				antworteAbbruch(res, error);
			}
		}),
	);
}
