/**
 * Vereinsgebundene Datenschicht (Rahmen-Spec 7.3, TP2-Spec 3.1).
 *
 * `vereinDb(prisma, vereinId)` setzt den Verein in jede Abfrage ein: in jedes
 * `where` und in jedes angelegte `data`. Was ausserhalb eines Vereins liegt
 * (Admin-Tabellen, Rohabfragen), ist ueber diesen Client gesperrt.
 *
 * Erster Riegel ist die Datenbank selbst: Zusammengesetzte Fremdschluessel
 * verhindern Verknuepfungen ueber Vereinsgrenzen (Spec 3.1). vereinDb ist der
 * zweite: Er verhindert, dass eine Abfrage fremde Zeilen ueberhaupt sieht.
 * Verworfen: Row-Level-Security in Postgres — als weiteres Netz nachruestbar,
 * aber nicht Teil von Version 1 (Rahmen-Spec 7.3).
 *
 * Grenze: Eine Prisma-Query-Extension sieht nur die oberste Ebene einer Abfrage.
 * Verschachtelte Schreibvorgaenge (z.B. `create` unter einer Relation) erben den
 * Verein ueber die zusammengesetzten Fremdschluessel; dort haelt die Datenbank.
 */

import type * as runtime from '@prisma/client/runtime/client';
import type { PrismaClient } from '../generated/client.js';
import type { Prisma } from '../generated/client.js';

/** Ein Aufruf ueber vereinDb, der den eingesetzten Verein umginge. */
export class VereinDbFehler extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VereinDbFehler';
	}
}

/**
 * Alle Modelle mit `vereinId`, ausser `AdminProtokoll` (Admin-Modell, traegt
 * `vereinId` nur als Notiz ohne Fremdschluessel). Ein Test vergleicht die Liste
 * mit dem Schema; ein neues Vereinsmodell ohne Eintrag waere ueber vereinDb
 * gesperrt, nicht offen.
 *
 * `WebauthnChallenge` und `MailWarteschlange` haben `vereinId` optional: Ueber
 * vereinDb sieht und schreibt man nur Zeilen des eigenen Vereins; Admin-Challenges
 * und Admin-Mails laufen nie hierueber. `VereinLogo` hat `vereinId` als Schluessel.
 * `DateiLoeschung` hat `vereinId` ohne Fremdschluessel und gehoert trotzdem hierher: Nur
 * so darf ein Vereins-Pfad die Loeschliste ueber vereinDb fuellen (Plan TP4 Etappe 1,
 * Entscheidung 6); der Aufraeumer liest sie plattformweit ueber den schlichten Client.
 */
export const VEREINS_MODELLE = [
	'VereinLogo',
	'Person',
	'Bezugsperson',
	'Untergruppe',
	'UntergruppeMitglied',
	'Zugang',
	'Passkey',
	'RecoveryCode',
	'WebauthnChallenge',
	'Session',
	'Einladung',
	'Einwilligung',
	'MailWarteschlange',
	'Thread',
	'ThreadUntergruppe',
	'ThreadModul',
	'InfoModul',
	'DateienModul',
	'FotosModul',
	'TerminModul',
	'UmfrageModul',
	'UmfrageOption',
	'UmfrageAntwort',
	'UmfrageAntwortOption',
	'HelferModul',
	'HelferPosition',
	'HelferEintrag',
	'VerlaufEintrag',
	'GelesenStand',
	'Aenderung',
	'Datei',
	'DokumentKategorie',
	'Dokument',
	'DateiLoeschung',
] as const satisfies readonly Prisma.ModelName[];

type VereinsModell = (typeof VEREINS_MODELLE)[number];

const LESEN = [
	'findUnique',
	'findUniqueOrThrow',
	'findFirst',
	'findFirstOrThrow',
	'findMany',
	'count',
	'aggregate',
	'groupBy',
] as const;
const ANLEGEN = ['create', 'createMany', 'createManyAndReturn'] as const;
const AENDERN = ['update', 'updateMany', 'updateManyAndReturn'] as const;
const LOESCHEN = ['delete', 'deleteMany'] as const;

