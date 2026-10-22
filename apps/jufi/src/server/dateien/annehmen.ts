import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { sperreVereinszeile, type VereinDb, type VereinTx } from '@jufi/db';
import {
	erkenneTyp,
	FEHLER_TEXT,
	GRENZE_BYTES,
	kontingentReicht,
	MB,
	passendeEndung,
	speicherText,
	type DateiArt,
	type DateiFehlerCode,
} from '@jufi/domain';
import type { Request, Response } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { verarbeiteFoto } from './foto.js';
import { nimmUpload } from './hochladen.js';
import { dateiSchluessel } from './speicher.js';

// Die gemeinsame Annahme eines Uploads fuer Dokumente und Module. Eine Stelle, weil Reihenfolge
// und Aufraeumen ueberall gleich sein muessen: Rate-Limit und Kontingent vor dem Koerper, Typ am
// Inhalt, Bytes vor der Zeile, Kontingent unter der Sperre. Verworfen: je Route eine eigene Fassung
// -- Etappe 1 hatte zwei, und die dritte und vierte (Datei- und Foto-Modul) haetten die Luecken
// der ersten geerbt.

/**
 * Was die Dateien des Vereins zusammen wiegen. Eine Summe ueber Datei.groesse statt eines
 * mitgefuehrten Zaehlers am Verein: Ein Zaehler muesste mit jedem Anlegen, Ersetzen und
 * Loeschen mitwandern und liefe bei einem vergessenen Pfad still auseinander.
 *
 * _sum bei einem Int liefert Prisma als number; es ueberlaeuft nicht bei 2^31 (der Test mit 100
 * Dateien zu je 25 MB sichert das). Verworfen: $queryRaw -- vereinDb sperrt Rohabfragen, weil
 * sie den eingesetzten Verein umgingen.
 */
export async function verbrauchBytes(db: VereinDb | VereinTx): Promise<number> {
	const summe = await db.datei.aggregate({ _sum: { groesse: true } });
	return summe._sum.groesse ?? 0;
}

export interface AbbruchKoerper {
	fehler: string;
	code?: DateiFehlerCode;
	feld?: string;
}

/**
 * Ende einer Transaktion mit Status und Antwort. In der Transaktion geworfen, damit Prisma
 * zuruecknimmt, was bis dahin geschrieben wurde (auch den Stand aus mitAenderung); ein
 * Rueckgabewert liesse es stehen.
 */
export class Abbruch extends Error {
	constructor(
		readonly status: number,
		readonly body: AbbruchKoerper,
	) {
		super('Abgebrochen');
	}
}

/** Beantwortet einen Abbruch und meldet, ob es einer war; alles andere wirft der Aufrufer weiter. */
export function antworteBeiAbbruch(res: Response, fehler: unknown): boolean {
	if (!(fehler instanceof Abbruch)) return false;
	res.status(fehler.status).json(fehler.body);
	return true;
}

/**
 * Antwort, bevor der Koerper eines Uploads gelesen ist. Connection: close, weil ein
 * ungelesener Koerper die Verbindung fuer die naechste Anfrage verdirbt (hochladen.ts).
 */
export function fruehAntwort(res: Response, status: number, body: object): void {
	res.set('Connection', 'close').status(status).json(body);
}

function kontingentFehler(belegtBytes: number, grenzeMb: number): AbbruchKoerper {
	return {
		fehler: FEHLER_TEXT.KONTINGENT(speicherText(belegtBytes), speicherText(grenzeMb * MB)),
		code: 'KONTINGENT',
	};
}

/** Prueft das Kontingent unter der Sperre und wirft Abbruch(413), wenn die Datei nicht mehr passt. */
async function pruefeKontingent(tx: VereinTx, vereinId: string, bytes: number, freiBytes: number): Promise<void> {
	// Die Grenze neu lesen: Der Plattform-Admin kann sie zwischen dem Laden des Vereins und hier geaendert haben.
	const { speicherGrenzeMb } = await tx.verein.findUniqueOrThrow({
		where: { id: vereinId },
		select: { speicherGrenzeMb: true },
	});
	const belegt = await verbrauchBytes(tx);
	if (!kontingentReicht({ verbrauchBytes: belegt - freiBytes, grenzeMb: speicherGrenzeMb, zusatzBytes: bytes })) {
		// Die Bytes liegen schon im Speicher und bleiben dort als Waise fuer den Aufraeumer: sie
		// hier zu loeschen waere ein Schreibzugriff auf die Platte mitten in der Sperre.
		throw new Abbruch(413, kontingentFehler(belegt, speicherGrenzeMb));
	}
}

/** Eine angenommene Datei, deren Bytes schon unter ihrem Schluessel liegen; die Zeile legt `schreibe` an. */
export interface NeueDatei {
	id: string;
	art: DateiArt;
	name: string;
	typ: string;
	groesse: number;
	breite: number | null;
	hoehe: number | null;
	sha256: string;
}

const BESCHAEFTIGT: AbbruchKoerper = { fehler: FEHLER_TEXT.BESCHAEFTIGT, code: 'BESCHAEFTIGT' };

