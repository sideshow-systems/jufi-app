import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, loescheMitgliederCookie, mitgliedKontext } from './sitzung.js';

/**
 * Profil und Abmelden. Haengt die Routen an den Router von vereinsApi, nicht an
 * einen Unter-Router: der Mandanten-Test liest die Liste von dort.
 */
export function profilRouten(router: Router, _deps: Pick<VolleAppDeps, 'jetzt'>): void {
	router.get('/ich', brauchtMitglied, (_req, res) => {
		const { person, zugang } = mitgliedKontext(res);
		res.json({
			person: {
				id: person.id,
				vorname: person.vorname,
				nachname: person.nachname,
				art: person.art,
				rechte: person.rechte,
			},
			// Erwachsene melden sich mit der Adresse an, Jungfischer mit dem Anmeldenamen.
			kennung: person.art === 'ERWACHSENER' ? person.email : zugang.anmeldename,
		});
	});

	router.post(
		'/abmelden',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { sitzungId } = mitgliedKontext(res);
			// deleteMany: ein Doppelklick auf Abmelden soll nicht mit 500 enden.
			await db.session.deleteMany({ where: { id: sitzungId } });
			loescheMitgliederCookie(req, res, verein.slug);
			res.status(204).end();
		}),
	);

	router.post(
		'/abmelden/alle',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { zugang } = mitgliedKontext(res);
			await db.session.deleteMany({ where: { zugangId: zugang.id } });
			loescheMitgliederCookie(req, res, verein.slug);
			res.status(204).end();
		}),
	);
}