/** Was der Verein selbst ueber vereinDb darf: lesen und aendern, nie anlegen oder loeschen. */
const VEREIN_OPERATIONEN = [...LESEN, 'update'] as const;

/** Felder, die nie im data stehen duerfen: Den Verein setzt vereinDb. */
const VEREIN_FELDER = ['vereinId', 'verein'];

/** Felder des Vereins, die vereinDb nie aendert; auch der Typ von update laesst sie weg. */
const VEREIN_GESPERRTE_FELDER = ['id', 'slug', 'status'] as const;

/**
 * Relationsoperationen, die eine bestehende Zeile per eindeutigem Schluessel
 * holen — ohne Verein, denn vereinDb sieht diese Ebene nicht. `connect` auf einen
 * fremden Zugang setzte dessen (vereinId, personId) neu und zoege ihn in den
 * eigenen Verein; `disconnect` setzte die vereinId einer WebauthnChallenge auf
 * null. Darum schreiben Aufrufer Fremdschluessel als Skalar (`personId`), dann
 * prueft der zusammengesetzte Fremdschluessel.
 */
const VERKNUEPFEN = ['connect', 'connectOrCreate', 'disconnect'];

const VEREINS_MODELL_SET: ReadonlySet<string> = new Set(VEREINS_MODELLE);

function enthaelt(liste: readonly string[], wert: string): boolean {
	return liste.includes(wert);
}

/** Nur JSON-artige Objekte; Date, Uint8Array (Bytes) und Decimal sind Werte. */
function istEinfachesObjekt(wert: unknown): wert is Record<string, unknown> {
	if (typeof wert !== 'object' || wert === null) return false;
	const proto = Object.getPrototypeOf(wert);
	return proto === Object.prototype || proto === null;
}

/**
 * Durchsucht data bis in jede Tiefe. Tief statt nur oben, weil ein verschachteltes
 * `update` oder `create` sonst `verein` oder `connect` an vereinDb vorbeitruege.
 */
function pruefeDaten(wert: unknown, modell: string): void {
	if (Array.isArray(wert)) {
		for (const eintrag of wert) pruefeDaten(eintrag, modell);
		return;
	}
	if (!istEinfachesObjekt(wert)) return;
	for (const [schluessel, inhalt] of Object.entries(wert)) {
		if (enthaelt(VEREIN_FELDER, schluessel)) {
			throw new VereinDbFehler(`${modell}: ${schluessel} setzt vereinDb selbst, er darf nicht im data stehen`);
		}
		if (enthaelt(VERKNUEPFEN, schluessel)) {
			throw new VereinDbFehler(`${modell}: ${schluessel} umgeht den Verein; Fremdschluessel als Skalar schreiben`);
		}
		// set gibt es fuer Listen-Skalare (rechte, transports) und fuer Relationen;
		// nur bei Relationen stehen Objekte darin, und dann wirkt es wie connect.
		if (
			schluessel === 'set' &&
			(istEinfachesObjekt(inhalt) || (Array.isArray(inhalt) && inhalt.some(istEinfachesObjekt)))
		) {
			throw new VereinDbFehler(`${modell}: set auf eine Relation umgeht den Verein`);
		}
		pruefeDaten(inhalt, modell);
	}
}

/**
 * Haengt die Bedingung an AND an, statt where zu ersetzen oder vereinId zu
 * ueberschreiben: Ein Aufrufer, der selbst eine (fremde) vereinId filtert,
 * bekommt dann nichts — statt still die Zeilen des eigenen Vereins. Der
 * eindeutige Schluessel bleibt oben stehen, das verlangen findUnique, update,
 * delete und upsert.
 */
function mitBedingung(where: unknown, bedingung: Record<string, string>): Record<string, unknown> {
	const bisher = istEinfachesObjekt(where) ? where : {};
	const und = bisher['AND'] === undefined ? [] : Array.isArray(bisher['AND']) ? bisher['AND'] : [bisher['AND']];
	return { ...bisher, AND: [bedingung, ...und] };
}

