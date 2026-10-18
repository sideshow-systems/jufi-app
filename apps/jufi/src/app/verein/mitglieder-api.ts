import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { Beziehung, RechtName } from '@jufi/domain';
import { catchError, type Observable, throwError } from 'rxjs';
import { alsApiFehler } from '../gemeinsam/api-fehler';

/** Was GET /ich ueber die angemeldete Person und ihren Zugang sagt (Server: profil.ts). */
export interface MitgliedIch {
	person: { id: string; vorname: string; nachname: string; art: 'ERWACHSENER' | 'JUNGFISCHER'; rechte: string[] };
	/** Adresse (Erwachsene) oder Anmeldename (Jungfischer). */
	kennung: string | null;
	passkeys: { id: string; label: string; erstelltAm: string; zuletztGenutztAm: string | null }[];
	hatPasswort: boolean;
	/** Ob die Person (noch nicht entfernte) Kinder hat; nur dann zeigt die Oberflaeche "Meine Jungfischer". */
	hatKinder: boolean;
	totp: { moeglich: boolean; aktiv: boolean; wiederherstellungscodesUebrig: number };
}

export type MitgliedAnmeldeSchritt = { schritt: 'fertig' } | { schritt: 'totp'; zwischenmarke: string };

/** Was POST /einladung/pruefen ueber den Link verraet, ohne ihn zu verbrauchen. */
export interface EinladungInfo {
	vorname: string;
	art: string;
	vereinsname: string;
	personArt: 'ERWACHSENER' | 'JUNGFISCHER';
	kennung: { fest: boolean; wert: string | null };
	hatZugang: boolean;
	einwilligungFehlt: boolean;
	/** Nur Kinder, fuer die diese Person heute einwilligen duerfte; fuer Jungfischer immer leer. */
	kinder: EinladungKind[];
	/** Was die Person beim Einwilligen liest; die Version hält der Server als Nachweis fest. */
	einwilligungsText: { version: string; text: string };
}

export interface EinladungKind {
	id: string;
	vorname: string;
	zugangErlaubt: boolean;
	/** Hat schon jemand aus der Familie gueltig eingewilligt? Dann ist der Schritt freiwillig. */
	einwilligungVorhanden: boolean;
}

export interface Einwilligungswunsch {
	kindId: string;
	einwilligen: boolean;
	zugang: boolean;
}

export interface EinloesenDaten {
	token: string;
	kennung?: string;
	passwort?: string;
	/** Antwort der Passkey-Zeremonie, wenn statt eines Passworts ein Passkey eingerichtet wird. */
	passkey?: unknown;
	/** Nur bei Erwachsenen mit Kindern; fehlt der Schluessel, aendert sich an den Kindern nichts. */
	einwilligungen?: Einwilligungswunsch[];
}

export interface MitgliedTotpStart {
	marke: string;
	geheimnis: string;
	uri: string;
	wiederherstellungscodes: string[];
}

/** Die Hinweise der Verwaltung; Zeitpunkte kommen als ISO-Text, nicht als Date. */
export type Warnhinweis =
	| { art: 'OHNE_FAMILIE' }
	| { art: 'EINWILLIGUNG_FEHLT' }
	| { art: 'EINLADUNG_OFFEN'; ablauf: string }
	| { art: 'MAIL_NICHT_ZUGESTELLT' }
	| { art: 'VOLLJAEHRIG'; seit: string };

/**
 * Eine Zeile der Mitgliederliste. Der Server baut sie je nach Einsicht des Betrachters
 * auf: alles ausser den Namen kann fehlen, darum sind die Felder optional.
 */
export interface PersonListe {
	id: string;
	art: 'ERWACHSENER' | 'JUNGFISCHER';
	vorname: string;
	nachname: string;
	geburtsdatum?: string;
	jugendsprecher?: boolean;
	rechte?: string[];
	email?: string;
	untergruppen?: { id: string; name: string }[];
	warnhinweise?: Warnhinweis[];
}

/** Familienbeziehung aus Sicht der angezeigten Person: vorname/nachname sind die der Gegenseite. */
export interface FamilienEintrag {
	erwachsenerId: string;
	jungfischerId: string;
	vorname: string;
	nachname: string;
	beziehung: Beziehung;
	beziehungFreitext: string | null;
	erziehungsberechtigt: boolean;
}

export interface PersonDetail extends PersonListe {
	familie?: FamilienEintrag[];
	/** Nur fuer die Verwaltung. */
	einladung?: { offen: boolean; ablauf: string | null; mailNichtZugestellt: boolean } | null;
	/** Nur fuer die Verwaltung. */
	zugang?: { vorhanden: boolean; letzteAnmeldungAm: string | null; erlaubt: boolean } | null;
}

