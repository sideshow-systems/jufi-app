/**
 * Passkeys (WebAuthn).
 *
 * Passwort plus TOTP heisst am Handy: ein Formular, ein Wechsel in die
 * Authenticator-App, sechs abgetippte Ziffern — und das erneut, sobald das
 * Session-Cookie weg ist. Ein Passkey ist ein Schluesselpaar im Secure Element
 * des Geraets; die Anmeldung ist ein Blick in die Kamera.
 *
 * **Ein Passkey ersetzt hier beide Faktoren, nicht nur den zweiten.** Das klingt
 * nach Rueckschritt und ist keiner:
 *
 * - `userVerification: 'required'` erzwingt Face ID bzw. den Gerätecode. Damit
 *   sind es zwei Faktoren — Besitz des Geraets und Biometrie. Ein gefundenes
 *   iPhone allein oeffnet nichts.
 * - Die Signatur ist an die Herkunft gebunden. Eine nachgebaute Anmeldeseite
 *   bekommt keine gueltige Antwort; einen TOTP-Code tippt man dort dagegen
 *   bereitwillig ein. Phishing-Resistenz ist der eigentliche Gewinn, nicht die
 *   Bequemlichkeit.
 * - Der private Schluessel verlaesst das Geraet nie. Ein Datenbank-Leck liefert
 *   hier nur oeffentliche Schluessel — das TOTP-Secret dagegen ist ein
 *   Geheimnis, das auf dem Server liegt (verschluesselt, aber es liegt dort).
 *
 * Passwort und TOTP bleiben trotzdem vollstaendig erhalten. Sie sind der Weg auf
 * ein Geraet ohne Passkey und der Weg zurueck, wenn alle Passkeys verloren sind;
 * die Recovery-Codes bleiben die letzte Stufe.
 *
 * Die Kryptografie liegt bei `@simplewebauthn/server`. CBOR, COSE-Schluessel und
 * Attestation selbst zu parsen waere der eine Ort in diesem Projekt, an dem ein
 * Fehler nicht auffaellt, sondern die Tuer offen laesst.
 */

import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
	AuthenticationResponseJSON,
	AuthenticatorTransportFuture,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON,
} from '@simplewebauthn/server';

/** Steht im Face-ID-Dialog des Geraets. */
export const RP_NAME = 'JuFi App';

/**
 * Zwei Minuten. Der Browser blendet den Dialog danach aus; eine laengere
 * Challenge wuerde nur die Tabelle fuellen.
 */
export const WEBAUTHN_CHALLENGE_TTL_MS = 2 * 60 * 1000;

export interface RelyingParty {
	/** Domain, an die der Schluessel gebunden ist. Ohne Port, ohne Schema. */
	rpId: string;
	/** Vollstaendige Herkunft, die der Browser in die Signatur schreibt. */
	origin: string;
}

/**
 * Ermittelt Relying Party und Herkunft.
 *
 * Beides muss **genau** stimmen, sonst schlaegt die Pruefung fehl — und die
 * Werte unterscheiden sich zwischen `localhost:4200` und
 * `https://test.jufi-app.de`. Deshalb ableitbar aus der Anfrage, mit
 * ausdruecklichem Vorrang fuer die Umgebungsvariablen: in Produktion soll nicht
 * ein `Host`-Header entscheiden, woran ein Schluessel haengt.
 *
 * Reine Funktion, damit die Ableitung geprueft ist und nicht nur behauptet.
 */
export function resolveRelyingParty(input: {
	/** `Host`-Header, ggf. mit Port. */
	host: string | undefined;
	secure: boolean;
	rpId?: string;
	origin?: string;
}): RelyingParty {
	const { host, secure } = input;
	const rpIdEnv = input.rpId?.trim();
	const originEnv = input.origin?.trim();
	if (rpIdEnv && originEnv) return { rpId: rpIdEnv, origin: originEnv.replace(/\/$/, '') };
	if (!host) throw new Error('WebAuthn: weder WEBAUTHN_RP_ID/WEBAUTHN_ORIGIN gesetzt noch Host-Header vorhanden.');

	// Ueber URL statt Zeichenketten-Trennung: bei `[::1]:4200` liegt der letzte
	// Doppelpunkt mitten in der Adresse.
	const parsed = new URL(`${secure ? 'https' : 'http'}://${host}`);
	return {
		rpId: rpIdEnv ?? parsed.hostname,
		origin: originEnv ? originEnv.replace(/\/$/, '') : parsed.origin,
	};
}