function mitVerein(daten: unknown, vereinId: string, modell: string): unknown {
	if (Array.isArray(daten)) return daten.map((d) => mitVerein(d, vereinId, modell));
	pruefeDaten(daten, modell);
	return { ...(istEinfachesObjekt(daten) ? daten : {}), vereinId };
}

/** Baut die Argumente einer Abfrage um oder wirft; reine Funktion, darum einzeln pruefbar. */
function vereinsArgs(
	model: string | undefined,
	operation: string,
	args: Record<string, unknown> | undefined,
	vereinId: string,
): Record<string, unknown> {
	const a = args ?? {};

	if (model === undefined) {
		throw new VereinDbFehler(`${operation} ueber vereinDb: Rohabfragen umgingen den eingesetzten Verein`);
	}

	if (model === 'Verein') {
		if (!enthaelt(VEREIN_OPERATIONEN, operation)) {
			throw new VereinDbFehler(`Verein.${operation} ueber vereinDb: Vereine legt und loescht nur der Plattform-Admin`);
		}
		if (operation === 'update') {
			// Die id eines Vereins zu aendern, zoege per Kaskade alle seine Zeilen mit.
			// Der Slug ist die Adresse und wirkt auf Cookie-Pfade und Links; der Status
			// sperrt oder oeffnet den Verein. Beides aendert nur der Plattform-Admin
			// (Etappe 2, eigener Client). Verworfen: eine Positivliste erlaubter Felder —
			// sie muesste mit jedem Feld der Etappe 5 (Vereinsdaten) mitwachsen.
			if (istEinfachesObjekt(a['data'])) {
				for (const feld of VEREIN_GESPERRTE_FELDER) {
					if (feld in a['data']) {
						throw new VereinDbFehler(`Verein.update ueber vereinDb: ${feld} ist unveraenderlich`);
					}
				}
			}
			pruefeDaten(a['data'], model);
		}
		return { ...a, where: mitBedingung(a['where'], { id: vereinId }) };
	}

	if (!VEREINS_MODELL_SET.has(model)) {
		throw new VereinDbFehler(`${model} ueber vereinDb: kein Vereinsmodell`);
	}

	const where = mitBedingung(a['where'], { vereinId });
	if (enthaelt(LESEN, operation) || enthaelt(LOESCHEN, operation)) {
		return { ...a, where };
	}
	if (enthaelt(ANLEGEN, operation)) {
		return { ...a, data: mitVerein(a['data'], vereinId, model) };
	}
	if (enthaelt(AENDERN, operation)) {
		pruefeDaten(a['data'], model);
		return { ...a, where };
	}
	if (operation === 'upsert') {
		pruefeDaten(a['update'], model);
		return { ...a, where, create: mitVerein(a['create'], vereinId, model) };
	}
	// Unbekannte Operation (etwa aus einer kuenftigen Prisma-Version): gesperrt,
	// bis jemand entschieden hat, wo der Verein hineingehoert.
	throw new VereinDbFehler(`${model}.${operation} ueber vereinDb: nicht vorgesehen`);
}

// --- Typen ---------------------------------------------------------------------
//
// Die Typen spiegeln die Sperren, damit Fehler schon beim Uebersetzen auffallen:
// Vereinsmodelle ohne vereinId/verein im data, der Verein nur lesen und update,
// keine Admin-Modelle, keine Rohabfragen. Gebaut wird das ueber eine angepasste
// TypeMap, aus der Prisma auch den Typ eines erweiterten Clients ableitet. So
// bleiben select/include und die Ergebnistypen exakt. Verworfen: der blosse
// Rueckgabetyp von $extends — dann verlangte create eine vereinId, die vereinDb
// zur Laufzeit ablehnt, und jeder Aufrufer braeuchte einen Cast.

type TypeMapOriginal = Prisma.TypeMap;
type Modelle = TypeMapOriginal['model'];

/** Verteilt sich ueber Unions (XOR der Eingaben) und Listen (createMany). */
type Ohne<T, K extends PropertyKey> = T extends readonly (infer E)[] ? Ohne<E, K>[] : T extends object ? Omit<T, K> : T;

