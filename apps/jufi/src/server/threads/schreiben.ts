import { mitAenderung, type AenderungEingabe, type Prisma, type VereinTx } from '@jufi/db';
import {
	darfBearbeiten,
	entwurfAus,
	entwurfAusThread,
	entwurfFehler,
	hatRecht,
	siehtThread,
	vergleicheEntwurf,
	zielgruppeGeaendert,
	type EntwurfVergleich,
	type ModulEntwurf,
	type OptionEntwurf,
	type ThreadEntwurf,
	type ThreadKopf,
	type ThreadPerson,
} from '@jufi/domain';
import type { Router } from 'express';
import { randomInt } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { brauchtMitglied, mitgliedKontext } from '../mitglieder/sitzung.js';
import { vereinsKontext } from '../verein.js';
import { ladeBearbeitung } from './bearbeitung.js';
import { ungueltigesFeld } from './eingabe.js';
import {
	amFeld,
	antworteThreadFehler,
	AUSTAUSCH,
	BEANTWORTET,
	DOPPELTE_TEILNAHME,
	NICHT_GEFUNDEN,
	ThreadAbbruch,
	VERALTET,
} from './fehler.js';
import { ladeThread, ladeThreadUmfeld, type GeladenerThread } from './laden.js';

const ZEICHEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Schluessel einer neuen Option (Plan-Entscheidung 11): "o" und acht Zeichen aus a-z0-9,
 * gezogen mit randomInt aus node:crypto. Verworfen: den Schluessel aus dem Text ableiten --
 * ein Umbenennen vor dem ersten Speichern ergaebe zwei Schreibweisen fuer dieselbe Option.
 * Das "o" vorn haelt sie von den festen Schluesseln der Teilnahme fern (dabei, vielleicht,
 * abgesagt): keiner von ihnen beginnt damit.
 */
export function neuerSchluessel(): string {
	let schluessel = 'o';
	for (let i = 0; i < 8; i++) schluessel += ZEICHEN[randomInt(ZEICHEN.length)];
	return schluessel;
}

const istObjekt = (w: unknown): w is Record<string, unknown> =>
	typeof w === 'object' && w !== null && !Array.isArray(w);

/**
 * Der Entwurf aus dem Koerper, oder das Feld, an dem seine Form scheitert. Doppelte
 * Untergruppen-IDs fallen hier weg: Zwei gleiche Zeilen in ThreadUntergruppe schluegen
 * am Primaerschluessel als P2002 und damit als 500 auf. Verworfen: 400 fuer eine doppelte
 * ID -- sie meint dieselbe Auswahl, und ein Editor, der eine Gruppe zweimal anhakt, soll
 * daran nicht scheitern.
 */
function liesEntwurf(wert: unknown): { entwurf: ThreadEntwurf } | { feld: string } {
	const gelesen = entwurfAus(wert);
	if ('fehler' in gelesen) return { feld: gelesen.fehler.feld };
	const e = gelesen.entwurf;
	return { entwurf: { ...e, untergruppenIds: [...new Set(e.untergruppenIds)] } };
}

/** Wer neue Threads anlegen darf (Spec 3.5); Entfernte nie, wie bei darfBearbeiten. */
function darfErstellen(p: ThreadPerson): boolean {
	return !p.entferntAm && (hatRecht(p, 'THREADS_ERSTELLEN') || hatRecht(p, 'ALLE_THREADS'));
}

/**
 * Die eigene Person, gelesen unter der Sperre der Vereinszeile. Rechte aendern sich unter
 * derselben Sperre (mitglieder/rechte.ts), die Pruefung hier sieht also den Stand, gegen den
 * auch geschrieben wird. Nur die Person, nicht das ganze Umfeld: Wer bearbeiten oder anlegen
 * darf, hat ein Recht und ist damit Jugendleiter, und Jugendleiter sehen jeden Thread
 * (siehtThread); Familien und Untergruppen spielen fuer die Entscheidung keine Rolle.
 * Verworfen: ladeThreadUmfeld unter der Sperre -- alle Personen und Zuordnungen des Vereins
 * lesen, waehrend jede andere Schreibroute wartet.
 */
