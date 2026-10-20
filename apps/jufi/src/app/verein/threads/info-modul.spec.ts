import { TestBed } from '@angular/core/testing';
import type { ModulAnsicht } from '@jufi/domain';
import { InfoModul } from './info-modul';

type Info = Extract<ModulAnsicht, { typ: 'INFO' }>;

async function zeige(modul: Info): Promise<HTMLElement> {
	const fixture = TestBed.createComponent(InfoModul);
	fixture.componentRef.setInput('modul', modul);
	const el = fixture.nativeElement as HTMLElement;
	// Der Parser wird nachgeladen; gewartet wird auf den Text statt auf eine geratene Zeit.
	await vi.waitFor(() => {
		fixture.detectChanges();
		expect(el.querySelector('.text')).not.toBeNull();
	});
	return el;
}

describe('Info-Modul', () => {
	it('zeigt Titel und den formatierten Text', async () => {
		const el = await zeige({
			typ: 'INFO',
			id: 'm1',
			titel: 'Worum es geht',
			text: 'Wir gehen **kegeln**.\n\n- Schuhe\n- Socken',
		});

		expect(el.querySelector('h2')?.textContent).toBe('Worum es geht');
		expect(el.querySelector('.text strong')?.textContent).toBe('kegeln');
		expect(Array.from(el.querySelectorAll('.text li')).map((li) => li.textContent)).toEqual(['Schuhe', 'Socken']);
	});

	it('kommt ohne Titel aus', async () => {
		const el = await zeige({ typ: 'INFO', id: 'm1', titel: null, text: 'Nur Text' });

		expect(el.querySelector('h2')).toBeNull();
		expect(el.querySelector('.text')?.textContent?.trim()).toBe('Nur Text');
	});

	it('Links gehen in einem neuen Fenster ohne Zugriff auf die App auf', async () => {
		const el = await zeige({ typ: 'INFO', id: 'm1', titel: null, text: '[Karte](https://example.org)' });

		const a = el.querySelector('.text a');
		expect(a?.getAttribute('href')).toBe('https://example.org');
		expect(a?.getAttribute('target')).toBe('_blank');
		expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('fremdes HTML erscheint als Text und wird kein Element', async () => {
		const text = '<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1))';
		const el = await zeige({ typ: 'INFO', id: 'm1', titel: null, text });

		expect(el.querySelector('.text img, .text script, .text a')).toBeNull();
		expect(el.querySelector('.text')?.textContent?.trim()).toBe(text);
	});
});
