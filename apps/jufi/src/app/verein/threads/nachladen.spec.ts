import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { nachlader } from './nachladen';

describe('nachlader', () => {
	let ressource: { isLoading: ReturnType<typeof signal<boolean>>; reload: ReturnType<typeof vi.fn<() => boolean>> };
	let anlass: () => void;

	beforeEach(() => {
		vi.useFakeTimers();
		ressource = { isLoading: signal(false), reload: vi.fn(() => true) };
		anlass = nachlader(ressource, TestBed.inject(Injector));
	});

	afterEach(() => vi.useRealTimers());

	it('fasst zwei Anlaesse binnen 250 ms zu einem Neuladen zusammen', () => {
		anlass();
		vi.advanceTimersByTime(100);
		anlass();
		vi.advanceTimersByTime(149);
		expect(ressource.reload).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(ressource.reload).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1000);
		TestBed.tick();
		expect(ressource.reload).toHaveBeenCalledTimes(1);
	});

	it('laedt nach dem Ende einer laufenden Anfrage genau einmal neu', () => {
		ressource.isLoading.set(true);
		TestBed.tick();
		anlass();
		vi.advanceTimersByTime(250);
		TestBed.tick();
		expect(ressource.reload).not.toHaveBeenCalled();

		ressource.isLoading.set(false);
		TestBed.tick();
		expect(ressource.reload).toHaveBeenCalledTimes(1);

		// Ein weiteres Laden und sein Ende loesen ohne neuen Anlass nichts mehr aus.
		ressource.isLoading.set(true);
		TestBed.tick();
		ressource.isLoading.set(false);
		TestBed.tick();
		vi.advanceTimersByTime(1000);
		expect(ressource.reload).toHaveBeenCalledTimes(1);
	});

	it('laedt ohne laufende Anfrage nach 250 ms direkt neu', () => {
		anlass();
		vi.advanceTimersByTime(250);
		expect(ressource.reload).toHaveBeenCalledTimes(1);
	});
});
