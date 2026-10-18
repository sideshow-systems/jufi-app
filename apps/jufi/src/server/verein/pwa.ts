import { createHash } from 'node:crypto';
import { Router, type Response } from 'express';
import { FLAECHEN, vereinsfarben } from '../../app/gestaltung/farben.js';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { vereinAusSlug, vereinsKontext } from '../verein.js';
import { initialenIcon } from './logo.js';

/**
 * Manifest und Icons je Verein, ohne Anmeldung (Rahmen-Entscheidung 4): Browser
 * laden das Manifest ohne Cookies, und gesperrte oder unbekannte Vereine bleiben
 * 404, weil alle drei Routen hinter vereinAusSlug liegen.
 *
 * Genau drei volle Pfade statt `app.use('/:slug', vereinAusSlug, ...)`:
 * express.static haengt in server.ts erst hinter createApp, und `/chunk-abc.js`
 * passte dann als Slug, scheiterte an pruefeSlug und bekaeme 404 statt der Datei.
 * So erreichen alle anderen Pfade unter dem Slug Angular, ohne die Datenbank zu
 * beruehren. caseSensitive wie die App: ein Router erbt die Einstellung nicht.
 *
 * Die Icons entstehen bei jeder Anfrage neu, statt irgendwo zu liegen: sie werden
 * nur beim Installieren und selten danach abgerufen. Verworfen: Icons ohne Logo
 * in der Datenbank ablegen, sie veralteten bei jeder Aenderung von Name oder Farbe.
 */
export function pwaRouten(deps: VolleAppDeps): Router {
	const router = Router({ caseSensitive: true });
	const slug = vereinAusSlug(deps.prisma);

	router.get('/:slug/manifest.webmanifest', slug, async (_req, res, next) => {
		try {
			const { verein, db } = vereinsKontext(res);
			const logo = await db.vereinLogo.findUnique({
				where: { vereinId: verein.id },
				select: { geaendertAm: true },
			});
			// Der Stand haengt als ?v= an den Icon-Adressen, damit ein neues Logo oder eine
			// neue Farbe das alte Icon verdraengt, obwohl der Browser es zwischenspeichert.
			// Ohne Logo gibt es keine Aenderungszeit; Name und Farbe bestimmen dann das Icon,
			// also bestimmen sie auch den Stand.
			const stand =
				logo?.geaendertAm.toISOString() ??
				createHash('sha256').update(`${verein.anzeigename}\n${verein.farbe}`).digest('hex').slice(0, 8);
			const icon = (groesse: 192 | 512) => ({
				src: `/${verein.slug}/icon-${groesse}.png?v=${stand}`,
				sizes: `${groesse}x${groesse}`,
				type: 'image/png',
			});
			res
				.type('application/manifest+json')
				.set('Cache-Control', 'no-cache')
				.json({
					id: `/${verein.slug}/`,
					name: verein.anzeigename,
					short_name: verein.anzeigename,
					lang: 'de',
					start_url: `/${verein.slug}/`,
					scope: `/${verein.slug}/`,
					display: 'standalone',
					background_color: FLAECHEN.hell.seite,
					theme_color: vereinsfarben(verein.farbe).hell.akzent,
					icons: [icon(192), icon(512)],
				});
		} catch (error) {
			next(error);
		}
	});

	for (const groesse of [192, 512] as const) {
		router.get(`/:slug/icon-${groesse}.png`, slug, async (_req, res, next) => {
			try {
				await sendeIcon(res, groesse);
			} catch (error) {
				next(error);
			}
		});
	}

	return router;
}

async function sendeIcon(res: Response, groesse: 192 | 512): Promise<void> {
	const { verein, db } = vereinsKontext(res);
	// Nur die verlangte Spalte lesen: Bytea-Spalten sind gross, und das Icon wird
	// ohnehin nur in einer Groesse gebraucht.
	const where = { vereinId: verein.id };
	const gespeichert =
		groesse === 192
			? (await db.vereinLogo.findUnique({ where, select: { icon192: true } }))?.icon192
			: (await db.vereinLogo.findUnique({ where, select: { icon512: true } }))?.icon512;
	const bytes = gespeichert ?? (await initialenIcon(verein.anzeigename, verein.farbe, groesse));
	// no-cache heisst "vor Verwendung nachfragen", nicht "nie speichern": Express setzt
	// einen ETag, und ein unveraendertes Icon kostet nur ein 304.
	res.type('image/png').set('Cache-Control', 'no-cache').send(Buffer.from(bytes));
}
