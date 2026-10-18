import { sperreVereinszeile, type VereinDb } from '@jufi/db';
import {
	hatRecht,
	LOGO_MAX_BYTES,
	LOGO_ZU_GROSS,
	normalisiereFarbe,
	pruefeAnzeigename,
	pruefeFarbe,
	pruefeKontakt,
	pruefeVereinsname,
} from '@jufi/domain';
import express, { type ErrorRequestHandler, type RequestHandler, type Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { statt404 } from '../mitglieder/verwaltung.js';
import { vereinsKontext } from '../verein.js';
import { verarbeiteLogo } from './logo.js';

const FORMAT_FEHLER = { fehler: 'Bitte ein PNG- oder JPEG-Bild wählen' };
const ZU_GROSS = { fehler: LOGO_ZU_GROSS };

/** Alles, was sich ueber die Oberflaeche aendern laesst. Slug und Status gehoeren dem Plattform-Admin. */
const FELDER = ['name', 'anzeigename', 'kontakt', 'farbe'] as const;

interface Aenderung {
	name?: string;
	anzeigename?: string;
	kontakt?: string | null;
	farbe?: string;
}

/** Erstes ungueltiges Feld mit seinem Text; der Aufrufer macht daraus die 400er-Antwort. */
class Ungueltig extends Error {
	constructor(
		readonly fehler: string,
		readonly feld: string,
	) {
		super(fehler);
	}
}

/**
 * Ein Text-Feld des Bodys, ohne Rand. Etwas anderes als Text ist fuer die Pruefung
 * ein leerer Text und scheitert dort mit demselben Hinweis wie eine Eingabe,
 * die zu kurz oder zu lang ist.
 */
function textOhneRand(wert: unknown): string {
	return typeof wert === 'string' ? wert.trim() : '';
}

/**
 * Prueft den Body und liefert nur, was geschrieben werden soll. Bewusst eine
 * Positivliste: Ein unbekannter Schluessel ist ein 400 und wird nicht still
 * ignoriert, damit ein Client, der slug oder status mitschickt, den Irrtum
 * merkt, statt von einer 200-Antwort getaeuscht zu werden. Verworfen: unbekannte
 * Schluessel verwerfen -- das hiesse, dass ein Tippfehler im Feldnamen unbemerkt bleibt.
 *
 * Die Grenzen kommen aus libs/domain, die Texte stehen hier: Sie gehoeren zur
 * Oberflaeche, die Regeln nicht. Leer und zu lang haben je einen Text, weil
 * "hoechstens 24 Zeichen" fuer ein leeres Feld in die Irre fuehrte.
 */
function pruefeAenderung(body: unknown): Aenderung {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new Ungueltig('Ungültige Anfrage', 'body');
	}
	const roh = body as Record<string, unknown>;
	for (const schluessel of Object.keys(roh)) {
		if (!(FELDER as readonly string[]).includes(schluessel)) {
			throw new Ungueltig('Dieses Feld lässt sich nicht ändern', schluessel);
		}
	}
	const aenderung: Aenderung = {};
	if ('name' in roh) {
		const name = textOhneRand(roh['name']);
		if (name === '') throw new Ungueltig('Bitte den offiziellen Namen angeben', 'name');
		if (!pruefeVereinsname(name)) throw new Ungueltig('Der offizielle Name darf höchstens 120 Zeichen haben', 'name');
		aenderung.name = name;
	}
	if ('anzeigename' in roh) {
		const anzeigename = textOhneRand(roh['anzeigename']);
		if (anzeigename === '') throw new Ungueltig('Bitte einen Anzeigenamen angeben', 'anzeigename');
		if (!pruefeAnzeigename(anzeigename)) {
			throw new Ungueltig('Der Anzeigename darf höchstens 24 Zeichen haben', 'anzeigename');
		}
		aenderung.anzeigename = anzeigename;
	}
	if ('kontakt' in roh) {
		const wert = roh['kontakt'];
		// null und leer sind beide "kein Kontakt" und werden zu null: eine Darstellung in der Datenbank.
		const kontakt = wert === null ? '' : textOhneRand(wert);
		if ((typeof wert !== 'string' && wert !== null) || !pruefeKontakt(kontakt)) {
			throw new Ungueltig('Der Kontakt darf höchstens 500 Zeichen haben', 'kontakt');
		}
		aenderung.kontakt = kontakt === '' ? null : kontakt;
	}
	if ('farbe' in roh) {
		const farbe = normalisiereFarbe(typeof roh['farbe'] === 'string' ? roh['farbe'] : '');
		if (!pruefeFarbe(farbe)) throw new Ungueltig('Bitte eine Farbe als #rrggbb angeben', 'farbe');
		aenderung.farbe = farbe;
	}
	return aenderung;
}

async function logoStand(db: VereinDb, vereinId: string): Promise<string | null> {
	const logo = await db.vereinLogo.findUnique({ where: { vereinId }, select: { geaendertAm: true } });
	return logo?.geaendertAm.toISOString() ?? null;
}

/**
 * Das Recht EINSTELLUNGEN, vor allem anderen: Wer es nicht hat, bekommt 404 und
 * erfaehrt nicht, dass es die Route gibt (Rahmen-Spec 8). Bei dem Upload steht
 * das vor dem Body-Parser, damit niemand ohne Recht ein Megabyte in den Speicher
 * des Servers schicken kann.
 */
const brauchtEinstellungen: RequestHandler = (_req, res, next) => {
	if (!hatRecht(mitgliedKontext(res).person, 'EINSTELLUNGEN')) return statt404(res);
	next();
};

