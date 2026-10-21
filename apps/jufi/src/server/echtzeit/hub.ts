import { vereinDb, type PrismaClient } from '@jufi/db';
import { signaleFuer, type Umfeld } from '@jufi/domain';
import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { loeseSitzungAuf, sitzungGilt } from '../mitglieder/sitzung.js';
import { ladeKoepfe, ladeThreadUmfeld } from '../threads/laden.js';
import type { Umgebung } from '../umgebung.js';
import { ladeVereinAusSlug } from '../verein.js';
import type { Bus, BusEreignis } from './bus.js';

/** Abstand der Pings (Spec 5.1); ein Socket, der bis zum naechsten nicht antwortet, wird gekappt. */
export const PING_MS = 30_000;
/** Mehr offene Tabs hat niemand; die Grenze haelt eine Schleife im Client davon ab, den Server zu fluten. */
export const SOCKETS_JE_PERSON = 10;

/** Die Sitzung oder der Verein gilt nicht mehr; der Client geht zur Anmeldung. */
const SITZUNG_UNGUELTIG = 4401;
/** Service Restart: Der Server faehrt herunter, der Client verbindet sich spaeter neu. */
const NEUSTART = 1012;
/**
 * Internal Error: Verteilen oder Pruefen ist gescheitert (reiheEin, pruefeSicher). Der Client
 * fragt nach jedem Abbruch ausser 1012 sofort GET /sync ab seinem alten Stand und verbindet dann
 * mit Backoff neu; der Upgrade prueft die Sitzung frisch. Verworfen: 1012 -- der Server startet
 * nicht neu, und der Client glich erst nach dem naechsten gelungenen Oeffnen ab; ist die
 * Datenbank noch gestoert, scheitert schon der Upgrade.
 */
const INTERNER_FEHLER = 1011;
/**
 * So lange wartet schliesseAlle auf den Schliess-Handschlag, dann kappt es. ws selbst wartet
 * 30 Sekunden auf einen Client, der nicht antwortet; Docker beendet den Prozess nach 10, und
 * der Rest von SIGTERM (Mail-Arbeiter, Nachlauf) kaeme dann nicht mehr dran.
 */
const SCHLIESS_FRIST_MS = 2_000;

/** /<slug>/ws, sonst nichts; das Cookie hat den Pfad /<slug>/ und kommt nur hier mit. */
const PFAD = /^\/([^/]+)\/ws$/;

/** Was der Hub je Socket weiss. Kein Umfeld: das prueft jedes Signal frisch (Plan-Entscheidung 4). */
interface Verbindung {
	ws: WebSocket;
	vereinId: string;
	personId: string;
	sitzungId: string;
	/** Ablauf der Sitzung beim Verbinden oder bei der letzten Pruefung; der Ping sieht danach nach. */
	ablauf: Date;
	/** Seit dem letzten Ping ein Pong bekommen? */
	lebt: boolean;
}

export interface HubDeps {
	/** Schlicht, nicht vereinDb: Beim Upgrade ist der Verein erst zu finden (Plattform-Operation). */
	prisma: PrismaClient;
	umgebung: Umgebung;
	jetzt: () => Date;
	bus: Bus;
	/** Nur fuer Tests kuerzer; sonst PING_MS. */
	pingMs?: number;
}

type Aenderungsereignis = Extract<BusEreignis, { typ: 'aenderung' }>;

