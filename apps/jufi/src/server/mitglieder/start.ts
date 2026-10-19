import { hatRecht } from '@jufi/domain';
import type { RequestHandler, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';
import { statt404 } from './verwaltung.js';

/** So lange zeigt die Verwaltung einen Notfall-Link an (Plan-Entscheidung 2). */
export const NOTFALL_HINWEIS_TAGE = 30;

const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Nur JUGENDLEITER_RECHTE: Der Notfall-Link ist ein Zugang, den die Plattform fuer eine
 * Leitung ausstellt, also gehoert der Hinweis dem, der Rechte vergibt. Wer das Recht
 * nicht hat, bekommt 404 und erfaehrt nicht, dass es die Route gibt (Rahmen-Spec 8).
 */
const brauchtLeitung: RequestHandler = (_req, res, next) => {
	if (!hatRecht(mitgliedKontext(res).person, 'JUGENDLEITER_RECHTE')) return statt404(res);
	next();
};

export function startRouten(router: Router, deps: Pick<VolleAppDeps, 'jetzt' | 'prisma'>): void {
	const { jetzt, prisma } = deps;

	router.get(
		'/ansprechpartner',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { verein, db } = vereinsKontext(res);
			// Jede angemeldete Person darf das sehen, auch ein Kind: Es soll wissen, wen es fragen
			// kann. Darum nur Id und Name, weder Rechte noch Adresse. Ohne MITGLIEDER-Recht
			// reichte der Weg ueber /personen nicht, und eine eigene Kennzeichnung "Ansprechpartner"
			// gaebe es neben den Rechten ein zweites Mal (verworfen, wie bei istJugendleiter).
			const personen = await db.person.findMany({
				where: { entferntAm: null, rechte: { isEmpty: false } },
				select: { id: true, vorname: true, nachname: true },
			});
			// Im Speicher statt orderBy: Die Reihenfolge soll deutsch sein (Umlaute) und nicht von der
			// Sortierung abhaengen, mit der die Datenbank angelegt wurde.
			personen.sort((a, b) => a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de'));
			// Der Freitext aus den Einstellungen steht neben den Leitungen: Nicht jeder Verein hat eine
			// Leitung, die man mit Namen nennen will, oder eine Adresse, die man dazuschreibt. Ueber db
			// gelesen statt aus verein in res.locals, damit auch dieser Zugriff am Verein haengt.
			// Verworfen: ein eigener Endpunkt, denn die Oberflaeche zeigt beides in einem Abschnitt und
			// ein zweiter Aufruf liesse ihn halb geladen erscheinen.
			const stamm = await db.verein.findUnique({ where: { id: verein.id }, select: { kontakt: true } });
			res.json({ ansprechpartner: personen, kontakt: stamm?.kontakt ?? null });
		}),
	);

	router.get(
		'/verwaltung/hinweise',
		brauchtMitglied,
		brauchtLeitung,
		asynchron(async (_req, res) => {
			const { verein, db } = vereinsKontext(res);
			const gte = new Date(jetzt().getTime() - NOTFALL_HINWEIS_TAGE * TAG_MS);
			// Plan-Entscheidung 2: Hier wird ausnahmsweise mit dem schlichten PrismaClient gelesen,
			// denn AdminProtokoll ist eine Plattformtabelle ohne vereinId-Schluessel fuer vereinDb.
			// Die Abfrage ist eng: nur der Verein aus dem Slug, nur diese Aktion, nur Zeitpunkt und
			// Ziel; der Admin und alles andere aus dem Protokoll bleiben ungelesen. Verworfen: ein
			// eigenes Feld oder eine Quittung am Verein, damit der Hinweis ohne Ausnahme von der
			// Regel auskaeme -- das wuerde ein Schema und einen Bedienschritt nur dafuer einfuehren.
			const eintraege = await prisma.adminProtokoll.findMany({
				where: { vereinId: verein.id, aktion: 'NOTFALL_LINK', zeitpunkt: { gte } },
				select: { zeitpunkt: true, betroffenePersonId: true },
				orderBy: { zeitpunkt: 'desc' },
			});
			// Die Namen kommen ueber vereinDb: Ohne Fremdschluessel koennte die Id im Protokoll auch
			// auf eine Person eines anderen Vereins zeigen, die findet sich dort nicht. Ein Grabstein
			// ist nicht mehr "da" und hat ohnehin keinen Namen mehr, auch er wird null.
			const ids = [...new Set(eintraege.flatMap((e) => (e.betroffenePersonId ? [e.betroffenePersonId] : [])))];
			const personen = await db.person.findMany({
				where: { id: { in: ids }, entferntAm: null },
				select: { id: true, vorname: true, nachname: true },
			});
			const nachId = new Map(personen.map((p) => [p.id, p]));
			res.json({
				notfallLinks: eintraege.map((e) => {
					const person = e.betroffenePersonId ? nachId.get(e.betroffenePersonId) : undefined;
					return {
						am: e.zeitpunkt.toISOString(),
						vorname: person?.vorname ?? null,
						nachname: person?.nachname ?? null,
					};
				}),
			});
		}),
	);
}
