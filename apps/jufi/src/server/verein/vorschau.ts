import { idAusSegment, vorschauTitel } from '@jufi/domain';
import { vereinDb } from '@jufi/db';
import { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { ladeVereinAusSlug } from '../verein.js';

/**
 * Link-Vorschau (TP3-Spec 7.2): Ein Messenger holt die Thread-Seite ohne Cookie und liest
 * nur den Kopf. Angular rendert dort fuer jede Adresse dieselbe Huelle, also setzt der
 * Server die Open-Graph-Tags in genau die Seite, die Angular sonst ausliefert (deps.seitenHtml).
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const maskiere = (text: string) => text.replace(/[&<>"']/g, (z) => ESCAPES[z]);

export function vorschauTags(e: { siteName: string; titel: string; bild: string }): string {
	const meta = (eigenschaft: string, inhalt: string) =>
		`<meta property="${eigenschaft}" content="${maskiere(inhalt)}" />`;
	return [
		meta('og:type', 'website'),
		meta('og:site_name', e.siteName),
		meta('og:title', e.titel),
		meta('og:image', e.bild),
		meta('og:image:width', '512'),
		meta('og:image:height', '512'),
	].join('\n');
}

/**
 * Setzt die Tags vor das erste `</head>`. Ohne `</head>` bleibt die Seite unveraendert, statt
 * Tags in den Rumpf zu schreiben, wo kein Messenger sie liest. Ein Ersetzen per String statt
 * Regex mit `$`-Mustern: Der Titel ist fremder Text, und `$&` darin wuerde sonst ausgewertet.
 */
export function setzeInKopf(html: string, tags: string): string {
	const stelle = html.indexOf('</head>');
	if (stelle < 0) return html;
	return `${html.slice(0, stelle)}${tags}\n${html.slice(stelle)}`;
}

/**
 * Bewusst ohne vereinAusSlug: Das antwortet mit JSON-404, und wer sich im Link vertippt hat,
 * sah statt der Seite JSON. Ein unbekannter oder gesperrter Verein wird weitergereicht und
 * antwortet wie bisher, ohne Tags. Jeder andere Fall (Entwurf, Jugendleiter-Thread, fremder
 * Verein, Austausch, Unsinn) bekommt dieselben Bytes wie eine unbekannte ID: Der Titel kommt
 * nur aus vorschauTitel, und der Thread wird ueber vereinDb gelesen, also nur im eigenen Verein.
 * Verworfen: je Fall eine eigene Antwort, weil jeder Unterschied verraet, dass es den Thread gibt.
 *
 * Kein Cache (no-store): Die Antwort haengt am Stand des Threads, und eine Vorschau, die den
 * Titel eines inzwischen zurueckgezogenen Threads zeigt, waere genau das Leck, das es nicht geben soll.
 */
export function vorschauRouten(deps: VolleAppDeps): Router {
	const router = Router({ caseSensitive: true });

	router.get('/:slug/t/:segment', async (req, res, next) => {
		try {
			const verein = await ladeVereinAusSlug(deps.prisma, req.params['slug'] ?? '');
			if (!verein) return next();
			const id = idAusSegment(req.params['segment'] ?? '');
			const thread = id
				? await vereinDb(deps.prisma, verein.id).thread.findFirst({
						where: { id },
						select: { titel: true, veroeffentlichtAm: true, rollenfilter: true },
					})
				: null;
			const html = await deps.seitenHtml(req);
			if (html === null) return next();
			const tags = vorschauTags({
				siteName: verein.anzeigename,
				titel: vorschauTitel(thread) ?? verein.anzeigename,
				bild: `${deps.umgebung.basisUrl}/${verein.slug}/icon-512.png`,
			});
			res.status(200).type('text/html; charset=utf-8').set('Cache-Control', 'no-store').send(setzeInKopf(html, tags));
		} catch (error) {
			next(error);
		}
	});

	return router;
}
