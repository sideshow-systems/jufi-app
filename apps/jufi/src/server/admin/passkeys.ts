import {
	authenticationOptions,
	challengeAusAntwort,
	passkeyLabel,
	registrationOptions,
	resolveRelyingParty,
	WEBAUTHN_CHALLENGE_TTL_MS,
	type ChallengePurpose,
	type RelyingParty,
} from '@jufi/auth';
import type { PrismaClient } from '@jufi/db';
import type { Request, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from './asynchron.js';
import { adminKontext, brauchtAdmin, legeAdminSitzungAn, setzeAdminCookie } from './sitzung.js';
import { reserviere, scheitere, zuVieleVersuche } from './versuche.js';

/**
 * Passkeys des Plattform-Admins: damit anmelden und einen hinzufuegen.
 *
 * Gesucht wird nur in AdminPasskey und angenommen nur, was als Admin-Challenge
 * angelegt wurde. Die Challenges teilen sich die Tabelle WebauthnChallenge mit
 * den Vereinen, und die credentialId ist ueber Passkey und AdminPasskey nicht
 * gemeinsam eindeutig: eine Suche ueber beide Tabellen oder eine Challenge mit
 * vereinId liesse einen Vereins-Passkey den Admin-Bereich aufschliessen.
 */

const FEHLGESCHLAGEN = { fehler: 'Anmeldung fehlgeschlagen' };
const EINRICHTUNG_GESCHEITERT = { fehler: 'Passkey konnte nicht eingerichtet werden' };

type ChallengeSpeicher = Pick<PrismaClient, 'webauthnChallenge'>;

/**
 * Legt eine Challenge fuer den Admin-Bereich ab. adminId null heisst: Anmeldung,
 * bei der noch niemand feststeht (Passkey ohne Benutzernamen); sonst gehoert die
 * Challenge diesem Admin und taugt nur fuer ihn. vereinId bleibt immer leer.
 *
 * Raeumt vorher abgelaufene Challenges weg, alle, auch die der Vereine: sie sind
 * ohnehin unbrauchbar, und so braucht es keinen eigenen Aufraeum-Takt. Verworfen:
 * ein Zeitgeber -- die Tabelle waechst nur durch Anmeldeversuche, ein
 * Aufraeumen bei jedem Anlegen haelt sie ohne zusaetzlichen Prozess klein.
 */
export async function speichereAdminChallenge(
	prisma: ChallengeSpeicher,
	eingabe: { challenge: string; purpose: ChallengePurpose; adminId: string | null; jetzt: Date },
): Promise<void> {
	await prisma.webauthnChallenge.deleteMany({ where: { expiresAt: { lte: eingabe.jetzt } } });
	await prisma.webauthnChallenge.create({
		data: {
			challenge: eingabe.challenge,
			purpose: eingabe.purpose,
			adminId: eingabe.adminId,
			expiresAt: new Date(eingabe.jetzt.getTime() + WEBAUTHN_CHALLENGE_TTL_MS),
		},
	});
}

/**
 * Loest eine Challenge ein: genau einmal, und nur wenn sie fuer den Admin-Bereich
 * angelegt wurde. Die Zeile wird geloescht, bevor irgendetwas geprueft wird --
 * eine falsche, abgelaufene oder fremde Challenge ist damit auch verbraucht, und
 * wer sie raet, hat keinen zweiten Versuch mit derselben.
 *
 * Das Loeschen entscheidet, nicht das Lesen: deleteMany zaehlt 1 nur fuer den
 * einen Aufruf, der die Zeile wirklich entfernt hat. Zwei gleichzeitige
 * Anfragen mit derselben Challenge lasen sonst beide die Zeile, und beide
 * kaemen durch. Verworfen: delete -- das wirft fuer die zweite Anfrage und
 * braeuchte ein try/catch um einen Prisma-Fehlercode.
 *
 * undefined bei fehlender Zeile, falschem Zweck, Ablauf oder gesetzter
 * vereinId: eine Vereins-Challenge taugt nie fuer den Admin. Die Bibliothek
 * prueft Zweck und Ablauf nicht selbst (anders als hwyd), das geschieht hier.
 */
export async function nimmAdminChallenge(
	prisma: ChallengeSpeicher,
	eingabe: { challenge: string; purpose: ChallengePurpose; jetzt: Date },
): Promise<{ adminId: string | null } | undefined> {
	const zeile = await prisma.webauthnChallenge.findUnique({ where: { challenge: eingabe.challenge } });
	if (!zeile) return undefined;
	const { count } = await prisma.webauthnChallenge.deleteMany({ where: { id: zeile.id } });
	if (count !== 1) return undefined;
	if (zeile.vereinId !== null) return undefined;
	if (zeile.purpose !== eingabe.purpose) return undefined;
	if (zeile.expiresAt <= eingabe.jetzt) return undefined;
	return { adminId: zeile.adminId };
}

/**
 * Relying Party dieser Anfrage; WEBAUTHN_RP_ID und WEBAUTHN_ORIGIN haben
 * Vorrang vor dem Host-Header (Umgebung), lokal genuegt der Header.
 */
function relyingParty(req: Request, deps: VolleAppDeps): RelyingParty {
	return resolveRelyingParty({
		host: req.headers.host,
		secure: req.secure,
		rpId: deps.umgebung.webauthnRpId,
		origin: deps.umgebung.webauthnOrigin,
	});
}

type Antwort = Parameters<typeof challengeAusAntwort>[0];

/**
 * Haengt die Routen direkt an den Router aus adminApi, ohne Unter-Router:
 * adminRouten liest nur dessen eigene Liste (siehe api.ts).
 */
export function passkeyRouten(router: Router, deps: VolleAppDeps): void {
	const { prisma, jetzt, anmeldeVersuche: versuche, webauthn } = deps;

	router.post(
		'/anmelden/passkey/optionen',
		asynchron(async (req, res) => {
			const optionen = await authenticationOptions(relyingParty(req, deps));
			await speichereAdminChallenge(prisma, {
				challenge: optionen.challenge,
				purpose: 'authenticate',
				adminId: null,
				jetzt: jetzt(),
			});
			res.json(optionen);
		}),
	);

	router.post(
		'/anmelden/passkey',
		asynchron(async (req, res) => {
			// Nur die IP: wer sich mit Passkey anmeldet, nennt keinen Namen, der sich
			// sperren liesse. Der Schluessel ist derselbe wie beim Passwort, beide
			// Wege teilen sich also den Zaehler je IP.
			const schluessel = [`ip:${req.ip}`];
			const versuch = reserviere(versuche, schluessel);
			if (versuch.wartenMs > 0) {
				zuVieleVersuche(res, versuch.wartenMs);
				return;
			}
			const scheitert = () => scheitere(versuche, schluessel, versuch.loestSperreAus, res, FEHLGESCHLAGEN);

			const antwort: unknown = req.body?.antwort;
			const credentialId = (antwort as { id?: unknown } | null | undefined)?.id;
			const challenge = challengeAusAntwort(antwort as Antwort);
			if (typeof credentialId !== 'string' || !credentialId || !challenge) {
				scheitert();
				return;
			}

			const zeit = jetzt();
			const genommen = await nimmAdminChallenge(prisma, { challenge, purpose: 'authenticate', jetzt: zeit });
			// adminId gesetzt gehoerte zu einer Einrichtung, nicht zu einer Anmeldung
			// ohne Namen; das legt dieser Code nie so an, also lehnt er es ab.
			if (!genommen || genommen.adminId !== null) {
				scheitert();
				return;
			}

			// Nur AdminPasskey: derselbe Schluessel in Passkey (Verein) bleibt unbekannt.
			const passkey = await prisma.adminPasskey.findUnique({
				where: { credentialId },
				select: { id: true, adminId: true, credentialId: true, publicKey: true, counter: true, transports: true },
			});
			if (!passkey) {
				scheitert();
				return;
			}

			const geprueft = await webauthn
				.verifyAuthentication({
					response: antwort as Parameters<typeof webauthn.verifyAuthentication>[0]['response'],
					expectedChallenge: challenge,
					rp: relyingParty(req, deps),
					passkey,
				})
				// Eine Antwort, die sich nicht pruefen laesst (kaputte Signatur, falsche
				// Herkunft), ist fuer den Aufrufer dasselbe wie eine falsche.
				.catch(() => null);
			if (!geprueft) {
				scheitert();
				return;
			}

			const token = await prisma.$transaction(async (tx) => {
				await tx.adminPasskey.update({
					where: { id: passkey.id },
					data: { counter: geprueft.counter, lastUsedAt: zeit },
				});
				return legeAdminSitzungAn(tx, passkey.adminId, zeit, req.get('user-agent'));
			});
			versuche.reset(schluessel[0] ?? '');
			setzeAdminCookie(req, res, token);
			res.json({ schritt: 'fertig' });
		}),
	);

	router.post(
		'/konto/passkey/optionen',
		brauchtAdmin,
		asynchron(async (req, res) => {
			const { admin } = adminKontext(res);
			const vorhandene = await prisma.adminPasskey.findMany({
				where: { adminId: admin.id },
				select: { credentialId: true, publicKey: true, counter: true, transports: true },
			});
			const optionen = await registrationOptions({
				rp: relyingParty(req, deps),
				user: {
					id: admin.id,
					name: admin.benutzername,
					// Der Bereich im Namen, damit die Auswahl am Telefon den Admin-Passkey
					// von einem Vereins-Passkey derselben Domain unterscheidet.
					displayName: `${admin.benutzername} · JuFi-Admin`,
				},
				existing: vorhandene,
			});
			await speichereAdminChallenge(prisma, {
				challenge: optionen.challenge,
				purpose: 'register',
				adminId: admin.id,
				jetzt: jetzt(),
			});
			res.json(optionen);
		}),
	);

	router.post(
		'/konto/passkey',
		brauchtAdmin,
		asynchron(async (req, res) => {
			const { admin } = adminKontext(res);
			const antwort: unknown = req.body?.antwort;
			const challenge = challengeAusAntwort(antwort as Antwort);
			const genommen = challenge
				? await nimmAdminChallenge(prisma, { challenge, purpose: 'register', jetzt: jetzt() })
				: undefined;
			// Die Challenge muss zu dieser Sitzung gehoeren: sonst richtete ein Admin
			// mit der Challenge eines anderen einen Passkey fuer sich ein, den dieser
			// gar nicht angefordert hat. Auch eine anonyme Anmelde-Challenge
			// (adminId null) taugt hier nicht.
			if (!challenge || !genommen || genommen.adminId !== admin.id) {
				res.status(400).json(EINRICHTUNG_GESCHEITERT);
				return;
			}

			const ergebnis = await webauthn
				.verifyRegistration({
					response: antwort as Parameters<typeof webauthn.verifyRegistration>[0]['response'],
					expectedChallenge: challenge,
					rp: relyingParty(req, deps),
				})
				.catch(() => null);
			if (!ergebnis) {
				res.status(400).json(EINRICHTUNG_GESCHEITERT);
				return;
			}

			const label = passkeyLabel(req.get('user-agent'));
			try {
				// create statt upsert wie in hwyd: ein Upsert uebernaehme eine
				// credentialId, die schon einem anderen Admin gehoert.
				await prisma.adminPasskey.create({
					data: {
						adminId: admin.id,
						credentialId: ergebnis.credentialId,
						publicKey: ergebnis.publicKey,
						counter: ergebnis.counter,
						transports: ergebnis.transports,
						backedUp: ergebnis.backedUp,
						label,
					},
				});
			} catch (error) {
				// P2002: credentialId schon vergeben (der Browser haelt sie wegen
				// excludeCredentials eigentlich fern; hier greift die Datenbank).
				if ((error as { code?: unknown } | null)?.code === 'P2002') {
					res.status(400).json(EINRICHTUNG_GESCHEITERT);
					return;
				}
				throw error;
			}
			res.status(201).json({ label });
		}),
	);
}