/**
 * Uebersetzt den Fehler des Parsers (zu gross, 413) in den Text dieser Route; der
 * allgemeine Fehlerbehandler in fehler.ts kennt nur "Anfrage zu gross", und die
 * Oberflaeche braucht den Hinweis auf das Bild. Alles andere geht unveraendert weiter.
 */
const parserFehler: ErrorRequestHandler = (error, _req, res, next) => {
	if ((error as { type?: unknown } | null)?.type === 'entity.too.large') {
		return void res.status(413).json(ZU_GROSS);
	}
	next(error);
};

export function einstellungenRouten(router: Router, _deps: VolleAppDeps): void {
	router.get(
		'/einstellungen',
		brauchtMitglied,
		brauchtEinstellungen,
		asynchron(async (_req, res) => {
			const { verein, db } = vereinsKontext(res);
			res.json(antwort(verein, await logoStand(db, verein.id)));
		}),
	);

	router.patch(
		'/einstellungen',
		brauchtMitglied,
		brauchtEinstellungen,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			let aenderung: Aenderung;
			try {
				aenderung = pruefeAenderung(req.body);
			} catch (error) {
				if (error instanceof Ungueltig) return void res.status(400).json({ fehler: error.fehler, feld: error.feld });
				throw error;
			}
			// Kein sperreVereinszeile: Das ist keine Entscheidung "angenommen oder nicht", zwei
			// gleichzeitige PATCH ueberschreiben sich feldweise, und die spaetere gewinnt.
			const neu = await db.verein.update({ where: { id: verein.id }, data: aenderung });
			res.json(antwort(neu, await logoStand(db, verein.id)));
		}),
	);

	// Das Logo hat mit 1 MB (Spec 8.5) eine eigene Grenze nur an dieser Route. Der globale
	// JSON-Parser (100 KB) bleibt unberuehrt: express.json liest keine Bilder, er ueberspringt
	// diesen Content-Type. Verworfen: die Grenze global anheben -- jede JSON-Route nahme dann 1 MB.
	router.put(
		'/einstellungen/logo',
		brauchtMitglied,
		brauchtEinstellungen,
		express.raw({ type: ['image/png', 'image/jpeg'], limit: LOGO_MAX_BYTES }),
		parserFehler,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			// Ein anderer Content-Type liess den Parser den Body auslassen, ein leerer Body
			// liefert ebenfalls keinen Puffer: beides ist fuer den Aufrufer ein falsches Format.
			const eingabe: unknown = req.body;
			if (!Buffer.isBuffer(eingabe) || eingabe.length === 0) return void res.status(415).json(FORMAT_FEHLER);

			const logo = await verarbeiteLogo(eingabe);
			if (!logo.ok)
				return void res
					.status(logo.grund === 'zu-gross' ? 413 : 415)
					.json(logo.grund === 'zu-gross' ? ZU_GROSS : FORMAT_FEHLER);

			// Unter der Sperre, damit zwei erste Uploads nicht beide ein Logo anlegen wollen und
			// eines am Primaerschluessel scheitert (500). geaendertAm setzt Prisma (@updatedAt) bei
			// jedem Ersetzen neu; davon haengt das ?v= der Logo-Adresse ab.
			const stand = await db.$transaction(async (tx) => {
				await sperreVereinszeile(tx, verein.id);
				// Kopie als Uint8Array<ArrayBuffer>: Prismas Bytes-Typ verlangt einen echten ArrayBuffer,
				// ein Buffer von sharp kann nach den Typen auf einem SharedArrayBuffer liegen.
				const daten = {
					bild: new Uint8Array(logo.bild),
					mimeType: logo.mimeType,
					icon192: new Uint8Array(logo.icon192),
					icon512: new Uint8Array(logo.icon512),
				};
				const zeile = await tx.vereinLogo.upsert({
					where: { vereinId: verein.id },
					create: daten,
					update: daten,
					select: { geaendertAm: true },
				});
				return zeile.geaendertAm.toISOString();
			});
			res.json({ logoStand: stand });
		}),
	);

	router.delete(
		'/einstellungen/logo',
		brauchtMitglied,
		brauchtEinstellungen,
		asynchron(async (_req, res) => {
			const { verein, db } = vereinsKontext(res);
			// deleteMany statt delete: ohne Logo ist das count 0 und die Antwort dieselbe, ohne
			// Prisma-Fehler (P2025). Ein Aufruf, der nichts zu tun hat, ist kein Fehler.
			// Das where nennt den Verein ausdruecklich, obwohl vereinDb ihn ohnehin einsetzt: Fiele
			// diese Einschraenkung je weg, loeschte ein leeres where die Logos aller Vereine.
			// Unter derselben Sperre wie der Upload, damit ein gleichzeitiges PUT und DELETE
			// hintereinander laufen: Der Upload liest die Zeile und ersetzt sie dann, ein Loeschen
			// dazwischen liesse sein Ersetzen als P2025 mit 500 scheitern. Verworfen: ohne Sperre,
			// weil die Reihenfolge dann vom Zufall abhinge.
			await db.$transaction(async (tx) => {
				await sperreVereinszeile(tx, verein.id);
				await tx.vereinLogo.deleteMany({ where: { vereinId: verein.id } });
			});
			res.json({ logoStand: null });
		}),
	);
}

function antwort(
	verein: { slug: string; name: string; anzeigename: string; kontakt: string | null; farbe: string },
	stand: string | null,
) {
	return {
		slug: verein.slug,
		name: verein.name,
		anzeigename: verein.anzeigename,
		kontakt: verein.kontakt,
		farbe: verein.farbe,
		logoStand: stand,
	};
}
