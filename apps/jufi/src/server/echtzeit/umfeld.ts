import type { SignalAenderung } from '@jufi/domain';
import type { Bus } from './bus.js';

/**
 * Meldet eine Umfeld-Aenderung (vermerkeUmfeld) auf dem Bus. Nur nach dem Commit der
 * Transaktion, die sie vermerkt hat: ein zurueckgerollter Stand duerfte nie jemanden
 * erreichen. Ohne Verlaufseintraege, denn das Umfeld hat keinen Thread, dessen Inhalt
 * mitgeschickt werden koennte. Eine eigene Funktion statt Bus.melde an jeder Route, weil
 * ein gutes Dutzend Routen dieselbe Form melden und ein vergessenes `eintraege` das
 * Signal unvollstaendig machte.
 */
export function meldeUmfeld(
	bus: Bus,
	vereinId: string,
	vermerk: { stand: number; aenderungen: readonly SignalAenderung[] },
): void {
	bus.melde({ typ: 'aenderung', vereinId, stand: vermerk.stand, aenderungen: vermerk.aenderungen, eintraege: [] });
}