type DatenOhne<A, K extends PropertyKey> = A extends { data: infer D } ? Omit<A, 'data'> & { data: Ohne<D, K> } : A;

type UpsertOhne<A, K extends PropertyKey> = A extends { create: infer C; update: infer U }
	? Omit<A, 'create' | 'update'> & { create: Ohne<C, K>; update: Ohne<U, K> }
	: A;

type Schreibend = (typeof ANLEGEN)[number] | (typeof AENDERN)[number];

type VereinsOperationen<O> = {
	[P in keyof O]: O[P] extends { args: infer A; result: infer R }
		? {
				args: P extends 'upsert'
					? UpsertOhne<A, 'vereinId' | 'verein'>
					: P extends Schreibend
						? DatenOhne<A, 'vereinId' | 'verein'>
						: A;
				result: R;
			}
		: O[P];
};

type VereinOperationen = {
	[P in (typeof VEREIN_OPERATIONEN)[number]]: P extends 'update'
		? {
				args: DatenOhne<Modelle['Verein']['operations'][P]['args'], (typeof VEREIN_GESPERRTE_FELDER)[number]>;
				result: Modelle['Verein']['operations'][P]['result'];
			}
		: Modelle['Verein']['operations'][P];
};

type VereinTypeMap = Omit<TypeMapOriginal, 'meta' | 'model' | 'other'> & {
	meta: Omit<TypeMapOriginal['meta'], 'modelProps'> & { modelProps: Uncapitalize<VereinsModell | 'Verein'> };
	// Admin-Modelle bleiben in der Karte, damit Prismas Typen fuer Relationen
	// (z.B. WebauthnChallenge.admin) aufgehen; sichtbar sind nur die modelProps.
	model: Omit<Modelle, VereinsModell | 'Verein'> & {
		[M in VereinsModell]: Omit<Modelle[M], 'operations'> & { operations: VereinsOperationen<Modelle[M]['operations']> };
	} & {
		Verein: Omit<Modelle['Verein'], 'operations'> & { operations: VereinOperationen };
	};
	other: { payload: unknown; operations: {} };
};

/** Client eines Vereins: wie PrismaClient, aber nur mit dem, was vereinDb erlaubt. */
export type VereinDb = runtime.Types.Extensions.DynamicClientExtensionThis<
	VereinTypeMap,
	Prisma.TypeMapCb,
	runtime.Types.Extensions.DefaultArgs
>;

/**
 * Der Client, den `vereinDb(...).$transaction(async (tx) => ...)` dem Callback
 * uebergibt. Aus der Callback-Ueberladung abgeleitet statt von Hand mit Omit
 * nachgebaut, damit er mit Prismas Typ mitwaechst.
 */
export type VereinTx = Parameters<Parameters<VereinDb['$transaction']>[0]>[0];

/**
 * Client fuer genau einen Verein. Daten der App laufen ausschliesslich hierueber
 * (Rahmen-Spec 7.4); der ungebundene PrismaClient bleibt Kommandozeile und
 * Plattform-Admin vorbehalten.
 */
export function vereinDb(prisma: PrismaClient, vereinId: string): VereinDb {
	// Prisma ignoriert where-Felder mit undefined. Ohne diese Pruefung waere
	// vereinDb(prisma, undefined) ein Client ohne jede Einschraenkung.
	if (typeof vereinId !== 'string' || vereinId === '') {
		throw new VereinDbFehler('vereinDb ohne vereinId');
	}
	const erweitert = prisma.$extends({
		name: 'vereinDb',
		query: {
			// Oberstes $allOperations statt $allModels: Es faengt auch die
			// Rohabfragen ($queryRaw usw., dort ohne model) und sperrt damit alles,
			// was nicht ausdruecklich erlaubt ist.
			$allOperations({ model, operation, args, query }) {
				let neu: Record<string, unknown>;
				try {
					neu = vereinsArgs(model, operation, args, vereinId);
				} catch (fehler) {
					return Promise.reject(fehler);
				}
				return query(neu);
			},
		},
	});
	return erweitert as unknown as VereinDb;
}
