import { Bus, type BusEreignis } from './bus.js';

// Nur fuer Tests: ein Bus, dessen Ereignisse sich nachlesen lassen. Ein Test-Verein hat
// je Test eine eigene ID, darum sortiert `fuer` die Ereignisse nach Verein, statt dass jeder
// Test den Sammler leeren muesste.

export interface Sammler {
	bus: Bus;
	fuer(vereinId: string): BusEreignis[];
}

export function sammleEreignisse(): Sammler {
	const bus = new Bus();
	const alle: BusEreignis[] = [];
	bus.abonniere((e) => alle.push(e));
	return { bus, fuer: (vereinId) => alle.filter((e) => e.vereinId === vereinId) };
}
