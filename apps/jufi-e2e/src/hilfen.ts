import type { BrowserContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

/**
 * Port des E2E-Servers. Nicht 4200 (pnpm run dev) und nicht 4000 (Vorgabe von
 * server.ts), damit ein laufender Entwicklungsserver den Lauf nicht stoert und
 * umgekehrt.
 */
export const PORT = 4210;

/** Gleich BASIS_URL des Servers: Die Ursprungspruefung laesst nur diesen Ursprung schreiben. */
export const BASIS_URL = `http://localhost:${PORT}`;

/**
 * Hier legt der Ablauf die Sitzungen (storageState je Rolle) und die IDs ab, die
 * das Projekt layout (Task 16) braucht. Relativ zur Workspace-Wurzel, denn dort
 * laeuft playwright (nx run jufi-e2e:e2e). Nicht im outputDir: Playwright leert
 * es vor jedem Projekt und raeumte die Sitzungen weg, bevor layout sie liest.
 */
export const ZUSTAND = 'apps/jufi-e2e/.zustand';

/**
 * Passwort fuer Admin und Mutter, je Lauf zufaellig, nie ein echtes Passwort. Es
 * entsteht im Hauptprozess, sobald Konfiguration oder Aufbau diese Datei laden,
 * also vor dem ersten Worker; die Worker erben es ueber die Umgebung, die
 * Playwright ihnen mitgibt, und erzeugen deshalb kein eigenes. Verworfen: ein festes
 * Passwort im Repo -- es laege dann in der Liste der Dinge, die jemand fuer echt
 * halten und wiederverwenden koennte.
 */
export const TESTPASSWORT: string = (process.env['E2E_TESTPASSWORT'] ??=
	`E2e-${randomBytes(12).toString('base64url')}`);

/**
 * Ein virtueller Authenticator ueber CDP, je Kontext und damit je Person ein
 * eigener: Leitung und Kind haben verschiedene Geraete, und ein Passkey der
 * einen Person darf beim Anmelden der anderen nicht auftauchen.
 *
 * automaticPresenceSimulation beantwortet jede Zeremonie sofort, ohne dass ein
 * Dialog erscheint; isUserVerified, weil der Server Nutzerverifikation verlangt.
 * hasResidentKey, weil die Anmeldung ohne Benutzernamen (discoverable
 * credential) laeuft. Verworfen: ein Authenticator fuer den ganzen Browser --
 * CDP bindet ihn ohnehin an die Seite, und geteilte Passkeys verwischten, wer
 * sich gerade anmeldet.
 */
export async function passkeyGeraet(context: BrowserContext): Promise<void> {
	// Der Authenticator haengt an der CDP-Sitzung einer Seite. Die erste Seite des
	// Kontexts entsteht deshalb hier und ist die, mit der der Ablauf arbeitet.
	const seite = context.pages()[0] ?? (await context.newPage());
	const cdp = await context.newCDPSession(seite);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
}

/**
 * Ein erzeugtes JPEG fuer die Foto-Schritte: Farbverlauf, auf Wunsch mit erfundenem GPS im EXIF.
 * Erzeugt statt aus dem Repo, weil im Ablauf nie ein echtes Foto liegen darf (TP4-Spec 1.2), und
 * mit GPS, weil der Ablauf beweisen soll, dass der Server es entfernt. Dieselbe Bauart wie
 * erzeugeBild in apps/jufi/src/server/dateien/test-bilder.ts; verworfen: jenes zu importieren --
 * es haengt an den Serverquellen der App, und das E2E-Projekt kennt sie nur ueber den Bau.
 */
export async function erzeugeJpeg(breite: number, hoehe: number, gps = false): Promise<Buffer> {
	const roh = Buffer.alloc(breite * hoehe * 3);
	for (let y = 0; y < hoehe; y++) {
		for (let x = 0; x < breite; x++) {
			const i = (y * breite + x) * 3;
			roh[i] = Math.round((x / breite) * 255);
			roh[i + 1] = Math.round((y / hoehe) * 255);
			roh[i + 2] = 128;
		}
	}
	let bild = sharp(roh, { raw: { width: breite, height: hoehe, channels: 3 } });
	if (gps) {
		bild = bild.withExif({
			IFD0: { Make: 'Erfunden' },
			IFD3: {
				GPSLatitudeRef: 'N',
				GPSLatitude: '52/1 30/1 0/1',
				GPSLongitudeRef: 'E',
				GPSLongitude: '13/1 24/1 0/1',
			},
		});
	}
	return bild.jpeg({ quality: 85 }).toBuffer();
}