/**
 * Nimmt einen Upload an, in dieser Reihenfolge (Plan, Task 6): Rate-Limit, bei Fotos die
 * Schlange, Kontingent nach Content-Length, dann erst der Koerper; Groesse, Typ am Inhalt, bei
 * Fotos die Verarbeitung; Bytes unter ihren Schluessel; zuletzt die Transaktion unter der
 * Vereinssperre mit dem Kontingent nach der echten Groesse und `schreibe`. Ort, Sichtbarkeit,
 * Recht und Anzahl prueft der Aufrufer vorher, denn nur er kennt sie.
 *
 * `freiBytes` ist, was das Ersetzen an alten Bytes freigibt (0 beim Anlegen): Ein Verein an der
 * Grenze soll eine Datei durch eine gleich grosse tauschen koennen. Fuer die Pruefung vor dem
 * Koerper steht die Schaetzung aus Content-Length: Sie erspart das Hochladen von 25 MB in einen
 * vollen Verein. Verbindlich ist erst die zweite Pruefung in der Transaktion, weil zwei Uploads,
 * die einzeln passen, zusammen nicht passen muessen.
 *
 * Die Sperre nimmt diese Funktion selbst, nicht `schreibe`: Das Kontingent muss unter ihr
 * stehen, und Dokumente haben keinen Aenderungsstand. Ruft `schreibe` danach mitAenderung (die
 * Module), sperrt dessen UPDATE dieselbe Zeile in derselben Transaktion ein zweites Mal; das
 * kostet nichts und verklemmt nicht. Verworfen: das Kontingent in jedes `schreibe` -- eine
 * vergessene Pruefung liesse einen Verein still ueber seine Grenze wachsen.
 *
 * Bei `ok: false` ist die Antwort schon gesendet. Temp-Dateien verschwinden in jedem
 * Fehlerzweig; ein Fehler des Dateisystems wird geworfen und endet als 500.
 */
export async function nimmDatei<T>(
	req: Request,
	res: Response,
	deps: VolleAppDeps,
	e: {
		art: DateiArt;
		/** Der bereinigte Name aus X-Dateiname; Fotos haben keinen (Plan-Entscheidung 12). */
		name: string | null;
		freiBytes: number;
		schreibe: (tx: VereinTx, datei: NeueDatei) => Promise<T>;
		/** Nach dem Commit, etwa fuer deps.bus; bekommt, was `schreibe` geliefert hat. */
		nachDemCommit?: (wert: T) => void;
	},
): Promise<{ ok: true; wert: T } | { ok: false }> {
	const { verein, db } = vereinsKontext(res);
	const { person } = mitgliedKontext(res);
	const nein = (status: number, body: object): { ok: false } => {
		fruehAntwort(res, status, body);
		return { ok: false };
	};

	const wartezeit = deps.uploadFenster.pruefe(person.id);
	if (wartezeit > 0) {
		res.set('Retry-After', String(Math.ceil(wartezeit / 1000)));
		return nein(429, { fehler: 'Zu viele Uploads. Bitte warte einen Moment.' });
	}
	if (e.art === 'DATEI' && e.name === null) return nein(400, { fehler: 'Dateiname fehlt' });

	// Vor dem Koerper: Wer jetzt schon keinen Platz bekaeme, soll nicht erst 20 MB senden. Ein Platz
	// ist damit nicht reserviert; ist die Schlange nach dem Lesen voll, gilt dieselbe Antwort (unten).
	if (e.art === 'FOTO' && deps.fotoSchlange.voll()) {
		res.set('Retry-After', '2');
		return nein(503, BESCHAEFTIGT);
	}

	const laenge = req.header('content-length');
	const geschaetzt = laenge !== undefined && /^\d+$/u.test(laenge) ? Number(laenge) : 0;
	const belegt = await verbrauchBytes(db);
	if (
		!kontingentReicht({
			verbrauchBytes: belegt - e.freiBytes,
			grenzeMb: verein.speicherGrenzeMb,
			zusatzBytes: geschaetzt,
		})
	) {
		return nein(413, kontingentFehler(belegt, verein.speicherGrenzeMb));
	}

	const upload = await nimmUpload(req, { speicher: deps.dateiSpeicher, maxBytes: GRENZE_BYTES[e.art] });
	if (!upload.ok) {
		return upload.status === 411
			? nein(411, { fehler: 'Die Größe der Datei fehlt' })
			: nein(413, { fehler: FEHLER_TEXT.GROESSE[e.art], code: 'GROESSE' });
	}

	const typ = erkenneTyp(upload.kopf, e.name, e.art);
	if (!typ.ok) {
		await rm(upload.tempPfad, { force: true });
		res.status(415).json({ fehler: typ.grund === 'HEIC' ? FEHLER_TEXT.HEIC : FEHLER_TEXT.TYP[e.art], code: typ.grund });
		return { ok: false };
	}

	// Die ID steht vor der Zeile fest, weil die Bytes vorher abgelegt werden: Eine Zeile ohne
	// Bytes waere eine Datei, die sich nicht oeffnen laesst; Bytes ohne Zeile raeumt der
	// Aufraeumer als Waise weg. Verworfen: erst die Zeile, dann die Bytes -- ein Abbruch dazwischen
	// hinterliesse genau die Datei, die sich nicht oeffnen laesst.
	const id = randomUUID();
	let datei: NeueDatei;
	if (e.art === 'FOTO') {
		const foto = await nimmFoto(deps, verein.id, id, upload.tempPfad);
		if (!foto.ok) {
			if (foto.status === 503) res.set('Retry-After', '2');
			res.status(foto.status).json(foto.body);
			return { ok: false };
		}
		datei = foto.datei;
	} else {
		try {
			await deps.dateiSpeicher.uebernimm(upload.tempPfad, dateiSchluessel(verein.id, id));
		} catch (fehler) {
			await rm(upload.tempPfad, { force: true });
			throw fehler;
		}
		datei = {
			id,
			art: 'DATEI',
			// Plan-Entscheidung 9: Ein PNG namens "x.pdf" liesse sich beim Empfaenger nicht oeffnen.
			name: passendeEndung(e.name as string, typ.typ),
			typ: typ.typ,
			groesse: upload.bytes,
			breite: null,
			hoehe: null,
			sha256: upload.sha256,
		};
	}

	let wert: T;
	try {
		wert = await db.$transaction(async (tx) => {
			await sperreVereinszeile(tx, verein.id);
			await pruefeKontingent(tx, verein.id, datei.groesse, e.freiBytes);
			return e.schreibe(tx, datei);
		});
	} catch (fehler) {
		if (antworteBeiAbbruch(res, fehler)) return { ok: false };
		throw fehler;
	}
	e.nachDemCommit?.(wert);
	return { ok: true, wert };
}

