import { sperreVereinszeile, vermerkeUmfeld, type Person } from '@jufi/db';
import {
	darfEinwilligen,
	darfFuerKindHandeln,
	EINWILLIGUNG_TEXT_VERSION,
	FOTO_EINWILLIGUNG_TEXT_VERSION,
	istErziehungsberechtigt,
	istVolljaehrig,
} from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { meldeUmfeld } from '../echtzeit/umfeld.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';
import { alsSicht } from './verwaltung.js';
import {
	Abbruch,
	EINWILLIGUNG_FEHLT,
	entzieheZugang,
	entzieheZugangWennUngueltig,
	erzeugeEinladungFuerKind,
	hatEinwilligung,
	hatFotoEinwilligung,
	type Transaktion,
} from './zugang.js';

const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

/**
 * Ob der Angemeldete fuer dieses Kind einwilligen und den Zugang steuern darf, mit allem
 * frisch gelesen. Wird unter sperreVereinszeile aufgerufen: ob die Aktion angenommen
 * wird, haengt an Handelndem, Kind und Zuordnungen, und jedes davon kann eine gleichzeitige
 * Anfrage aendern (Familie loesen, Entfernen, Einloesen -- wie in rechte.ts). Die Vorab-
 * Pruefung aus der Sitzung zaehlt nicht.
 *
 * darfEinwilligen schliesst Entfernte, Nicht-Erziehungsberechtigte und Volljaehrige aus
 * (Spec 5.6): fuer all das ist das Kind "nicht gefunden" (404, Rahmen-Spec 8). Verworfen:
 * nur darfFuerKindHandeln zu verlangen -- die Grossmutter duerfte dann den Zugang
 * des Enkels steuern, und das volljaehrig gewordene Kind stuende weiter unter der Mutter.
 */
async function ladeErziehungsberechtigt(tx: Transaktion, handelndenId: string, kindId: string, zeit: Date) {
	const [ich, kind] = await Promise.all([
		tx.person.findFirst({ where: { id: handelndenId, art: 'ERWACHSENER', entferntAm: null } }),
		tx.person.findFirst({
			where: { id: kindId, art: 'JUNGFISCHER', entferntAm: null },
			include: { zugang: { select: { id: true } } },
		}),
	]);
	if (!ich || !kind) throw new Abbruch(404, NICHT_GEFUNDEN);
	const zuordnungen = await tx.bezugsperson.findMany({ where: { jungfischerId: kind.id } });
	if (!darfEinwilligen(alsSicht(ich), alsSicht(kind), zuordnungen, zeit)) throw new Abbruch(404, NICHT_GEFUNDEN);
	return { ich, kind };
}

type Einwilligungsart = 'DSGVO_ART8' | 'FOTOS';

/**
 * Die Art der Einwilligung aus dem Body; ohne Angabe die DSGVO-Einwilligung (Plan zu Etappe 2,
 * Entscheidung 7). Der Grund ist die Anfrage, nicht der Test: Der DSGVO-Weg des Clients schickt bis
 * heute nur erteilen (mitglieder-api.ts), und eine Seite, die beim Ausrollen noch in der alten
 * Fassung offen ist, ebenso. Verworfen: art zur Pflicht machen -- dann scheiterte jede solche
 * Anfrage mit 400. Alles andere ist 400, auch null und eine andere Schreibweise: eine Art, die
 * wir nicht kennen, soll nicht stillschweigend als DSGVO-Einwilligung gelten.
 */
function lesArt(body: unknown): Einwilligungsart {
	const wert = ((body ?? {}) as Record<string, unknown>)['art'];
	if (wert === undefined || wert === 'DSGVO_ART8') return 'DSGVO_ART8';
	if (wert === 'FOTOS') return 'FOTOS';
	throw new Abbruch(400, { fehler: 'Unbekannte Art der Einwilligung', feld: 'art' });
}

function lesBoolean(body: unknown, feld: string): boolean {
	const wert = ((body ?? {}) as Record<string, unknown>)[feld];
	if (typeof wert !== 'boolean') throw new Abbruch(400, { fehler: 'Ja oder nein erwartet', feld });
	return wert;
}