export async function ichUnterSperre(tx: VereinTx, personId: string): Promise<ThreadPerson | null> {
	return tx.person.findFirst({ where: { id: personId, entferntAm: null } });
}

/**
 * Prueft, was der Entwurf bedeutet, und bricht mit dem ersten Fehler ab. Ein Eingabefehler
 * geht der doppelten Teilnahme (dem einzigen Konflikt von entwurfFehler) vor, wie fehler vor
 * konflikt in vergleicheEntwurf: Ein Entwurf, der nicht lesbar ist, soll nicht erst am
 * Konflikt scheitern und nach dessen Behebung an etwas anderem.
 */
function pruefeEntwurf(e: ThreadEntwurf, untergruppenIds: ReadonlySet<string>): void {
	const fehler = entwurfFehler(e, untergruppenIds);
	const ungueltig = fehler.find((f) => !f.konflikt);
	if (ungueltig) throw new ThreadAbbruch(400, { fehler: ungueltig.text, feld: ungueltig.feld });
	const [konflikt] = fehler;
	if (konflikt) throw new ThreadAbbruch(409, amFeld(DOPPELTE_TEILNAHME, konflikt));
}

/** Der Plan aus vergleicheEntwurf, oder der Abbruch mit seinem Fehler (400) oder Konflikt (409 BEANTWORTET). */
function planeAenderung(alt: { kopf: ThreadKopf; module: GeladenerThread['module'] }, e: ThreadEntwurf) {
	const plan = vergleicheEntwurf(alt, e);
	if (plan.fehler) throw new ThreadAbbruch(400, { fehler: plan.fehler.text, feld: plan.fehler.feld });
	if (plan.konflikt) throw new ThreadAbbruch(409, amFeld(BEANTWORTET, plan.konflikt));
	return plan;
}

/**
 * Am Austausch aendert der Editor nur Titel und Modus (FAM 2.5, Entscheidung 7); Anpinnen
 * hat seine eigene Route. Geprueft gegen den gespeicherten Thread, vor der Pruefung des
 * Entwurfs: Was am Austausch nicht geht, soll nicht erst als Eingabefehler erscheinen.
 * Die Zielgruppe nach derselben Regel wie SICHTBARKEIT (zielgruppeGeaendert). Die Module vergleicht isDeepStrictEqual mit dem Entwurf, den der Editor geladen hat
 * (entwurfAusThread) -- jede Abweichung ist eine Aenderung, auch eine kaputte Modul-ID.
 * Verworfen: das Ergebnis von vergleicheEntwurf -- bei einem Fehler ist dessen Plan leer und
 * saehe aus wie "nichts geaendert".
 */
function pruefeAustausch(alt: GeladenerThread, e: ThreadEntwurf): void {
	const k = alt.kopf;
	if (k.art !== 'JUGENDSPRECHER_AUSTAUSCH') return;
	if (zielgruppeGeaendert(k, e)) throw new ThreadAbbruch(409, amFeld(AUSTAUSCH, { feld: 'zielgruppe' }));
	if (!isDeepStrictEqual(e.module, entwurfAusThread(k, alt.module).module)) {
		throw new ThreadAbbruch(409, amFeld(AUSTAUSCH, { feld: 'module' }));
	}
}

async function untergruppenIds(tx: VereinTx): Promise<Set<string>> {
	return new Set((await tx.untergruppe.findMany({ select: { id: true } })).map((g) => g.id));
}

const kopfDaten = (e: ThreadEntwurf) => ({
	titel: e.titel,
	modus: e.modus,
	rollenfilter: e.rollenfilter,
	alleUntergruppen: e.alleUntergruppen,
});

/**
 * Ersetzt die gewaehlten Untergruppen. Bei "alle Untergruppen" bleibt die Tabelle leer,
 * auch wenn der Entwurf noch IDs traegt: entwurfFehler prueft sie dann nicht, und eine
 * unbekannte ID schluege am Fremdschluessel als P2003 und damit als 404 auf.
 */
