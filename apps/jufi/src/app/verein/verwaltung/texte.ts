import type { Beziehung } from '@jufi/domain';
import type { ApiFehler } from '../../gemeinsam/api-fehler';
import { datumDeutsch, zeitpunktBerlin } from '../../gestaltung/format';
import type { Warnhinweis } from '../mitglieder-api';

export const BEZIEHUNG_TEXT: Record<Beziehung, string> = {
	MUTTER: 'Mutter',
	VATER: 'Vater',
	GROSSMUTTER: 'Großmutter',
	GROSSVATER: 'Großvater',
	TANTE: 'Tante',
	ONKEL: 'Onkel',
	GESCHWISTER: 'Geschwister',
	PFLEGEPERSON: 'Pflegeperson',
	ANDERE: 'Andere',
};

export const BEZIEHUNGEN = Object.keys(BEZIEHUNG_TEXT) as Beziehung[];

export function beziehungText(beziehung: Beziehung, freitext: string | null): string {
	return beziehung === 'ANDERE' && freitext ? freitext : BEZIEHUNG_TEXT[beziehung];
}

/** Nur der Tag eines Zeitpunkts, in Berliner Zeit: Die Hinweise nennen Tage, keine Uhrzeiten. */
export function tagBerlin(iso: string): string {
	return zeitpunktBerlin(iso).split(' ')[0];
}

/** Der Wortlaut der Hinweise steht in der Spec (5.2); die Seite faerbt nicht allein, sie schreibt es aus. */
export function warnhinweisText(h: Warnhinweis): string {
	switch (h.art) {
		case 'OHNE_FAMILIE':
			return 'Ohne erziehungsberechtigte Familie';
		case 'EINWILLIGUNG_FEHLT':
			return 'Einwilligung fehlt';
		case 'EINLADUNG_OFFEN':
			return `Einladung offen, läuft am ${tagBerlin(h.ablauf)} ab`;
		case 'MAIL_NICHT_ZUGESTELLT':
			return 'Einladungsmail nicht zustellbar';
		case 'VOLLJAEHRIG':
			// Das Datum ist ein Kalendertag in UTC-Mitternacht; in Berliner Zeit umgerechnet bliebe es der Tag, aber ohne Not.
			return `Volljährig seit ${datumDeutsch(h.seit.slice(0, 10))}`;
	}
}

/**
 * Der Satz zu einem Fehler der Verwaltung. Die Codes bekommen Texte, die sagen, was zu
 * tun ist; die Texte des Servers sind knapper gehalten. 404 heisst auch "darfst du nicht"
 * (Rahmen-Spec 8), darum sagt der Satz beides.
 */
export function verwaltungsfehler(f: ApiFehler): string {
	switch (f.code) {
		case 'EINWILLIGUNG_FEHLT':
			return 'Einladen geht noch nicht: Es fehlt die Einwilligung einer erziehungsberechtigten Person. Die Familie erteilt sie unter „Meine Jungfischer“ oder beim Einlösen ihrer Einladung.';
		case 'ZUGANG_NICHT_ERLAUBT':
			return 'Einladen geht noch nicht: Die Familie hat den Zugang für dieses Kind nicht erlaubt. Sie erlaubt ihn unter „Meine Jungfischer“.';
		case 'SELBST':
			return 'Du kannst dich nicht selbst entfernen.';
		case 'LETZTE_LEITUNG':
			return 'Das geht nicht: Der Verein braucht mindestens eine Person, die Rechte vergeben darf.';
		case 'EMAIL_MIT_ZUGANG':
			return 'Die E-Mail-Adresse lässt sich nicht ändern, weil die Person sich schon anmelden kann: Die Adresse ist ihre Kennung.';
		case 'EMAIL_VERGEBEN':
			return 'Diese E-Mail-Adresse gehört im Verein schon jemand anderem.';
	}
	if (f.status === 404) return 'Diese Person gibt es nicht, oder du darfst hier nichts ändern.';
	if (f.status === 429 && f.wartenSekunden !== undefined) {
		return `Zu viele Versuche – bitte in ${f.wartenSekunden} Sekunden erneut`;
	}
	return f.fehler;
}
