import { describe, expect, it } from 'vitest';
import { assertSecrets, checkSecrets } from './env-check.js';

/** 32 Byte base64 — so, wie `openssl rand -base64 32` es liefert. */
const GOOD_KEY = Buffer.alloc(32, 7).toString('base64');
const GOOD_SESSION = 'x'.repeat(32);
const GOOD_DB = 'postgresql://u:p@h:5432/d?schema=public';

const complete = {
	SESSION_SECRET: GOOD_SESSION,
	TOTP_ENC_KEY: GOOD_KEY,
	DATABASE_URL: GOOD_DB,
	BASIS_URL: 'https://test.jufi-app.de',
};

describe('checkSecrets', () => {
	it('beanstandet eine vollstaendige Umgebung nicht', () => {
		expect(checkSecrets(complete)).toEqual([]);
	});

	it('nennt jede fehlende Variable', () => {
		const problems = checkSecrets({});
		expect(problems.map((p) => p.variable).sort()).toEqual([
			'BASIS_URL',
			'DATABASE_URL',
			'SESSION_SECRET',
			'TOTP_ENC_KEY',
		]);
	});

	/**
	 * Der Fall, der diese Pruefung veranlasst hat: ein Schluessel mit 31 statt 32
	 * Byte liess die App starten und scheiterte erst bei der Anmeldung.
	 */
	it('erkennt einen Schluessel mit 31 Byte', () => {
		const problems = checkSecrets({ ...complete, TOTP_ENC_KEY: Buffer.alloc(31, 7).toString('base64') });
		expect(problems).toHaveLength(1);
		expect(problems[0].variable).toBe('TOTP_ENC_KEY');
		expect(problems[0].problem).toContain('31 Byte');
	});

	it('erkennt einen zu langen Schluessel', () => {
		const problems = checkSecrets({ ...complete, TOTP_ENC_KEY: Buffer.alloc(33, 7).toString('base64') });
		expect(problems[0].problem).toContain('33 Byte');
	});

	/**
	 * `Buffer.from(…, 'base64')` verschluckt ungueltige Zeichen still. Ein
	 * Platzhalter wie in der Vorlage darf deshalb nicht durchrutschen.
	 */
	it('erkennt einen Platzhalter, der kein base64 ist', () => {
		const problems = checkSecrets({ ...complete, TOTP_ENC_KEY: '32-byte-base64-key' });
		expect(problems[0].variable).toBe('TOTP_ENC_KEY');
	});

	it('beanstandet ein zu kurzes Sitzungsgeheimnis', () => {
		const problems = checkSecrets({ ...complete, SESSION_SECRET: 'kurz' });
		expect(problems[0].variable).toBe('SESSION_SECRET');
		expect(problems[0].problem).toContain('4 Zeichen');
	});
});

describe('BASIS_URL', () => {
	it('env-check verlangt BASIS_URL ohne abschliessenden Schraegstrich', () => {
		const gut = {
			DATABASE_URL: 'x',
			SESSION_SECRET: 'a'.repeat(32),
			TOTP_ENC_KEY: Buffer.alloc(32).toString('base64'),
		};
		expect(checkSecrets({ ...gut, BASIS_URL: 'https://test.jufi-app.de' })).toEqual([]);
		expect(checkSecrets({ ...gut, BASIS_URL: 'https://test.jufi-app.de/' }).map((p) => p.variable)).toEqual([
			'BASIS_URL',
		]);
		expect(checkSecrets({ ...gut }).map((p) => p.variable)).toEqual(['BASIS_URL']);
	});

	/**
	 * Die Origin-Pruefung (Spec 4.5) vergleicht den Origin-Header mit diesem Wert.
	 * Ein Pfad, Query oder Schraegstrich am Ende wuerde nie gleich sein.
	 */
	it('verlangt einen reinen Ursprung, ohne Pfad, Query und Schraegstrich', () => {
		for (const bad of ['https://test.jufi-app.de/', 'https://test.jufi-app.de/app', 'https://test.jufi-app.de?x=1']) {
			const problems = checkSecrets({ ...complete, BASIS_URL: bad });
			expect(
				problems.map((p) => p.variable),
				bad,
			).toEqual(['BASIS_URL']);
			expect(problems[0].problem).toContain('reiner Ursprung');
		}
	});

	it('nimmt http fuer die lokale Entwicklung an', () => {
		expect(checkSecrets({ ...complete, BASIS_URL: 'http://localhost:4200' })).toEqual([]);
	});

	it('lehnt eine relative URL und fremde Schemata ab', () => {
		for (const bad of ['/glonntal', 'test.jufi-app.de', 'ftp://test.jufi-app.de', 'javascript:alert(1)']) {
			expect(
				checkSecrets({ ...complete, BASIS_URL: bad }).map((p) => p.variable),
				bad,
			).toEqual(['BASIS_URL']);
		}
	});
});

describe('assertSecrets', () => {
	it('laesst eine gute Umgebung durch', () => {
		expect(() => assertSecrets(complete)).not.toThrow();
	});

	it('wirft und nennt alle Beanstandungen auf einmal', () => {
		expect(() => assertSecrets({ SESSION_SECRET: 'kurz' })).toThrow(/SESSION_SECRET.*\n.*TOTP_ENC_KEY/s);
	});

	/** Ein Log ist kein Ort fuer Geheimnisse. */
	it('nennt den fehlerhaften Wert nicht in der Meldung', () => {
		const secret = 'geheim-aber-viel-zu-kurz';
		try {
			assertSecrets({ ...complete, SESSION_SECRET: secret });
			expect.unreachable('haette werfen muessen');
		} catch (error) {
			expect((error as Error).message).not.toContain(secret);
		}
	});
});