export interface Untergruppe {
	id: string;
	name: string;
	mitglieder: number;
}

export interface NeuePerson {
	art: 'ERWACHSENER' | 'JUNGFISCHER';
	vorname: string;
	nachname: string;
	geburtsdatum?: string;
	email?: string | null;
	untergruppenIds?: string[];
	/** Bestaetigt die Anlage trotz Doppelt-Hinweis (409 DOPPELT). */
	trotzdem?: boolean;
}

export interface PersonAenderung {
	vorname?: string;
	nachname?: string;
	geburtsdatum?: string;
	email?: string | null;
	jugendsprecher?: boolean;
}

export interface FamilienAngabe {
	beziehung: Beziehung;
	beziehungFreitext?: string;
	/** Fehlt sie, setzt der Server die Vorbelegung der Beziehung. */
	erziehungsberechtigt?: boolean;
}

/** Einladungs- oder Zugangslink, wie der Server ihn ausgibt; das Token steht nur hier und in der Mail. */
export interface EinladungsLink {
	link: string;
	text: string;
	ablauf: string;
}

/** Ein Kind aus Sicht seiner Familie ("Meine Jungfischer"). */
export interface KindAnsicht {
	id: string;
	vorname: string;
	nachname: string;
	jugendsprecher: boolean;
	untergruppen: { id: string; name: string }[];
	familie: { vorname: string; nachname: string; beziehung: Beziehung; beziehungFreitext: string | null }[];
	zugang: { erlaubt: boolean; vorhanden: boolean; einwilligungGueltig: boolean };
	ichBinErziehungsberechtigt: boolean;
	volljaehrig: boolean;
}

/** Eine Person, die der Verein als Ansprechpartner fuehrt (hat mindestens ein Recht); nur Name, keine Rechte oder Adresse. */
export interface Ansprechpartner {
	id: string;
	vorname: string;
	nachname: string;
}

/**
 * Ein Notfall-Link, den die Plattform fuer den Verein ausgestellt hat. Name und Zeitpunkt
 * genuegen der Verwaltung; die Person kann inzwischen entfernt sein, dann fehlt der Name.
 */
export interface NotfallLinkHinweis {
	am: string;
	vorname: string | null;
	nachname: string | null;
}

/** Die Vereinseinstellungen, wie GET und PATCH /einstellungen sie liefern (Server: verein/einstellungen.ts). */
export interface Einstellungen {
	slug: string;
	name: string;
	anzeigename: string;
	kontakt: string | null;
	farbe: string;
	/** ISO-Zeit der letzten Logo-Aenderung, null ohne Logo. */
	logoStand: string | null;
}

/** Was PATCH /einstellungen annimmt; was fehlt, bleibt unveraendert. Ein leerer Kontakt ist null. */
export interface EinstellungenAenderung {
	name?: string;
	anzeigename?: string;
	kontakt?: string | null;
	farbe?: string;
}

/**
 * Alle Aufrufe der Mitglieder-API, einer je Endpunkt, der Slug stets als erster
 * Parameter. Der Slug ist Teil des Pfads und nicht im Dienst gemerkt: Ein
 * Dienst mit Zustand haette bei einem Wechsel zwischen Vereinen den alten Slug
 * noch in der Hand. Absolute Pfade, weil base href "/" ist (wie VereinApi).
 */
@Injectable({ providedIn: 'root' })
export class MitgliederApi {
	private readonly http = inject(HttpClient);

	private basis(slug: string): string {
		return `/${encodeURIComponent(slug)}/api/v1`;
	}