/**
 * Haelt die WebSockets der Mitglieder je Verein (Spec 5.1) und verteilt die Signale.
 *
 * Er haengt am Bus und nicht an den Routen (Plan-Entscheidung 1): Die Routen melden nach dem
 * Commit, der Hub abonniert. Verworfen: Routen rufen den Hub direkt -- jeder Routen-Test
 * braeuchte dann einen Hub, und unter ng serve lebt der Hub auf einem eigenen Port.
 *
 * Geschlossen wird ein Socket nur, wenn seine Sitzung nicht mehr gilt: abgemeldet, Zugang
 * entzogen, Person entfernt, Sitzung abgelaufen, Verein gesperrt (Plan-Entscheidung 4), oder
 * wenn der Hub selbst scheitert (1011, siehe reiheEin und pruefeSicher).
 * Eine Aenderung der Rechte schliesst nichts, denn der Socket haelt kein Umfeld. Darum prueft
 * der Hub bei jedem pruefen-Ereignis und jeder Umfeld-Aenderung (Aenderung ohne Thread) die
 * Sitzungen aller Sockets des Vereins neu, mit derselben Regel wie die Middleware
 * (sitzungGilt), und beim Ping die Sockets, deren gespeicherter Ablauf vorbei ist. Verworfen:
 * jede TP2-Route nennt die Personen, deren Zugang endete -- entzieheZugangWennUngueltig und
 * entferne stecken in sieben Routen, und eine vergessene liesse einen Socket offen.
 *
 * Schliesscodes (Plan-Entscheidung 5): 1012 beim Herunterfahren, 4401 wenn Sitzung oder Verein
 * nicht mehr gelten, 1011 wenn Verteilen oder Pruefen scheitert. Abgelehnte Upgrades: 403 bei fremdem Origin (wie pruefeUrsprung), 404 bei
 * unbekanntem oder gesperrtem Verein, 401 ohne gueltige Sitzung, 429 ab dem elften Socket einer
 * Person. Verworfen: 401/404 auch fuer den Origin (Spec 5.1 woertlich) -- die REST-Pruefung
 * antwortet 403, und der Unterschied verraet nichts.
 *
 * Signale ohne Abo je Thread (Plan-Entscheidung 2): Je Ereignis laedt der Hub die Koepfe der
 * betroffenen Threads in einer Abfrage, nimmt das Umfeld des Vereins aus einem Cache und laesst
 * signaleFuer je Socket entscheiden, was die Person erfaehrt; eine eigene Sichtpruefung hat der
 * Hub nicht. Den Cache verwirft jede Umfeld-Aenderung (Aenderung ohne Thread), und eine solche
 * kommt bei jeder Aenderung an Personen, Familien, Untergruppen und Rechten (Plan-Entscheidung 3).
 * Verworfen: den Kopf von vorher durch das Ereignis reichen, damit SICHTBARKEIT und GELOESCHT
 * nur an die gehen, die den Thread bisher sahen -- jede Route muesste ihn laden, und gewonnen
 * waere nur eine zufaellige ID, die nichts verraet (5.2 nennt sie mit unsichtbar ohnehin).
 *
 * noServer statt new WebSocketServer({ server }): ws beantwortete sonst jedes Upgrade auf
 * jedem Pfad selbst, und die Pruefungen davor sind asynchron (Datenbank); verifyClient
 * koennte das, raten die ws-Autoren aber selbst ab.
 */
export class Hub {
	// Der Client schickt nichts; 1 KiB reicht fuer jeden Steuerrahmen und haelt Unfug klein.
	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
	private readonly vereine = new Map<string, Set<Verbindung>>();
	/**
	 * Das Umfeld je Verein, als Promise: Ereignisse, die waehrend des Ladens kommen, warten auf
	 * dieselbe Abfrage statt eine eigene zu starten. Verworfen: das Umfeld je Ereignis frisch
	 * laden -- jede Nachricht im Chat laede dann alle Personen und Zuordnungen des Vereins, obwohl
	 * sie sich nur mit einer Umfeld-Aenderung aendern, und die verwirft den Eintrag.
	 */
	private readonly umfelder = new Map<string, Promise<Umfeld>>();
	/**
	 * Das Ende der Verteilung je Verein. Jedes Ereignis haengt sich hinten an, damit die Signale
	 * eines Vereins in der Reihenfolge der Staende ankommen: Ein spaeteres Ereignis mit Umfeld aus
	 * dem Cache ueberholte sonst eines, das noch laedt. Je Verein statt einer fuer alle, damit ein
	 * langsamer Verein die anderen nicht aufhaelt.
	 */
	private readonly ketten = new Map<string, Promise<void>>();
	private readonly ursprung: string;
	private readonly abbestellen: () => void;
	private takt: NodeJS.Timeout | undefined;
	private geschlossen = false;
	/**
	 * Zaehlt die angestossenen Pruefungen. Ein Upgrade liest Verein und Sitzung, bevor es den
	 * Socket aufnimmt; kommt dazwischen ein Abmelden, saehe die Pruefung den Socket noch nicht,
	 * und er bliebe mit geloeschter Sitzung offen. Hat sich der Zaehler waehrend des Upgrades
	 * bewegt, prueft der neue Socket sich darum gleich nach. Einer fuer alle Vereine statt einer
	 * je Verein: Der Verein steht erst nach der ersten Abfrage fest, und eine ueberfluessige
	 * Nachpruefung kostet eine Abfrage.
	 */
	private pruefungen = 0;

