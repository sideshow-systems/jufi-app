import type { Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied } from '../mitglieder/sitzung.js';
import { statt404 } from '../mitglieder/verwaltung.js';
import { vereinsKontext } from '../verein.js';
import { dateiSchluessel } from './speicher.js';

/**
 * Typen, die der Browser selbst anzeigen darf. Alles andere kommt als Anhang, auch wenn der
 * Typ am Inhalt erkannt wurde: Ein Office-Dokument oeffnet der Browser ohnehin nicht, und
 * eine Liste zum Ausschliessen waere eine, die bei jedem neuen Typ vergessen wird.
 */
const INLINE_TYPEN: ReadonlySet<string> = new Set(['application/pdf', 'image/jpeg', 'image/png']);

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
 * Wer die Datei sehen darf, soweit sie keine Abhaengigkeit von der Zeile selbst hat. Dokumente
 * sind fuer jedes Mitglied des Vereins da (TP4-Spec 3.1). Dateien an Modulen bleiben bis
 * Etappe 2 gesperrt (404), weil die Sichtbarkeit dort am Thread haengt, den diese Route noch
 * nicht prueft: lieber nichts ausliefern als zu viel. Etappe 2 ersetzt das `false` durch die
 * Pruefung der Thread-Sichtbarkeit.
 */
export function darfDateiSehen(datei: { dokumentId: string | null; modulId: string | null }): boolean {
	return datei.dokumentId !== null;
}

const KOEPFE = [
	'Content-Type',
	'Content-Length',
	'X-Content-Type-Options',
	'Content-Security-Policy',
	'Content-Disposition',
	'Cache-Control',
] as const;

function setzeKoepfe(
	res: Response,
	datei: { typ: string; groesse: number; name: string },
	herunterladen: boolean,
): void {
	res.setHeader('Content-Type', datei.typ);
	res.setHeader('Content-Length', datei.groesse);
	res.setHeader('X-Content-Type-Options', 'nosniff');
	// Ersetzt die App-CSP: Ein PDF oder Bild in einem eigenen Tab bekommt weder Skripte noch
	// Origin der App (sandbox), selbst wenn der Inhalt trotz Typpruefung aktiv waere. Auch fuer
	// PDF gemessen (Chromium 156, Chrome 155, Firefox 158, je als eigener Tab): Die PDF-Ansicht
	// erscheint unter dieser CSP genauso wie ganz ohne; nur in einem sandbox-iframe blockiert
	// Chrome sie. Verworfen: fuer PDF eine lockerere CSP ohne sandbox -- sie braeuchte einen Grund.
	res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
	res.setHeader(
		'Content-Disposition',
		contentDisposition(datei.name === '' ? 'datei' : datei.name, !herunterladen && INLINE_TYPEN.has(datei.typ)),
	);
	// Die ID ist eine Version: Ersetzen legt eine neue Datei mit neuer ID an. private, weil die
	// Antwort hinter der Anmeldung liegt und kein gemeinsamer Cache sie ausliefern soll.
	res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
}

export function dateiRouten(router: Router, deps: VolleAppDeps): void {
	router.get(
		'/dateien/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const datei = await db.datei.findFirst({
				where: { id: req.params['id'] ?? '' },
				select: { id: true, typ: true, groesse: true, name: true, dokumentId: true, modulId: true },
			});
			if (!datei || !darfDateiSehen(datei)) return statt404(res);

			const strom = await deps.dateiSpeicher.lies(dateiSchluessel(verein.id, datei.id));
			if (!strom) {
				// Nur die ID: Der Name einer Datei gehoert nicht ins Log.
				console.error(`Datei ${datei.id}: Zeile da, Bytes fehlen`);
				return statt404(res);
			}

			setzeKoepfe(res, datei, req.query['herunterladen'] === '1');
			// Von Hand statt stream.pipeline: pipeline zerstoert beim Fehler auch res, und die 404-Antwort
			// unten waere nicht mehr moeglich. lies prueft mit stat und oeffnet erst danach; verschwindet
			// die Datei dazwischen, kommt ENOENT als Fehler des Stroms, noch bevor ein Byte geschrieben
			// ist. Dann ist ein 404 ehrlicher als eine abgebrochene Antwort; ab dem ersten Byte bleibt
			// nur, die Verbindung zu kappen.
			strom.once('error', () => {
				console.error(`Datei ${datei.id}: Lesen der Bytes gescheitert`);
				if (res.headersSent) return void res.destroy();
				for (const kopf of KOEPFE) res.removeHeader(kopf);
				statt404(res);
			});
			// Bricht der Client ab, soll der Strom die Datei nicht bis zum Ende lesen.
			res.once('close', () => strom.destroy());
			strom.pipe(res);
		}),
	);
}
