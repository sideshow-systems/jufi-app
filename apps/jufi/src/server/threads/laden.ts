import type { ModulTyp, VereinDb, VereinTx } from '@jufi/db';
import {
	baueUmfeld,
	kinderImThread,
	type AntwortDaten,
	type AutoDaten,
	type DateiDaten,
	type EinwilligungZeile,
	type FahrtDaten,
	type FotoDaten,
	type HelferDaten,
	type HelferEintragDaten,
	type MitfahrtDaten,
	type ModulDaten,
	type NachrichtenEingabe,
	type NeuAenderung,
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
 *
 * Nimmt auch die Transaktion einer Schreibroute: Nachrichten und Antworten entscheiden unter
 * der Sperre noch einmal, ob die Person im Thread schreiben darf bzw. gefragt ist, und das
 * haengt an Familie, Untergruppen und Jugendsprecher-Merkmal (Plan-Entscheidung 3).
 */
export async function ladeThreadUmfeld(db: VereinDb | VereinTx): Promise<Umfeld> {
	const [{ personen, zuordnungen }, mitgliedschaften] = await Promise.all([
		ladeUmfeld(db),
		db.untergruppeMitglied.findMany({ select: { personId: true, untergruppeId: true } }),
	]);
	return baueUmfeld(personen, zuordnungen, mitgliedschaften);
}

/**
 * Die Foto-Einwilligungen der Kinder, die der Thread anspricht (kinderImThread), je Jungfischer.
 * Leer, wenn der Thread kein Foto-Modul hat: Nur der Hinweis dieses Moduls liest sie, und die
 * Abfrage soll nicht bei jedem Thread laufen. Widerrufene Zeilen fehlen schon hier; ob eine
 * Zeile heute noch gilt (Erteiler darf noch, Kind noch minderjaehrig), entscheidet allein
 * fotoEinwilligungGilt gegen `jetzt`. Verworfen: die Zeilen hier schon nach "gilt heute" zu
 * filtern -- die Regel stuende an zwei Stellen, und "volljaehrig ueber Nacht" lebte nur in einer.
 * Nur die Art FOTOS: Die DSGVO-Einwilligung oeffnet den Zugang und erlaubt keine Fotos.
 */
export async function ladeFotoEinwilligungen(
	db: VereinDb | VereinTx,
	kopf: ThreadKopf,
	module: readonly ModulDaten[],
	umfeld: Umfeld,
): Promise<Map<string, EinwilligungZeile[]>> {
	const ergebnis = new Map<string, EinwilligungZeile[]>();
	if (!module.some((m) => m.typ === 'FOTOS')) return ergebnis;
	const kinder = kinderImThread(kopf, umfeld).map((k) => k.id);
	if (kinder.length === 0) return ergebnis;
	const zeilen = await db.einwilligung.findMany({
		where: { art: 'FOTOS', widerrufenAm: null, jungfischerId: { in: kinder } },
		select: { jungfischerId: true, erteiltVon: true, widerrufenAm: true },
	});
	for (const z of zeilen) {
		const liste = ergebnis.get(z.jungfischerId) ?? [];
		liste.push({ erteiltVon: z.erteiltVon, widerrufenAm: z.widerrufenAm });
		ergebnis.set(z.jungfischerId, liste);
	}
	return ergebnis;
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
	/** Sortierschluessel der Liste (Spalte des Threads); den Kopf braucht es dafuer nicht aufzublaehen. */
	letzteAktivitaetAm: Date;
}

/** Die Untergruppen nach ID sortiert, damit der Kopf nicht von der Reihenfolge der Datenbank abhaengt. */
const kopfEinbezug = {
	untergruppen: { select: { untergruppeId: true }, orderBy: { untergruppeId: 'asc' } },
} as const;

/**
 * Die Abbildung einer Thread-Zeile auf den Kopf, an einer Stelle: ladeThreads und ladeKoepfe
 * muessen denselben Kopf liefern, sonst deutet ein Signal einen Thread anders als die Seite.
 */
function kopfAus(thread: {
	id: string;
	art: ThreadKopf['art'];
	titel: string;
	modus: ThreadKopf['modus'];
	rollenfilter: ThreadKopf['rollenfilter'];
	alleUntergruppen: boolean;
	angepinnt: boolean;
	archivModus: ThreadKopf['archivModus'];
	veroeffentlichtAm: Date | null;
	erstelltVonId: string | null;
	untergruppen: { untergruppeId: string }[];
}): ThreadKopf {
	return {
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
	};
}

/** "JJJJ-MM-TT"; die Spalten sind @db.Date und kommen als Mitternacht UTC, ohne Zeitzonenversatz. */
function tag(datum: Date): string {
	return datum.toISOString().slice(0, 10);
}

/**
 * Alle Threads des Vereins (oder nur die mit den gegebenen IDs) mit Modulen, Optionen und
 * Antworten, in der Reihenfolge der Liste der Verwaltung: neueste zuerst, bei gleicher
 * Anlegezeit nach ID. Eine Abfrage je Tabelle statt einer verschachtelten und statt einer
 * Abfragefolge je Thread: die Zahl der Abfragen haengt weder von der Zahl der Module noch von
 * der der Threads ab, und jede Reihenfolge steht sichtbar im orderBy. Verworfen: die Liste der
 * Verwaltung ruft ladeThread je Thread -- bei dreissig Threads waere das ein paar hundert
 * Abfragen fuer eine Seite.
 *
 * `mitAntworten: false` laesst die Antworten weg (`UmfrageDaten.antworten` ist dann leer, Optionen
 * und `ergebnisse` bleiben), ebenso die Eintraege der Helferlisten (Positionen bleiben, ihre
 * `eintraege` sind leer) und die Autos und Mitfahrten der Fahrgemeinschaft (die Richtungen bleiben).
 * Liste und Kalender zeigen keine Antworten, und deren Zahl waechst mit jeder Abgabe; die Startseite
 * laedt sie nur fuer die Threads nach, die sie nach dem Filter wirklich braucht. Verworfen: eigene
 * schmale Abfragen je Route -- die Abbildung der Module stuende dreimal.
 *
 * Welche Untertabelle gilt, entscheidet `typ` des Moduls. Verworfen: die vorhandene
 * Untertabelle nehmen -- hinge an einem INFO-Modul von Hand eine Terminzeile, bestimmte
 * die Reihenfolge der Pruefungen, was die Karte zeigt. Ein Modul ohne die Zeile seines
 * Typs (kaputte Daten) wird uebersprungen, damit ein Thread nicht an einer Zeile haengt.
 */
export async function ladeThreads(
	db: VereinDb | VereinTx,
	auswahl: { threadIds?: readonly string[]; mitAntworten?: boolean } = {},
): Promise<GeladenerThread[]> {
	const { threadIds, mitAntworten = true } = auswahl;
	const threads = await db.thread.findMany({
		where: threadIds ? { id: { in: [...threadIds] } } : undefined,
		include: kopfEinbezug,
		orderBy: [{ angelegtAm: 'desc' }, { id: 'asc' }],
	});
	if (threads.length === 0) return [];

	const moduleZeilen = await db.threadModul.findMany({
		where: { threadId: { in: threads.map((t) => t.id) } },
		orderBy: [{ position: 'asc' }, { id: 'asc' }],
	});
	const ids = moduleZeilen.map((m) => m.id);
	const [infos, termine, umfragen, helferModule, dateienModule, fotosModule, dateiZeilen] = await Promise.all([
		db.infoModul.findMany({ where: { id: { in: ids } } }),
		db.terminModul.findMany({ where: { id: { in: ids } } }),
		db.umfrageModul.findMany({ where: { id: { in: ids } } }),
		db.helferModul.findMany({ where: { id: { in: ids } } }),
		db.dateienModul.findMany({ where: { id: { in: ids } }, select: { id: true } }),
		db.fotosModul.findMany({ where: { id: { in: ids } }, select: { id: true, hochladen: true } }),
		// Eine Abfrage fuer alle Module, nicht je Modul. Ohne sha256: die Hash-Spalte braucht kein
		// Leser. Aeltestes zuerst, bei gleicher Zeit nach ID, damit die Reihenfolge nicht vom Zufall abhaengt.
		db.datei.findMany({
			where: { modulId: { in: ids } },
			select: {
				id: true,
				modulId: true,
				name: true,
				typ: true,
				groesse: true,
				breite: true,
				hoehe: true,
				vonId: true,
				hochgeladenAm: true,
			},
			orderBy: [{ hochgeladenAm: 'asc' }, { id: 'asc' }],
		}),
	]);
	const umfrageIds = umfragen.map((u) => u.id);
	const [optionen, antworten, positionen, fahrtModule, autoZeilen, mitfahrtZeilen] = await Promise.all([
		db.umfrageOption.findMany({
			where: { umfrageId: { in: umfrageIds } },
			orderBy: [{ position: 'asc' }, { id: 'asc' }],
		}),
		mitAntworten
			? db.umfrageAntwort.findMany({
					where: { umfrageId: { in: umfrageIds } },
					include: { optionen: { select: { optionId: true } } },
					orderBy: [{ abgegebenAm: 'asc' }, { id: 'asc' }],
				})
			: Promise.resolve([]),
		db.helferPosition.findMany({
			where: { modulId: { in: helferModule.map((h) => h.id) } },
			orderBy: [{ position: 'asc' }, { id: 'asc' }],
		}),
		db.fahrtModul.findMany({ where: { id: { in: ids } } }),
		// Wie die Antworten: Liste und Kalender zeigen keine Autos. Die Reihenfolge ist die des
		// Anbietens und des Einsteigens (Plan-Entscheidung 16), mit der ID als Tiebreaker. Ueber alle
		// Module des Threads wie bei den Dateien: Die Fremdschluessel binden jedes Auto an eine
		// Fahrgemeinschaft, eine eigene Abfrage nach den Fahrgemeinschaften davor kostete eine Wartezeit.
		mitAntworten
			? db.auto.findMany({
					where: { modulId: { in: ids } },
					orderBy: [{ angelegtAm: 'asc' }, { id: 'asc' }],
				})
			: Promise.resolve([]),
		mitAntworten
			? db.mitfahrt.findMany({
					where: { modulId: { in: ids } },
					orderBy: [{ eingetragenAm: 'asc' }, { id: 'asc' }],
				})
			: Promise.resolve([]),
	]);
	// Nach den Positionen, weil die Eintraege an deren IDs haengen: Ohne Helferliste faellt die Abfrage
	// ganz weg, und mit einer filtert sie ueber den Index (positionId, fuerId) statt ueber einen Join.
	// Verworfen: der Filter ueber die Relation (position: { modulId: { in } }) neben den Optionen --
	// eine Wartezeit weniger, aber eine Abfrage samt Join auch fuer jeden Thread ohne Helferliste.
	const eintraege =
		mitAntworten && positionen.length > 0
			? await db.helferEintrag.findMany({
					where: { positionId: { in: positionen.map((p) => p.id) } },
					select: { positionId: true, fuerId: true, vonId: true, notiz: true, eingetragenAm: true },
					orderBy: [{ eingetragenAm: 'asc' }, { id: 'asc' }],
				})
			: [];

	const infoVon = new Map(infos.map((i) => [i.id, i]));
	const terminVon = new Map(termine.map((t) => [t.id, t]));
	const umfrageVon = new Map(umfragen.map((u) => [u.id, u]));
	const helferVon = new Map(helferModule.map((h) => [h.id, h]));
	const fahrtVon = new Map(fahrtModule.map((f) => [f.id, f]));
	const dateienModulIds = new Set(dateienModule.map((d) => d.id));
	const fotosVon = new Map(fotosModule.map((f) => [f.id, f]));
	const dateiVon = new Map<string, typeof dateiZeilen>();
	for (const d of dateiZeilen) {
		if (d.modulId === null) continue;
		const liste = dateiVon.get(d.modulId) ?? [];
		liste.push(d);
		dateiVon.set(d.modulId, liste);
	}
	const rang = new Map(optionen.map((o, i) => [o.id, i]));
	// Einmal nach Umfrage gruppiert statt je Umfrage die ganze Liste zu filtern: Der Aufwand waechst so
	// mit der Zahl der Antworten, nicht mit Umfragen mal Antworten. Die Reihenfolge der Abfrage bleibt erhalten.
	const antwortenVon = new Map<string, AntwortDaten[]>();
	for (const a of antworten) {
		const liste = antwortenVon.get(a.umfrageId) ?? [];
		liste.push({
			fuerId: a.fuerId,
			vonId: a.vonId,
			// In der Reihenfolge der Optionen, nicht der Datenbank: die Ansicht ist so unabhaengig vom Zufall.
			optionIds: a.optionen.map((o) => o.optionId).sort((x, y) => (rang.get(x) ?? 0) - (rang.get(y) ?? 0)),
			abgegebenAm: a.abgegebenAm,
		});
		antwortenVon.set(a.umfrageId, liste);
	}
	// Ebenso gruppiert: Eintraege je Position, Positionen je Modul, die Reihenfolge der Abfragen bleibt.
	const eintraegeVon = new Map<string, HelferEintragDaten[]>();
	for (const { positionId, ...eintrag } of eintraege) {
		const liste = eintraegeVon.get(positionId) ?? [];
		liste.push(eintrag);
		eintraegeVon.set(positionId, liste);
	}
	const positionenVon = new Map<string, HelferDaten['positionen'][number][]>();
	for (const p of positionen) {
		const liste = positionenVon.get(p.modulId) ?? [];
		liste.push({
			id: p.id,
			schluessel: p.schluessel,
			text: p.text,
			anzahl: p.anzahl,
			eintraege: eintraegeVon.get(p.id) ?? [],
		});
		positionenVon.set(p.modulId, liste);
	}

	// Autos und Mitfahrten je Fahrgemeinschaft, in der Reihenfolge der Abfragen (siehe oben).
	const autosVon = new Map<string, AutoDaten[]>();
	for (const a of autoZeilen) {
		const liste = autosVon.get(a.modulId) ?? [];
		liste.push({
			id: a.id,
			fahrerId: a.fahrerId,
			richtung: a.richtung,
			plaetze: a.plaetze,
			abfahrtTag: a.abfahrtTag ? tag(a.abfahrtTag) : null,
			abfahrtZeit: a.abfahrtZeit,
			ort: a.ort,
			notiz: a.notiz,
			angelegtAm: a.angelegtAm,
		});
		autosVon.set(a.modulId, liste);
	}
	const mitfahrtenVon = new Map<string, MitfahrtDaten[]>();
	for (const m of mitfahrtZeilen) {
		const liste = mitfahrtenVon.get(m.modulId) ?? [];
		liste.push({
			richtung: m.richtung,
			kindId: m.kindId,
			autoId: m.autoId,
			vonId: m.vonId,
			eingetragenAm: m.eingetragenAm,
		});
		mitfahrtenVon.set(m.modulId, liste);
	}

	// Erschoepfend ueber den Typ des Moduls, wie vergleicheBestehendes: Ein neuer Wert in ModulTyp
	// bricht hier den Bau. Vorher fiel alles Unbekannte in den Umfrage-Zweig, fand dort keine Zeile
	// und verschwand still aus dem Thread (Gesamtreview TP4 Etappe 3, M7).
	const modulVon = (m: (typeof moduleZeilen)[number]): ModulDaten | null => {
		const titel = m.titel;
		switch (m.typ) {
			case 'INFO': {
				const info = infoVon.get(m.id);
				return info ? { typ: 'INFO', id: m.id, titel, text: info.text } : null;
			}
			case 'TERMIN': {
				const t = terminVon.get(m.id);
				if (!t) return null;
				const termin: TerminDaten = {
					modulId: m.id,
					startDatum: tag(t.startDatum),
					endDatum: t.endDatum ? tag(t.endDatum) : null,
					beginn: t.beginn,
					ende: t.ende,
					ort: t.ort,
					treffpunkt: t.treffpunkt,
				};
				return { typ: 'TERMIN', id: m.id, titel, termin };
			}
			case 'DATEIEN':
				if (!dateienModulIds.has(m.id)) return null;
				return {
					typ: 'DATEIEN',
					id: m.id,
					titel,
					dateien: (dateiVon.get(m.id) ?? []).map((d): DateiDaten => ({
						id: d.id,
						name: d.name,
						typ: d.typ,
						groesse: d.groesse,
						vonId: d.vonId,
						hochgeladenAm: d.hochgeladenAm,
					})),
				};
			case 'FOTOS': {
				const f = fotosVon.get(m.id);
				if (!f) return null;
				return {
					typ: 'FOTOS',
					id: m.id,
					titel,
					hochladen: f.hochladen,
					// Breite und Hoehe stehen bei Fotos immer (Spec 2.1); fehlen sie in einer kaputten Zeile,
					// zaehlt 0 statt eines Fehlers, damit ein Thread nicht an einem Foto haengt.
					fotos: (dateiVon.get(m.id) ?? []).map((d): FotoDaten => ({
						id: d.id,
						breite: d.breite ?? 0,
						hoehe: d.hoehe ?? 0,
						vonId: d.vonId,
						hochgeladenAm: d.hochgeladenAm,
					})),
				};
			}
			case 'HELFER': {
				const h = helferVon.get(m.id);
				if (!h) return null;
				const helfer: HelferDaten = {
					modulId: m.id,
					// Der Titel des Moduls, damit Regeln, die nur ThreadDaten bekommen, die Liste benennen koennen.
					titel,
					einheit: h.einheit,
					frist: h.frist,
					positionen: positionenVon.get(m.id) ?? [],
				};
				return { typ: 'HELFER', id: m.id, titel, helfer };
			}
			case 'FAHRT': {
				const f = fahrtVon.get(m.id);
				if (!f) return null;
				const fahrt: FahrtDaten = {
					modulId: m.id,
					// Wie bei der Helferliste: Regeln, die nur ThreadDaten bekommen, sollen das Modul benennen koennen.
					titel,
					hin: f.hin,
					rueck: f.rueck,
					autos: autosVon.get(m.id) ?? [],
					mitfahrten: mitfahrtenVon.get(m.id) ?? [],
				};
				return { typ: 'FAHRT', id: m.id, titel, fahrt };
			}
			case 'UMFRAGE': {
				const u = umfrageVon.get(m.id);
				if (!u) return null;
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
					antworten: antwortenVon.get(u.id) ?? [],
				};
				return { typ: 'UMFRAGE', id: m.id, titel, umfrage };
			}
			// Erschoepfend ueber typ: Ein neuer Modultyp bricht hier den Bau. Kommt zur Laufzeit doch einer
			// (Datenbank neuer als der Code), endet das Laden mit einem Fehler statt mit dem Typnamen als
			// Moduldaten. Verworfen: unerreichbar zurueckzugeben wie an den Stellen, die das Modul selbst
			// pruefen; hier waere der Rueckgabewert ein String, den jeder Aufrufer als Modul laese.
			default: {
				const unerreichbar: never = m.typ;
				throw new Error(`Unbekannter Modultyp: ${String(unerreichbar)}`);
			}
		}
	};

	return threads.map((thread) => ({
		letzteAktivitaetAm: thread.letzteAktivitaetAm,
		kopf: kopfAus(thread),
		module: moduleZeilen
			.filter((m) => m.threadId === thread.id)
			.flatMap((m) => {
				const modul = modulVon(m);
				return modul ? [modul] : [];
			}),
	}));
}