	constructor(private readonly d: HubDeps) {
		this.ursprung = new URL(d.umgebung.basisUrl).origin;
		this.abbestellen = d.bus.abonniere((e) => this.beiEreignis(e));
	}

	/** Nimmt die Upgrades des Servers an und startet den Ping. */
	haengeAn(server: Server): void {
		server.on('upgrade', this.beiUpgrade);
		if (!this.takt) {
			this.takt = setInterval(() => this.pinge(), this.d.pingMs ?? PING_MS);
			// Der Ping allein haelt den Prozess nicht am Leben; das tut der Server.
			this.takt.unref();
		}
	}

	/**
	 * Schliesst alle Sockets mit 1012, bestellt den Bus ab und nimmt keine Upgrades mehr an.
	 * Der Upgrade-Handler bleibt am Server und zerstoert jeden weiteren Versuch: Ohne Handler
	 * entschiede Node selbst, was mit einem Upgrade geschieht.
	 */
	async schliesseAlle(): Promise<void> {
		this.geschlossen = true;
		this.abbestellen();
		clearInterval(this.takt);
		this.takt = undefined;
		// Laufende Verteilungen fragen noch die Datenbank; wer danach die Verbindung schliesst,
		// soll nicht in eine offene Abfrage fallen. Sie scheitern nie (reiheEin faengt ab).
		const laufend = [...this.ketten.values()];
		const alle = [...this.vereine.values()].flatMap((set) => [...set]);
		await Promise.all(
			alle.map(
				(v) =>
					new Promise<void>((fertig) => {
						if (v.ws.readyState === WebSocket.CLOSED) return fertig();
						v.ws.once('close', () => fertig());
						const frist = setTimeout(() => v.ws.terminate(), SCHLIESS_FRIST_MS);
						frist.unref();
						v.ws.once('close', () => clearTimeout(frist));
						v.ws.close(NEUSTART);
					}),
			),
		);
		await Promise.all(laufend);
		this.umfelder.clear();
	}

	/** Offene Sockets, insgesamt oder eines Vereins. */
	anzahl(vereinId?: string): number {
		if (vereinId !== undefined) return this.vereine.get(vereinId)?.size ?? 0;
		let summe = 0;
		for (const set of this.vereine.values()) summe += set.size;
		return summe;
	}

