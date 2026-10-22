import { mitAenderung, vereinDb, type PrismaClient, type VereinDb } from '@jufi/db';
import {
	teilnahmeOptionen,
	type AntwortEinheit,
	type ArchivModus,
	type Beziehung,
	type ErgebnisSicht,
	type FotoHochladen,
	type Richtung,
	type Rollenfilter,
	type TerminDaten,
	type ThreadArt,
	type ThreadModus,
} from '@jufi/domain';
import { randomUUID } from 'node:crypto';

// Nur fuer Tests (wie test-vereine.ts): Threads und die Personen darum herum direkt in der
// Datenbank anlegen. Der Weg ueber die Routen steht in deren eigenen Tests; hier geht es um
// alles, was ein Thread an Daten braucht.

export type TestModul =
	| { typ: 'INFO'; text: string }
	| { typ: 'TERMIN'; termin: Omit<TerminDaten, 'modulId'> }
	| {
			typ: 'UMFRAGE';
			frage?: string;
			einheit?: AntwortEinheit;
			mehrfach?: boolean;
			teilnahme?: boolean;
			vielleicht?: boolean;
			frist?: Date | null;
			ergebnisse?: ErgebnisSicht;
			/** Texte freier Optionen; bei `teilnahme` gelten stattdessen die festen Teilnahme-Optionen. */
			optionen?: string[];
	  }
	/** Dateien als Zeilen ohne Bytes; `vonId` ungesetzt heisst der Ersteller des Threads. */
	| { typ: 'DATEIEN'; dateien?: { name?: string; vonId?: string }[] }
	/** Fotos als Zeilen ohne Bytes (Fassung und Vorschau gibt es nur im Speicher). */
	| { typ: 'FOTOS'; hochladen?: FotoHochladen; fotos?: { vonId?: string }[] }
	/** Positionen mit dem Text als Schluessel (wie freie Optionen); Eintraege schreibt trageEinTest. */
	| {
			typ: 'HELFER';
			einheit?: AntwortEinheit;
			frist?: Date | null;
			positionen: { text: string; anzahl: number }[];
	  }
	/** Ohne Autos und Mitfahrten; die schreiben bieteAutoTest und setzeEinTest. Ohne Angabe beide Richtungen. */
	| { typ: 'FAHRT'; hin?: boolean; rueck?: boolean };

/**
 * Schluessel einer freien Option oder Position aus ihrem Text: "Pizza essen" wird "pizza-essen"
 * (CHECK option_schluessel und helfer_position_schluessel).
 */
function schluesselAus(text: string, nummer: number): string {
	const schluessel = text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return schluessel === '' ? `option-${nummer}` : schluessel;
}

/**
 * Legt einen Thread mit Modulen an und liefert die IDs. Geschrieben wird wie in den Routen
 * ueber vereinDb und mitAenderung (Art THREAD, dazu je Modul MODUL), damit Vereinsstand und
 * letzte Aktivitaet in Tests stimmen. `optionIds` ist nach dem Schluessel der Option
 * geordnet (dabei, vielleicht, abgesagt oder der Text als Schluessel); haben zwei Umfragen
 * eines Threads denselben Schluessel, gilt die spaetere. `positionIds` ebenso nach dem
 * Schluessel einer Position (der Text als Schluessel).
 *
 * Ohne `erstelltVonId` bekommt ein normaler Thread eine eigene Person als Ersteller, weil
 * die Datenbank einen verlangt (CHECK thread_ersteller); `null` ist nur fuer den Austausch
 * gedacht, den legeVereinAn schon anlegt.
 *
 * `untergruppenIds` ungesetzt heisst "Alle", eine (auch leere) Liste die Auswahl.
 */
