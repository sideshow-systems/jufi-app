import { hashToken, registrationOptions } from '@jufi/auth';
import type { VereinDb } from '@jufi/db';
import { anmeldenameVorschlag } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { relyingParty } from '../admin/passkeys.js';
import { asynchron, text } from '../admin/asynchron.js';
import { vereinsKontext } from '../verein.js';
import { speichereChallenge } from './challenges.js';

const LINK_UNGUELTIG = { fehler: 'Dieser Link gilt nicht mehr' };

/**
 * Die offene Einladung zu diesem Token samt Person, oder undefined. Alles, was
 * keinen Link ergibt, ist dasselbe undefined: unbekannt, eingeloest, abgelaufen,
 * Person entfernt, Jungfischer ohne erlaubten Zugang. Wer von aussen fragt,
 * erfaehrt nicht, welcher Fall vorlag (404 wie bei jedem ungueltigen Link).
 * Ueber vereinDb: das Token eines anderen Vereins findet sich nicht.
 */
async function offeneEinladung(db: VereinDb, token: string, jetzt: Date) {
	const einladung = await db.einladung.findFirst({
		where: { tokenHash: hashToken(token), eingeloestAm: null, ablauf: { gt: jetzt } },
		include: { person: { include: { zugang: true } } },
	});
	if (!einladung) return undefined;
	const { person } = einladung;
	if (person.entferntAm) return undefined;
	if (person.art === 'JUNGFISCHER' && !person.zugangErlaubt) return undefined;
	return { einladung, person };
}

/**
 * Einladung pruefen und Passkey-Optionen. Haengt die Routen direkt an den Router
 * von vereinsApi (kein Unter-Router, der Mandanten-Test liest die Liste von dort).
 * Kein Backoff: das Token hat 256 Bit, Raten lohnt nicht.
 */
export function einladungsRouten(router: Router, deps: Pick<VolleAppDeps, 'jetzt' | 'umgebung'>): void {
	const { jetzt } = deps;

	// Prueft nur, verbraucht nichts: die Seite zeigt vor dem Einrichten, fuer wen
	// der Link ist und welche Kennung gilt.
	router.post(
		'/einladung/pruefen',
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const treffer = await offeneEinladung(db, text(req.body?.token), jetzt());
			if (!treffer) {
				res.status(404).json(LINK_UNGUELTIG);
				return;
			}
			const { einladung, person } = treffer;
			const zugang = person.zugang;
			let wert: string | null;
			if (person.art === 'ERWACHSENER') {
				wert = person.email;
			} else if (zugang?.anmeldename) {
				// Bestehender Zugang: die Kennung bleibt, auch bei Reset oder neuer Einladung.
				wert = zugang.anmeldename;
			} else {
				const vergeben = await db.zugang.findMany({
					where: { anmeldename: { not: null } },
					select: { anmeldename: true },
				});
				wert = anmeldenameVorschlag(
					person.vorname,
					new Set(vergeben.map((z) => z.anmeldename).filter((n): n is string => n !== null)),
				);
			}
			const einwilligungFehlt =
				person.art === 'JUNGFISCHER' &&
				(await db.einwilligung.count({ where: { jungfischerId: person.id, widerrufenAm: null } })) === 0;
			res.json({
				vorname: person.vorname,
				art: einladung.art,
				vereinsname: verein.anzeigename,
				personArt: person.art,
				kennung: { fest: zugang !== null, wert },
				hatZugang: zugang !== null,
				einwilligungFehlt,
			});
		}),
	);

	router.post(
		'/einladung/passkey-optionen',
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const zeit = jetzt();
			const treffer = await offeneEinladung(db, text(req.body?.token), zeit);
			if (!treffer) {
				res.status(404).json(LINK_UNGUELTIG);
				return;
			}
			const { person } = treffer;
			const optionen = await registrationOptions({
				rp: relyingParty(req, deps),
				user: {
					id: person.id,
					// Der Verein im Namen, damit die Auswahl am Telefon die Passkeys
					// mehrerer Vereine auf derselben Domain unterscheidet.
					name: `${person.vorname} ${person.nachname} · ${verein.anzeigename}`,
					displayName: `${person.vorname} ${person.nachname} · ${verein.anzeigename}`,
				},
				// Ein Passkey ist erst nach dem Einloesen gespeichert; vorher gibt es keinen auszuschliessen.
				existing: [],
			});
			await speichereChallenge(db, {
				challenge: optionen.challenge,
				purpose: 'register',
				personId: person.id,
				jetzt: zeit,
			});
			res.json({ optionen });
		}),
	);
}
