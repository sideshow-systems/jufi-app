import type { Datenstand, FahrModul, Id, Thread, UmfrageModul } from '../daten/typen';
import { kinderImThread } from './sichtbarkeit';
import { freiePlaetze } from './fahrt-kosten';

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const zwei = (n: number) => String(n).padStart(2, '0');

/** Der Teil einer Adresse nach dem Slug, z. B. "/glonntal/t/2-bowling". */
export function threadPfad(t: Thread, slug: string): string {
	const wort = t.titel
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `/${slug}/t/${t.nr}${wort ? `-${wort}` : ''}`;
}

/** Ein vorangestelltes Emoji bleibt ausserhalb der Sternchen, sonst faerbt WhatsApp es nicht fett. */
function titelzeile(titel: string): string {
	const treffer = /^(\p{Extended_Pictographic}\S*)\s+(.+)$/u.exec(titel);
	return treffer ? `${treffer[1]} *${treffer[2]}*` : `*${titel}*`;
}

/** Bis zu zehn Vornamen; laengere Listen enden mit "…", damit der Text lesbar bleibt. */
function namen(stand: Datenstand, ids: Id[]): string {
	const vornamen = ids.map((id) => stand.personen.find((p) => p.id === id)?.vorname ?? '?');
	return vornamen.length > 10 ? `${vornamen.slice(0, 10).join(', ')}, …` : vornamen.join(', ');
}

const plaetze = (n: number) => (n === 1 ? '1 Platz' : `${n} Plätze`);

/** WhatsApp-Text mit dem Stand eines Threads (Rahmen 6.7). */
export function teilenText(stand: Datenstand, t: Thread, basisUrl: string, jetzt: Date): string {
	const zeilen = [
		`${titelzeile(ohneFormat(t.titel))} – Stand ${WOCHENTAGE[jetzt.getDay()]} ${zwei(jetzt.getHours())}:${zwei(jetzt.getMinutes())}`,
	];
	for (const m of t.module) {
		if (m.typ === 'umfrage') zeilen.push(...umfrageZeilen(stand, t, m).map(ohneFormat));
		if (m.typ === 'fahrt') zeilen.push(...fahrtZeilen(stand, m).map(ohneFormat));
	}
	zeilen.push(`👉 Antworten: ${basisUrl}${threadPfad(t, stand.verein.slug)}`);
	return zeilen.join('\n');
}

function umfrageZeilen(stand: Datenstand, t: Thread, m: UmfrageModul): string[] {
	const mit = (option: Id) => m.antworten.filter((a) => a.optionen.includes(option)).map((a) => a.fuer);
	if (m.teilnahme) {
		const dabei = mit('ja');
		const ab = mit('nein');
		const zeilen = [
			`✅ Dabei (${dabei.length}): ${namen(stand, dabei)}`,
			`❌ Abgesagt (${ab.length}): ${namen(stand, ab)}`,
		];
		if (m.einheit === 'jungfischer') {
			const geantwortet = new Set(m.antworten.map((a) => a.fuer));
			const offen = kinderImThread(stand, t)
				.map((k) => k.id)
				.filter((id) => !geantwortet.has(id));
			zeilen.push(`❓ Offen (${offen.length}): ${namen(stand, offen)}`);
		}
		return zeilen;
	}
	return [`📊 ${m.frage}`, ...m.optionen.map((o) => `• ${o.text} (${mit(o.id).length}): ${namen(stand, mit(o.id))}`)];
}

function fahrtZeilen(stand: Datenstand, m: FahrModul): string[] {
	const liste = (richtung: 'hin' | 'rueck') =>
		m.autos
			.filter((a) => a.richtung === richtung)
			.map(
				(a) => `Fam. ${stand.personen.find((p) => p.id === a.fahrer)?.nachname ?? '?'} (${plaetze(freiePlaetze(a))})`,
			)
			.join(', ');
	const zeilen: string[] = [];
	if (liste('hin')) zeilen.push(`🚗 Fahrer: ${liste('hin')}`);
	if (liste('rueck')) zeilen.push(`↩️ Rückfahrt: ${liste('rueck')}`);
	return zeilen;
}

/**
 * Ersetzt WhatsApps Formatzeichen in fremdem Text durch gleich aussehende
 * Zeichen, damit "Bowling *neu*" nicht die Fettschrift des Titels zerreisst.
 * Verworfen: ein unsichtbares Zeichen dazwischen — ob WhatsApp es als Grenze
 * wertet, ist nirgends festgelegt; die Ersatzzeichen wirken sicher.
 */
export function ohneFormat(text: string): string {
	return text.replace(/[*_~`]/g, (z) => ({ '*': '∗', _: 'ˍ', '~': '∼', '`': 'ˋ' })[z]!);
}

/**
 * Beispiel-Einladung in diesen Entwurf. Verworfen: die spaetere Adresse
 * jufi-app.de — die gehoert dem Entwurf nicht, und ein dorthin geschickter
 * Link liefe ins Leere oder zu Fremden.
 */
export function einladungsLink(basisUrl: string, slug: string, kennung: string): string {
	return `${basisUrl}/${slug}?einladung=${encodeURIComponent(kennung)}`;
}