	// Pfeilfunktion, damit haengeAn sie ohne bind uebergeben kann.
	private readonly beiUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
		// Bis handleUpgrade gehoert der Socket uns; ein Fehler darauf (Client weg) waere sonst
		// ein unbehandeltes Ereignis und beendete den Prozess.
		socket.on('error', ignoriere);
		this.upgrade(req, socket, head).catch((error: unknown) => {
			logge('Upgrade', error);
			socket.destroy();
		});
	};

	private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
		const treffer = PFAD.exec((req.url ?? '').split('?')[0] ?? '');
		// Ohne Antwort: Unter einem fremden Pfad gibt es keinen WebSocket, und eine Antwort
		// verriete nur, dass hier einer lauscht.
		if (this.geschlossen || !treffer) {
			socket.destroy();
			return;
		}
		// Eigene Pruefung, denn pruefeUrsprung ist Express-Middleware und sieht kein Upgrade.
		// Ohne sie koennte jede fremde Seite mit dem Cookie des Mitglieds einen Socket oeffnen
		// (Cross-Site WebSocket Hijacking): Der Browser schickt das Cookie mit, und fuer
		// WebSockets gilt keine Same-Origin-Policy. Ohne Origin wird abgelehnt, wie dort.
		if (req.headers.origin !== this.ursprung) return lehneAb(socket, 403);
		const vorher = this.pruefungen;
		const verein = await ladeVereinAusSlug(this.d.prisma, treffer[1] ?? '');
		if (!verein) return lehneAb(socket, 404);
		const sitzung = await loeseSitzungAuf(vereinDb(this.d.prisma, verein.id), req.headers.cookie, this.d.jetzt());
		if (!sitzung) return lehneAb(socket, 401);
		if (this.geschlossen || socket.destroyed) {
			socket.destroy();
			return;
		}
		if (this.zaehle(verein.id, sitzung.person.id) >= SOCKETS_JE_PERSON) return lehneAb(socket, 429);
		socket.off('error', ignoriere);
		// Ohne verifyClient ruft handleUpgrade synchron zurueck: Zaehlen und Aufnehmen liegen im
		// selben Durchlauf, zwei gleichzeitige Upgrades koennen die Grenze nicht gemeinsam ueberholen.
		this.wss.handleUpgrade(req, socket, head, (ws) => {
			const v: Verbindung = {
				ws,
				vereinId: verein.id,
				personId: sitzung.person.id,
				sitzungId: sitzung.sitzungId,
				ablauf: sitzung.ablauf,
				lebt: true,
			};
			this.nimmAuf(v);
			if (this.pruefungen !== vorher) this.pruefeSicher(v.vereinId, [v]);
		});
	}

	private nimmAuf(v: Verbindung): void {
		let set = this.vereine.get(v.vereinId);
		if (!set) {
			set = new Set();
			this.vereine.set(v.vereinId, set);
		}
		set.add(v);
		v.ws.on('pong', () => {
			v.lebt = true;
		});
		// ws meldet Protokollfehler (etwa eine zu grosse Nachricht) als error und schliesst dann
		// selbst; ohne Handler beendete das Ereignis den Prozess.
		v.ws.on('error', (error) => logge('Socket', error));
		v.ws.once('close', () => {
			const aktuell = this.vereine.get(v.vereinId);
			aktuell?.delete(v);
			if (aktuell?.size === 0) {
				this.vereine.delete(v.vereinId);
				// Ohne Socket laedt der Verein nichts mehr; ein liegengebliebenes Umfeld waere nur
				// Speicher und muesste sonst auch fuer Vereine verworfen werden, die keiner sieht.
				this.umfelder.delete(v.vereinId);
			}
		});
	}

	private zaehle(vereinId: string, personId: string): number {
		let n = 0;
		for (const v of this.vereine.get(vereinId) ?? []) if (v.personId === personId) n++;
		return n;
	}

	/**
	 * Der Bus liefert synchron in der Anfrage der Route (bus.ts): Hier wird nur angestossen,
	 * nie gewartet. Fuer die Pruefung werden die Sockets jetzt festgehalten; wer danach dazukommt,
	 * hat seine Sitzung beim Upgrade selbst geprueft (und prueft nach, siehe pruefungen). Die
	 * Verteilung liest sie dagegen erst nach dem Laden (verteile).
	 */
	private beiEreignis(e: BusEreignis): void {
		if (e.typ === 'aenderung') {
			const umfeldGeaendert = e.aenderungen.some((a) => a.threadId === null);
			// Jetzt verwerfen, nicht erst in der Kette: Was danach geladen wird, ist nach dem Commit
			// dieser Aenderung gelesen, fuer dieses Ereignis und alle spaeteren.
			if (umfeldGeaendert) this.umfelder.delete(e.vereinId);
			this.reiheEin(e);
			if (!umfeldGeaendert) return;
		}
		this.pruefungen++;
		const set = this.vereine.get(e.vereinId);
		if (set?.size) this.pruefeSicher(e.vereinId, [...set]);
	}

	/**
	 * Kappt, wer auf den letzten Ping nicht geantwortet hat, und prueft die Sockets, deren
	 * gespeicherter Ablauf vorbei ist. Nachgesehen wird in der Datenbank statt sofort zu
	 * schliessen: Die Middleware verlaengert die Sitzung bei REST-Anfragen, davon erfaehrt der
	 * Socket nichts.
	 */
	private pinge(): void {
		const jetzt = this.d.jetzt();
		const abgelaufen = new Map<string, Verbindung[]>();
		for (const [vereinId, set] of this.vereine) {
			for (const v of set) {
				if (!v.lebt) {
					v.ws.terminate();
					continue;
				}
				v.lebt = false;
				v.ws.ping();
				if (v.ablauf <= jetzt) abgelaufen.set(vereinId, [...(abgelaufen.get(vereinId) ?? []), v]);
			}
		}
		for (const [vereinId, liste] of abgelaufen) this.pruefeSicher(vereinId, liste);
	}

	/**
	 * Haengt die Verteilung hinten an die Kette des Vereins; der Bus wartet nicht darauf.
	 *
	 * Scheitert sie (etwa die Datenbank beim Laden von Umfeld oder Koepfen), schliesst der Hub alle
	 * Sockets des Vereins mit 1011. Der Client erkennt Luecken nur am Abbruch (Spec 5.2) und gleicht
	 * danach ab seinem alten Stand ab. Alle Sockets des Vereins, nicht nur die, die das Signal
	 * bekommen haetten: Wer das ist, entscheidet erst signaleFuer mit dem Umfeld, das gerade nicht zu
	 * laden war, und ein Teil kann schon verschickt sein. Verworfen: nur loggen und die Sockets offen
	 * lassen -- das naechste gelungene Signal hoebe den Stand im Client ueber das verlorene, und auch
	 * ein spaeterer Abgleich meldete dessen Thread nicht mehr.
	 */
	private reiheEin(e: Aenderungsereignis): void {
		const vorher = this.ketten.get(e.vereinId) ?? Promise.resolve();
		const fertig = vorher
			.then(() => this.verteile(e))
			.catch((error: unknown) => {
				logge('Verteilen', error);
				schliesseMitFehler(this.vereine.get(e.vereinId) ?? []);
			});
		this.ketten.set(e.vereinId, fertig);
		void fertig.then(() => {
			if (this.ketten.get(e.vereinId) === fertig) this.ketten.delete(e.vereinId);
		});
	}

	/**
	 * Die Sockets werden erst nach dem Laden gelesen: Wer waehrenddessen dazukam, bekommt das
	 * Signal auch, wer ging, nicht. Nur an offene Sockets: Einer, den pruefe mit 4401 schliesst,
	 * bleibt bis zum Ende des Handschlags im Verein, soll aber nichts mehr erfahren.
	 */
	private async verteile(e: Aenderungsereignis): Promise<void> {
		// Ohne Socket nichts laden: Die meisten Vereine haben die meiste Zeit niemanden verbunden.
		if (!this.vereine.get(e.vereinId)?.size) return;
		const db = vereinDb(this.d.prisma, e.vereinId);
		const threadIds = [...new Set(e.aenderungen.flatMap((a) => (a.threadId === null ? [] : [a.threadId])))];
		const [umfeld, koepfe] = await Promise.all([this.umfeld(e.vereinId), ladeKoepfe(db, threadIds)]);
		// Mehrere Tabs einer Person bekommen dieselben Signale; einmal gebaut genuegt.
		const nachrichten = new Map<string, string[]>();
		for (const v of this.vereine.get(e.vereinId) ?? []) {
			if (v.ws.readyState !== WebSocket.OPEN) continue;
			let fuerPerson = nachrichten.get(v.personId);
			if (!fuerPerson) {
				const signale = signaleFuer({
					ich: umfeld.personen.get(v.personId),
					umfeld,
					koepfe,
					stand: e.stand,
					aenderungen: e.aenderungen,
					eintraege: e.eintraege,
				});
				fuerPerson = signale.map((signal) => JSON.stringify(signal));
				nachrichten.set(v.personId, fuerPerson);
			}
			for (const nachricht of fuerPerson) v.ws.send(nachricht);
		}
	}

	/** Das Umfeld aus dem Cache. Ein gescheitertes Laden bleibt nicht liegen, das naechste versucht es neu. */
	private umfeld(vereinId: string): Promise<Umfeld> {
		const vorhanden = this.umfelder.get(vereinId);
		if (vorhanden) return vorhanden;
		const geladen = ladeThreadUmfeld(vereinDb(this.d.prisma, vereinId));
		this.umfelder.set(vereinId, geladen);
		geladen.catch(() => {
			if (this.umfelder.get(vereinId) === geladen) this.umfelder.delete(vereinId);
		});
		return geladen;
	}

	/**
	 * Scheitert die Pruefung, schliesst der Hub die geprueften Sockets mit 1011: Ihr Upgrade danach
	 * prueft die Sitzung frisch, und ohne sie fuehrt der Abgleich des Clients zur Anmeldung (401).
	 * Nur die geprueften, denn nur deren Sitzung ist offen; die uebrigen hat ihr Upgrade oder eine
	 * fruehere Pruefung bestaetigt, und ihr gespeicherter Ablauf ist nicht vorbei. Verworfen: nur
	 * loggen und offen lassen -- ein abgemeldetes Geraet (etwa nach "Ueberall abmelden") bekaeme
	 * weiter Nachrichten live, bis zum naechsten Anlass im Verein oder bis zum gespeicherten Ablauf.
	 */
	private pruefeSicher(vereinId: string, verbindungen: readonly Verbindung[]): void {
		this.pruefe(vereinId, verbindungen).catch((error: unknown) => {
			logge('Pruefen', error);
			schliesseMitFehler(verbindungen);
		});
	}

	/**
	 * Alle Sitzungen der Sockets in einer Abfrage, der Status des Vereins ueber die Relation
	 * dazu. Eine Sitzung, die fehlt (abgemeldet), schliesst ihren Socket wie eine, die nicht
	 * mehr gilt.
	 */
	private async pruefe(vereinId: string, verbindungen: readonly Verbindung[]): Promise<void> {
		const ids = [...new Set(verbindungen.map((v) => v.sitzungId))];
		const zeilen = await vereinDb(this.d.prisma, vereinId).session.findMany({
			where: { id: { in: ids } },
			select: { id: true, ablauf: true, verein: { select: { status: true } }, zugang: { select: { person: true } } },
		});
		const jetzt = this.d.jetzt();
		const gueltig = new Map(
			zeilen.filter((z) => z.verein.status !== 'GESPERRT' && sitzungGilt(z, jetzt)).map((z) => [z.id, z.ablauf]),
		);
		for (const v of verbindungen) {
			const ablauf = gueltig.get(v.sitzungId);
			if (ablauf) v.ablauf = ablauf;
			else v.ws.close(SITZUNG_UNGUELTIG);
		}
	}
}

/**
 * Lehnt ein Upgrade mit nackter HTTP-Antwort ab. end statt write: destroy direkt nach write
 * koennte die Antwort verwerfen, bevor sie draussen ist.
 */
function lehneAb(socket: Duplex, status: 401 | 403 | 404 | 429): void {
	socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n\r\n`, () => socket.destroy());
}

/**
 * Ein Socket, der schon schliesst (4401 aus pruefe, 1012 beim Herunterfahren), behaelt seinen Code:
 * ws.close tut dann nichts mehr. Die Menge des Vereins aendert sich dabei nicht, denn ein Socket
 * meldet sich erst mit dem close-Ereignis ab, nach dem Handschlag.
 */
function schliesseMitFehler(verbindungen: Iterable<Verbindung>): void {
	for (const v of verbindungen) v.ws.close(INTERNER_FEHLER);
}

function ignoriere(): void {
	// Der Socket ist ohnehin verloren; mehr ist nicht zu tun.
}

/** Nur der Name (Spec 4.4): message und Stack koennen Inhalte tragen. */
function logge(wo: string, error: unknown): void {
	console.error(`Hub: ${wo} fehlgeschlagen:`, error instanceof Error ? error.name : typeof error);
}
