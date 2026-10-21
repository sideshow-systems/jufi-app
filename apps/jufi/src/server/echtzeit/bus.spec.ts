import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bus, type BusEreignis } from './bus.js';

const EREIGNIS: BusEreignis = { typ: 'pruefen', vereinId: 'v1' };

describe('Bus', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('stellt zwei Abonnenten dasselbe Ereignis zu', () => {
		const bus = new Bus();
		const a: BusEreignis[] = [];
		const b: BusEreignis[] = [];
		bus.abonniere((e) => a.push(e));
		bus.abonniere((e) => b.push(e));

		bus.melde(EREIGNIS);

		expect(a).toEqual([EREIGNIS]);
		expect(b).toEqual([EREIGNIS]);
	});

	it('stellt nach dem Abbestellen nichts mehr zu, den anderen weiter', () => {
		const bus = new Bus();
		const a: BusEreignis[] = [];
		const b: BusEreignis[] = [];
		const abbestellen = bus.abonniere((e) => a.push(e));
		bus.abonniere((e) => b.push(e));

		bus.melde(EREIGNIS);
		abbestellen();
		bus.melde(EREIGNIS);

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(2);
	});

	it('abbestellt nur das eigene Abo, wenn dieselbe Funktion zweimal abonniert wurde', () => {
		const bus = new Bus();
		const f = vi.fn();
		const erstes = bus.abonniere(f);
		bus.abonniere(f);

		erstes();
		bus.melde(EREIGNIS);

		expect(f).toHaveBeenCalledTimes(1);
	});

	it('ein werfender Abonnent haelt die anderen nicht auf und loggt nur den Namen', () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const bus = new Bus();
		const danach: BusEreignis[] = [];
		bus.abonniere(() => {
			throw new TypeError('geheimer Nachrichtentext');
		});
		bus.abonniere((e) => danach.push(e));

		expect(() => bus.melde(EREIGNIS)).not.toThrow();

		expect(danach).toEqual([EREIGNIS]);
		expect(log).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(log.mock.calls)).toContain('TypeError');
		expect(JSON.stringify(log.mock.calls)).not.toContain('geheimer');
	});

	it('ein Abonnent mit scheiterndem Promise bleibt ohne unbehandelte Ablehnung und loggt nur den Namen', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const bus = new Bus();
		bus.abonniere(() => Promise.reject(new RangeError('geheim')) as unknown as void);

		bus.melde(EREIGNIS);
		await new Promise((r) => setImmediate(r));

		expect(JSON.stringify(log.mock.calls)).toContain('RangeError');
		expect(JSON.stringify(log.mock.calls)).not.toContain('geheim');
	});

	it('ein Abonnent darf sich beim Zustellen abbestellen, ohne dass einer ausfaellt', () => {
		const bus = new Bus();
		const b: BusEreignis[] = [];
		const abbestellen = bus.abonniere(() => abbestellen());
		bus.abonniere((e) => b.push(e));

		bus.melde(EREIGNIS);

		expect(b).toHaveLength(1);
	});
});
