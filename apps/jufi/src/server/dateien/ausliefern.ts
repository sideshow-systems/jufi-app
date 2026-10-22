import type { VereinDb } from '@jufi/db';
import type { Request, Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { statt404 } from '../mitglieder/verwaltung.js';
import { modulOrt } from '../threads/laden.js';
import { darfThreadSehen } from '../threads/lesen.js';
import { vereinsKontext } from '../verein.js';
import { dateiSchluessel } from './speicher.js';

/**
 * Typen, die der Browser selbst anzeigen darf. Alles andere kommt als Anhang, auch wenn der
 * Typ am Inhalt erkannt wurde: Ein Office-Dokument oeffnet der Browser ohnehin nicht, und
 * eine Liste zum Ausschliessen waere eine, die bei jedem neuen Typ vergessen wird. WebP steht
 * dabei, obwohl Fotos immer JPEG sind: Eine Datei im Modul darf WebP sein, und der Browser zeigt
 * es selbst an.
 */
export const INLINE_TYPEN: ReadonlySet<string> = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/**
 * Der Kopf Content-Disposition mit beiden Namensformen (RFC 6266): `filename` als ASCII fuer
 * alte Clients, `filename*` mit dem echten Namen. Im einfachen Namen werden Nicht-ASCII und
 * Steuerzeichen zu `_`; Anfuehrungszeichen und Rueckstrich fallen weg statt zu `_`, weil sie
 * das Quoted-String beenden oder maskieren wuerden und ein `_` dort nichts retten wuerde.
 * Verworfen: den Namen mit `\` maskieren -- Clients behandeln das uneinheitlich.
 *
 * encodeURIComponent laesst `'()*` stehen, RFC 5987 erlaubt sie im Klartext nicht; sie werden
 * von Hand kodiert. Halbe Surrogate werden ersetzt (mit u-Flag trifft nur ein einzelnes zu, nie
 * ein Paar), weil encodeURIComponent bei einem halben Surrogat wirft und aus einem Namen so ein
 * 500 wuerde. String.prototype.toWellFormed taete dasselbe, fehlt aber in der lib des Projekts.
 */
export function contentDisposition(name: string, inline: boolean): string {
	const heil = name.replace(/\p{Surrogate}/gu, '\ufffd');
	const einfach = heil.replace(/["\\]/gu, '').replace(/[^\x20-\x7e]/gu, '_');
	const kodiert = encodeURIComponent(heil).replace(
		/['()*]/gu,
		(zeichen) => `%${zeichen.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `${inline ? 'inline' : 'attachment'}; filename="${einfach}"; filename*=UTF-8''${kodiert}`;
}

/**
 * Wer die Datei sehen darf. Dokumente sind fuer jedes Mitglied des Vereins da (TP4-Spec 3.1);
 * eine Datei oder ein Foto an einem Modul sieht, wer den Thread sieht (darfThreadSehen: Entwurf,
 * Rollenfilter, entfernte Personen). Eine Datei ohne Dokument und ohne Modul gibt es nach dem
 * CHECK der Tabelle nicht; sie bliebe gesperrt, lieber nichts ausliefern als zu viel.
 *
 * Verworfen: die Sicht an die Datei zu heften (etwa eine eigene Liste "wer darf") -- sie
 * wiche beim ersten Aendern des Rollenfilters von der des Threads ab.
 */
export async function darfDateiSehen(
	db: VereinDb,
	personId: string,
	datei: { dokumentId: string | null; modulId: string | null },
): Promise<boolean> {
	if (datei.dokumentId !== null) return true;
	if (datei.modulId === null) return false;
	const ort = await modulOrt(db, datei.modulId);
	return ort !== null && (await darfThreadSehen(db, personId, ort.threadId));
}

/** Was beim Entfernen der Dokument-Koepfe fuer eine Fehlerantwort wegfaellt; nosniff und CSP bleiben. */
const DATEI_KOEPFE = ['Content-Type', 'Content-Length', 'Content-Disposition', 'Cache-Control'] as const;

/**
 * Die Kopfzeilen, die jede Antwort dieser Route tragen soll, auch das 404 bei fehlenden Bytes:
 * Die Route liefert Inhalte, die ein Mitglied hochgeladen hat, und eine Fehlerantwort soll nicht
 * weniger abgeschottet sein als die Datei selbst.
 */
function schuetze(res: Response): void {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	// Ersetzt die App-CSP: Ein PDF oder Bild in einem eigenen Tab bekommt weder Skripte noch
	// Origin der App (sandbox), selbst wenn der Inhalt trotz Typpruefung aktiv waere. Auch fuer
	// PDF gemessen (Chromium 156, Chrome 155, Firefox 158, je als eigener Tab): Die PDF-Ansicht
	// erscheint unter dieser CSP genauso wie ganz ohne; nur in einem sandbox-iframe blockiert
	// Chrome sie. Verworfen: fuer PDF eine lockerere CSP ohne sandbox -- sie braeuchte einen Grund.
	res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
}

function setzeKoepfe(res: Response, datei: { typ: string; bytes: number; name: string }, herunterladen: boolean): void {
	schuetze(res);
	res.setHeader('Content-Type', datei.typ);
	// Die Laenge der Bytes, die der Strom liefert, nicht Datei.groesse: Bei Fotos zaehlt groesse
	// beide Fassungen, und eine zu grosse Content-Length bricht die Antwort ab (Plan-Entscheidung 4).
	res.setHeader('Content-Length', datei.bytes);
	res.setHeader(
		'Content-Disposition',
		contentDisposition(datei.name === '' ? 'datei' : datei.name, !herunterladen && INLINE_TYPEN.has(datei.typ)),
	);
	// Die ID ist eine Version: Ersetzen legt eine neue Datei mit neuer ID an. private, weil die
	// Antwort hinter der Anmeldung liegt und kein gemeinsamer Cache sie ausliefern soll.
	res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
}

/** Fotos haben keinen Namen (Plan-Entscheidung 12); beim Speichern bekommen sie diesen. */
const fotoName = (id: string) => `foto-${id.slice(0, 8)}.jpg`;

export function dateiRouten(router: Router, deps: VolleAppDeps): void {
	/**
	 * Beide Routen: die Datei selbst und die Vorschau eines Fotos. Ort, Sicht und Fehlerbehandlung
	 * sind dieselben; sie unterscheiden sich nur in Schluessel, Typ und Name.
	 */
	async function liefere(req: Request, res: Response, vorschau: boolean): Promise<void> {
		const { verein, db } = vereinsKontext(res);
		const { person } = mitgliedKontext(res);
		const datei = await db.datei.findFirst({
			where: { id: req.params['id'] ?? '', ...(vorschau ? { art: 'FOTO' as const } : {}) },
			select: { id: true, art: true, typ: true, name: true, dokumentId: true, modulId: true },
		});
		if (!datei || !(await darfDateiSehen(db, person.id, datei))) return statt404(res);

		const gelesen = await deps.dateiSpeicher.lies(dateiSchluessel(verein.id, datei.id, vorschau));
		if (!gelesen) {
			// Nur die ID: Der Name einer Datei gehoert nicht ins Log.
			console.error(`Datei ${datei.id}: Zeile da, Bytes fehlen`);
			schuetze(res);
			return statt404(res);
		}
		const { strom, bytes } = gelesen;

		setzeKoepfe(
			res,
			{
				typ: vorschau ? 'image/jpeg' : datei.typ,
				bytes,
				name: datei.art === 'FOTO' ? fotoName(datei.id) : datei.name,
			},
			!vorschau && req.query['herunterladen'] === '1',
		);
		// Von Hand statt stream.pipeline: pipeline zerstoert beim Fehler auch res, und die 404-Antwort
		// unten waere nicht mehr moeglich. lies oeffnet die Datei und misst sie am selben Deskriptor;
		// ein Fehler beim Lesen kommt als Fehler des Stroms, noch bevor ein Byte geschrieben ist (etwa
		// ein defekter Datentraeger). Dann ist ein 404 ehrlicher als eine abgebrochene Antwort; ab dem
		// ersten Byte bleibt nur, die Verbindung zu kappen.
		strom.once('error', () => {
			console.error(`Datei ${datei.id}: Lesen der Bytes gescheitert`);
			if (res.headersSent) return void res.destroy();
			for (const kopf of DATEI_KOEPFE) res.removeHeader(kopf);
			statt404(res);
		});
		// Bricht der Client ab, soll der Strom die Datei nicht bis zum Ende lesen.
		res.once('close', () => strom.destroy());
		strom.pipe(res);
	}

	router.get(
		'/dateien/:id',
		brauchtMitglied,
		asynchron((req, res) => liefere(req, res, false)),
	);
	// Nur Fotos haben eine Vorschau; fuer eine DATEI antwortet die Abfrage oben mit 404.
	router.get(
		'/dateien/:id/vorschau',
		brauchtMitglied,
		asynchron((req, res) => liefere(req, res, true)),
	);
}