async function schreibeUntergruppen(tx: VereinTx, threadId: string, e: ThreadEntwurf): Promise<void> {
	await tx.threadUntergruppe.deleteMany({ where: { threadId } });
	if (e.alleUntergruppen || e.untergruppenIds.length === 0) return;
	await tx.threadUntergruppe.createMany({
		data: e.untergruppenIds.map((untergruppeId) => ({ threadId, untergruppeId })),
	});
}

/**
 * Erster Schreibschritt beim Ersetzen: wegfallende Optionen behaltener Umfragen und
 * wegfallende Module. vergleicheEntwurf laesst beides nur zu, wenn niemand darauf
 * geantwortet hat, die Fremdschluessel ohne Kaskade (UmfrageAntwort.umfrage,
 * UmfrageAntwortOption.option) halten also nicht. Info, Termin, Umfrage und deren Optionen
 * gehen per Kaskade mit dem ThreadModul.
 *
 * Geloescht wird vor allem anderen, weil die beiden eindeutigen Indizes nicht aufschiebbar
 * sind: Eine geloeschte Teilnahme-Umfrage gibt umfrage_eine_teilnahme fuer eine neue frei,
 * und eine geloeschte Option ihren Schluessel (UmfrageOption umfrageId+schluessel).
 */
async function loescheModule(tx: VereinTx, plan: EntwurfVergleich): Promise<void> {
	for (const m of plan.behalten) {
		if (m.optionenLoeschen.length === 0) continue;
		await tx.umfrageOption.deleteMany({ where: { umfrageId: m.id, schluessel: { in: m.optionenLoeschen } } });
	}
	if (plan.loeschen.length > 0) await tx.threadModul.deleteMany({ where: { id: { in: plan.loeschen } } });
}

/**
 * Die Optionen einer Umfrage in der Reihenfolge des Entwurfs, ueber ihren Schluessel: eine
 * bestehende Option behaelt Zeile und ID (und damit ihre Antworten), Text und Position
 * werden ueberschrieben; eine neue bekommt ihren Schluessel hier. Was wegfaellt, hat
 * loescheModule schon entfernt, also kann kein Schluessel des Entwurfs an einer anderen Zeile
 * haengen. Verworfen: alle Optionen loeschen und neu anlegen -- beantwortete Optionen haelt
 * der Fremdschluessel fest, und die Antworten verloeren ihre Option.
 */
async function schreibeOptionen(tx: VereinTx, umfrageId: string, optionen: readonly OptionEntwurf[]): Promise<void> {
	const vergeben = new Set(optionen.flatMap((o) => (o.schluessel === null ? [] : [o.schluessel])));
	for (const [position, o] of optionen.entries()) {
		let schluessel = o.schluessel;
		if (schluessel === null) {
			// 36^8 Moeglichkeiten machen einen Zusammenstoss praktisch unmoeglich; die Schleife kostet
			// nichts und erspart den P2002, der sonst als 500 endete.
			do schluessel = neuerSchluessel();
			while (vergeben.has(schluessel));
			vergeben.add(schluessel);
		}
		await tx.umfrageOption.upsert({
			where: { umfrageId_schluessel: { umfrageId, schluessel } },
			create: { umfrageId, schluessel, text: o.text, position },
			update: { text: o.text, position },
		});
	}
}

/**
 * Schreibt ein Modul an seine Position: legt es an (id null) oder ueberschreibt ein
 * behaltenes ganz. Die Untertabelle per upsert, damit beide Faelle denselben Weg nehmen; ihr
 * Typ steht fest, vergleicheEntwurf verbietet einen Typwechsel. Liefert die Modul-ID.
 */
