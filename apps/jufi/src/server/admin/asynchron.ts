import type { Request, RequestHandler, Response } from 'express';

/** Express 4 faengt abgelehnte Promises nicht selbst; ohne das hinge die Anfrage. */
export function asynchron(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
	return (req, res, next) => {
		fn(req, res).catch(next);
	};
}

/** Body-Feld als Text; alles andere (fehlend, Zahl, Objekt) ist leer statt ein Fehler. */
export function text(wert: unknown): string {
	return typeof wert === 'string' ? wert : '';
}
