import {
	normalisiereEmail,
	normalisiereFarbe,
	pruefeAnzeigename,
	pruefeEmail,
	pruefeFarbe,
	pruefeNeuenSlug,
	pruefeVereinsname,
	SLUG_HINWEIS,
} from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { einladungsLink, leitungsEinladungsText } from '../einladung.js';
import { asynchron, text } from './asynchron.js';
import { adminDaten, type NeuerVerein } from './daten.js';
import { adminKontext, brauchtAdmin } from './sitzung.js';

const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };
const SLUG_VERGEBEN = { fehler: 'Dieser Slug ist vergeben', feld: 'slug' };
const BITTE_AUSFUELLEN = 'Bitte ausfüllen';

type Feld = 'name' | 'anzeigename' | 'slug' | 'farbe' | 'vorname' | 'nachname' | 'email';

/**
 * Normalisiert den Body und prueft ihn Feld fuer Feld. Gemeldet wird das erste
 * fehlerhafte Feld in der Reihenfolge des Formulars (Verein oben, Leitung
 * darunter), damit dieselbe Eingabe immer dieselbe Antwort gibt. Verworfen: alle
 * Fehler auf einmal -- die Oberflaeche zeigt ohnehin einen Hinweis am Feld, und
 * die Antwort bliebe { fehler, feld } wie ueberall sonst.
 *
 * Geprueft wird der normalisierte Wert (wie libs/domain es vorsieht): "#0F766E "
 * ist eine gueltige Farbe, "  Thomas@Example.ORG " eine gueltige Adresse. Der
 * Slug wird nicht normalisiert: Die Oberflaeche schlaegt ihn vor, und ein
 * still umgeschriebener Slug waere eine andere Adresse als die eingetippte.
 */
function pruefeNeuenVerein(
	body: unknown,
): { ok: true; eingabe: NeuerVerein } | { ok: false; feld: Feld; fehler: string } {
	const b = (body ?? {}) as Record<string, unknown>;
	const l = (typeof b['leitung'] === 'object' && b['leitung'] !== null ? b['leitung'] : {}) as Record<string, unknown>;
	const eingabe: NeuerVerein = {
		name: text(b['name']).trim(),
		anzeigename: text(b['anzeigename']).trim(),
		slug: text(b['slug']),
		farbe: normalisiereFarbe(text(b['farbe'])),
		leitung: {
			vorname: text(l['vorname']).trim(),
			nachname: text(l['nachname']).trim(),
			email: normalisiereEmail(text(l['email'])),
		},
	};

	if (!pruefeVereinsname(eingabe.name))
		return { ok: false, feld: 'name', fehler: 'Bitte den offiziellen Namen angeben' };
	if (!pruefeAnzeigename(eingabe.anzeigename)) {
		return { ok: false, feld: 'anzeigename', fehler: 'Höchstens 24 Zeichen, nicht leer' };
	}
	const slug = pruefeNeuenSlug(eingabe.slug);
	if (!slug.ok) return { ok: false, feld: 'slug', fehler: SLUG_HINWEIS[slug.grund] };
	if (!pruefeFarbe(eingabe.farbe)) return { ok: false, feld: 'farbe', fehler: 'Farbe als #rrggbb' };
	if (!eingabe.leitung.vorname) return { ok: false, feld: 'vorname', fehler: BITTE_AUSFUELLEN };
	if (!eingabe.leitung.nachname) return { ok: false, feld: 'nachname', fehler: BITTE_AUSFUELLEN };
	if (!pruefeEmail(eingabe.leitung.email)) return { ok: false, feld: 'email', fehler: 'Keine gültige E-Mail-Adresse' };
	return { ok: true, eingabe };
}

/**
 * Vereine ansehen und anlegen. Haengt direkt an den Router aus adminApi (siehe
 * api.ts). Bekommt adminDaten statt des PrismaClient: Was der Admin aus Vereinen
 * liest, steht so nur in daten.ts (Spec 7.4).
 */
export function vereinsRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, umgebung } = deps;
	const daten = adminDaten(deps.prisma);

	router.get(
		'/vereine',
		brauchtAdmin,
		asynchron(async (_req, res) => {
			res.json({ vereine: await daten.vereinsliste(jetzt()) });
		}),
	);

	router.post(
		'/vereine',
		brauchtAdmin,
		asynchron(async (req, res) => {
			const pruefung = pruefeNeuenVerein(req.body);
			if (!pruefung.ok) {
				res.status(400).json({ fehler: pruefung.fehler, feld: pruefung.feld });
				return;
			}
			const { admin } = adminKontext(res);
			const angelegt = await daten.legeVereinAn(pruefung.eingabe, admin.id, jetzt());
			if (angelegt === 'vergeben') {
				res.status(409).json(SLUG_VERGEBEN);
				return;
			}
			const link = einladungsLink(umgebung.basisUrl, angelegt.slug, angelegt.token);
			res.status(201).json({
				id: angelegt.id,
				slug: angelegt.slug,
				einladung: {
					link,
					text: leitungsEinladungsText({ vorname: angelegt.leitung.vorname, anzeigename: angelegt.anzeigename, link }),
				},
			});
		}),
	);

	router.get(
		'/vereine/:id',
		brauchtAdmin,
		asynchron(async (req, res) => {
			const details = await daten.vereinsdetails(req.params['id'] ?? '', jetzt());
			if (!details) {
				res.status(404).json(NICHT_GEFUNDEN);
				return;
			}
			res.json(details);
		}),
	);
}