async function schreibeModul(
	tx: VereinTx,
	threadId: string,
	position: number,
	neu: ModulEntwurf,
	id: string | null,
): Promise<string> {
	const kopf = { position, titel: neu.titel };
	let modulId: string;
	if (id === null) {
		modulId = (await tx.threadModul.create({ data: { threadId, typ: neu.typ, ...kopf }, select: { id: true } })).id;
	} else {
		await tx.threadModul.update({ where: { id }, data: kopf });
		modulId = id;
	}

	if (neu.typ === 'INFO') {
		await tx.infoModul.upsert({
			where: { id: modulId },
			create: { id: modulId, text: neu.text },
			update: { text: neu.text },
		});
	} else if (neu.typ === 'TERMIN') {
		const t = neu.termin;
		// "JJJJ-MM-TT" liest Date als Mitternacht UTC, genau das, was eine @db.Date-Spalte speichert.
		const daten = {
			startDatum: new Date(t.startDatum),
			endDatum: t.endDatum ? new Date(t.endDatum) : null,
			beginn: t.beginn,
			ende: t.ende,
			ort: t.ort,
			treffpunkt: t.treffpunkt,
		};
		await tx.terminModul.upsert({ where: { id: modulId }, create: { id: modulId, ...daten }, update: daten });
	} else {
		const daten = {
			frage: neu.frage,
			einheit: neu.einheit,
			mehrfach: neu.mehrfach,
			teilnahme: neu.teilnahme,
			vielleicht: neu.vielleicht,
			frist: neu.frist ? new Date(neu.frist) : null,
			ergebnisse: neu.ergebnisse,
		};
		await tx.umfrageModul.upsert({
			where: { id: modulId },
			create: { id: modulId, threadId, ...daten },
			update: daten,
		});
		await schreibeOptionen(tx, modulId, neu.optionen);
	}
	return modulId;
}

const istTeilnahme = (m: ModulEntwurf) => m.typ === 'UMFRAGE' && m.teilnahme;

/**
 * Schreibt den Plan eines PUT und liefert die Aenderungen (Plan-Entscheidung 5).
 *
 * Reihenfolge, weil umfrage_eine_teilnahme und (umfrageId, schluessel) nicht aufschiebbar
 * sind und jede Anweisung fuer sich bestehen muss: erst loeschen (loescheModule), dann die
 * behaltenen Module aendern, und zwar die ohne Teilnahme vor denen mit -- tauschen zwei
 * Umfragen den Teilnahme-Schalter, ist die alte schon aus, bevor die neue ihn bekommt --, dann
 * die neuen anlegen. Optionen gehen ueber ihren Schluessel (schreibeOptionen). Die Position
 * stoert nicht: sie ist absichtlich nicht eindeutig. Verworfen: die Indizes DEFERRABLE machen --
 * ein Partial-Unique-Index laesst sich in Postgres nicht aufschieben, und die Ordnung hier
 * genuegt.
 */
