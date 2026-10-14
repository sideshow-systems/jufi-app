import { sperreVereinszeile, type VereinDb } from '@jufi/db';
import { normalisiereEmail, pruefeEmail } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron, text } from '../admin/asynchron.js';
import { reserviere, sperre, zuVieleVersuche } from '../admin/versuche.js';
import { einladungsLink, erzeugeVereinsEinladung } from '../einladung.js';
import { resetMail } from '../mail/texte.js';
import { legeMailAn } from '../mail/warteschlange.js';
import { vereinsKontext } from '../verein.js';

/** Fuer jeden Fall dieselbe Antwort, auch fuer kaputte Eingaben (Spec 4.4). */
const OK = { ok: true };

/**
 * Sucht die Person und reiht Reset-Link und Mail ein. Laeuft im Nachlauf, nach
 * der Antwort. Nur Erwachsene, nicht entfernt, mit Zugang: Jungfischer
 * bekommen nie eine Mail (ihre Adresse ist freiwillig und nur fuer
 * Benachrichtigungen; die Oberflaeche schickt sie zur Familie), und wer noch
 * keinen Zugang hat, braucht eine Einladung, keinen Reset.
 *
 * Erst lesen, dann die Transaktion nur fuer den Treffer: Unbekannte Adressen
 * kosten so keinen Schreibvorgang auf der Vereinszeile. In der Transaktion wird
 * nach der Sperre neu gelesen, weil der Admin zwischendurch den Slug korrigiert
 * oder den Verein gesperrt haben kann -- der Link truege sonst den alten Slug.
 * Verworfen: den Slug aus der Anfrage nehmen, dann fuehrte die Mail ins Leere.
 */
async function setzeZurueck(
	db: VereinDb,
	e: { vereinId: string; email: string; jetzt: Date; basisUrl: string },
): Promise<void> {
	const bedingung = { email: e.email, art: 'ERWACHSENER', entferntAm: null, zugang: { isNot: null } } as const;
	if (!(await db.person.findFirst({ where: bedingung, select: { id: true } }))) return;

	await db.$transaction(async (tx) => {
		await sperreVereinszeile(tx, e.vereinId);
		const verein = await tx.verein.findFirst({ select: { slug: true, anzeigename: true, status: true } });
		if (!verein || verein.status !== 'AKTIV') return;
		const person = await tx.person.findFirst({ where: bedingung, select: { id: true, vorname: true, email: true } });
		if (!person?.email) return;

		const { id, token } = await erzeugeVereinsEinladung(tx, {
			personId: person.id,
			art: 'RESET',
			erstelltVonPersonId: null,
			jetzt: e.jetzt,
		});
		const link = einladungsLink(e.basisUrl, verein.slug, token);
		await legeMailAn(tx, {
			empfaenger: person.email,
			...resetMail({ vorname: person.vorname, anzeigename: verein.anzeigename, link }),
			bezug: `reset:${id}`,
			jetzt: e.jetzt,
		});
	});
}

/**
 * "Passwort vergessen?" Haengt direkt am Router von vereinsApi (kein
 * Unter-Router, der Mandanten-Test liest die Liste von dort).
 *
 * Backoff mit eigenem Praefix "m-reset", getrennt von der Anmeldung: wer sein
 * Passwort vergessen hat, soll sich nach dem Reset sofort anmelden koennen.
 * Jeder Aufruf zaehlt und wird nie zurueckgesetzt, ob es die Adresse gibt oder
 * nicht -- ein Zuruecksetzen beim Treffer machte die 429 zum Orakel fuer
 * bekannte Adressen, und jeder Aufruf kann einer fremden Adresse eine Mail
 * schicken. Der Versuch, der die Sperre ausloest, ist schon 429 und erzeugt
 * nichts (wie bei der Anmeldung: "der vierte ist 429").
 */
export function zugangVerlorenRouten(
	router: Router,
	deps: Pick<VolleAppDeps, 'jetzt' | 'umgebung' | 'anmeldeVersuche' | 'nachlauf'>,
): void {
	const { jetzt, umgebung, anmeldeVersuche: versuche, nachlauf } = deps;

	router.post(
		'/zugang-verloren',
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const email = normalisiereEmail(text(req.body?.email));
			// Normalisiert im Schluessel, sonst zaehlten "A@x.de" und "a@x.de " getrennt.
			const schluessel = [`m-reset-ip:${req.ip}`, `m-reset:${verein.id}:${email}`];
			const versuch = reserviere(versuche, schluessel);
			if (versuch.wartenMs > 0 || versuch.loestSperreAus) {
				zuVieleVersuche(res, versuch.wartenMs || sperre(versuche, schluessel));
				return;
			}

			// Erst antworten, dann arbeiten: Inhalt und Dauer der Antwort haengen so
			// an nichts, was die Datenbank weiss (Spec 3.4/4.4).
			res.json(OK);
			if (!pruefeEmail(email)) return;
			const zeit = jetzt();
			nachlauf.starte(() => setzeZurueck(db, { vereinId: verein.id, email, jetzt: zeit, basisUrl: umgebung.basisUrl }));
		}),
	);
}