/**
 * Ein Thread mit allen Modulen, Optionen und Antworten, oder null, wenn es ihn im Verein
 * nicht gibt (ein fremder Verein ist ueber vereinDb ebenfalls "nicht da"). Nimmt auch die
 * Transaktion einer Schreibroute: Dort wird der Thread nach der Sperre der Vereinszeile
 * geladen, damit Pruefung und Schreiben denselben Stand sehen (Plan-Entscheidung 3).
 */
export async function ladeThread(db: VereinDb | VereinTx, threadId: string): Promise<GeladenerThread | null> {
	return (await ladeThreads(db, { threadIds: [threadId] }))[0] ?? null;
}

/**
 * Nur die Koepfe der genannten Threads, je ID einer; unbekannte IDs (auch die eines fremden
 * Vereins, ueber vereinDb) fehlen in der Map. Eine Abfrage samt Untergruppen, ohne Module und
 * Antworten: Wer nur wissen will, ob jemand einen Thread sehen darf, soll dafuer nicht alle
 * Module laden. Verworfen: ladeThreads und den Kopf herausziehen -- das laedt bei jedem Signal
 * Module, Optionen und Antworten mit, die niemand liest.
 */
export async function ladeKoepfe(db: VereinDb, threadIds: readonly string[]): Promise<Map<string, ThreadKopf>> {
	if (threadIds.length === 0) return new Map();
	const threads = await db.thread.findMany({
		where: { id: { in: [...threadIds] } },
		include: kopfEinbezug,
	});
	return new Map(threads.map((thread) => [thread.id, kopfAus(thread)]));
}

