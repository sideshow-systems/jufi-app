import { M, P, T } from '../daten/beispieldaten';
import type { Datenstand } from '../daten/typen';
import { alsIso, zeitpunkt } from '../daten/zeit';
import { uhrzeit, wochentag } from '../gestaltung/format';
import { naechsteTermine } from '../regeln/termine';
import { ausBeispieldaten, modul } from './pruefung';
import type { Aufgabe, PersonKey } from './typen';

/** Die naechste Gruppenstunde, wie Sandra sie unter "Als Naechstes" findet. */
function gruppenstunde(s: Datenstand) {
	const ab = zeitpunkt(`${s.bezugstag}T00:00`);
	return (
		naechsteTermine(s, P.sandra, ab, 50).find((e) => e.modul.id === M.gruppenstunde)?.modul ??
		modul(s, T.infos, M.gruppenstunde, 'termin')
	);
}

function treffen(s: Datenstand): { richtig: string; falsch: [string, string] } {
	const g = gruppenstunde(s);
	if (!g)
		return { richtig: 'Kein Treffen geplant', falsch: ['Montag 17:00 · Vereinsheim', 'Freitag 18:00 · Kirchplatz'] };
	const folgetag = zeitpunkt(g.beginn);
	folgetag.setDate(folgetag.getDate() + 1);
	const zeit = uhrzeit(g.beginn);
	const andererOrt = g.ort === 'Vereinsweiher' ? 'Vereinsheim' : 'Vereinsweiher';
	return {
		richtig: `${wochentag(g.beginn)} ${zeit} · ${g.ort}`,
		falsch: [`${wochentag(alsIso(folgetag))} ${zeit} · ${g.ort}`, `${wochentag(g.beginn)} ${zeit} · ${andererOrt}`],
	};
}

function mitfahrt(s: Datenstand): { richtig: string; falsch: [string, string] } {
	const autos = modul(s, T.bowling, M.bowlingFahrt, 'fahrt')?.autos ?? [];
	const nachname = (id: string) => s.personen.find((p) => p.id === id)?.nachname ?? '?';
	const lenas = autos.find((a) => a.richtung === 'hin' && a.mitfahrer.includes(P.lena));
	const richtig = lenas ? `Familie ${nachname(lenas.fahrer)}` : 'Noch in keinem Auto';
	// Die anderen Fahrer zuerst, dann Familien aus den Beispieldaten als Auffueller.
	const andere = [...new Set([...autos.map((a) => nachname(a.fahrer)), 'Schmid', 'Berger'])]
		.map((n) => `Familie ${n}`)
		.filter((n) => n !== richtig);
	return { richtig, falsch: [andere[0], andere[1]] };
}

const umfrageJa = (s: Datenstand, kind: string) =>
	modul(s, T.bowling, M.bowlingUmfrage, 'umfrage')?.antworten.some(
		(a) => a.fuer === kind && a.optionen.includes('ja'),
	) ?? false;

const kosten = (s: Datenstand, kind: string) => modul(s, T.bowling, M.bowlingKosten, 'kosten')?.status[kind];

/**
 * Die 15 Aufgaben der Spec TP1 5.3, Texte woertlich. "kurz" ist der Titel in
 * der Rueckmeldung. Die Reihenfolge je Person ist fest.
 */
