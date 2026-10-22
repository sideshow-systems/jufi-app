import { mitAenderung, vereinDb, type PrismaClient } from '@jufi/db';
import {
	teilnahmeOptionen,
	type AntwortEinheit,
	type ArchivModus,
	type Beziehung,
	type ErgebnisSicht,
	type FotoHochladen,
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
	| { typ: 'FOTOS'; hochladen?: FotoHochladen; fotos?: { vonId?: string }[] };

/** Schluessel einer freien Option aus ihrem Text: "Pizza essen" wird "pizza-essen" (CHECK option_schluessel). */
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
 * eines Threads denselben Schluessel, gilt die spaetere.
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
): Promise<{ threadId: string; modulIds: string[]; optionIds: Record<string, string>; dateiIds: string[] }> {
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
				ergebnis: { threadId: thread.id, modulIds, optionIds, dateiIds },
				aenderungen: [
					{ threadId: thread.id, art: 'THREAD' as const, objektId: thread.id },
					...modulIds.map((id) => ({ threadId: thread.id, art: 'MODUL' as const, objektId: id })),
				],
			};
		}),
	);
	return ergebnis;
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
