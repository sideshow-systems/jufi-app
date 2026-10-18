import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
	it('startet', () => {
		TestBed.configureTestingModule({
			providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
		});
		expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
	});
});
