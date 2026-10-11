import { erzeugeBeispieldaten, P } from '../daten/beispieldaten';
import { darf, elternVon, istJugendleiter, kannRechtEntziehen, kinderVon, person, ROLLEN_VORLAGEN } from './personen';

const stand = erzeugeBeispieldaten('2026-10-11');

describe('personen', () => {
	it('findet Kinder und Eltern', () => {
		expect(kinderVon(stand, P.sandra).map((p) => p.id)).toEqual([P.lena, P.max]);
		expect(elternVon(stand, P.jonas).map((p) => p.id)).toEqual([P.thomas]);
		expect(kinderVon(stand, P.lena)).toEqual([]);
	});

	it('erkennt Jugendleiter an mindestens einem Recht', () => {
		expect(istJugendleiter(person(stand, P.thomas)!)).toBe(true);
		expect(istJugendleiter(person(stand, P.michael)!)).toBe(true);
		expect(istJugendleiter(person(stand, P.sandra)!)).toBe(false);
	});

	it('prueft Einzelrechte', () => {
		expect(darf(person(stand, P.thomas)!, 'rechteVerwalten')).toBe(true);
		expect(darf(person(stand, P.katrin)!, 'rechteVerwalten')).toBe(false);
		expect(darf(person(stand, P.katrin)!, 'alleThreads')).toBe(true);
	});

	it('schuetzt den letzten Rechte-Verwalter', () => {
		expect(kannRechtEntziehen(stand, P.thomas, 'rechteVerwalten')).toBe(false);
		expect(kannRechtEntziehen(stand, P.thomas, 'einstellungen')).toBe(true);
		const zweiVerwalter = {
			...stand,
			personen: stand.personen.map((p) =>
				p.id === P.katrin ? { ...p, rechte: [...p.rechte, 'rechteVerwalten' as const] } : p,
			),
		};
		expect(kannRechtEntziehen(zweiVerwalter, P.thomas, 'rechteVerwalten')).toBe(true);
	});

	it('kennt die Rollen-Vorlagen aus Rahmen 4.2', () => {
		expect(ROLLEN_VORLAGEN.leitung).toHaveLength(7);
		expect(ROLLEN_VORLAGEN.jugendleiter).toEqual(person(stand, P.katrin)!.rechte);
		expect(ROLLEN_VORLAGEN.betreuer).toEqual(['antwortenDetail']);
	});
});
