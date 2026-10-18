import { HttpErrorResponse } from '@angular/common/http';
import { alsApiFehler } from './api-fehler';

describe('alsApiFehler', () => {
	it('behält Code und gefundene Person der Serverantwort', () => {
		const fehler = alsApiFehler(
			new HttpErrorResponse({
				status: 409,
				error: {
					fehler: 'Diese Person gibt es vielleicht schon',
					code: 'DOPPELT',
					person: { id: 'k9', vorname: 'Lena', nachname: 'Muster' },
				},
			}),
		);
		expect(fehler.code).toBe('DOPPELT');
		expect(fehler.person).toEqual({ id: 'k9', vorname: 'Lena', nachname: 'Muster' });
	});

	it('übernimmt keine Person ohne Namen', () => {
		const fehler = alsApiFehler(new HttpErrorResponse({ status: 409, error: { fehler: 'x', person: { id: 1 } } }));
		expect(fehler.person).toBeUndefined();
		expect(fehler.code).toBeUndefined();
	});
});
