import { infoHtml } from './info-text';

/** Ohne die Zeilenumbrueche, die marked zwischen Bloecke setzt; um die geht es hier nicht. */
async function html(text: string): Promise<string> {
	return (await infoHtml(text)).replace(/>\n+</g, '><').trim();
}

/** Was im Browser als Text ankommt: das HTML in ein Element gesetzt und wieder gelesen. */
async function sichtbar(text: string): Promise<string> {
	const div = document.createElement('div');
	div.innerHTML = await infoHtml(text);
	return (div.textContent ?? '').trim();
}

describe('Info-Text', () => {
	describe('Teilmenge', () => {
		it('fett und kursiv', async () => {
			const h = await html('**fett** und _kursiv_');

			expect(h).toContain('<strong>fett</strong>');
			expect(h).toContain('<em>kursiv</em>');
		});

		it('Listen mit Bindestrich', async () => {
			expect(await html('- a\n- b')).toContain('<ul><li>a</li><li>b</li></ul>');
		});

		it('zwei Absaetze ergeben zwei p', async () => {
			const h = await html('Erster Absatz.\n\nZweiter Absatz.');

			expect(h.match(/<p>/g)).toHaveLength(2);
		});

		it('ein einfacher Umbruch bleibt ein Umbruch', async () => {
			expect(await html('Zeile 1\nZeile 2')).toBe('<p>Zeile 1<br>Zeile 2</p>');
		});

		it.each([
			['[Karte](https://example.org)', 'Karte'],
			['https://example.org', 'https://example.org'],
		])('%s wird ein Link, der in einem neuen Fenster aufgeht', async (eingabe, text) => {
			expect(await html(eingabe)).toContain(
				`<a href="https://example.org" target="_blank" rel="noopener noreferrer">${text}</a>`,
			);
		});

		it('mailto ist erlaubt', async () => {
			expect(await html('[Schreib uns](mailto:jugend@example.org)')).toContain(
				'<a href="mailto:jugend@example.org" target="_blank" rel="noopener noreferrer">Schreib uns</a>',
			);
		});

		it('http ist erlaubt', async () => {
			expect(await html('[alt](http://example.org)')).toContain('<a href="http://example.org"');
		});
	});

	describe('alles andere erscheint als Text', () => {
		it.each(['[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](data:text/html,hallo)', '[x](/relativ)'])(
			'%s wird kein Link',
			async (eingabe) => {
				const h = await html(eingabe);

				expect(h).not.toContain('<a');
				expect(await sichtbar(eingabe)).toBe(eingabe);
			},
		);

		it('HTML wird maskiert', async () => {
			const h = await html('<b>x</b>');

			expect(h).not.toContain('<b>');
			expect(h).toContain('&lt;b&gt;');
			expect(await sichtbar('<b>x</b>')).toBe('<b>x</b>');
		});

		it('ein Bild mit onerror wird kein Element', async () => {
			const eingabe = '<img src=x onerror=alert(1)>';

			expect(await html(eingabe)).not.toContain('<img');
			expect(await sichtbar(eingabe)).toBe(eingabe);
		});

		it('ein Skript wird kein Element', async () => {
			const eingabe = '<script>alert(1)</script>';

			expect(await html(eingabe)).not.toContain('<script');
			expect(await sichtbar(eingabe)).toBe(eingabe);
		});

		it('HTML mitten im Absatz wird maskiert', async () => {
			const h = await html('Hallo <img src=x onerror=alert(1)> du');

			expect(h).not.toContain('<img');
			expect(await sichtbar('Hallo <img src=x onerror=alert(1)> du')).toBe('Hallo <img src=x onerror=alert(1)> du');
		});

		it('Markdown-Bilder bleiben als Text sichtbar', async () => {
			const eingabe = '![Bild](https://example.org/a.png)';

			expect(await html(eingabe)).not.toContain('<img');
			expect(await sichtbar(eingabe)).toBe(eingabe);
		});

		it.each(['# Titel', '## Titel', 'Titel\n==='])('Ueberschrift %j bleibt Text', async (eingabe) => {
			const h = await html(eingabe);

			expect(h).not.toMatch(/<h\d/);
			// Ein Umbruch wird br und hat keinen Text; verglichen wird ohne Leerraum.
			expect((await sichtbar(eingabe)).replace(/\s+/g, '')).toBe(eingabe.replace(/\s+/g, ''));
		});

		it('Inline-Code bleibt Text', async () => {
			expect(await html('`code`')).not.toContain('<code');
			expect(await sichtbar('`code`')).toBe('`code`');
		});

		it('Codebloecke bleiben Text', async () => {
			const eingabe = '```\nlet a = 1;\n```';

			expect(await html(eingabe)).not.toContain('<code');
			expect(await html(eingabe)).not.toContain('<pre');
			expect(await sichtbar(eingabe)).toContain('let a = 1;');
			expect(await sichtbar(eingabe)).toContain('```');
		});

		it('Zitate bleiben Text', async () => {
			expect(await html('> Zitat')).not.toContain('<blockquote');
			expect(await sichtbar('> Zitat')).toBe('> Zitat');
		});

		it('nummerierte Listen, Tabellen, Linien und Durchgestrichenes bleiben Text', async () => {
			for (const eingabe of ['1. a\n2. b', '| a | b |\n| - | - |\n| 1 | 2 |', '---', '~~weg~~']) {
				const h = await html(eingabe);
				expect(h).not.toMatch(/<(ol|table|hr|del)/);
				expect((await sichtbar(eingabe)).replace(/\s+/g, '')).toBe(eingabe.replace(/\s+/g, ''));
			}
		});

		it('Aufgabenlisten zeigen ihre Kaestchen als Text', async () => {
			const h = await html('- [ ] Schlafsack');

			expect(h).not.toContain('<input');
			expect(await sichtbar('- [ ] Schlafsack')).toBe('[ ] Schlafsack');
		});

		it('Linkdefinitionen verschwinden nicht', async () => {
			expect(await sichtbar('[a]: https://example.org')).toBe('[a]: https://example.org');
		});
	});
});
