import type { Provider } from '@angular/core';
import { speicherAblage } from './daten/speicher';
import { ABLAGE, UHR } from './daten/store';

/**
 * Provider fuer Bauteil-Tests: eigene Ablage je Test (jsdom teilt localStorage
 * ueber Tests hinweg) und eine feste Uhr am Sonntag, 11.10.2026, 10:00.
 */
export function testProvider(): Provider[] {
	return [
		{ provide: ABLAGE, useFactory: () => speicherAblage() },
		{ provide: UHR, useValue: () => new Date(2026, 9, 11, 10, 0) },
	];
}