/**
 * Zu welchem Thread ein Modul gehoert und welcher Art es ist (jeder ModulTyp, auch HELFER und FAHRT); null,
 * wenn es im Verein kein solches Modul gibt.
 */
export async function modulOrt(db: VereinDb, modulId: string): Promise<{ threadId: string; typ: ModulTyp } | null> {
	const modul = await db.threadModul.findUnique({ where: { id: modulId }, select: { threadId: true, typ: true } });
	return modul ?? null;
}

/**
 * Zu welcher Helferliste und welchem Thread eine Position gehoert; null, wenn es sie im Verein
 * nicht gibt. Die Routen der Eintraege kennen nur die Position und brauchen den Thread fuer
 * Sichtbarkeit und Laden. Eine Abfrage ueber die Relationen statt zweier: vereinDb setzt den
 * Verein in die oberste Ebene, und die zusammengesetzten Fremdschluessel halten Position, Liste
 * und Modul im selben Verein, also kann der Weg nicht in einen fremden fuehren. Nimmt auch die
 * Transaktion einer Schreibroute, die den Ort unter der Sperre neu bestimmt.
 */
export async function positionOrt(
	db: VereinDb | VereinTx,
	positionId: string,
): Promise<{ modulId: string; threadId: string } | null> {
	const position = await db.helferPosition.findUnique({
		where: { id: positionId },
		select: { modulId: true, modul: { select: { modul: { select: { threadId: true } } } } },
	});
	return position ? { modulId: position.modulId, threadId: position.modul.modul.threadId } : null;
}

