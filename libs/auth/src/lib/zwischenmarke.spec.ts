import { describe, expect, it } from 'vitest';
import { pruefeZwischenmarke, signiereZwischenmarke, ZWISCHENMARKE_GUELTIG_MS } from './zwischenmarke.js';

const GEHEIMNIS = 'g'.repeat(32);
const JETZT = Date.UTC(2026, 9, 13, 12, 0, 0);

describe('Zwischenmarke', () => {
	it('liefert nach der Rundreise die ID', () => {
		const marke = signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT);
		expect(pruefeZwischenmarke(marke, GEHEIMNIS, JETZT + 1000)).toBe('admin-1');
	});

	it('gilt fuenf Minuten', () => {
		expect(ZWISCHENMARKE_GUELTIG_MS).toBe(5 * 60 * 1000);
	});

	it('ist noch eine Millisekunde vor Ablauf gueltig', () => {
		const marke = signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT);
		expect(pruefeZwischenmarke(marke, GEHEIMNIS, JETZT + ZWISCHENMARKE_GUELTIG_MS - 1)).toBe('admin-1');
	});

	// Genau zur Ablaufzeit ist sie schon abgelaufen (<=), nicht erst danach.
	it('ist genau zur Ablaufzeit abgelaufen', () => {
		const marke = signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT);
		expect(pruefeZwischenmarke(marke, GEHEIMNIS, JETZT + ZWISCHENMARKE_GUELTIG_MS)).toBeUndefined();
		expect(pruefeZwischenmarke(marke, GEHEIMNIS, JETZT + ZWISCHENMARKE_GUELTIG_MS + 1)).toBeUndefined();
	});

	it('lehnt ein falsches Geheimnis ab', () => {
		const marke = signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT);
		expect(pruefeZwischenmarke(marke, 'h'.repeat(32), JETZT)).toBeUndefined();
	});

	it('lehnt ein veraendertes Zeichen ab, in jedem Teil', () => {
		const marke = signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT);
		const teile = marke.split('.');
		for (let i = 0; i < teile.length; i++) {
			const kopie = [...teile];
			const zeichen = kopie[i][0] === 'a' ? 'b' : 'a';
			kopie[i] = zeichen + kopie[i].slice(1);
			expect(pruefeZwischenmarke(kopie.join('.'), GEHEIMNIS, JETZT), `Teil ${i}`).toBeUndefined();
		}
	});

	// Wer die Ablaufzeit hinaufsetzt, um eine abgelaufene Marke zu retten, hat die
	// Signatur nicht mehr: der Ablauf steckt im signierten Teil.
	it('lehnt eine nachtraeglich verlaengerte Marke ab', () => {
		const marke = signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT);
		const [id, , nonce, mac] = marke.split('.');
		const gefaelscht = [id, String(JETZT + 10 * ZWISCHENMARKE_GUELTIG_MS), nonce, mac].join('.');
		expect(pruefeZwischenmarke(gefaelscht, GEHEIMNIS, JETZT + ZWISCHENMARKE_GUELTIG_MS + 1)).toBeUndefined();
	});

	it('lehnt eine falsche Teilezahl ab', () => {
		const marke = signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT);
		expect(pruefeZwischenmarke(marke.split('.').slice(0, 3).join('.'), GEHEIMNIS, JETZT)).toBeUndefined();
		expect(pruefeZwischenmarke(`${marke}.extra`, GEHEIMNIS, JETZT)).toBeUndefined();
		expect(pruefeZwischenmarke('', GEHEIMNIS, JETZT)).toBeUndefined();
	});

	it('lehnt eine Marke ab, deren Signatur kuerzer ist', () => {
		const marke = signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT);
		expect(pruefeZwischenmarke(marke.slice(0, -4), GEHEIMNIS, JETZT)).toBeUndefined();
	});

	it('liefert bei gleicher Eingabe verschiedene Marken (Nonce)', () => {
		expect(signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT)).not.toBe(
			signiereZwischenmarke('admin-1', GEHEIMNIS, JETZT),
		);
	});

	// Der Punkt trennt die Teile. Eine ID mit Punkt wuerde beim Pruefen anders
	// zerlegt und still abgelehnt; lauter scheitern ist besser.
	it('weigert sich, eine ID mit Punkt zu signieren', () => {
		expect(() => signiereZwischenmarke('a.b', GEHEIMNIS, JETZT)).toThrow(/Punkt/);
	});
});