export function jungfischerRouten(router: Router, deps: Pick<VolleAppDeps, 'jetzt' | 'umgebung' | 'bus'>): void {
	const { jetzt, umgebung, bus } = deps;

	/**
	 * Gemeinsamer Rahmen der Schreib-Routen: Sperre, Entscheidung, Abbruch als Antwort. Die Arbeit
	 * ruft `vermerke` mit den geaenderten Personen auf, sobald feststeht, dass sie schreibt; gemeldet
	 * wird hier, nach dem Commit. Eine Arbeit, die nie vermerkt (Einladen), meldet nichts.
	 */
	async function unterSperre<T>(
		res: Parameters<typeof vereinsKontext>[0],
		handelnderId: string,
		zeit: Date,
		arbeit: (
			tx: Transaktion,
			verein: { slug: string; anzeigename: string },
			vermerke: (objektIds: readonly string[]) => Promise<void>,
		) => Promise<T>,
	): Promise<{ status: number; antwort: object } | { ok: T }> {
		const { verein, db } = vereinsKontext(res);
		try {
			// Ein Objekt statt einer Variable: TypeScript verfolgt die Zuweisung im Rueckruf nicht.
			const gemerkt: { vermerk?: Awaited<ReturnType<typeof vermerkeUmfeld>> } = {};
			const ergebnis = await db.$transaction(async (tx) => {
				await sperreVereinszeile(tx, verein.id);
				// Erneut gelesen: der Slug steht im Link, und der Admin kann ihn zwischen vereinAusSlug
				// und der Sperre korrigiert oder den Verein gesperrt haben.
				const stand = await tx.verein.findFirst({ select: { slug: true, anzeigename: true, status: true } });
				if (!stand || stand.status !== 'AKTIV') throw new Abbruch(404, NICHT_GEFUNDEN);
				return arbeit(tx, stand, async (objektIds) => {
					gemerkt.vermerk = await vermerkeUmfeld(tx, verein.id, handelnderId, zeit, objektIds);
				});
			});
			if (gemerkt.vermerk) meldeUmfeld(bus, verein.id, gemerkt.vermerk);
			return { ok: ergebnis };
		} catch (error) {
			if (error instanceof Abbruch) return { status: error.status, antwort: error.antwort };
			throw error;
		}
	}

	router.get(
		'/meine-jungfischer',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { person: ich } = mitgliedKontext(res);
			const { db } = vereinsKontext(res);
			const zeit = jetzt();
			// Eine Transaktion, damit hatEinwilligung dieselbe Frage stellt wie beim Schreiben.
			const kinder = await db.$transaction(async (tx) => {
				const eigene = await tx.bezugsperson.findMany({
					where: { erwachsenerId: ich.id, jungfischer: { entferntAm: null, art: 'JUNGFISCHER' } },
					include: {
						jungfischer: { include: { zugang: { select: { id: true } } } },
					},
				});
				const ergebnis = [];
				for (const z of eigene) {
					const kind = z.jungfischer;
					if (!darfFuerKindHandeln(alsSicht(ich), alsSicht(kind), [z])) continue;
					const ichBinErziehungsberechtigt = istErziehungsberechtigt(z, alsSicht(kind), zeit);
					const volljaehrig = istVolljaehrig(kind, zeit);
					const [familie, gruppen] = await Promise.all([
						tx.bezugsperson.findMany({
							where: { jungfischerId: kind.id, erwachsener: { entferntAm: null } },
							include: { erwachsener: { select: { vorname: true, nachname: true } } },
							orderBy: [{ angelegtAm: 'asc' }, { id: 'asc' }],
						}),
						tx.untergruppeMitglied.findMany({
							where: { personId: kind.id },
							select: { untergruppe: { select: { id: true, name: true } } },
						}),
					]);
					// Feld fuer Feld aufgebaut: keine E-Mail und keine Rechte fremder Familienmitglieder.
					ergebnis.push({
						id: kind.id,
						vorname: kind.vorname,
						nachname: kind.nachname,
						jugendsprecher: kind.jugendsprecher,
						untergruppen: gruppen.map((g) => g.untergruppe).sort((a, b) => a.name.localeCompare(b.name, 'de')),
						familie: familie.map((f) => ({
							vorname: f.erwachsener.vorname,
							nachname: f.erwachsener.nachname,
							beziehung: f.beziehung,
							beziehungFreitext: f.beziehungFreitext,
						})),
						zugang: {
							erlaubt: kind.zugangErlaubt,
							vorhanden: kind.zugang !== null,
							einwilligungGueltig: await hatEinwilligung(tx, kind, zeit),
						},
						ichBinErziehungsberechtigt,
						volljaehrig,
						// Eigene Frage an die Foto-Zeilen: die DSGVO-Einwilligung oben sagt nichts ueber Fotos.
						// darfAendern ohne Volljaehrige: sie pflegt der Jungfischer selbst (POST /ich/einwilligung).
						fotos: {
							erlaubt: await hatFotoEinwilligung(tx, kind, zeit),
							darfAendern: ichBinErziehungsberechtigt && !volljaehrig,
						},
					});
				}
				return ergebnis.sort(
					(a, b) => a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de'),
				);
			});
			res.json({ kinder });
		}),
	);

	router.post(
		'/meine-jungfischer/:kindId/zugang',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			const kindId = req.params['kindId'] ?? '';
			const zeit = jetzt();
			const r = await unterSperre(res, handelnder.id, zeit, async (tx, _stand, vermerke) => {
				const { kind } = await ladeErziehungsberechtigt(tx, handelnder.id, kindId, zeit);
				const erlaubt = lesBoolean(req.body, 'erlaubt');
				await vermerke([kind.id]);
				if (!erlaubt) {
					await entzieheZugang(tx, kind.id);
				} else {
					if (!(await hatEinwilligung(tx, kind, zeit))) throw new Abbruch(409, EINWILLIGUNG_FEHLT);
					await tx.person.update({ where: { id: kind.id }, data: { zugangErlaubt: true } });
				}
				return { erlaubt };
			});
			if ('ok' in r) return void res.json(r.ok);
			res.status(r.status).json(r.antwort);
		}),
	);

	router.post(
		'/meine-jungfischer/:kindId/einladung',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			const kindId = req.params['kindId'] ?? '';
			const zeit = jetzt();
			const r = await unterSperre(res, handelnder.id, zeit, async (tx, stand) => {
				const { ich, kind } = await ladeErziehungsberechtigt(tx, handelnder.id, kindId, zeit);
				// Das Kind hat meist keine Adresse und die Familie reicht den Link selbst weiter: keine Mail.
				return erzeugeEinladungFuerKind(tx, { ich, ziel: kind, stand, mail: false, zeit, basisUrl: umgebung.basisUrl });
			});
			if ('ok' in r) return void res.status(201).json(r.ok);
			res.status(r.status).json(r.antwort);
		}),
	);

	router.post(
		'/meine-jungfischer/:kindId/einwilligung',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			const kindId = req.params['kindId'] ?? '';
			const zeit = jetzt();
			const r = await unterSperre(res, handelnder.id, zeit, async (tx, _stand, vermerke) => {
				const { ich, kind } = await ladeErziehungsberechtigt(tx, handelnder.id, kindId, zeit);
				const erteilen = lesBoolean(req.body, 'erteilen');
				const art = lesArt(req.body);
				if (art === 'FOTOS') {
					await aendereFotoEinwilligung(tx, vermerke, { kind, erteiler: ich, erteilen, zeit });
					return { erteilt: erteilen };
				}
				if (erteilen) {
					// Eine offene reicht: ein zweiter Klick soll keine zweite Zeile als Nachweis erzeugen.
					// Nur DSGVO-Zeilen zaehlen: eine offene Foto-Einwilligung ersetzt sie nicht.
					const offen = await tx.einwilligung.count({
						where: { jungfischerId: kind.id, erteiltVon: ich.id, art: 'DSGVO_ART8', widerrufenAm: null },
					});
					if (offen === 0) {
						await vermerke([kind.id]);
						await tx.einwilligung.create({
							data: {
								jungfischerId: kind.id,
								erteiltVon: ich.id,
								art: 'DSGVO_ART8',
								textVersion: EINWILLIGUNG_TEXT_VERSION,
								erteiltAm: zeit,
							},
						});
					}
				} else {
					// Nur die eigenen: die Einwilligung des Vaters widerruft die Mutter nicht. Die Zeilen
					// bleiben als Nachweis stehen, verworfen: sie zu loeschen. Die Foto-Einwilligung bleibt
					// unberuehrt: Wer den Zugang widerruft, hat damit nichts ueber Fotos gesagt.
					// Immer vermerkt, auch ohne offene Zeile: der Haken danach kann dem Kind den Zugang nehmen.
					await vermerke([kind.id]);
					await tx.einwilligung.updateMany({
						where: { jungfischerId: kind.id, erteiltVon: ich.id, art: 'DSGVO_ART8', widerrufenAm: null },
						data: { widerrufenAm: zeit },
					});
					await entzieheZugangWennUngueltig(tx, kind, zeit);
				}
				return { erteilt: erteilen };
			});
			if ('ok' in r) return void res.json(r.ok);
			res.status(r.status).json(r.antwort);
		}),
	);

	/**
	 * Ein volljaehriger Jungfischer pflegt seine Foto-Einwilligung selbst (Plan zu Etappe 2,
	 * Entscheidung 6): die der Eltern erloescht mit dem 18. Geburtstag, und ein Erwachsener
	 * entscheidet ueber Fotos von sich. Unter derselben Sperre wie die Elternroute, denn
	 * "angenommen oder nicht" haengt am Geburtsdatum und am Entfernt-Stand, die eine gleichzeitige
	 * Anfrage aendern kann.
	 * Alles andere ist "nicht gefunden": ein Minderjaehriger oder Erwachsener hat diese Route nicht.
	 */
	router.post(
		'/ich/einwilligung',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			const zeit = jetzt();
			const r = await unterSperre(res, handelnder.id, zeit, async (tx, _stand, vermerke) => {
				const ich = await tx.person.findFirst({ where: { id: handelnder.id, art: 'JUNGFISCHER', entferntAm: null } });
				if (!ich || !istVolljaehrig(ich, zeit)) throw new Abbruch(404, NICHT_GEFUNDEN);
				const erteilen = lesBoolean(req.body, 'erteilen');
				await aendereFotoEinwilligung(tx, vermerke, { kind: ich, erteiler: ich, erteilen, zeit });
				return { erteilt: erteilen };
			});
			if ('ok' in r) return void res.json(r.ok);
			res.status(r.status).json(r.antwort);
		}),
	);
}

