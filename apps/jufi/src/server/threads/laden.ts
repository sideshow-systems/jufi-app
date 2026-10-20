import type { VereinDb } from '@jufi/db';
import {
	baueUmfeld,
	type AntwortDaten,
	type ModulDaten,
	type TerminDaten,
	type ThreadKopf,
	type Umfeld,
	type UmfrageDaten,
} from '@jufi/domain';
import { ladeUmfeld } from '../mitglieder/verwaltung.js';

/**
 * Das Umfeld, das die Threadregeln brauchen: ladeUmfeld plus die Mitgliedschaften in
 * Untergruppen. Die Zeilen von Person und Bezugsperson tragen schon alle Felder von
 * ThreadPerson und Bezug, es braucht also keine Umwandlung; baueUmfeld laesst Entfernte
 * samt ihren Zuordnungen und Mitgliedschaften weg. Verworfen: ladeUmfeld nachbauen --
 * zwei Stellen, die entscheiden, wer "im Verein" ist, laufen auseinander.
 */
export async function ladeThreadUmfeld(db: VereinDb): Promise<Umfeld> {
	const [{ personen, zuordnungen }, mitgliedschaften] = await Promise.all([
		ladeUmfeld(db),
		db.untergruppeMitglied.findMany({ select: { personId: true, untergruppeId: true } }),
	]);
	return baueUmfeld(personen, zuordnungen, mitgliedschaften);
}

/**
 * Der Aenderungsstand des Vereins. Die Routen lesen ihn vor den Daten des Threads:
 * Unter READ COMMITTED ist alles, was danach geladen wird, mindestens so neu wie dieser
 * Stand, ein Client, der ihn als "gesehen" meldet, hat also nichts uebersprungen. Andersherum
 * (erst die Daten, dann der Stand) meldete er eine Aenderung als gesehen, die er nie geladen hat.
 */
export async function ladeVereinsstand(db: VereinDb, vereinId: string): Promise<number> {
	const verein = await db.verein.findUnique({ where: { id: vereinId }, select: { aenderungsstand: true } });
	if (!verein) throw new Error('Verein nicht gefunden');
	return verein.aenderungsstand;
}

export interface GeladenerThread {
	kopf: ThreadKopf;
	module: ModulDaten[];
}

/** "JJJJ-MM-TT"; die Spalten sind @db.Date und kommen als Mitternacht UTC, ohne Zeitzonenversatz. */
function tag(datum: Date): string {
	return datum.toISOString().slice(0, 10);
}

/**
 * Ein Thread mit allen Modulen, Optionen und Antworten, oder null, wenn es ihn im Verein
 * nicht gibt (ein fremder Verein ist ueber vereinDb ebenfalls "nicht da"). Eine Abfrage je
 * Tabelle statt einer verschachtelten: die Zahl der Abfragen haengt so nicht von der Zahl
 * der Module ab, und jede Reihenfolge steht sichtbar im orderBy.
 *
 * Welche Untertabelle gilt, entscheidet `typ` des Moduls. Verworfen: die vorhandene
 * Untertabelle nehmen -- hinge an einem INFO-Modul von Hand eine Terminzeile, bestimmte
 * die Reihenfolge der Pruefungen, was die Karte zeigt. Ein Modul ohne die Zeile seines
 * Typs (kaputte Daten) wird uebersprungen, damit ein Thread nicht an einer Zeile haengt.
 */