export async function legeThreadAn(
	prisma: PrismaClient,
	verein: { id: string },
	jetzt: Date,
	daten: {
		titel?: string;
		art?: ThreadArt;
		modus?: ThreadModus;
		rollenfilter?: Rollenfilter;
		untergruppenIds?: string[];
		veroeffentlicht?: boolean;
		erstelltVonId?: string | null;
		archivModus?: ArchivModus;
		module?: TestModul[];
	} = {},
): Promise<{
	threadId: string;
	modulIds: string[];
	optionIds: Record<string, string>;
	positionIds: Record<string, string>;
	dateiIds: string[];
}> {
	const db = vereinDb(prisma, verein.id);
	const art = daten.art ?? 'NORMAL';
	let erstelltVonId = daten.erstelltVonId;
	if (erstelltVonId === undefined && art === 'NORMAL') {
		const ersteller = await db.person.create({
			data: {
				art: 'ERWACHSENER',
				vorname: 'Ersteller',
				nachname: 'Test',
				email: `ersteller-${randomUUID().slice(0, 8)}@example.test`,
				rechte: ['THREADS_ERSTELLEN'],
			},
		});
		erstelltVonId = ersteller.id;
	}

	const { ergebnis } = await db.$transaction((tx) =>
		mitAenderung(tx, verein.id, erstelltVonId ?? null, jetzt, async () => {
			const thread = await tx.thread.create({
				data: {
					art,
					titel: daten.titel ?? 'Testthread',
					modus: daten.modus ?? 'KOMMENTARE',
					rollenfilter: daten.rollenfilter ?? 'JUNGFISCHER_FAMILIE',
					alleUntergruppen: daten.untergruppenIds === undefined,
					archivModus: daten.archivModus ?? 'AUTOMATISCH',
					veroeffentlichtAm: (daten.veroeffentlicht ?? true) ? jetzt : null,
					erstelltVonId: erstelltVonId ?? null,
					angelegtAm: jetzt,
				},
			});
			if (daten.untergruppenIds?.length) {
				await tx.threadUntergruppe.createMany({
					data: daten.untergruppenIds.map((untergruppeId) => ({ threadId: thread.id, untergruppeId })),
				});
			}

			const modulIds: string[] = [];
			const optionIds: Record<string, string> = {};
			const positionIds: Record<string, string> = {};
			const dateiIds: string[] = [];
			for (const [position, modul] of (daten.module ?? []).entries()) {
				const zeile = await tx.threadModul.create({ data: { threadId: thread.id, typ: modul.typ, position } });
				modulIds.push(zeile.id);
				if (modul.typ === 'INFO') {
					await tx.infoModul.create({ data: { id: zeile.id, text: modul.text } });
				} else if (modul.typ === 'DATEIEN' || modul.typ === 'FOTOS') {
					const foto = modul.typ === 'FOTOS';
					if (foto) {
						await tx.fotosModul.create({ data: { id: zeile.id, hochladen: modul.hochladen ?? 'JUGENDLEITER' } });
					} else {
						await tx.dateienModul.create({ data: { id: zeile.id } });
					}
					const dateien = foto ? (modul.fotos ?? []) : (modul.dateien ?? []);
					for (const [nummer, d] of dateien.entries()) {
						const datei = await tx.datei.create({
							data: {
								art: foto ? 'FOTO' : 'DATEI',
								modulId: zeile.id,
								// Fotos haben keinen Namen (Plan-Entscheidung 12).
								name: foto ? '' : ((d as { name?: string }).name ?? `datei-${nummer + 1}.pdf`),
								typ: foto ? 'image/jpeg' : 'application/pdf',
								groesse: 1000,
								breite: foto ? 800 : null,
								hoehe: foto ? 600 : null,
								sha256: 'x',
								vonId: d.vonId ?? (erstelltVonId as string),
								hochgeladenAm: jetzt,
							},
							select: { id: true },
						});
						dateiIds.push(datei.id);
					}
				} else if (modul.typ === 'HELFER') {
					await tx.helferModul.create({
						data: { id: zeile.id, einheit: modul.einheit ?? 'ERWACHSENER', frist: modul.frist ?? null },
					});
					for (const [stelle, p] of modul.positionen.entries()) {
						const schluessel = schluesselAus(p.text, stelle + 1);
						const position = await tx.helferPosition.create({
							data: { modulId: zeile.id, text: p.text, anzahl: p.anzahl, position: stelle, schluessel },
							select: { id: true },
						});
						positionIds[schluessel] = position.id;
					}
				} else if (modul.typ === 'FAHRT') {
					await tx.fahrtModul.create({
						data: { id: zeile.id, threadId: thread.id, hin: modul.hin ?? true, rueck: modul.rueck ?? true },
					});
				} else if (modul.typ === 'TERMIN') {
					const t = modul.termin;
					await tx.terminModul.create({
						data: {
							id: zeile.id,
							startDatum: new Date(t.startDatum),
							endDatum: t.endDatum ? new Date(t.endDatum) : null,
							beginn: t.beginn,
							ende: t.ende,
							ort: t.ort,
							treffpunkt: t.treffpunkt,
						},
					});
				} else {
					const teilnahme = modul.teilnahme ?? false;
					const vielleicht = modul.vielleicht ?? true;
					await tx.umfrageModul.create({
						data: {
							id: zeile.id,
							threadId: thread.id,
							frage: modul.frage ?? (teilnahme ? 'Kommst du mit?' : 'Was meinst du?'),
							einheit: modul.einheit ?? 'JUNGFISCHER',
							mehrfach: modul.mehrfach ?? false,
							teilnahme,
							vielleicht,
							frist: modul.frist ?? null,
							ergebnisse: modul.ergebnisse ?? 'ALLE',
						},
					});
					const optionen = teilnahme
						? teilnahmeOptionen(vielleicht)
						: (modul.optionen ?? ['Ja', 'Nein']).map((text, i) => ({ text, schluessel: schluesselAus(text, i + 1) }));
					for (const [stelle, option] of optionen.entries()) {
						const o = await tx.umfrageOption.create({
							data: { umfrageId: zeile.id, text: option.text, schluessel: option.schluessel, position: stelle },
						});
						optionIds[option.schluessel] = o.id;
					}
				}
			}
			return {
				ergebnis: { threadId: thread.id, modulIds, optionIds, positionIds, dateiIds },
				aenderungen: [
					{ threadId: thread.id, art: 'THREAD' as const, objektId: thread.id },
					...modulIds.map((id) => ({ threadId: thread.id, art: 'MODUL' as const, objektId: id })),
				],
			};
		}),
	);
	return ergebnis;
}

