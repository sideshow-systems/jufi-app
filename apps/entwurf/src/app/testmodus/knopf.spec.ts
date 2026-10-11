import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { routes } from '../app.routes';
import { testProvider } from '../testhilfe';
import { TestmodusKnopf } from './knopf';

async function aufbauen(url: string) {
	TestBed.configureTestingModule({ providers: [provideRouter(routes), ...testProvider()] });
	await TestBed.inject(Router).navigateByUrl(url);
	const fixture = TestBed.createComponent(TestmodusKnopf);
	fixture.detectChanges();
	TestBed.tick();
	const wurzel = TestBed.inject(DOCUMENT).documentElement;
	return { fixture, platz: () => wurzel.style.getPropertyValue('--knopf-platz') };
}

describe('TestmodusKnopf', () => {
	it('haelt unten Platz frei, damit er am Seitenende nichts verdeckt', async () => {
		const { platz } = await aufbauen('/glonntal');
		expect(platz()).toBe('calc(var(--tippflaeche) + var(--a3))');
	});

	it('gibt den Platz frei, wenn er ausgeblendet ist und wenn er verschwindet', async () => {
		const { fixture, platz } = await aufbauen('/glonntal/willkommen');
		expect(platz()).toBe('');
		await TestBed.inject(Router).navigateByUrl('/glonntal');
		TestBed.tick();
		expect(platz()).not.toBe('');
		fixture.destroy();
		expect(platz()).toBe('');
	});
});