/**
 * Legt die Foto-Einwilligung an oder zieht sie zurueck; die Aufrufer halten die Sperre und haben
 * Recht und Volljaehrigkeit schon geprueft. Eine Stelle fuer Eltern- und Selbstroute, damit beide
 * dieselbe Regel anwenden.
 *
 * Erteilen legt nur eine Zeile an, wenn heute noch keine gueltige gilt: Sieht die Mutter Fotos als
 * erlaubt, soll ein Klick des Vaters keine zweite Zeile als Nachweis danebenlegen. Zurueckziehen
 * nimmt alle offenen Foto-Zeilen des Kindes (bei Volljaehrigen die eigenen): ob Fotos gezeigt werden
 * duerfen, ist eine Antwort der Familie, und ein Widerruf der Mutter soll nicht an der Zeile des
 * Vaters scheitern. Verworfen: wie bei der DSGVO-Einwilligung nur die eigene Zeile, denn dann
 * bliebe das Kind nach dem Widerruf der Mutter auf Fotos, und der Hinweis nennte es nicht.
 * Die Zeilen bleiben als Nachweis stehen.
 */
async function aendereFotoEinwilligung(
	tx: Transaktion,
	vermerke: (objektIds: readonly string[]) => Promise<void>,
	a: { kind: Person; erteiler: Person; erteilen: boolean; zeit: Date },
): Promise<void> {
	const { kind, erteiler, erteilen, zeit } = a;
	if (erteilen) {
		if (await hatFotoEinwilligung(tx, kind, zeit)) return;
		await vermerke([kind.id]);
		await tx.einwilligung.create({
			data: {
				jungfischerId: kind.id,
				erteiltVon: erteiler.id,
				art: 'FOTOS',
				textVersion: FOTO_EINWILLIGUNG_TEXT_VERSION,
				erteiltAm: zeit,
			},
		});
		return;
	}
	// Ein Volljaehriger zieht nur seine eigenen Zeilen zurueck; die der Eltern gelten fuer ihn ohnehin nicht mehr.
	const eigene = istVolljaehrig(kind, zeit) ? { erteiltVon: erteiler.id } : {};
	const { count } = await tx.einwilligung.updateMany({
		where: { jungfischerId: kind.id, art: 'FOTOS', widerrufenAm: null, ...eigene },
		data: { widerrufenAm: zeit },
	});
	// Nur vermerkt, wenn sich etwas geaendert hat: an der Foto-Einwilligung haengt kein Zugang, anders
	// als bei der DSGVO-Einwilligung, wo der Haken danach dem Kind den Zugang nehmen kann. Ein
	// wiederholter Widerruf soll darum niemanden zum Neuladen bewegen.
	if (count > 0) await vermerke([kind.id]);
}
