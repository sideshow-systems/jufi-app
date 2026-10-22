import { dateiLink, imBrowser, typKuerzel } from './dateien-anzeige';

describe('dateien-anzeige', () => {
	it('kuerzt bekannte Typen und nennt den Rest Datei', () => {
		expect(typKuerzel('application/pdf')).toBe('PDF');
		expect(typKuerzel('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('Word');
		expect(typKuerzel('image/webp')).toBe('Bild');
		expect(typKuerzel('application/zip')).toBe('Datei');
	});

	it('zeigt PDF und Bilder im Browser, auch WebP, alles andere nicht', () => {
		for (const typ of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) expect(imBrowser(typ)).toBe(true);
		expect(imBrowser('application/vnd.oasis.opendocument.text')).toBe(false);
	});

	it('oeffnet PDF in neuem Tab', () => {
		expect(dateiLink('demo', { id: 'd1', typ: 'application/pdf' })).toEqual({
			href: '/demo/api/v1/dateien/d1',
			neuerTab: true,
		});
	});

	it('laedt alles andere herunter', () => {
		expect(
			dateiLink('demo', { id: 'd 2', typ: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
		).toEqual({ href: '/demo/api/v1/dateien/d%202?herunterladen=1', neuerTab: false });
	});
});
