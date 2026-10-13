import type { VereinStatus } from '@jufi/db';
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
import type { Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { einladungsLink, leitungsEinladungsText } from '../einladung.js';
import { asynchron, text } from './asynchron.js';
import type { AdminDaten, NeuerVerein, NeueEinladung } from './daten.js';
import { adminKontext, brauchtAdmin } from './sitzung.js';

const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };
const SLUG_VERGEBEN = { fehler: 'Dieser Slug ist vergeben', feld: 'slug' };
const SLUG_FEST = { fehler: 'Der Slug ist fest, seit die erste Einladung angenommen wurde' };
const SCHON_ANGENOMMEN = { fehler: 'Die erste Einladung ist schon angenommen' };
const BITTE_AUSFUELLEN = 'Bitte ausfüllen';
/**
 * Ohne Grenze liefe ein 90-kB-Name (nur express.json begrenzt auf 100 kB) in die
 * Datenbank und in den Einladungstext. 100 reicht fuer jeden echten Namen.
 */
const MAX_PERSONENNAME = 100;
const ZU_LANG_NAME = `Höchstens ${MAX_PERSONENNAME} Zeichen`;

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
	if (eingabe.leitung.vorname.length > MAX_PERSONENNAME) return { ok: false, feld: 'vorname', fehler: ZU_LANG_NAME };
	if (!eingabe.leitung.nachname) return { ok: false, feld: 'nachname', fehler: BITTE_AUSFUELLEN };
	if (eingabe.leitung.nachname.length > MAX_PERSONENNAME) return { ok: false, feld: 'nachname', fehler: ZU_LANG_NAME };
	if (!pruefeEmail(eingabe.leitung.email)) return { ok: false, feld: 'email', fehler: 'Keine gültige E-Mail-Adresse' };
	return { ok: true, eingabe };
}

/**
 * Was die Vereinsrouten brauchen: Uhr, Umgebung und adminDaten -- ausdruecklich
 * ohne prisma. Die Grenze "nur daten.ts liest Vereinstabellen" (Spec 7.4) haelt
 * so die Signatur fest und nicht die Disziplin beim naechsten Einfuegen einer
 * Route. Verworfen: VolleAppDeps durchreichen und prisma nur nicht benutzen.
 */
export type VereinsRoutenDeps = Pick<VolleAppDeps, 'jetzt' | 'umgebung'> & { daten: AdminDaten };

/** Link und fertiger Text zum Kopieren, wie nach dem Anlegen eines Vereins. */
function einladung(basisUrl: string, e: NeueEinladung): { link: string; text: string } {
	const link = einladungsLink(basisUrl, e.slug, e.token);
	return { link, text: leitungsEinladungsText({ vorname: e.vorname, anzeigename: e.anzeigename, link }) };
}

function nichtGefunden(res: Response): void {
	res.status(404).json(NICHT_GEFUNDEN);
}

/**
 * Vereine ansehen, anlegen, sperren, Slug korrigieren und Einladungen erneuern
 * (Spec 7.3). Haengt direkt an den Router aus adminApi (siehe
 * api.ts).
 */
export function vereinsRouten(router: Router, deps: VereinsRoutenDeps): void {
	const { jetzt, umgebung, daten } = deps;

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
			res.status(201).json({
				id: angelegt.id,
				slug: angelegt.slug,
				einladung: einladung(umgebung.basisUrl, {
					token: angelegt.token,
					vorname: angelegt.leitung.vorname,
					anzeigename: angelegt.anzeigename,
					slug: angelegt.slug,
				}),
			});
		}),
	);

	router.get(
		'/vereine/:id',
		brauchtAdmin,
		asynchron(async (req, res) => {
			const details = await daten.vereinsdetails(req.params['id'] ?? '', jetzt());
			if (!details) {
				nichtGefunden(res);
				return;
			}
			res.json(details);
		}),
	);

	/**
	 * 200 mit dem Status auch, wenn er schon so war: Das Ziel des Klicks ist
	 * erreicht, ein Fehler wuerde die Oberflaeche nur verwirren (Doppelklick,
	 * zweiter Tab).
	 */
	function statusRoute(pfad: string, status: VereinStatus): void {
		router.post(
			`/vereine/:id/${pfad}`,
			brauchtAdmin,
			asynchron(async (req, res) => {
				const { admin } = adminKontext(res);
				const ergebnis = await daten.setzeStatus(req.params['id'] ?? '', status, admin.id, jetzt());
				if (!ergebnis) {
					nichtGefunden(res);
					return;
				}
				res.json({ status });
			}),
		);
	}
	statusRoute('sperren', 'GESPERRT');
	statusRoute('entsperren', 'AKTIV');

	/**
	 * Reihenfolge der Antworten: unbekannter Verein (404), Format (400), fest
	 * (409), vergeben (409). Den Verein gibt es nur dann vorab nachzusehen, wenn
	 * das Format nicht stimmt; sonst sagt es die Korrektur selbst, in ihrer
	 * Transaktion. Verworfen: das Format erst in daten.ts pruefen -- die Pruefung
	 * der Eingabe steht fuer alle Routen hier.
	 */
	router.post(
		'/vereine/:id/slug',
		brauchtAdmin,
		asynchron(async (req, res) => {
			const id = req.params['id'] ?? '';
			const b = (req.body ?? {}) as Record<string, unknown>;
			// Nicht normalisiert, aus demselben Grund wie beim Anlegen (pruefeNeuenVerein).
			const slug = text(b['slug']);
			const pruefung = pruefeNeuenSlug(slug);
			if (!pruefung.ok) {
				if (!(await daten.gibtVerein(id))) nichtGefunden(res);
				else res.status(400).json({ fehler: SLUG_HINWEIS[pruefung.grund], feld: 'slug' });
				return;
			}
			const { admin } = adminKontext(res);
			const ergebnis = await daten.korrigiereSlug(id, slug, admin.id, jetzt());
			if (ergebnis === null) nichtGefunden(res);
			else if (ergebnis === 'fest') res.status(409).json(SLUG_FEST);
			else if (ergebnis === 'vergeben') res.status(409).json(SLUG_VERGEBEN);
			else res.json({ slug, einladung: einladung(umgebung.basisUrl, { ...ergebnis, slug }) });
		}),
	);

	router.post(
		'/vereine/:id/einladung-erneuern',
		brauchtAdmin,
		asynchron(async (req, res) => {
			const { admin } = adminKontext(res);
			const ergebnis = await daten.erneuereErsteEinladung(req.params['id'] ?? '', admin.id, jetzt());
			if (ergebnis === null) nichtGefunden(res);
			else if (ergebnis === 'angenommen') res.status(409).json(SCHON_ANGENOMMEN);
			else res.json({ einladung: einladung(umgebung.basisUrl, ergebnis) });
		}),
	);

	/**
	 * Jede Person, die kein Ansprechpartner dieses Vereins ist, ist "nicht
	 * gefunden" -- auch eine, die es gibt (Spec 7.3, Rahmen-Spec 8).
	 */
	router.post(
		'/vereine/:id/notfall-link',
		brauchtAdmin,
		asynchron(async (req, res) => {
			const b = (req.body ?? {}) as Record<string, unknown>;
			const { admin } = adminKontext(res);
			const ergebnis = await daten.notfallLink(req.params['id'] ?? '', text(b['personId']), admin.id, jetzt());
			if (ergebnis === null) nichtGefunden(res);
			else res.json({ einladung: einladung(umgebung.basisUrl, ergebnis) });
		}),
	);
}
