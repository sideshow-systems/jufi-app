import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

describe('Passwort-Hash', () => {
	it('prueft das richtige und lehnt ein falsches ab', async () => {
		const h = await hashPassword('lange-passphrase-123');
		expect(await verifyPassword(h, 'lange-passphrase-123')).toBe(true);
		expect(await verifyPassword(h, 'falsch')).toBe(false);
	});

	it('liefert false statt zu werfen bei einem beschaedigten Hash', async () => {
		expect(await verifyPassword('kein-hash', 'egal')).toBe(false);
	});
});
