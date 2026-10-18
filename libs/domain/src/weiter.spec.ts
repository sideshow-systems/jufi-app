import { sichererWeiterPfad } from './weiter.js';

describe('sichererWeiterPfad', () => {
	it.each(['/demo/', '/demo/profil', '/demo/verwaltung/personen/abc?x=1#y'])(
		'laesst %j unveraendert durch',
		(weiter) => {
			expect(sichererWeiterPfad('demo', weiter)).toBe(weiter);
		},
	);

	it.each([
		['null', null],
		['undefined', undefined],
		['leer', ''],
		// Der Start des Vereins heisst /demo/, ohne Schraegstrich ist es eine andere Adresse.
		['Slug ohne Schraegstrich', '/demo'],
		['protokollrelative Adresse', '//boese.example'],
		['Backslash statt Schraegstrich', '/\\boese.example'],
		// Browser entfernen Tabulator und Zeilenumbruch aus Adressen, aus // wird so ein fremder Host.
		['Tabulator zwischen den Schraegstrichen', '/\t/boese.example'],
		['absolute Adresse', 'https://boese.example/demo/'],
		['javascript-Schema', 'javascript:alert(1)'],
		['Punktsegment', '/demo/../admin'],
		['kodiertes Punktsegment', '/demo/%2e%2e/admin'],
		['kodiertes Punktsegment gross', '/demo/%2E%2E/admin'],
		['Backslash als Trenner vor dem Punktsegment', '/demo/..\\admin'],
		['Slug als Praefix eines anderen', '/demox/profil'],
		['anderer Slug', '/anderer/profil'],
		['Anmeldung', '/demo/anmelden'],
		['Anmeldung mit weiter', '/demo/anmelden?weiter=/demo/'],
		['Anmeldung mit Schraegstrich', '/demo/anmelden/'],
		['Anmeldung kodiert', '/demo/%61nmelden'],
		['Anmeldung mit Matrixparameter', '/demo/anmelden;x=1'],
		['Einladung', '/demo/einladung'],
		['Einladung mit Token', '/demo/einladung/abc'],
		['Zugang verloren', '/demo/zugang-verloren'],
		['501 Zeichen', '/demo/' + 'a'.repeat(495)],
	])('faellt bei %s auf den Start zurueck', (_name, weiter) => {
		expect(sichererWeiterPfad('demo', weiter)).toBe('/demo/');
	});

	it('nimmt genau 500 Zeichen noch an', () => {
		const weiter = '/demo/' + 'a'.repeat(494);
		expect(sichererWeiterPfad('demo', weiter)).toBe(weiter);
	});

	it('loest ein Punktsegment innerhalb des Vereins auf, statt es durchzureichen', () => {
		expect(sichererWeiterPfad('demo', '/demo/a/../profil')).toBe('/demo/profil');
	});

	it('faellt auf den Start des uebergebenen Slugs zurueck', () => {
		expect(sichererWeiterPfad('glonntal', '/demo/profil')).toBe('/glonntal/');
	});

	it('laesst einen Pfad mit anmelden an anderer Stelle durch', () => {
		const weiter = '/demo/verwaltung/anmelden';
		expect(sichererWeiterPfad('demo', weiter)).toBe(weiter);
	});
});
