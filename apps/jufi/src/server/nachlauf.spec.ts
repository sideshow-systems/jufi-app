import { afterEach, describe, expect, it, vi } from 'vitest';
import { Nachlauf } from './nachlauf.js';

describe('Nachlauf', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('warteAufAlle wartet auf laufende Arbeit', async () => {
		const nachlauf = new Nachlauf();
		const erledigt: string[] = [];
		let loslassen = () => {};
		const tor = new Promise<void>((r) => (loslassen = r));

		nachlauf.starte(async () => {
			await tor;
			erledigt.push('erste');
			// Arbeit, die waehrend des Wartens dazukommt, gehoert auch dazu.
			nachlauf.starte(async () => {
				await Promise.resolve();
				erledigt.push('zweite');
			});
		});

		let fertig = false;
		const warten = nachlauf.warteAufAlle().then(() => (fertig = true));
		await Promise.resolve();
		expect(fertig).toBe(false);

		loslassen();
		await warten;
		expect(erledigt).toEqual(['erste', 'zweite']);
	});

	it('warteAufAlle ohne Arbeit kehrt sofort zurueck', async () => {
		await expect(new Nachlauf().warteAufAlle()).resolves.toBeUndefined();
	});

	it('ein Fehler bricht nichts ab und steht nicht mit Text im Log', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const info = vi.spyOn(console, 'log').mockImplementation(() => {});
		const nachlauf = new Nachlauf();
		const erledigt: string[] = [];

		nachlauf.starte(async () => {
			throw new Error('SMTP sagt nein zu geheim@example.test');
		});
		// Auch ein synchroner Wurf, bevor die Arbeit ein Promise liefert.
		nachlauf.starte(() => {
			throw new Error('geheim@example.test');
		});
		nachlauf.starte(async () => {
			erledigt.push('weiter');
		});

		await expect(nachlauf.warteAufAlle()).resolves.toBeUndefined();
		expect(erledigt).toEqual(['weiter']);

		const alles = [...log.mock.calls, ...warn.mock.calls, ...info.mock.calls].flat().map(String).join('\n');
		expect(alles).not.toContain('geheim');
		expect(alles).not.toContain('SMTP');
		expect(log).toHaveBeenCalledTimes(2);
		expect(log).toHaveBeenCalledWith('Nachlauf fehlgeschlagen');
	});
});