/**
 * Name des Geraets fuer die Liste in den Einstellungen.
 *
 * Nur geraten, und das genuegt: die Liste soll erkennbar machen, welchen Eintrag
 * man loescht. Reihenfolge der Pruefungen ist wichtig — iPadOS nennt sich
 * „Macintosh", wenn es Desktop-Seiten anfordert, und Android enthaelt „Linux".
 */
export function passkeyLabel(userAgent: string | undefined): string {
	const ua = userAgent ?? '';
	if (/iPhone/i.test(ua)) return 'iPhone';
	if (/iPad/i.test(ua)) return 'iPad';
	if (/Android/i.test(ua)) return 'Android-Gerät';
	if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
	if (/Windows/i.test(ua)) return 'Windows-PC';
	if (/Linux/i.test(ua)) return 'Linux-Rechner';
	return 'Unbekanntes Gerät';
}

export interface StoredPasskey {
	credentialId: string;
	publicKey: string;
	counter: number;
	transports: string[];
}

/** base64url, weil der Rest des WebAuthn-Protokolls es auch so schreibt. */
export function encodePublicKey(key: Uint8Array): string {
	return Buffer.from(key).toString('base64url');
}

/**
 * `Uint8Array.from` und nicht `new Uint8Array(buffer)`: der Konstruktor uebernimmt
 * den `ArrayBufferLike` des Buffers, und die Typen von @simplewebauthn verlangen
 * einen echten `ArrayBuffer`. `from` kopiert und liefert genau den.
 */
export function decodePublicKey(key: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(Buffer.from(key, 'base64url'));
}

/**
 * Einrichtung eines neuen Passkeys.
 *
 * Name und Anzeigename sind getrennt (Spec 4.2): der Name ist die Kennung, der
 * Anzeigename steht in der Auswahl des Geraets und nennt zusaetzlich den
 * Bereich, etwa „florian · JuFi-Admin". Wer Passkeys fuer mehrere Bereiche
 * hat, unterscheidet sie so in der Auswahl des Telefons. In hwyd war beides
 * derselbe Benutzername.
 *
 * `residentKey: 'required'` — der Schluessel muss im Authenticator auffindbar
 * sein. Nur dann kommt man ohne Benutzernamen an: Knopf, Face ID, drin. Ohne
 * Discoverable Credential muesste die Anmeldeseite erst wissen, wer man ist, und
 * damit waere der halbe Gewinn weg.
 *
 * `excludeCredentials` verhindert einen zweiten Passkey fuer dasselbe Geraet —
 * sonst sammelt die Liste in den Einstellungen Dubletten, die niemand
 * unterscheiden kann.
 *
 * Bewusst **keine** `authenticatorAttachment`-Vorgabe: so bleibt neben Face ID
 * auch ein Sicherheitsschluessel oder ein fremdes Geraet per QR-Code moeglich.
 */
