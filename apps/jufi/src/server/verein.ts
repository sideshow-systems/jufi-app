import { vereinDb, type PrismaClient, type Verein, type VereinDb } from '@jufi/db';
import { pruefeSlug } from '@jufi/domain';
import { Router, type RequestHandler, type Response } from 'express';

/** Was vereinAusSlug in res.locals ablegt; die Endpunkte lesen es ueber vereinsKontext. */
export interface VereinsLocals {
	verein: Verein;
	db: VereinDb;
}

const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

/**
 * Macht aus dem Slug im Pfad den Verein der Anfrage. Gesperrte, unbekannte und
 * unmoegliche Slugs sind alle "nicht gefunden" (404, nie 403, Rahmen-Spec 8):
 * Wer nichts sehen darf, erfaehrt auch nicht, dass es etwas gibt.
 *
 * pruefeSlug laeuft zuerst, damit ein Slug, den es nie geben kann (Grossbuchstaben,
 * Umlaute, reservierte Namen), die Datenbank gar nicht erreicht: ein Fehler dort
 * endete als 500 mit Log-Eintrag, obwohl die Anfrage schlicht ins Leere ging.
 */
export function vereinAusSlug(prisma: PrismaClient): RequestHandler {
	return async (req, res, next) => {
		try {
			const slug = req.params['slug'] ?? '';
			if (!pruefeSlug(slug).ok) {
				res.status(404).json(NICHT_GEFUNDEN);
				return;
			}
			const verein = await prisma.verein.findUnique({ where: { slug } });
			if (!verein || verein.status === 'GESPERRT') {
				res.status(404).json(NICHT_GEFUNDEN);
				return;
			}
			const locals: VereinsLocals = { verein, db: vereinDb(prisma, verein.id) };
			Object.assign(res.locals, locals);
			next();
		} catch (error) {
			// Express 4 faengt abgelehnte Promises nicht selbst.
			next(error);
		}
	};
}

/**
 * Der Verein der Anfrage, getippt. res.locals ist in Express ein Record<string, any>;
 * die Pruefung faengt eine Route ab, die ohne vereinAusSlug eingehaengt wurde,
 * bevor sie mit undefined weiterrechnet.
 */
export function vereinsKontext(res: Response): VereinsLocals {
	const locals = res.locals as Partial<VereinsLocals>;
	if (!locals.verein || !locals.db) throw new Error('vereinsKontext ohne vereinAusSlug aufgerufen');
	return { verein: locals.verein, db: locals.db };
}

/**
 * Alle Endpunkte unter /:slug/api/v1. Jeder haengt direkt an diesem einen Router,
 * ohne Unter-Router: vereinsRouten liest die Liste aus vereinsApi.stack, und der
 * Mandanten-Test verlangt fuer jeden Eintrag einen Fall. Eine Route in einem
 * Unter-Router bliebe dort unsichtbar und damit ungeprueft.
 */
export const vereinsApi = Router();

vereinsApi.get('/verein', async (_req, res, next) => {
	try {
		const { verein, db } = vereinsKontext(res);
		// count statt Logo laden: das Bild bleibt in der Datenbank.
		const hatLogo = (await db.vereinLogo.count()) > 0;
		res.json({ slug: verein.slug, anzeigename: verein.anzeigename, farbe: verein.farbe, hatLogo });
	} catch (error) {
		next(error);
	}
});

export const nichtGefunden: RequestHandler = (_req, res) => {
	res.status(404).json(NICHT_GEFUNDEN);
};

interface RouteSchicht {
	route?: { path?: unknown; methods?: Record<string, boolean> };
}

/**
 * Methode und Pfad jeder Route von vereinsApi, fuer den Mandanten-Test.
 *
 * Liest Express' interne Schichtenliste (stack). Eine Schicht ohne route
 * (router.use, Unter-Router) oder mit einem Pfad, der kein Text ist, wirft: Der
 * Test koennte sie nicht benennen, und still ueberspringen hiesse, eine
 * ungepruefte Route durchzulassen.
 */
export function vereinsRouten(): { methode: string; pfad: string }[] {
	const routen: { methode: string; pfad: string }[] = [];
	for (const schicht of vereinsApi.stack as RouteSchicht[]) {
		const route = schicht.route;
		if (!route || typeof route.path !== 'string') {
			throw new Error('vereinsApi darf nur Routen mit Textpfad enthalten, keine Unter-Router oder Middleware');
		}
		const methoden = Object.entries(route.methods ?? {})
			.filter(([, aktiv]) => aktiv)
			.map(([name]) => (name === '_all' ? 'ALL' : name.toUpperCase()));
		for (const methode of methoden) routen.push({ methode, pfad: route.path });
	}
	return routen;
}
