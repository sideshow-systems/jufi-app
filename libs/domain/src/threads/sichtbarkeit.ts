import { istJugendleiter } from '../rechte.js';
import type { ThreadKopf, ThreadPerson, Umfeld } from './typen.js';
import { nachVorname } from './umfeld.js';

// Die Jungfischer, die zur Zielgruppe des Threads gehoeren (Spec 3.1). Bei "Nur
// Familie" sind es die Kinder, ueber die ihre Bezugspersonen den Thread sehen.
// Leer ist die Zielgruppe bei "Nur Jugendleiter" und bei leerer Auswahl
// (alleUntergruppen false ohne Untergruppe, etwa nach dem Loeschen der letzten): dann
// ist niemand gefragt, und der Thread bleibt fuer Jugendleiter sichtbar. Verworfen:
// eine leere Auswahl als "alle" zu lesen, weil ein Thread dann nach dem Loeschen einer
// Untergruppe ploetzlich allen Familien erschiene.
export function kinderImThread(kopf: ThreadKopf, umfeld: Umfeld): ThreadPerson[] {
	if (kopf.rollenfilter === 'NUR_JUGENDLEITER') return [];
	const jungfischer = [...umfeld.personen.values()].filter((p) => p.art === 'JUNGFISCHER');
	// Das Merkmal ersetzt hier die Untergruppen, sie werden ignoriert (FAM 2.3): die
	// Jugendsprecher sind eine eigene Runde quer zu den Gruppen.
	if (kopf.rollenfilter === 'JUGENDLEITER_JUGENDSPRECHER') {
		return jungfischer.filter((p) => p.jugendsprecher).sort(nachVorname);
	}
	if (kopf.alleUntergruppen) return jungfischer.sort(nachVorname);
	const gewaehlt = new Set(kopf.untergruppenIds);
	return jungfischer
		.filter((p) => [...(umfeld.untergruppenVon.get(p.id) ?? [])].some((ug) => gewaehlt.has(ug)))
		.sort(nachVorname);
}

// Spec 3.1. Jugendleiter sehen alles, auch Entwuerfe; alle anderen nur Veroeffentlichtes
// und nur ueber die Kinder der Zielgruppe. Der Aufrufer macht aus "false" ein 404
// (nicht 403, Rahmen-Spec 8), damit niemand erfaehrt, dass es den Thread gibt.
// Entfernte sehen nichts, auch wenn sie noch Rechte tragen: sie koennen sich nicht mehr
// anmelden, und ein uebrig gebliebener Eintrag soll nichts oeffnen.
export function siehtThread(person: ThreadPerson, kopf: ThreadKopf, umfeld: Umfeld): boolean {
	if (person.entferntAm) return false;
	if (istJugendleiter(person)) return true;
	if (!kopf.veroeffentlichtAm || kopf.rollenfilter === 'NUR_JUGENDLEITER') return false;

	const kinder = new Set(kinderImThread(kopf, umfeld).map((k) => k.id));
	if (kinder.size === 0) return false;

	const istKind = person.art === 'JUNGFISCHER' && kinder.has(person.id);
	// Die Familie zaehlt ueber die Zuordnung, nicht ueber Erziehungsberechtigung oder
	// Alter: Grosseltern und die Eltern eines volljaehrig gewordenen Kindes behalten ihre
	// Sicht (TP2 5.6).
	const istFamilie =
		person.art === 'ERWACHSENER' &&
		umfeld.zuordnungen.some((z) => z.erwachsenerId === person.id && kinder.has(z.jungfischerId));

	switch (kopf.rollenfilter) {
		case 'JUNGFISCHER_FAMILIE':
			return istKind || istFamilie;
		case 'NUR_FAMILIE':
			return istFamilie;
		case 'JUGENDLEITER_JUGENDSPRECHER':
			// Die Familie sieht diesen Thread nicht (FAM 2.3).
			return istKind;
	}
}
