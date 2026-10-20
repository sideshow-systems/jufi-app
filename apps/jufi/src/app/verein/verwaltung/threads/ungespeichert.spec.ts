import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { ungespeichertWaechter } from './ungespeichert';

describe('ungespeichertWaechter', () => {
	afterEach(() => vi.restoreAllMocks());

	const pruefe = (ungespeichert: boolean) =>
		ungespeichertWaechter(
			{ ungespeichert: () => ungespeichert },
			{} as ActivatedRouteSnapshot,
			{} as RouterStateSnapshot,
			{} as RouterStateSnapshot,
		);

	it('laesst ohne Aenderung gehen und fragt nicht', () => {
		const frage = vi.spyOn(window, 'confirm');
		expect(pruefe(false)).toBe(true);
		expect(frage).not.toHaveBeenCalled();
	});

	it('fragt bei einer Aenderung und bleibt bei Abbruch', () => {
		const frage = vi.spyOn(window, 'confirm').mockReturnValue(false);
		expect(pruefe(true)).toBe(false);
		expect(frage).toHaveBeenCalledWith('Ungespeicherte Änderungen verwerfen?');
	});

	it('geht bei einer Aenderung, wenn die Person verwirft', () => {
		vi.spyOn(window, 'confirm').mockReturnValue(true);
		expect(pruefe(true)).toBe(true);
	});
});
