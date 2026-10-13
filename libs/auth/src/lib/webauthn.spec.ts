import { describe, expect, it } from 'vitest';
import {
	challengeAusAntwort,
	decodePublicKey,
	encodePublicKey,
	passkeyLabel,
	registrationOptions,
	RP_NAME,
	resolveRelyingParty,
} from './webauthn.js';

/**
 * Geprueft wird hier, was wir selbst entscheiden — Ableitung der Relying Party,
 * Geraetename, Kodierung. Die Signaturpruefung liegt bei @simplewebauthn und
 * braucht echte Authenticator-Antworten; sie nachzubauen wuerde die Bibliothek
 * gegen sich selbst testen.
 */
describe('resolveRelyingParty', () => {
	it('leitet aus Host und Schema ab', () => {
		expect(resolveRelyingParty({ host: 'test.jufi-app.de', secure: true })).toEqual({
			rpId: 'test.jufi-app.de',
			origin: 'https://test.jufi-app.de',
		});
	});

	// Die rpId ist die Domain ohne Port, die Herkunft *mit* — genau diese
	// Asymmetrie laesst den Login lokal scheitern, wenn man sie verwechselt.
	it('behaelt den Port in der Herkunft und laesst ihn in der rpId weg', () => {
		expect(resolveRelyingParty({ host: 'localhost:4200', secure: false })).toEqual({
			rpId: 'localhost',
			origin: 'http://localhost:4200',
		});
	});

	it('trennt bei IPv6 nicht am falschen Doppelpunkt', () => {
		expect(resolveRelyingParty({ host: '[::1]:4200', secure: false }).rpId).toBe('[::1]');
	});

	it('gibt der Umgebungsvariablen Vorrang vor dem Host-Header', () => {
		expect(
			resolveRelyingParty({
				host: 'boeser-host.example',
				secure: true,
				rpId: 'test.jufi-app.de',
				origin: 'https://test.jufi-app.de',
			}),
		).toEqual({ rpId: 'test.jufi-app.de', origin: 'https://test.jufi-app.de' });
	});

	it('entfernt einen abschliessenden Schraegstrich aus der Herkunft', () => {
		const rp = resolveRelyingParty({
			host: undefined,
			secure: true,
			rpId: 'test.jufi-app.de',
			origin: 'https://test.jufi-app.de/',
		});
		expect(rp.origin).toBe('https://test.jufi-app.de');
	});

	it('scheitert laut, wenn nichts bekannt ist', () => {
		expect(() => resolveRelyingParty({ host: undefined, secure: true })).toThrow(/WebAuthn/);
	});
});

describe('passkeyLabel', () => {
	it('erkennt das iPhone', () => {
		const ua =
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
		expect(passkeyLabel(ua)).toBe('iPhone');
	});

	it('erkennt den Mac', () => {
		const ua =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
		expect(passkeyLabel(ua)).toBe('Mac');
	});

	// Android nennt sich „Linux; Android 15" — die Pruefung auf Android muss
	// deshalb vor der auf Linux stehen, sonst heisst jedes Handy „Linux-Rechner".
	it('nennt ein Android-Handy nicht Linux', () => {
		const ua = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile';
		expect(passkeyLabel(ua)).toBe('Android-Gerät');
	});

	it('faellt auf einen lesbaren Namen zurueck', () => {
		expect(passkeyLabel(undefined)).toBe('Unbekanntes Gerät');
	});
});

describe('Schluesselkodierung', () => {
	it('ueberlebt den Rundweg', () => {
		const key = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
		expect(decodePublicKey(encodePublicKey(key))).toEqual(key);
	});

	it('kodiert ohne Zeichen, die eine URL zerlegen', () => {
		const key = new Uint8Array([251, 255, 190, 255]);
		expect(encodePublicKey(key)).not.toMatch(/[+/=]/);
	});
});

describe('registrationOptions', () => {
	const rp = { rpId: 'test.jufi-app.de', origin: 'https://test.jufi-app.de' };

	// Name und Anzeigename sind getrennt (Spec 4.2): der Name ist der Benutzername
	// zum Wiederfinden, der Anzeigename steht im Dialog des Geraets und nennt auch
	// den Bereich, damit der Passkey in der Liste des Geraets zuzuordnen ist.
	it('trennt Name und Anzeigename', async () => {
		const options = await registrationOptions({
			rp,
			user: { id: 'admin-1', name: 'florian', displayName: 'florian · JuFi-Admin' },
			existing: [],
		});
		expect(options.user.name).toBe('florian');
		expect(options.user.displayName).toBe('florian · JuFi-Admin');
		expect(options.rp).toEqual({ name: RP_NAME, id: 'test.jufi-app.de' });
		expect(RP_NAME).toBe('JuFi App');
	});

	it('verlangt auffindbare Schluessel mit Nutzerpruefung', async () => {
		const options = await registrationOptions({
			rp,
			user: { id: 'admin-1', name: 'florian', displayName: 'florian · JuFi-Admin' },
			existing: [],
		});
		expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
	});

	it('schliesst vorhandene Passkeys aus', async () => {
		const options = await registrationOptions({
			rp,
			user: { id: 'admin-1', name: 'florian', displayName: 'florian · JuFi-Admin' },
			existing: [{ credentialId: 'abc', publicKey: 'x', counter: 0, transports: ['internal'] }],
		});
		expect(options.excludeCredentials?.map((c) => c.id)).toEqual(['abc']);
	});
});

describe('challengeAusAntwort', () => {
	/** So baut der Browser clientDataJSON: JSON, base64url-kodiert. */
	function clientData(daten: unknown): { response: { clientDataJSON: string } } {
		return { response: { clientDataJSON: Buffer.from(JSON.stringify(daten)).toString('base64url') } };
	}

	it('liest die Challenge aus clientDataJSON', () => {
		const antwort = clientData({ type: 'webauthn.get', challenge: 'c2lnbmllcnQ', origin: 'https://test.jufi-app.de' });
		expect(challengeAusAntwort(antwort)).toBe('c2lnbmllcnQ');
	});

	it('liefert undefined fuer Muell statt zu werfen', () => {
		expect(challengeAusAntwort({ response: { clientDataJSON: '%%%' } })).toBeUndefined();
	});

	it('liefert undefined, wenn keine Challenge im JSON steht', () => {
		expect(challengeAusAntwort(clientData({ type: 'webauthn.get' }))).toBeUndefined();
	});

	it('liefert undefined, wenn die Challenge keine Zeichenkette ist', () => {
		expect(challengeAusAntwort(clientData({ challenge: 42 }))).toBeUndefined();
		expect(challengeAusAntwort(clientData(null))).toBeUndefined();
	});

	it('liefert undefined fuer eine leere Challenge', () => {
		expect(challengeAusAntwort(clientData({ challenge: '' }))).toBeUndefined();
	});

	it('liefert undefined, wenn die Antwort selbst kaputt ist', () => {
		expect(challengeAusAntwort({} as never)).toBeUndefined();
		expect(challengeAusAntwort(null as never)).toBeUndefined();
	});
});