export async function ladeThread(db: VereinDb, threadId: string): Promise<GeladenerThread | null> {
	const thread = await db.thread.findUnique({
		where: { id: threadId },
		include: { untergruppen: { select: { untergruppeId: true }, orderBy: { untergruppeId: 'asc' } } },
	});
	if (!thread) return null;

	const moduleZeilen = await db.threadModul.findMany({
		where: { threadId },
		orderBy: [{ position: 'asc' }, { id: 'asc' }],
	});
	const ids = moduleZeilen.map((m) => m.id);
	const [infos, termine, umfragen] = await Promise.all([
		db.infoModul.findMany({ where: { id: { in: ids } } }),
		db.terminModul.findMany({ where: { id: { in: ids } } }),
		db.umfrageModul.findMany({ where: { id: { in: ids } } }),
	]);
	const umfrageIds = umfragen.map((u) => u.id);
	const [optionen, antworten] = await Promise.all([
		db.umfrageOption.findMany({
			where: { umfrageId: { in: umfrageIds } },
			orderBy: [{ position: 'asc' }, { id: 'asc' }],
		}),
		db.umfrageAntwort.findMany({
			where: { umfrageId: { in: umfrageIds } },
			include: { optionen: { select: { optionId: true } } },
			orderBy: [{ abgegebenAm: 'asc' }, { id: 'asc' }],
		}),
	]);

	const infoVon = new Map(infos.map((i) => [i.id, i]));
	const terminVon = new Map(termine.map((t) => [t.id, t]));
	const umfrageVon = new Map(umfragen.map((u) => [u.id, u]));
	const rang = new Map(optionen.map((o, i) => [o.id, i]));

	const module: ModulDaten[] = [];
	for (const m of moduleZeilen) {
		const titel = m.titel;
		if (m.typ === 'INFO') {
			const info = infoVon.get(m.id);
			if (info) module.push({ typ: 'INFO', id: m.id, titel, text: info.text });
		} else if (m.typ === 'TERMIN') {
			const t = terminVon.get(m.id);
			if (!t) continue;
			const termin: TerminDaten = {
				modulId: m.id,
				startDatum: tag(t.startDatum),
				endDatum: t.endDatum ? tag(t.endDatum) : null,
				beginn: t.beginn,
				ende: t.ende,
				ort: t.ort,
				treffpunkt: t.treffpunkt,
			};
			module.push({ typ: 'TERMIN', id: m.id, titel, termin });
		} else {
			const u = umfrageVon.get(m.id);
			if (!u) continue;
			const umfrage: UmfrageDaten = {
				modulId: m.id,
				frage: u.frage,
				einheit: u.einheit,
				mehrfach: u.mehrfach,
				teilnahme: u.teilnahme,
				vielleicht: u.vielleicht,
				frist: u.frist,
				ergebnisse: u.ergebnisse,
				optionen: optionen
					.filter((o) => o.umfrageId === u.id)
					.map((o) => ({ id: o.id, schluessel: o.schluessel, text: o.text })),
				antworten: antworten
					.filter((a) => a.umfrageId === u.id)
					.map((a): AntwortDaten => ({
						fuerId: a.fuerId,
						vonId: a.vonId,
						// In der Reihenfolge der Optionen, nicht der Datenbank: die Ansicht ist so unabhaengig vom Zufall.
						optionIds: a.optionen.map((o) => o.optionId).sort((x, y) => (rang.get(x) ?? 0) - (rang.get(y) ?? 0)),
						abgegebenAm: a.abgegebenAm,
					})),
			};
			module.push({ typ: 'UMFRAGE', id: m.id, titel, umfrage });
		}
	}

	return {
		kopf: {
			id: thread.id,
			art: thread.art,
			titel: thread.titel,
			modus: thread.modus,
			rollenfilter: thread.rollenfilter,
			alleUntergruppen: thread.alleUntergruppen,
			untergruppenIds: thread.untergruppen.map((g) => g.untergruppeId),
			angepinnt: thread.angepinnt,
			archivModus: thread.archivModus,
			veroeffentlichtAm: thread.veroeffentlichtAm,
			erstelltVonId: thread.erstelltVonId,
		},
		module,
	};
}

/** Zu welchem Thread ein Modul gehoert und welcher Art es ist; null, wenn es im Verein kein solches Modul gibt. */
export async function modulOrt(
	db: VereinDb,
	modulId: string,
): Promise<{ threadId: string; typ: 'INFO' | 'TERMIN' | 'UMFRAGE' } | null> {
	const modul = await db.threadModul.findUnique({ where: { id: modulId }, select: { threadId: true, typ: true } });
	return modul ?? null;
}