/**
 * Verarbeitet ein hochgeladenes Foto in der Schlange und legt beide Fassungen unter ihre
 * Schluessel. Die Eingabe-Temp-Datei ist danach in jedem Fall weg: Gespeichert wird nur die
 * neu kodierte Fassung (ohne EXIF, Spec 13.2), nie das Original. Die Ausgaben raeumt
 * verarbeiteFoto bei einem Fehler selbst weg; nach Erfolg gehoeren sie hierher, bis uebernimm
 * sie verschoben hat.
 */
async function nimmFoto(
	deps: VolleAppDeps,
	vereinId: string,
	id: string,
	eingabe: string,
): Promise<{ ok: true; datei: NeueDatei } | { ok: false; status: number; body: AbbruchKoerper }> {
	let haupt: string;
	let vorschau: string;
	let ergebnis: Awaited<ReturnType<typeof verarbeiteFoto>>;
	try {
		haupt = await deps.dateiSpeicher.neueTempDatei();
		vorschau = await deps.dateiSpeicher.neueTempDatei();
		const lauf = deps.fotoSchlange.reihe(() => verarbeiteFoto(eingabe, { haupt, vorschau }));
		// Zwischen der Pruefung vor dem Koerper und hier kann die Schlange vollgelaufen sein; der
		// Koerper ist dann umsonst gelesen, aber die Antwort fuer den Client dieselbe.
		if (lauf === null) return { ok: false, status: 503, body: BESCHAEFTIGT };
		// Ein Wurf ist ein Fehler des Dateisystems (foto.ts) und kein Fehler des Nutzers: Er geht
		// weiter und endet als 500. Verworfen: ihn als TYP zu melden -- eine volle Platte hiesse dann
		// "Diese Bildart geht nicht", und die Person versuchte es mit dem naechsten Foto.
		ergebnis = await lauf;
	} finally {
		await rm(eingabe, { force: true });
	}
	if (!ergebnis.ok) {
		return ergebnis.grund === 'PIXEL'
			? { ok: false, status: 413, body: { fehler: FEHLER_TEXT.PIXEL, code: 'GROESSE' } }
			: { ok: false, status: 415, body: { fehler: FEHLER_TEXT.TYP.FOTO, code: 'TYP' } };
	}
	try {
		await deps.dateiSpeicher.uebernimm(haupt, dateiSchluessel(vereinId, id));
		await deps.dateiSpeicher.uebernimm(vorschau, dateiSchluessel(vereinId, id, true));
	} catch (fehler) {
		// Was schon verschoben ist, liegt ohne Zeile da und faellt dem Aufraeumer als Waise zu.
		await Promise.allSettled([rm(haupt, { force: true }), rm(vorschau, { force: true })]);
		throw fehler;
	}
	return {
		ok: true,
		datei: {
			id,
			art: 'FOTO',
			// Fotos haben keinen Namen (Plan-Entscheidung 12); die Fassung ist immer JPEG (foto.ts).
			name: '',
			typ: 'image/jpeg',
			groesse: ergebnis.bytes,
			breite: ergebnis.breite,
			hoehe: ergebnis.hoehe,
			sha256: ergebnis.sha256,
		},
	};
}
