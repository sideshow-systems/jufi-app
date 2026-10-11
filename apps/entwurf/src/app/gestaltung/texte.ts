import type { Datenstand, Id, Zielgruppe } from '../daten/typen';
import { istJugendleiter, kinderVon, person } from '../regeln/personen';

const ROLLEN = {
	jungfischerUndEltern: 'Jungfischer + Eltern',
	nurEltern: 'Nur Eltern',
	nurJugendleiter: 'Nur Jugendleiter',
};

/** "Alle · Jungfischer + Eltern", "Zeltlager-Teilnehmer · Jungfischer + Eltern" … */
export function zielgruppeText(stand: Datenstand, z: Zielgruppe): string {
	if (z.rollen === 'nurJugendleiter') return ROLLEN.nurJugendleiter;
	const gruppen =
		z.untergruppen === 'alle'
			? 'Alle'
			: stand.untergruppen
					.filter((u) => (z.untergruppen as Id[]).includes(u.id))
					.map((u) => u.name)
					.join(', ');
	return `${gruppen} · ${ROLLEN[z.rollen]}`;
}

/**
 * Name mit Rolle fuer Verlauf und Listen: "Katrin H. (Jugendleiter)",
 * "Petra M. (Elternteil von Paul)". "Elternteil" statt "Mama/Papa": der
 * Entwurf kennt kein Geschlecht und soll keines raten.
 */
export function nameMitRolle(stand: Datenstand, id: Id): string {
	const p = person(stand, id);
	if (!p) return 'Unbekannt';
	const name = `${p.vorname} ${p.nachname.charAt(0)}.`;
	if (istJugendleiter(p)) return `${name} (Jugendleiter)`;
	const kinder = kinderVon(stand, id);
	return kinder.length ? `${name} (Elternteil von ${kinder.map((k) => k.vorname).join(' und ')})` : name;
}

export function vorname(stand: Datenstand, id: Id): string {
	return person(stand, id)?.vorname ?? '?';
}

/** Rolle in Worten fuers Profil: "Jugendleiter · Elternteil von Jonas", "Jungfischer". */
export function rolleText(stand: Datenstand, id: Id): string {
	const p = person(stand, id);
	if (!p) return '';
	if (p.art === 'jungfischer') return 'Jungfischer';
	const kinder = kinderVon(stand, id).map((k) => k.vorname);
	const teile = [
		istJugendleiter(p) ? 'Jugendleiter' : '',
		kinder.length ? `Elternteil von ${kinder.join(' und ')}` : '',
	];
	return teile.filter(Boolean).join(' · ') || 'Erwachsener';
}