export interface NeuKandidaten {
	gelesenBis: number | null;
	verlaufGelesenBis: number | null;
	aenderungen: NeuAenderung[];
	nachrichten: NachrichtenEingabe['nachrichten'][number][];
}

/**
 * Die Aenderungen (und mit `mitNachrichten` die Nachrichten), aus denen die Domaene "neu"
 * bestimmt, fuer eine Liste von Threads, je Thread-ID ein Eintrag. Drei Abfragen, egal wie
 * viele Threads: die Gelesen-Staende der Person, die Aenderungen und die Nachrichten, die
 * beiden letzten mit einer OR-Bedingung je Thread.
 *
 * Es sind Kandidaten, kein Ergebnis: Je Thread kommen die Aenderungen ueber dem Gelesen-Stand
 * (`gt`, wie fremdeNeueAenderungen), ohne Gelesen-Zeile die ab dem Zugang (`gte`, ebenso),
 * und zwar von jedem Urheber und jeder Art. Ob eine fremd ist und zaehlt, entscheidet allein
 * die Domaene. Verworfen: `urheberId: { not: ich }` in der Abfrage -- `NULL <> x` ist in SQL
 * nicht wahr, Systemaenderungen ohne Urheber fielen still heraus, und die Regel stuende an
 * zwei Stellen. Die Grenzen muessen aber so weit sein wie die der Domaene, nie enger.
 *
 * Anders als bei der Ansicht eines Threads (ladeThreadAnsicht lehnt dort einen Zugangsfilter in
 * der Abfrage ab) filtert diese Abfrage nach Stand und Zugang: Die Liste betrifft alle Threads
 * des Vereins, und alle Aenderungen zu laden wuchse mit jeder Antwort der Vereinsgeschichte
 * (bis zum Aufraeumen nach 90 Tagen). Die Regel bleibt trotzdem in der Domaene; hier wird nur
 * vorsortiert.
 */
