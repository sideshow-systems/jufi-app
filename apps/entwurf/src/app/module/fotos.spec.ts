import { TestBed } from '@angular/core/testing';
import { type Testereignis, TESTEREIGNISSE } from '../daten/ereignisse';
import type { FotosModul } from '../daten/typen';
import { testProvider } from '../testhilfe';
import { FotosBauteil } from './fotos';

const MODUL: FotosModul = { id: 'm-f', typ: 'fotos', fotos: [{ id: 'f1', bild: 'data:,', von: 'p-x' }] };

function aufbauen() {
	TestBed.configureTestingModule({ providers: testProvider() });
	const gemeldet: Testereignis[] = [];
	TestBed.inject(TESTEREIGNISSE).subscribe((e) => gemeldet.push(e));
	const fixture = TestBed.createComponent(FotosBauteil);
	fixture.componentRef.setInput('modul', MODUL);
	fixture.componentRef.setInput('threadId', 't-x');
	fixture.detectChanges();
	const el = fixture.nativeElement as HTMLElement;
	el.querySelector<HTMLButtonElement>('.raster button')!.click();
	fixture.detectChanges();
	return { fixture, el, gemeldet };
}

describe('FotosBauteil', () => {
	// Die Testmodus-Bewertung erschiene sonst ueber der Grossansicht, und nach
	// "Weiter" stuende das Foto noch offen da.
	it('meldet das angesehene Foto erst beim Schliessen der Grossansicht', () => {
		const { fixture, el, gemeldet } = aufbauen();
		expect(el.querySelector('.ueberlagerung')).not.toBeNull();
		expect(gemeldet).toEqual([]);
		el.querySelector<HTMLButtonElement>('.zu')!.click();
		fixture.detectChanges();
		expect(gemeldet).toEqual([{ art: 'fotoGeoeffnet', threadId: 't-x', fotoId: 'f1' }]);
	});

	it('meldet es auch, wenn die Seite mit offener Grossansicht verlassen wird', () => {
		const { fixture, gemeldet } = aufbauen();
		fixture.destroy();
		expect(gemeldet).toHaveLength(1);
	});
});