export const AUFGABEN: Record<PersonKey, Aufgabe[]> = {
	sandra: [
		{
			id: 'sandra-1',
			kurz: 'Max fürs Bowling',
			art: 'handlung',
			text: 'Melde Max fürs Bowling an.',
			erfuellt: (s) => umfrageJa(s, P.max),
		},
		{
			id: 'sandra-2',
			kurz: 'Kuchen eintragen',
			art: 'handlung',
			text: 'Trag dich fürs Herbstfest für einen Kuchen ein.',
			erfuellt: (s) =>
				modul(s, T.herbstfest, M.herbstHelfer, 'helfer')
					?.plaetze.find((p) => p.id === 'h-kuchen')
					?.eintraege.some((e) => e.fuer === P.sandra) ?? false,
		},
		{
			id: 'sandra-3',
			kurz: 'Fahrgemeinschaft',
			art: 'handlung',
			text: 'Such Max einen Platz für die Hinfahrt zum Bowling.',
			erfuellt: (s) =>
				modul(s, T.bowling, M.bowlingFahrt, 'fahrt')?.autos.some(
					(a) => a.richtung === 'hin' && a.mitfahrer.includes(P.max),
				) ?? false,
		},
		{
			id: 'sandra-4',
			kurz: 'Bezahlt melden',
			art: 'handlung',
			text: 'Melde, dass du die 12 € für Lena überwiesen hast.',
			erfuellt: (s) => kosten(s, P.lena) !== undefined,
		},
		{
			id: 'sandra-5',
			kurz: 'Nächstes Treffen',
			art: 'suche',
			text: 'Finde heraus, wann und wo das nächste Treffen ist.',
			antworten: treffen,
		},
		{
			id: 'sandra-6',
			kurz: 'Jugendfischereiordnung',
			art: 'handlung',
			text: 'Finde die Jugendfischereiordnung.',
			erfuellt: (_, e) => e.some((x) => x.art === 'dokumentGeoeffnet' && x.id === 'g-jfo'),
		},
	],
	lena: [
		{
			id: 'lena-1',
			kurz: 'Pizza wählen',
			art: 'handlung',
			text: 'Wähl deine Pizza fürs Zeltlager-Vortreffen.',
			erfuellt: (s) =>
				modul(s, T.zeltlager, M.pizzaUmfrage, 'umfrage')?.antworten.some((a) => a.fuer === P.lena) ?? false,
		},
		{
			id: 'lena-2',
			kurz: 'Mitfahrt finden',
			art: 'suche',
			text: 'Finde heraus, mit wem du zum Bowling fährst.',
			antworten: mitfahrt,
		},
		{
			id: 'lena-3',
			kurz: 'Fotos Hegefischen',
			art: 'handlung',
			text: 'Schau dir die Fotos vom Hegefischen an.',
			erfuellt: (_, e) => e.some((x) => x.art === 'fotoGeoeffnet' && x.threadId === T.hegefischen),
		},
		{
			id: 'lena-4',
			kurz: 'Frage im Zeltlager',
			art: 'handlung',
			text: 'Stell eine Frage im Thread „Zeltlager 2027".',
			erfuellt: (s) => {
				const alt = ausBeispieldaten(s).verlauf;
				return (
					s.threads
						.find((t) => t.id === T.zeltlager)
						?.verlauf.some((v) => v.art === 'nachricht' && v.von === P.lena && !alt.has(v.id)) ?? false
				);
			},
		},
	],
	thomas: [
		{
			id: 'thomas-1',
			kurz: 'Weihnachtsfeier anlegen',
			art: 'handlung',
			text: 'Leg den Thread „Weihnachtsfeier" mit Termin und Teilnahme-Umfrage an.',
			erfuellt: (s) =>
				s.threads.some(
					(t) =>
						t.veroeffentlicht &&
						t.titel.toLowerCase().includes('weihnachtsfeier') &&
						t.module.some((m) => m.typ === 'termin') &&
						t.module.some((m) => m.typ === 'umfrage'),
				),
		},
		{
			id: 'thomas-2',
			kurz: 'Stand teilen',
			art: 'handlung',
			text: 'Finde heraus, wer beim Bowling noch nicht geantwortet hat, und teile den Stand per WhatsApp.',
			erfuellt: (_, e) => e.some((x) => x.art === 'geteilt' && x.threadId === T.bowling),
		},
		{
			id: 'thomas-3',
			kurz: 'Zahlung bestätigen',
			art: 'handlung',
			text: 'Bestätige die Zahlung für Lena.',
			erfuellt: (s) => kosten(s, P.lena) === 'bezahlt',
		},
		{
			id: 'thomas-4',
			kurz: 'Elternteil einladen',
			art: 'handlung',
			text: 'Lade einen neuen Elternteil ein.',
			erfuellt: (s, e) => {
				const alt = ausBeispieldaten(s).personen;
				return e.some(
					(x) =>
						x.art === 'einladungErzeugt' &&
						!alt.has(x.personId) &&
						s.personen.find((p) => p.id === x.personId)?.art === 'erwachsener',
				);
			},
		},
		{
			id: 'thomas-5',
			kurz: 'Max umsetzen',
			art: 'handlung',
			text: 'Setz Max in ein anderes Auto, weil Familie Maier ausfällt.',
			erfuellt: (s) =>
				modul(s, T.bowling, M.bowlingFahrt, 'fahrt')?.autos.some(
					(a) => a.fahrer !== 'e-petra' && a.mitfahrer.includes(P.max),
				) ?? false,
		},
	],
};
