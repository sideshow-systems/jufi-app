import { NavigationError } from '@angular/router';
import { chunkFehlerHandler, istFehlenderChunk } from './chunk-fehler';

describe('istFehlenderChunk', () => {
	it.each([
		'Failed to fetch dynamically imported module: https://x.de/chunk-ABC.js',
		'Importing a module script failed.',
		'error loading dynamically imported module: https://x.de/chunk-ABC.js',
	])('erkennt "%s"', (text) => {
		expect(istFehlenderChunk(new TypeError(text))).toBe(true);
	});

	it('erkennt den Fehler auch als cause, auch mehrfach verschachtelt', () => {
		const innen = new TypeError('Failed to fetch dynamically imported module: x');
		expect(istFehlenderChunk(new Error('Navigation fehlgeschlagen', { cause: innen }))).toBe(true);
		expect(istFehlenderChunk(new Error('a', { cause: new Error('b', { cause: innen }) }))).toBe(true);
	});

	it('erkennt eine nackte Zeichenkette', () => {
		expect(istFehlenderChunk('Importing a module script failed')).toBe(true);
	});

	it('erkennt andere Fehler nicht', () => {
		expect(istFehlenderChunk(new Error('Cannot match any routes'))).toBe(false);
		expect(istFehlenderChunk(new TypeError('x is not a function'))).toBe(false);
		expect(istFehlenderChunk({ status: 500, fehler: 'Unerwarteter Fehler' })).toBe(false);
		expect(istFehlenderChunk(undefined)).toBe(false);
		expect(istFehlenderChunk(null)).toBe(false);
	});

	it('bleibt bei einer Ursachenschleife nicht haengen', () => {
		const a: Error & { cause?: unknown } = new Error('a');
		a.cause = a;
		expect(istFehlenderChunk(a)).toBe(false);
	});
});

describe('chunkFehlerHandler', () => {
	const chunk = () =>
		new NavigationError(1, '/demo/t/ck1-bowling', new TypeError('Failed to fetch dynamically imported module: x'));

	beforeEach(() => sessionStorage.clear());
	afterEach(() => vi.restoreAllMocks());

	it('laedt die Zielseite des fehlgeschlagenen Wechsels neu', () => {
		const neuLaden = vi.fn();
		chunkFehlerHandler(neuLaden, () => 1_000_000)(chunk());
		expect(neuLaden).toHaveBeenCalledExactlyOnceWith('/demo/t/ck1-bowling');
	});

	it('laedt innerhalb von zehn Sekunden nicht ein zweites Mal, danach wieder', () => {
		const neuLaden = vi.fn();
		let uhr = 1_000_000;
		const handler = chunkFehlerHandler(neuLaden, () => uhr);
		handler(chunk());
		uhr += 9_999;
		handler(chunk());
		expect(neuLaden).toHaveBeenCalledTimes(1);
		uhr += 1;
		handler(chunk());
		expect(neuLaden).toHaveBeenCalledTimes(2);
	});

	it('merkt sich die Marke in sessionStorage, damit sie das Neuladen uebersteht', () => {
		chunkFehlerHandler(vi.fn(), () => 5_000_000)(chunk());
		expect(sessionStorage.getItem('jufi-chunk-neuladen')).toBe('5000000');
		const neuLaden = vi.fn();
		chunkFehlerHandler(neuLaden, () => 5_000_100)(chunk());
		expect(neuLaden).not.toHaveBeenCalled();
	});

	it('laedt bei anderen Fehlern nicht neu', () => {
		const neuLaden = vi.fn();
		chunkFehlerHandler(
			neuLaden,
			() => 1_000_000,
		)(new NavigationError(1, '/demo', new Error('Cannot match any routes')));
		expect(neuLaden).not.toHaveBeenCalled();
		expect(sessionStorage.getItem('jufi-chunk-neuladen')).toBeNull();
	});

	it('laedt nicht neu, wenn sessionStorage nicht benutzbar ist (keine Schleifensperre moeglich)', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('gesperrt', 'SecurityError');
		});
		const neuLaden = vi.fn();
		expect(() => chunkFehlerHandler(neuLaden, () => 1_000_000)(chunk())).not.toThrow();
		expect(neuLaden).not.toHaveBeenCalled();
	});
});