export function registrationOptions(input: {
	rp: RelyingParty;
	user: { id: string; name: string; displayName: string };
	existing: StoredPasskey[];
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
	return generateRegistrationOptions({
		rpName: RP_NAME,
		rpID: input.rp.rpId,
		userID: new TextEncoder().encode(input.user.id),
		userName: input.user.name,
		userDisplayName: input.user.displayName,
		attestationType: 'none',
		excludeCredentials: input.existing.map((p) => ({
			id: p.credentialId,
			transports: p.transports as AuthenticatorTransportFuture[],
		})),
		authenticatorSelection: {
			residentKey: 'required',
			userVerification: 'required',
		},
		timeout: WEBAUTHN_CHALLENGE_TTL_MS,
	});
}

export async function verifyRegistration(input: {
	response: RegistrationResponseJSON;
	expectedChallenge: string;
	rp: RelyingParty;
}): Promise<{
	credentialId: string;
	publicKey: string;
	counter: number;
	transports: string[];
	backedUp: boolean;
} | null> {
	const result = await verifyRegistrationResponse({
		response: input.response,
		expectedChallenge: input.expectedChallenge,
		expectedOrigin: input.rp.origin,
		expectedRPID: input.rp.rpId,
		// Ohne diese Zeile waere ein Passkey ohne Face ID erlaubt, und damit waere
		// die ganze Begruendung oben hinfaellig.
		requireUserVerification: true,
	});
	if (!result.verified || !result.registrationInfo) return null;

	const info = result.registrationInfo;
	return {
		credentialId: info.credential.id,
		publicKey: encodePublicKey(info.credential.publicKey),
		counter: info.credential.counter,
		transports: info.credential.transports ?? [],
		backedUp: info.credentialBackedUp,
	};
}

/**
 * Anmeldung.
 *
 * Ohne `allowCredentials`: der Authenticator zeigt selbst, welche Passkeys er
 * fuer diese Domain hat. Eine Liste vom Server waere hier sogar schaedlich — sie
 * verriete jedem Aufrufer, welche Geraete registriert sind.
 */
export function authenticationOptions(rp: RelyingParty): Promise<PublicKeyCredentialRequestOptionsJSON> {
	return generateAuthenticationOptions({
		rpID: rp.rpId,
		userVerification: 'required',
		timeout: WEBAUTHN_CHALLENGE_TTL_MS,
	});
}

/**
 * Prueft die Antwort des Authenticators.
 *
 * Den Signaturzaehler prueft `@simplewebauthn/server` selbst und behandelt die
 * 0 richtig (siehe `Passkey.counter` im Schema): bei einem gespeicherten Stand
 * von 0 gilt eine 0 nicht als Klon.
 */
export async function verifyAuthentication(input: {
	response: AuthenticationResponseJSON;
	expectedChallenge: string;
	rp: RelyingParty;
	passkey: StoredPasskey;
}): Promise<{ counter: number } | null> {
	const result = await verifyAuthenticationResponse({
		response: input.response,
		expectedChallenge: input.expectedChallenge,
		expectedOrigin: input.rp.origin,
		expectedRPID: input.rp.rpId,
		credential: {
			id: input.passkey.credentialId,
			publicKey: decodePublicKey(input.passkey.publicKey),
			counter: input.passkey.counter,
			transports: input.passkey.transports as AuthenticatorTransportFuture[],
		},
		requireUserVerification: true,
	});
	if (!result.verified) return null;
	return { counter: result.authenticationInfo.newCounter };
}

export type ChallengePurpose = 'register' | 'authenticate';

/**
 * Liest die Challenge aus der Antwort des Authenticators.
 *
 * Die Antwort traegt die Challenge nur versteckt in `clientDataJSON` (base64url
 * von JSON). Der Server braucht sie vor der Pruefung, um die gespeicherte
 * Challenge herauszusuchen und einzuloesen; die eigentliche Pruefung vergleicht
 * sie danach gegen genau diesen gespeicherten Wert. Hier wird also nichts
 * vertraut, nur ein Schluessel zum Nachschlagen gelesen.
 *
 * Alles Kaputte liefert `undefined` statt eines Fehlers: eine Antwort, die sich
 * nicht lesen laesst, ist fuer den Aufrufer dasselbe wie eine unbekannte
 * Challenge, naemlich eine fehlgeschlagene Anmeldung.
 *
 * Die Challenges selbst speichert die Bibliothek nicht (anders als hwyd mit
 * `storeChallenge`/`takeChallenge`): sie bleibt frei von Prisma und damit ohne
 * Datenbank testbar. Der Server legt sie ab und loest sie ein.
 */
export function challengeAusAntwort(antwort: { response: { clientDataJSON: string } }): string | undefined {
	try {
		const json = Buffer.from(antwort.response.clientDataJSON, 'base64url').toString('utf8');
		const daten: unknown = JSON.parse(json);
		if (typeof daten !== 'object' || daten === null) return undefined;
		const challenge = (daten as { challenge?: unknown }).challenge;
		return typeof challenge === 'string' && challenge !== '' ? challenge : undefined;
	} catch {
		return undefined;
	}
}