export async function ladeNeuKandidaten(
	db: VereinDb,
	personId: string,
	zugangSeit: Date,
	threadIds: readonly string[],
	mitNachrichten: boolean,
): Promise<Map<string, NeuKandidaten>> {
	const ergebnis = new Map<string, NeuKandidaten>();
	if (threadIds.length === 0) return ergebnis;

	const gelesen = await db.gelesenStand.findMany({
		where: { personId, threadId: { in: [...threadIds] } },
		select: { threadId: true, gelesenBis: true, verlaufGelesenBis: true },
	});
	const staende = new Map(gelesen.map((g) => [g.threadId, g]));
	for (const threadId of threadIds) {
		const stand = staende.get(threadId);
		ergebnis.set(threadId, {
			gelesenBis: stand?.gelesenBis ?? null,
			verlaufGelesenBis: stand?.verlaufGelesenBis ?? null,
			aenderungen: [],
			nachrichten: [],
		});
	}

	const [aenderungen, nachrichten] = await Promise.all([
		db.aenderung.findMany({
			where: {
				OR: threadIds.map((threadId) => {
					const bis = ergebnis.get(threadId)?.gelesenBis ?? null;
					return bis !== null ? { threadId, stand: { gt: bis } } : { threadId, angelegtAm: { gte: zugangSeit } };
				}),
			},
			select: { threadId: true, stand: true, art: true, urheberId: true, angelegtAm: true },
		}),
		mitNachrichten
			? db.verlaufEintrag.findMany({
					where: {
						art: 'NACHRICHT',
						OR: threadIds.map((threadId) => {
							const bis = ergebnis.get(threadId)?.verlaufGelesenBis ?? null;
							return bis !== null ? { threadId, stand: { gt: bis } } : { threadId, angelegtAm: { gte: zugangSeit } };
						}),
					},
					select: { threadId: true, art: true, stand: true, autorId: true, angelegtAm: true, geloeschtAm: true },
				})
			: Promise.resolve([]),
	]);
	for (const a of aenderungen) {
		if (a.threadId === null) continue;
		ergebnis.get(a.threadId)?.aenderungen.push({
			stand: a.stand,
			art: a.art,
			urheberId: a.urheberId,
			angelegtAm: a.angelegtAm,
		});
	}
	for (const n of nachrichten) {
		ergebnis.get(n.threadId)?.nachrichten.push({
			// Die Abfrage holt nur NACHRICHT; SYSTEM kommt in der Eingabe der Domaene vor, hier nie.
			art: 'NACHRICHT',
			stand: n.stand,
			autorId: n.autorId,
			angelegtAm: n.angelegtAm,
			geloeschtAm: n.geloeschtAm,
		});
	}
	return ergebnis;
}