async function ersetzeThread(
	tx: VereinTx,
	alt: GeladenerThread,
	e: ThreadEntwurf,
	plan: EntwurfVergleich,
	ich: ThreadPerson,
	stand: number,
	zeit: Date,
): Promise<AenderungEingabe[]> {
	const threadId = alt.kopf.id;
	await loescheModule(tx, plan);
	const geaendert = plan.behalten
		.filter((m) => m.geaendert)
		.sort((a, b) => Number(istTeilnahme(a.neu)) - Number(istTeilnahme(b.neu)));
	for (const m of geaendert) await schreibeModul(tx, threadId, m.position, m.neu, m.id);
	const angelegt: string[] = [];
	for (const a of plan.anlegen) angelegt.push(await schreibeModul(tx, threadId, a.position, a.neu, null));

	// Der Kopf immer, auch ohne Aenderung: bearbeitetStand ist die Version, und jedes Speichern
	// ist eines (ein PUT ohne Aenderung macht andere offene Editoren veraltet wie jedes andere).
	await tx.thread.update({ where: { id: threadId }, data: { ...kopfDaten(e), bearbeitetStand: stand } });
	if (plan.sichtbarkeitGeaendert) await schreibeUntergruppen(tx, threadId, e);

	const modul = (objektId: string): AenderungEingabe => ({ threadId, art: 'MODUL', objektId });
	const aenderungen: AenderungEingabe[] = [
		{ threadId, art: 'THREAD', objektId: threadId },
		...plan.loeschen.map(modul),
		...geaendert.map((m) => modul(m.id)),
		...angelegt.map(modul),
	];
	// Im Entwurf sieht ihn ausser den Jugendleitern niemand: weder eine neue Zielgruppe noch ein
	// Satz im Verlauf hat dort jemanden zu erreichen (Entscheidung 6).
	if (alt.kopf.veroeffentlichtAm === null) return aenderungen;
	if (plan.sichtbarkeitGeaendert) aenderungen.push({ threadId, art: 'SICHTBARKEIT', objektId: threadId });
	for (const s of plan.system) {
		const eintrag = await tx.verlaufEintrag.create({
			data: {
				threadId,
				art: 'SYSTEM',
				autorId: ich.id,
				systemArt: s.art,
				systemDaten: s.daten as Prisma.InputJsonObject,
				stand,
				angelegtAm: zeit,
			},
			select: { id: true },
		});
		aenderungen.push({ threadId, art: 'VERLAUF', objektId: eintrag.id });
	}
	return aenderungen;
}