let letzterEintrag = 0;

/**
 * Traegt eine Person in eine Position ein, direkt in der Datenbank, ohne Route und ohne
 * Aenderung: Tests, die Speichern, Laden oder Loeschen pruefen, brauchen nur die Zeile.
 * Jeder Aufruf bekommt einen spaeteren Zeitpunkt als der vorige (Wanduhr, mindestens eine
 * Millisekunde weiter), damit mehrere Eintraege in der Reihenfolge der Aufrufe stehen.
 * Verworfen: ein fester Zeitpunkt oder die blosse Wanduhr -- bei gleicher Zeit ordnete die
 * ID, und die ist zufaellig.
 */
export async function trageEinTest(
	db: VereinDb,
	positionId: string,
	fuerId: string,
	vonId: string,
	notiz: string | null = null,
): Promise<string> {
	letzterEintrag = Math.max(Date.now(), letzterEintrag + 1);
	const eintrag = await db.helferEintrag.create({
		data: { positionId, fuerId, vonId, notiz, eingetragenAm: new Date(letzterEintrag), clientId: randomUUID() },
		select: { id: true },
	});
	return eintrag.id;
}

/**
 * Bietet ein Auto an, direkt in der Datenbank, ohne Route und ohne Aenderung (wie trageEinTest);
 * liefert die ID des Autos. `angelegtAm` ungesetzt ist ein spaeterer Zeitpunkt als beim Aufruf
 * davor, damit die Autos in der Reihenfolge der Aufrufe stehen.
 */
export async function bieteAutoTest(
	db: VereinDb,
	modulId: string,
	fahrerId: string,
	richtung: Richtung,
	plaetze: number,
	felder: {
		abfahrtTag?: string | null;
		abfahrtZeit?: string | null;
		ort?: string | null;
		notiz?: string | null;
		angelegtAm?: Date;
	} = {},
): Promise<string> {
	letzterEintrag = Math.max(Date.now(), letzterEintrag + 1);
	const auto = await db.auto.create({
		data: {
			modulId,
			fahrerId,
			richtung,
			plaetze,
			abfahrtTag: felder.abfahrtTag ? new Date(felder.abfahrtTag) : null,
			abfahrtZeit: felder.abfahrtZeit ?? null,
			ort: felder.ort ?? null,
			notiz: felder.notiz ?? null,
			angelegtAm: felder.angelegtAm ?? new Date(letzterEintrag),
			clientId: randomUUID(),
		},
		select: { id: true },
	});
	return auto.id;
}

/**
 * Setzt ein Kind in ein Auto (`autoId`) oder auf "kommt selbst" (null), direkt in der Datenbank.
 * Die Zeit wie bei bieteAutoTest; liefert die ID der Mitfahrt.
 */
export async function setzeEinTest(
	db: VereinDb,
	modulId: string,
	richtung: Richtung,
	kindId: string,
	autoId: string | null,
	vonId: string,
): Promise<string> {
	letzterEintrag = Math.max(Date.now(), letzterEintrag + 1);
	const mitfahrt = await db.mitfahrt.create({
		data: {
			modulId,
			richtung,
			kindId,
			// Die unchecked-Form: autoId null ist hier "kommt selbst", kein Abwaehlen einer Relation.
			autoId,
			vonId,
			eingetragenAm: new Date(letzterEintrag),
			clientId: randomUUID(),
		},
		select: { id: true },
	});
	return mitfahrt.id;
}

/** Ordnet einem Erwachsenen ein Kind zu (erziehungsberechtigt, wie es der haeufigste Fall ist). */
export async function ordneZu(
	prisma: PrismaClient,
	verein: { id: string },
	erwachsenerId: string,
	kindId: string,
	beziehung: Beziehung = 'MUTTER',
): Promise<void> {
	await vereinDb(prisma, verein.id).bezugsperson.create({
		data: { erwachsenerId, jungfischerId: kindId, beziehung, erziehungsberechtigt: true },
	});
}

export async function machJugendsprecher(prisma: PrismaClient, personId: string): Promise<void> {
	await prisma.person.update({ where: { id: personId }, data: { jugendsprecher: true } });
}

/** Nimmt die Person in die Untergruppe auf, die es bei Bedarf anlegt; liefert deren ID. */
export async function steckeInUntergruppe(
	prisma: PrismaClient,
	verein: { id: string },
	personId: string,
	name: string,
): Promise<string> {
	const db = vereinDb(prisma, verein.id);
	const gruppe =
		(await db.untergruppe.findFirst({ where: { name } })) ?? (await db.untergruppe.create({ data: { name } }));
	await db.untergruppeMitglied.create({ data: { untergruppeId: gruppe.id, personId } });
	return gruppe.id;
}
