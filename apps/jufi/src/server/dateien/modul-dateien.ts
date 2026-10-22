import { mitAenderung, type AenderungEingabe, type VereinDb, type VereinTx } from '@jufi/db';
import {
	absenderName,
	bereinigeDateiname,
	darfBearbeiten,
	darfFotoLoeschen,
	darfFotosHochladen,
	FEHLER_TEXT,
	GRENZE_ANZAHL,
	passendeEndung,
	pruefeDateiname,
	siehtThread,
	threadDatenAus,
	type DateiArt,
	type DateiZeile,
	type FotoZeile,
	type ThreadKopf,
	type ThreadPerson,
	type Umfeld,
} from '@jufi/domain';
import type { Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { Wiederholung } from '../threads/fehler.js';
import { ladeThread, ladeThreadUmfeld, modulOrt } from '../threads/laden.js';
import { vereinsKontext } from '../verein.js';
import { Abbruch, antworteBeiAbbruch, fruehAntwort, nimmDatei, type NeueDatei } from './annehmen.js';
import { loescheDateien } from './loeschen.js';

// Hochladen, Umbenennen und Loeschen in Datei- und Foto-Modulen (TP4-Spec 3, Plan Task 6).
// Jede Route schreibt in mitAenderung eine Aenderung MODUL ohne Systemeintrag und meldet nach dem
// Commit an deps.bus: Wer den Thread offen hat, sieht neue Fotos sofort. Verworfen: ein
// Verlaufseintrag "hat 3 Fotos hochgeladen" -- bei 40 Fotos eines Zeltlagers ueberschwemmte er den
// Verlauf, und die Fotos selbst stehen ohnehin sichtbar im Modul.

const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

type MedienTyp = 'DATEIEN' | 'FOTOS';

const ART: Record<MedienTyp, DateiArt> = { DATEIEN: 'DATEI', FOTOS: 'FOTO' };

/** Was eine Route ueber das Modul weiss, nachdem die Person dort hochladen darf. */
interface Erlaubt {
	kopf: ThreadKopf;
	umfeld: Umfeld;
	mich: ThreadPerson;
	anzahl: number;
}

/**
 * Ob die Person in dieses Modul hochladen darf, oder null fuer "nicht gefunden" (404, nie 403,
 * Rahmen-Spec 8; Plan-Entscheidung 5). Dieselbe Pruefung vor dem Koerper und noch einmal unter
 * der Sperre, weil zwischen beiden das Hochladen und die Fotoverarbeitung liegen: Wer in der
 * Zeit entfernt wird, das Recht verliert oder dessen Thread ins Archiv geht, laedt nichts mehr hinein.
 *
 * Die Person kommt aus dem Umfeld, das nur nicht entfernte Personen kennt: Eine entfernte Person
 * fehlt dort und bekommt 404, auch wenn ihre Sitzung bis hierher noch galt. Verworfen: der
 * Person aus der Sitzung zu glauben -- darfFotoLoeschen und darfFotosHochladen pruefen entferntAm
 * nicht in jedem Zweig.
 */
async function darfHochladen(
	db: VereinDb | VereinTx,
	e: { personId: string; threadId: string; modulId: string; typ: MedienTyp; jetzt: Date },
): Promise<Erlaubt | null> {
	const [umfeld, thread] = await Promise.all([ladeThreadUmfeld(db), ladeThread(db, e.threadId)]);
	const mich = umfeld.personen.get(e.personId);
	const modul = thread?.module.find((m) => m.id === e.modulId);
	if (!thread || !mich || !modul || !siehtThread(mich, thread.kopf, umfeld)) return null;
	if (modul.typ === 'DATEIEN' && e.typ === 'DATEIEN') {
		return darfBearbeiten(mich, thread.kopf) ? { kopf: thread.kopf, umfeld, mich, anzahl: modul.dateien.length } : null;
	}
	if (modul.typ === 'FOTOS' && e.typ === 'FOTOS') {
		const { termine } = threadDatenAus(thread.kopf, thread.module);
		return darfFotosHochladen(mich, thread.kopf, modul.hochladen, { umfeld, termine, jetzt: e.jetzt })
			? { kopf: thread.kopf, umfeld, mich, anzahl: modul.fotos.length }
			: null;
	}
	return null;
}

/** Eine Datei eines Moduls samt Thread, wie die Person sie sieht; null, wenn sie fehlt, zu einem Dokument gehoert oder unsichtbar ist. */
async function ladeModulDatei(tx: VereinTx, personId: string, dateiId: string) {
	const datei = await tx.datei.findFirst({
		where: { id: dateiId, modulId: { not: null } },
		select: {
			id: true,
			art: true,
			modulId: true,
			name: true,
			typ: true,
			groesse: true,
			vonId: true,
			hochgeladenAm: true,
		},
	});
	if (!datei?.modulId) return null;
	const modul = await tx.threadModul.findUnique({ where: { id: datei.modulId }, select: { threadId: true } });
	if (!modul) return null;
	const [umfeld, thread] = await Promise.all([ladeThreadUmfeld(tx), ladeThread(tx, modul.threadId)]);
	// Wie bei darfHochladen: eine entfernte Person fehlt im Umfeld.
	const mich = umfeld.personen.get(personId);
	if (!thread || !mich || !siehtThread(mich, thread.kopf, umfeld)) return null;
	return { datei: { ...datei, modulId: datei.modulId }, threadId: modul.threadId, kopf: thread.kopf, mich };
}

function dateiZeile(d: { id: string; name: string; typ: string; groesse: number; hochgeladenAm: Date }): DateiZeile {
	return { id: d.id, name: d.name, typ: d.typ, groesse: d.groesse, hochgeladenAm: d.hochgeladenAm.toISOString() };
}

export function modulDateiRouten(router: Router, deps: VolleAppDeps): void {
	const { bus } = deps;

	const melde = (vereinId: string, stand: number, aenderungen: readonly AenderungEingabe[]) =>
		bus.melde({ typ: 'aenderung', vereinId, stand, aenderungen, eintraege: [] });

	/**
	 * Der gemeinsame Teil beider Upload-Routen. Ort, Sichtbarkeit, Recht und Anzahl vor dem Koerper
	 * (Connection: close, weil der Koerper ungelesen bleibt), Rate-Limit, Schlange und Kontingent in
	 * nimmDatei; unter der Sperre dasselbe noch einmal, denn zwei Uploads in ein Modul mit 19 Dateien
	 * bestehen beide die erste Pruefung.
	 */
	async function ladeHoch(
		req: Parameters<typeof nimmDatei>[0],
		res: Response,
		typ: MedienTyp,
		zeile: (datei: NeueDatei, jetzt: Date, erlaubt: Erlaubt) => DateiZeile | FotoZeile,
	): Promise<void> {
		const { verein, db } = vereinsKontext(res);
		const { person } = mitgliedKontext(res);
		const modulId = req.params['modulId'] ?? '';
		const art = ART[typ];
		const ort = await modulOrt(db, modulId);
		const vorab =
			ort?.typ === typ
				? await darfHochladen(db, { personId: person.id, threadId: ort.threadId, modulId, typ, jetzt: deps.jetzt() })
				: null;
		if (!ort || !vorab) return fruehAntwort(res, 404, NICHT_GEFUNDEN);
		const voll = { fehler: FEHLER_TEXT.VOLL[art], code: 'VOLL' as const };
		if (vorab.anzahl >= GRENZE_ANZAHL[art]) return fruehAntwort(res, 409, voll);
		const { threadId } = ort;

		const ergebnis = await nimmDatei(req, res, deps, {
			art,
			name: art === 'DATEI' ? bereinigeDateiname(req.header('x-dateiname')) : null,
			freiBytes: 0,
			schreibe: (tx, datei) => {
				const jetzt = deps.jetzt();
				return mitAenderung(tx, verein.id, person.id, jetzt, async () => {
					const erlaubt = await darfHochladen(tx, { personId: person.id, threadId, modulId, typ, jetzt });
					if (!erlaubt) throw new Abbruch(404, NICHT_GEFUNDEN);
					if (erlaubt.anzahl >= GRENZE_ANZAHL[art]) throw new Abbruch(409, voll);
					await tx.datei.create({
						data: {
							id: datei.id,
							art,
							modulId,
							name: datei.name,
							typ: datei.typ,
							groesse: datei.groesse,
							breite: datei.breite,
							hoehe: datei.hoehe,
							sha256: datei.sha256,
							vonId: person.id,
							hochgeladenAm: jetzt,
						},
					});
					return {
						ergebnis: zeile(datei, jetzt, erlaubt),
						aenderungen: [{ threadId, art: 'MODUL' as const, objektId: modulId }],
					};
				});
			},
			nachDemCommit: ({ stand, aenderungen }) => melde(verein.id, stand, aenderungen),
		});
		if (ergebnis.ok) res.status(201).json(ergebnis.wert.ergebnis);
	}

	router.post(
		'/module/:modulId/dateien',
		brauchtMitglied,
		asynchron((req, res) => ladeHoch(req, res, 'DATEIEN', (d, jetzt) => dateiZeile({ ...d, hochgeladenAm: jetzt }))),
	);

	router.post(
		'/module/:modulId/fotos',
		brauchtMitglied,
		asynchron((req, res) =>
			ladeHoch(req, res, 'FOTOS', (d, jetzt, { kopf, umfeld, mich }) => ({
				id: d.id,
				breite: d.breite ?? 0,
				hoehe: d.hoehe ?? 0,
				von: absenderName(mich.id, umfeld),
				hochgeladenAm: jetzt.toISOString(),
				darfLoeschen: darfFotoLoeschen(mich, kopf, mich.id),
			})),
		),
	);

	/**
	 * Umbenennen gibt es nur fuer Dateien eines Datei-Moduls: Fotos haben keinen Namen
	 * (Plan-Entscheidung 12), Dokumente benennt die Verwaltung ueber ihren Titel um. Der Name wird
	 * bereinigt wie beim Hochladen, und die Endung folgt dem erkannten Typ, nicht der Eingabe
	 * (Entscheidung 9). Die Form des Koerpers zuerst: Sie haengt nicht an der Datei und verraet
	 * also nichts ueber sie.
	 */
	router.put(
		'/dateien/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const roh: unknown = (req.body as { name?: unknown } | undefined)?.name;
			if (typeof roh !== 'string')
				return void res.status(400).json({ fehler: 'Bitte einen Namen angeben', feld: 'name' });
			const geprueft = pruefeDateiname(roh);
			if (!geprueft.ok) return void res.status(400).json({ fehler: geprueft.fehler, feld: 'name' });

			const jetzt = deps.jetzt();
			try {
				const { stand, aenderungen, ergebnis } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, jetzt, async () => {
						const ziel = await ladeModulDatei(tx, person.id, req.params['id'] ?? '');
						if (!ziel || ziel.datei.art !== 'DATEI' || !darfBearbeiten(ziel.mich, ziel.kopf)) {
							throw new Abbruch(404, NICHT_GEFUNDEN);
						}
						const name = passendeEndung(geprueft.name, ziel.datei.typ);
						// Ohne Wirkung keine Aenderung (TP3-Spec 2.6): Der Wurf nimmt den eben vergebenen Stand
						// zurueck, und niemand bekommt ein Signal fuer nichts.
						if (name === ziel.datei.name) throw new Wiederholung(dateiZeile(ziel.datei));
						const neu = await tx.datei.update({ where: { id: ziel.datei.id }, data: { name } });
						return {
							ergebnis: dateiZeile(neu),
							aenderungen: [{ threadId: ziel.threadId, art: 'MODUL' as const, objektId: ziel.datei.modulId }],
						};
					}),
				);
				melde(verein.id, stand, aenderungen);
				res.json(ergebnis);
			} catch (fehler) {
				if (fehler instanceof Wiederholung) return void res.json(fehler.vorhanden);
				if (!antworteBeiAbbruch(res, fehler)) throw fehler;
			}
		}),
	);

	/**
	 * Ein Foto zieht jeder selbst zurueck, das fremde und jede Datei nur, wer den Thread bearbeitet
	 * (darfFotoLoeschen, darfBearbeiten). Die Entscheidung faellt unter der Sperre: Das Loeschen
	 * eines ganzen Moduls im Editor und dieses Loeschen sollen nicht beide dieselbe Zeile auf die
	 * Loeschliste setzen. Die Bytes bleiben bis zum Aufraeumer liegen (loescheDateien).
	 */
	router.delete(
		'/dateien/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const jetzt = deps.jetzt();
			try {
				const { stand, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, jetzt, async () => {
						const ziel = await ladeModulDatei(tx, person.id, req.params['id'] ?? '');
						const darf =
							ziel !== null &&
							(ziel.datei.art === 'FOTO'
								? darfFotoLoeschen(ziel.mich, ziel.kopf, ziel.datei.vonId)
								: darfBearbeiten(ziel.mich, ziel.kopf));
						if (!ziel || !darf) throw new Abbruch(404, NICHT_GEFUNDEN);
						await loescheDateien(tx, verein.id, [ziel.datei], jetzt);
						return {
							ergebnis: undefined,
							aenderungen: [{ threadId: ziel.threadId, art: 'MODUL' as const, objektId: ziel.datei.modulId }],
						};
					}),
				);
				melde(verein.id, stand, aenderungen);
				res.status(204).end();
			} catch (fehler) {
				if (!antworteBeiAbbruch(res, fehler)) throw fehler;
			}
		}),
	);
}