	private holen<T>(slug: string, pfad: string): Observable<T> {
		return this.http
			.get<T>(`${this.basis(slug)}${pfad}`)
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	private senden<T>(
		methode: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
		slug: string,
		pfad: string,
		koerper?: object,
	): Observable<T> {
		return this.http
			.request<T>(methode, `${this.basis(slug)}${pfad}`, koerper === undefined ? {} : { body: koerper })
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	ich(slug: string): Observable<MitgliedIch> {
		return this.holen(slug, '/ich');
	}

	abmelden(slug: string): Observable<void> {
		return this.senden('POST', slug, '/abmelden', {});
	}

	abmeldenAlle(slug: string): Observable<void> {
		return this.senden('POST', slug, '/abmelden/alle', {});
	}

	einladungPruefen(slug: string, token: string): Observable<EinladungInfo> {
		return this.senden('POST', slug, '/einladung/pruefen', { token });
	}

	einladungPasskeyOptionen(
		slug: string,
		token: string,
	): Observable<{ optionen: PublicKeyCredentialCreationOptionsJSON }> {
		return this.senden('POST', slug, '/einladung/passkey-optionen', { token });
	}

	einladungEinloesen(slug: string, daten: EinloesenDaten): Observable<{ vorname: string }> {
		return this.senden('POST', slug, '/einladung/einloesen', daten);
	}

	anmelden(slug: string, kennung: string, passwort: string): Observable<MitgliedAnmeldeSchritt> {
		return this.senden('POST', slug, '/anmelden', { kennung, passwort });
	}

	anmeldenTotp(
		slug: string,
		zwischenmarke: string,
		pruefung: { code: string } | { wiederherstellungscode: string },
	): Observable<{ schritt: 'fertig'; wiederherstellungscodesUebrig: number }> {
		return this.senden('POST', slug, '/anmelden/totp', { zwischenmarke, ...pruefung });
	}

	passkeyOptionen(slug: string): Observable<{ optionen: PublicKeyCredentialRequestOptionsJSON }> {
		return this.senden('POST', slug, '/anmelden/passkey-optionen');
	}

	anmeldenPasskey(slug: string, antwort: unknown): Observable<{ schritt: 'fertig' }> {
		return this.senden('POST', slug, '/anmelden/passkey', { antwort });
	}

	zugangVerloren(slug: string, email: string): Observable<{ ok: true }> {
		return this.senden('POST', slug, '/zugang-verloren', { email });
	}

	passwortAendern(slug: string, alt: string, neu: string): Observable<{ ok: true }> {
		return this.senden('POST', slug, '/profil/passwort', { alt, neu });
	}

	passkeyHinzufuegenOptionen(slug: string): Observable<{ optionen: PublicKeyCredentialCreationOptionsJSON }> {
		return this.senden('POST', slug, '/profil/passkeys/optionen');
	}

	passkeyHinzufuegen(slug: string, name: string, antwort: unknown): Observable<{ id: string; label: string }> {
		return this.senden('POST', slug, '/profil/passkeys', { name, antwort });
	}

	passkeyUmbenennen(slug: string, id: string, label: string): Observable<{ id: string; label: string }> {
		return this.senden('PATCH', slug, `/profil/passkeys/${encodeURIComponent(id)}`, { label });
	}

	passkeyEntfernen(slug: string, id: string): Observable<{ ok: true }> {
		return this.senden('DELETE', slug, `/profil/passkeys/${encodeURIComponent(id)}`);
	}

	totpStart(slug: string): Observable<MitgliedTotpStart> {
		return this.senden('POST', slug, '/profil/totp/start');
	}

	totpBestaetigen(slug: string, marke: string, code: string): Observable<{ ok: true }> {
		return this.senden('POST', slug, '/profil/totp/bestaetigen', { marke, code });
	}

	personen(slug: string): Observable<{ personen: PersonListe[] }> {
		return this.holen(slug, '/personen');
	}

	person(slug: string, id: string): Observable<PersonDetail> {
		return this.holen(slug, `/personen/${encodeURIComponent(id)}`);
	}

	legePersonAn(slug: string, daten: NeuePerson): Observable<{ id: string }> {
		return this.senden('POST', slug, '/personen', daten);
	}

	aenderePerson(slug: string, id: string, daten: PersonAenderung): Observable<{ ok: true }> {
		return this.senden('PATCH', slug, `/personen/${encodeURIComponent(id)}`, daten);
	}

	/** Die Antwort bietet Erwachsene an, die nach dem Entfernen des Kindes ohne Kind und Rechte dastehen. */
	entfernePerson(
		slug: string,
		id: string,
	): Observable<{ folgeangebot: { id: string; vorname: string; nachname: string }[] }> {
		return this.senden('DELETE', slug, `/personen/${encodeURIComponent(id)}`);
	}

	/** Die Verwaltung erlaubt oder entzieht den Zugang eines Kindes; Erlauben ohne Einwilligung antwortet 409 EINWILLIGUNG_FEHLT. */
	setzePersonZugang(slug: string, id: string, erlaubt: boolean): Observable<{ ok: true }> {
		return this.senden('POST', slug, `/personen/${encodeURIComponent(id)}/zugang`, { erlaubt });
	}

	volljaehrigBelassen(slug: string, id: string): Observable<{ ok: true }> {
		return this.senden('POST', slug, `/personen/${encodeURIComponent(id)}/volljaehrig-belassen`, {});
	}

	setzeFamilie(
		slug: string,
		jungfischerId: string,
		erwachsenerId: string,
		angabe: FamilienAngabe,
	): Observable<{ erziehungsberechtigt: boolean }> {
		return this.senden('PUT', slug, this.familienPfad(jungfischerId, erwachsenerId), angabe);
	}

	loeseFamilie(slug: string, jungfischerId: string, erwachsenerId: string): Observable<void> {
		return this.senden('DELETE', slug, this.familienPfad(jungfischerId, erwachsenerId));
	}

	private familienPfad(jungfischerId: string, erwachsenerId: string): string {
		return `/personen/${encodeURIComponent(jungfischerId)}/familie/${encodeURIComponent(erwachsenerId)}`;
	}

	untergruppen(slug: string): Observable<{ untergruppen: Untergruppe[] }> {
		return this.holen(slug, '/untergruppen');
	}

	legeUntergruppeAn(slug: string, name: string): Observable<{ id: string }> {
		return this.senden('POST', slug, '/untergruppen', { name });
	}

	benenneUntergruppeUm(slug: string, id: string, name: string): Observable<void> {
		return this.senden('PATCH', slug, `/untergruppen/${encodeURIComponent(id)}`, { name });
	}

	loescheUntergruppe(slug: string, id: string): Observable<void> {
		return this.senden('DELETE', slug, `/untergruppen/${encodeURIComponent(id)}`);
	}

	/** Ersetzt die Mitgliedschaften des Kindes als Ganzes. */
	setzeUntergruppen(
		slug: string,
		personId: string,
		untergruppenIds: string[],
	): Observable<{ untergruppenIds: string[] }> {
		return this.senden('PUT', slug, `/personen/${encodeURIComponent(personId)}/untergruppen`, { untergruppenIds });
	}

	/** Ersetzt die Rechte der Person als Ganzes. */
	setzeRechte(slug: string, id: string, rechte: RechtName[]): Observable<{ rechte: RechtName[] }> {
		return this.senden('PUT', slug, `/personen/${encodeURIComponent(id)}/rechte`, { rechte });
	}

	/** Einladung (ohne Zugang) oder Reset (mit Zugang); mail schickt den Link zusaetzlich an die Adresse der Person. */
	ladePersonEin(slug: string, id: string, mail = false): Observable<EinladungsLink> {
		return this.senden('POST', slug, `/personen/${encodeURIComponent(id)}/einladung`, { mail });
	}

	meineJungfischer(slug: string): Observable<{ kinder: KindAnsicht[] }> {
		return this.holen(slug, '/meine-jungfischer');
	}

	setzeKindZugang(slug: string, kindId: string, erlaubt: boolean): Observable<{ erlaubt: boolean }> {
		return this.senden('POST', slug, `/meine-jungfischer/${encodeURIComponent(kindId)}/zugang`, { erlaubt });
	}

	kindEinladung(slug: string, kindId: string): Observable<EinladungsLink> {
		return this.senden('POST', slug, `/meine-jungfischer/${encodeURIComponent(kindId)}/einladung`, {});
	}

	kindEinwilligung(slug: string, kindId: string, erteilen: boolean): Observable<{ erteilt: boolean }> {
		return this.senden('POST', slug, `/meine-jungfischer/${encodeURIComponent(kindId)}/einwilligung`, { erteilen });
	}

	/** Fuer jede angemeldete Person lesbar, auch fuer Kinder: Sie sollen wissen, wen sie fragen koennen. */
	ansprechpartner(slug: string): Observable<{ ansprechpartner: Ansprechpartner[] }> {
		return this.holen(slug, '/ansprechpartner');
	}

	/** Nur fuer Personen mit dem Recht JUGENDLEITER_RECHTE; sonst antwortet der Server mit 404. */
	verwaltungsHinweise(slug: string): Observable<{ notfallLinks: NotfallLinkHinweis[] }> {
		return this.holen(slug, '/verwaltung/hinweise');
	}

	/** Nur fuer Personen mit dem Recht EINSTELLUNGEN; sonst antwortet der Server mit 404. */
	einstellungen(slug: string): Observable<Einstellungen> {
		return this.holen(slug, '/einstellungen');
	}

	aendereEinstellungen(slug: string, daten: EinstellungenAenderung): Observable<Einstellungen> {
		return this.senden('PATCH', slug, '/einstellungen', daten);
	}

	/**
	 * Das Bild geht roh als Body, nicht als Formular: Der Server liest den Body dieser Route als
	 * Puffer und ordnet das Format am Inhalt zu. Der Content-Type ist der der Datei; ein leerer
	 * (unbekanntes Format) liesse den Browser keinen setzen, und der Server antwortete 415.
	 * Verworfen: multipart, denn der Server brauchte dafuer einen eigenen Parser.
	 */
	ladeLogoHoch(slug: string, datei: File): Observable<{ logoStand: string }> {
		return this.http
			.put<{ logoStand: string }>(`${this.basis(slug)}/einstellungen/logo`, datei, {
				headers: { 'Content-Type': datei.type },
			})
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	entferneLogo(slug: string): Observable<{ logoStand: null }> {
		return this.senden('DELETE', slug, '/einstellungen/logo');
	}
}