/** POST /threads und PUT /threads/:id. */
export function schreibenRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, bus } = deps;

	router.post(
		'/threads',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const eingabe = liesEntwurf(istObjekt(req.body) ? req.body['entwurf'] : undefined);
			if ('feld' in eingabe) return void res.status(400).json(ungueltigesFeld(eingabe.feld));
			const e = eingabe.entwurf;

			const umfeld = await ladeThreadUmfeld(db);
			const mich = umfeld.personen.get(person.id);
			if (!mich || !darfErstellen(mich)) return void res.status(404).json(NICHT_GEFUNDEN);

			const zeit = jetzt();
			let angelegt: { ich: ThreadPerson; threadId: string };
			try {
				const { stand, ergebnis, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, async (stand) => {
						const ich = await ichUnterSperre(tx, person.id);
						if (!ich || !darfErstellen(ich)) throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
						pruefeEntwurf(e, await untergruppenIds(tx));
						// Gegen einen leeren Thread mit demselben Kopf verglichen: So gelten fuer die
						// Module dieselben Regeln wie beim Ersetzen (keine Modul-ID, kein erfundener
						// Optionsschluessel), und alle landen in plan.anlegen. Verworfen: eine eigene
						// Pruefung fuer POST -- die Regel stuende an zwei Stellen.
						const leer: ThreadKopf = {
							id: '',
							art: 'NORMAL',
							...kopfDaten(e),
							untergruppenIds: e.untergruppenIds,
							angepinnt: false,
							archivModus: 'AUTOMATISCH',
							veroeffentlichtAm: null,
							erstelltVonId: ich.id,
						};
						const plan = planeAenderung({ kopf: leer, module: [] }, e);

						const { id: threadId } = await tx.thread.create({
							data: {
								art: 'NORMAL',
								...kopfDaten(e),
								veroeffentlichtAm: null,
								erstelltVonId: ich.id,
								angelegtAm: zeit,
								bearbeitetStand: stand,
							},
							select: { id: true },
						});
						await schreibeUntergruppen(tx, threadId, e);
						const modulIds: string[] = [];
						for (const a of plan.anlegen) modulIds.push(await schreibeModul(tx, threadId, a.position, a.neu, null));
						return {
							ergebnis: { ich, threadId },
							aenderungen: [
								{ threadId, art: 'THREAD' as const, objektId: threadId },
								...modulIds.map((objektId) => ({ threadId, art: 'MODUL' as const, objektId })),
							],
						};
					}),
				);
				angelegt = ergebnis;
				// Auch fuer einen Entwurf: Jugendleiter mit Recht sehen ihn, und ob das Signal jemanden
				// erreicht, entscheidet der Hub gegen Kopf und Umfeld, nicht die Route.
				bus.melde({ typ: 'aenderung', vereinId: verein.id, stand, aenderungen, eintraege: [] });
			} catch (error) {
				return void antworteThreadFehler(res, error);
			}

			// Nach dem Commit gelesen wie GET .../bearbeitung: Der Editor bekommt Modul-IDs und
			// Schluessel in derselben Form, in der er den Thread spaeter wieder laedt.
			const bearbeitung = await ladeBearbeitung(db, angelegt.ich, angelegt.threadId, umfeld, zeit);
			if (!bearbeitung) return void res.status(404).json(NICHT_GEFUNDEN);
			res.status(201).json(bearbeitung);
		}),
	);

	router.put(
		'/threads/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person } = mitgliedKontext(res);
			const koerper = istObjekt(req.body) ? req.body : {};
			const version = koerper['version'];
			if (typeof version !== 'number' || !Number.isInteger(version)) {
				return void res.status(400).json(ungueltigesFeld('version'));
			}
			const eingabe = liesEntwurf(koerper['entwurf']);
			if ('feld' in eingabe) return void res.status(400).json(ungueltigesFeld(eingabe.feld));
			const e = eingabe.entwurf;

			// Vorab ohne Sperre: Wer den Thread nicht bearbeiten darf, wartet nicht auf die
			// Vereinszeile und verbraucht keinen Stand. Entscheidend ist die Pruefung darunter.
			const threadId = req.params['id'] ?? '';
			const [umfeld, vorab] = await Promise.all([ladeThreadUmfeld(db), ladeThread(db, threadId)]);
			const mich = umfeld.personen.get(person.id);
			if (!mich || !vorab || !siehtThread(mich, vorab.kopf, umfeld) || !darfBearbeiten(mich, vorab.kopf)) {
				return void res.status(404).json(NICHT_GEFUNDEN);
			}

			const zeit = jetzt();
			let ich: ThreadPerson;
			try {
				const { stand, ergebnis, aenderungen } = await db.$transaction((tx) =>
					mitAenderung(tx, verein.id, person.id, zeit, async (stand) => {
						// Alles, was "angenommen oder nicht" entscheidet, unter der Sperre (Entscheidung 3):
						// Eine Antwort, ein anderes Speichern oder ein entzogenes Recht zwischen dem Laden
						// des Editors und diesem PUT ist hier schon sichtbar. In dieser Reihenfolge, damit
						// die Antwort vom Allgemeinen zum Besonderen geht: unbekannt, veraltet, Austausch,
						// Eingabefehler, Konflikt mit Antworten.
						const [ichJetzt, alt, gespeichert] = await Promise.all([
							ichUnterSperre(tx, person.id),
							ladeThread(tx, threadId),
							tx.thread.findUnique({ where: { id: threadId }, select: { bearbeitetStand: true } }),
						]);
						if (!ichJetzt || !alt || !gespeichert || !darfBearbeiten(ichJetzt, alt.kopf)) {
							throw new ThreadAbbruch(404, NICHT_GEFUNDEN);
						}
						if (gespeichert.bearbeitetStand !== version) throw new ThreadAbbruch(409, VERALTET);
						pruefeAustausch(alt, e);
						pruefeEntwurf(e, await untergruppenIds(tx));
						const plan = planeAenderung(alt, e);
						const aenderungen = await ersetzeThread(tx, alt, e, plan, ichJetzt, stand, zeit);
						return { ergebnis: ichJetzt, aenderungen };
					}),
				);
				ich = ergebnis;
				bus.melde({ typ: 'aenderung', vereinId: verein.id, stand, aenderungen, eintraege: [] });
			} catch (error) {
				return void antworteThreadFehler(res, error);
			}

			const bearbeitung = await ladeBearbeitung(db, ich, threadId, umfeld, zeit);
			if (!bearbeitung) return void res.status(404).json(NICHT_GEFUNDEN);
			res.json(bearbeitung);
		}),
	);
}
