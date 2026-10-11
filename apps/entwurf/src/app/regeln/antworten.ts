import type { Antwort, Datenstand, HelferModul, Id, Thread, UmfrageModul } from '../daten/typen';
import { zeitpunkt } from '../daten/zeit';
import { kostenStatus, zahlungspflichtig } from './fahrt-kosten';
import { kinderVon, person } from './personen';
import { kinderImThread, siehtThread } from './sichtbarkeit';
import { istArchiviert } from './termine';

/** Eine Zeile in einem Antwort-Modul: fuer wen geantwortet wird, und wie sie heisst. */
export interface AntwortZeile {
	fuer: Id;
	label: string;
	antwort?: Antwort;
}

/**
 * Welche Zeilen eine Person bei einer Umfrage oder Helferliste sieht
 * (Rahmen 6.3). "pro Jungfischer": Kinder antworten fuer sich, Eltern je Kind
 * im Thread. Ein Jugendleiter ohne eigenes Kind im Thread hat keine Zeile —
 * er sieht die Ergebnisse, beantwortet aber nichts.
 */
export function antwortZeilen(
	stand: Datenstand,
	personId: Id,
	t: Thread,
	m: UmfrageModul | HelferModul,
): AntwortZeile[] {
	const p = person(stand, personId);
	if (!p) return [];
	const antwortFuer = (fuer: Id) => (m.typ === 'umfrage' ? m.antworten.find((a) => a.fuer === fuer) : undefined);
	const zeile = (fuer: Id, label: string): AntwortZeile => {
		const antwort = antwortFuer(fuer);
		return antwort ? { fuer, label, antwort } : { fuer, label };
	};
	if (m.einheit === 'person') return [zeile(p.id, 'Du')];
	if (m.einheit === 'erwachsener') return p.art === 'erwachsener' ? [zeile(p.id, 'Du')] : [];
	const imThread = new Set(kinderImThread(stand, t).map((k) => k.id));
	if (p.art === 'jungfischer') return imThread.has(p.id) ? [zeile(p.id, p.vorname)] : [];
	return kinderVon(stand, p.id)
		.filter((k) => imThread.has(k.id))
		.map((k) => zeile(k.id, k.vorname));
}

/** Kinder mit "Ja" in der Teilnahme-Umfrage; null, wenn der Thread keine hat. */
export function zusagen(t: Thread): Id[] | null {
	const u = t.module.find((m): m is UmfrageModul => m.typ === 'umfrage' && m.teilnahme);
	return u ? u.antworten.filter((a) => a.optionen.includes('ja')).map((a) => a.fuer) : null;
}

export interface OffenerPunkt {
	threadId: Id;
	modulId: Id;
	fuer: Id;
	label: string;
	titel: string;
	art: 'umfrage' | 'helfer' | 'kosten';
	frist?: string;
}

const offen = (frist: string | undefined, jetzt: Date) => !frist || zeitpunkt(frist) > jetzt;

/**
 * Inhalt von "Braucht deine Antwort" auf dem Start. Helferlisten zaehlen,
 * solange die Person nirgends steht und noch Plaetze frei sind; Kosten nur fuer
 * Eltern, je zahlungspflichtigem eigenen Kind ohne Meldung.
 */
export function brauchtAntwort(stand: Datenstand, personId: Id, jetzt: Date): OffenerPunkt[] {
	const punkte: OffenerPunkt[] = [];
	const p = person(stand, personId);
	if (!p) return punkte;
	for (const t of stand.threads) {
		if (!siehtThread(stand, personId, t) || istArchiviert(t, jetzt)) continue;
		const basis = { threadId: t.id, titel: t.titel };
		for (const m of t.module) {
			if (m.typ === 'umfrage' && offen(m.frist, jetzt)) {
				for (const z of antwortZeilen(stand, personId, t, m)) {
					if (!z.antwort)
						punkte.push({ ...basis, modulId: m.id, fuer: z.fuer, label: z.label, art: 'umfrage', frist: m.frist });
				}
			}
			if (m.typ === 'helfer' && offen(m.frist, jetzt) && m.plaetze.some((pl) => pl.eintraege.length < pl.anzahl)) {
				for (const z of antwortZeilen(stand, personId, t, m)) {
					const steht = m.plaetze.some((pl) => pl.eintraege.some((e) => e.fuer === z.fuer));
					if (!steht)
						punkte.push({ ...basis, modulId: m.id, fuer: z.fuer, label: z.label, art: 'helfer', frist: m.frist });
				}
			}
			if (m.typ === 'kosten' && p.art === 'erwachsener') {
				const pflichtig = new Set(zahlungspflichtig(stand, t));
				for (const k of kinderVon(stand, p.id)) {
					if (pflichtig.has(k.id) && kostenStatus(m, k.id) === 'offen') {
						punkte.push({ ...basis, modulId: m.id, fuer: k.id, label: k.vorname, art: 'kosten' });
					}
				}
			}
		}
	}
	return punkte.sort((a, b) => (a.frist ?? '9999').localeCompare(b.frist ?? '9999'));
}
