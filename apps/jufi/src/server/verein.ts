import { vereinDb, type PrismaClient, type Verein, type VereinDb } from '@jufi/db';
import { pruefeSlug } from '@jufi/domain';
import { Router, type RequestHandler, type Response } from 'express';
import type { VolleAppDeps } from './abhaengigkeiten.js';
import { dateiRouten } from './dateien/ausliefern.js';
import { dokumentRouten, speicherRoute } from './dateien/dokumente.js';
import { anmeldeRouten } from './mitglieder/anmeldung.js';
import { einladungsRouten } from './mitglieder/einladung.js';
import { familieRouten } from './mitglieder/familie.js';
import { jungfischerRouten } from './mitglieder/jungfischer.js';
import { personenRouten } from './mitglieder/personen.js';
import { rechteRouten } from './mitglieder/rechte.js';
import { datenauszugRouten } from './mitglieder/datenauszug.js';
import { profilRouten } from './mitglieder/profil.js';
import { startRouten } from './mitglieder/start.js';
import { untergruppenRouten } from './mitglieder/untergruppen.js';
import { einladenRouten, zugangRouten } from './mitglieder/zugang.js';
import { zugangVerlorenRouten } from './mitglieder/zugang-verloren.js';
import { routenAus } from './routen.js';
import { threadRouten } from './threads/routen.js';
import { einstellungenRouten } from './verein/einstellungen.js';

/** Was vereinAusSlug in res.locals ablegt; die Endpunkte lesen es ueber vereinsKontext. */
export interface VereinsLocals {
	verein: Verein;
	db: VereinDb;
}

const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

/**
 * Der Verein zum Slug, oder null fuer alles, was "nicht gefunden" ist: gesperrte,
 * unbekannte und unmoegliche Slugs (404, nie 403, Rahmen-Spec 8). Wer nichts sehen
 * darf, erfaehrt auch nicht, dass es etwas gibt. Eigene Funktion, weil das Upgrade
 * des Hubs (echtzeit/hub.ts) dieselbe Regel braucht und keine Express-Anfrage hat.
 *
 * pruefeSlug laeuft zuerst, damit ein Slug, den es nie geben kann (Grossbuchstaben,
 * Umlaute, reservierte Namen), die Datenbank gar nicht erreicht: ein Fehler dort
 * endete als 500 mit Log-Eintrag, obwohl die Anfrage schlicht ins Leere ging.
 */
export async function ladeVereinAusSlug(prisma: PrismaClient, slug: string): Promise<Verein | null> {
	if (!pruefeSlug(slug).ok) return null;
	const verein = await prisma.verein.findUnique({ where: { slug } });
	if (!verein || verein.status === 'GESPERRT') return null;
	return verein;
}

/** Macht aus dem Slug im Pfad den Verein der Anfrage (ladeVereinAusSlug), sonst 404. */
export function vereinAusSlug(prisma: PrismaClient): RequestHandler {
	return async (req, res, next) => {
		try {
			const verein = await ladeVereinAusSlug(prisma, req.params['slug'] ?? '');
			if (!verein) {
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
 * ohne Unter-Router: vereinsRouten liest die Liste aus dessen stack, und der
 * Mandanten-Test verlangt fuer jeden Eintrag einen Fall. Eine Route in einem
 * Unter-Router bliebe dort unsichtbar und damit ungeprueft.
 *
 * Eine Funktion statt eines festen Routers: die Routen brauchen Uhr, Umgebung
 * und Backoff aus deps (wie adminApi). caseSensitive wie die App (createApp):
 * ein Router erbt die Einstellung nicht, /VEREIN fuehrte sonst zur selben Route
 * wie /verein.
 */
export function vereinsApi(deps: VolleAppDeps): Router {
	const router = Router({ caseSensitive: true });

	router.get('/verein', async (_req, res, next) => {
		try {
			const { verein, db } = vereinsKontext(res);
			// Nur die Aenderungszeit, nie die Bytes: das Bild bleibt in der Datenbank. Sie dient
			// dem Browser als ?v= an der Logo-Adresse; ein Zaehler oder Hash waere ein weiteres
			// Feld, das mit jeder Aenderung mitwandern muesste (verworfen).
			const logo = await db.vereinLogo.findUnique({
				where: { vereinId: verein.id },
				select: { geaendertAm: true },
			});
			res.json({
				slug: verein.slug,
				anzeigename: verein.anzeigename,
				farbe: verein.farbe,
				hatLogo: logo !== null,
				logoStand: logo?.geaendertAm.toISOString() ?? null,
			});
		} catch (error) {
			next(error);
		}
	});

	router.get('/verein/logo', async (_req, res, next) => {
		try {
			const { verein, db } = vereinsKontext(res);
			const logo = await db.vereinLogo.findUnique({
				where: { vereinId: verein.id },
				select: { bild: true, mimeType: true },
			});
			if (!logo) {
				res.status(404).json(NICHT_GEFUNDEN);
				return;
			}
			// Ohne Anmeldung, weil die Anmeldeseite das Logo zeigt. no-cache mit ETag: Der
			// Browser fragt nach und bekommt bei unveraendertem Logo ein 304; die Adresse
			// traegt zusaetzlich ?v=, sodass ein neues Logo gar nicht erst aus dem Cache kommt.
			res.type(logo.mimeType).set('Cache-Control', 'no-cache').send(Buffer.from(logo.bild));
		} catch (error) {
			next(error);
		}
	});

	einladungsRouten(router, deps);
	anmeldeRouten(router, deps);
	profilRouten(router, deps);
	datenauszugRouten(router, deps);
	personenRouten(router, deps);
	familieRouten(router, deps);
	untergruppenRouten(router, deps);
	rechteRouten(router, deps);
	zugangRouten(router, deps);
	einladenRouten(router, deps);
	jungfischerRouten(router, deps);
	zugangVerlorenRouten(router, deps);
	einstellungenRouten(router, deps);
	startRouten(router, deps);
	threadRouten(router, deps);
	dateiRouten(router, deps);
	dokumentRouten(router, deps);
	speicherRoute(router, deps);

	return router;
}

export const nichtGefunden: RequestHandler = (_req, res) => {
	res.status(404).json(NICHT_GEFUNDEN);
};

/** Methode und Pfad jeder Route von vereinsApi, fuer den Mandanten-Test. */
export function vereinsRouten(router: Router): { methode: string; pfad: string }[] {
	return routenAus(router, 'vereinsApi');
}
