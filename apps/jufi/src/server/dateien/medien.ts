import {
	istArchiviert,
	medienBloecke,
	siehtThread,
	threadDatenAus,
	threadSegment,
	type MedienAntwort,
} from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { NICHT_GEFUNDEN } from '../threads/fehler.js';
import { ladeKoepfe, ladeThreadUmfeld, ladeThreads } from '../threads/laden.js';
import { vereinsKontext } from '../verein.js';

/**
 * GET /medien: die Fotos und Dateien aller Threads, die die Person sehen darf (TP4-Spec 3.1).
 * Rein lesend, deshalb ohne Meldung an den Bus.
 *
 * Geladen wird in Stufen, damit die Zahl der Abfragen nicht mit den Threads waechst und Entwuerfe
 * oder fremde Threads keine Zeilen kosten: erst die Threads, die ueberhaupt ein Foto- oder
 * Datei-Modul haben (eine Abfrage), davon die Koepfe (eine), dann nur fuer die veroeffentlichten
 * und sichtbaren die Module samt Dateizeilen (ladeThreads, eine Abfrage je Tabelle). Verworfen:
 * wie /threads erst alle Threads mit allen Dateizeilen zu laden und danach zu filtern -- ein Verein
 * mit vielen Entwuerfen und Jugendleiter-Threads laedt dann deren Fotozeilen fuer jede Familie mit.
 *
 * Sichtbarkeit, Archivstatus und Segment kommen aus denselben Funktionen wie in der Thread-Liste
 * (siehtThread, istArchiviert, threadSegment), die Ordnung aus nachAktivitaet in medienBloecke:
 * Die Galerie hat keine eigene Regel, nur eine Auswahl davor: siehtThread laesst Jugendleiter auch
 * Entwuerfe sehen, die Galerie zeigt dagegen nur Veroeffentlichtes (wie der Kalender). Ein Entwurf ist
 * noch nicht verschickt; seine Bilder in einer Uebersicht zu zeigen, verriete den Stand der Planung
 * jedem, der die Seite oeffnet. Verworfen: Jugendleitern ihre Entwuerfe zeigen -- sie finden sie in der Verwaltung.
 */
export function medienRoute(router: Router, deps: VolleAppDeps): void {
	const { jetzt } = deps;

	router.get(
		'/medien',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const [umfeld, mitMedien] = await Promise.all([
				ladeThreadUmfeld(db),
				db.threadModul.findMany({ where: { typ: { in: ['FOTOS', 'DATEIEN'] } }, select: { threadId: true } }),
			]);
			const mich = umfeld.personen.get(person.id);
			if (!mich) return void res.status(404).json(NICHT_GEFUNDEN);

			const koepfe = await ladeKoepfe(db, [...new Set(mitMedien.map((m) => m.threadId))]);
			const sichtbar = [...koepfe.values()]
				.filter((kopf) => kopf.veroeffentlichtAm !== null && siehtThread(mich, kopf, umfeld))
				.map((kopf) => kopf.id);
			const geladen = sichtbar.length === 0 ? [] : await ladeThreads(db, { threadIds: sichtbar, mitAntworten: false });

			const jetztWert = jetzt();
			const antwort: MedienAntwort = {
				bloecke: medienBloecke(
					geladen.map((t) => ({
						kopf: t.kopf,
						segment: threadSegment(t.kopf.id, t.kopf.titel),
						archiviert: istArchiviert(t.kopf, threadDatenAus(t.kopf, t.module).termine, jetztWert),
						letzteAktivitaetAm: t.letzteAktivitaetAm,
						module: t.module,
					})),
				),
			};
			res.json(antwort);
		}),
	);
}
