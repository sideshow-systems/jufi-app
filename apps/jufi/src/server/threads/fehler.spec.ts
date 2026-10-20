import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { antworteThreadFehler, ENTWURF, NICHT_GEFUNDEN, ThreadAbbruch } from './fehler.js';

function antwort() {
	const erhalten: { status?: number; koerper?: unknown } = {};
	const res = {
		status(s: number) {
			erhalten.status = s;
			return this;
		},
		json(k: unknown) {
			erhalten.koerper = k;
			return this;
		},
	} as unknown as Response;
	return { res, erhalten };
}

describe('antworteThreadFehler', () => {
	it('gibt den Status und Koerper eines ThreadAbbruch weiter', () => {
		const { res, erhalten } = antwort();
		antworteThreadFehler(res, new ThreadAbbruch(409, ENTWURF));
		expect(erhalten).toEqual({ status: 409, koerper: ENTWURF });
	});

	it.each(['P2003', 'P2025'])('antwortet bei %s mit 404 und der Antwort fuer Unbekanntes', (code) => {
		const { res, erhalten } = antwort();
		antworteThreadFehler(res, { code });
		expect(erhalten).toEqual({ status: 404, koerper: NICHT_GEFUNDEN });
	});

	it('wirft jeden anderen Fehler weiter', () => {
		const { res, erhalten } = antwort();
		const fehler = Object.assign(new Error('anderes'), { code: 'P2002' });
		expect(() => antworteThreadFehler(res, fehler)).toThrow(fehler);
		expect(erhalten).toEqual({});
	});
});
