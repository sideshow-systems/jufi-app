import { teile } from './teilen';

type Optionen = {
	grob: boolean;
	share?: (daten: { text: string }) => Promise<void>;
	writeText?: (text: string) => Promise<void>;
};

function fenster(o: Optionen) {
	const writeText = vi.fn(o.writeText ?? (() => Promise.resolve()));
	const share = o.share ? vi.fn(o.share) : undefined;
	const f = {
		matchMedia: vi.fn((abfrage: string) => ({ matches: abfrage === '(pointer: coarse)' && o.grob })),
		navigator: { ...(share ? { share } : {}), clipboard: { writeText } },
	};
	return { fenster: f as unknown as Window, writeText, share };
}

describe('teile', () => {
	it('teilt am Handy ueber das Teilen-Blatt und kopiert dann nichts', async () => {
		const { fenster: f, writeText, share } = fenster({ grob: true, share: () => Promise.resolve() });

		expect(await teile('Hallo', f)).toBe('GETEILT');
		expect(share).toHaveBeenCalledWith({ text: 'Hallo' });
		expect(writeText).not.toHaveBeenCalled();
	});

	it('behandelt Abbrechen des Teilen-Blatts als Abbruch, ohne zu kopieren', async () => {
		const { fenster: f, writeText } = fenster({
			grob: true,
			share: () => Promise.reject(new DOMException('', 'AbortError')),
		});

		expect(await teile('Hallo', f)).toBe('ABGEBROCHEN');
		expect(writeText).not.toHaveBeenCalled();
	});

	it('kopiert, wenn das Teilen sonst scheitert', async () => {
		const { fenster: f, writeText } = fenster({
			grob: true,
			share: () => Promise.reject(new DOMException('', 'NotAllowedError')),
		});

		expect(await teile('Hallo', f)).toBe('KOPIERT');
		expect(writeText).toHaveBeenCalledWith('Hallo');
	});

	it('kopiert am Rechner, auch wenn share vorhanden ist', async () => {
		const { fenster: f, writeText, share } = fenster({ grob: false, share: () => Promise.resolve() });

		expect(await teile('Hallo', f)).toBe('KOPIERT');
		expect(writeText).toHaveBeenCalledWith('Hallo');
		expect(share).not.toHaveBeenCalled();
	});

	it('kopiert am Handy ohne share', async () => {
		const { fenster: f, writeText } = fenster({ grob: true });

		expect(await teile('Hallo', f)).toBe('KOPIERT');
		expect(writeText).toHaveBeenCalledWith('Hallo');
	});

	it('meldet FEHLER, wenn auch das Kopieren scheitert', async () => {
		const { fenster: f } = fenster({ grob: false, writeText: () => Promise.reject(new Error('verweigert')) });

		expect(await teile('Hallo', f)).toBe('FEHLER');
	});

	it('meldet FEHLER ohne Zwischenablage', async () => {
		const f = { matchMedia: () => ({ matches: false }), navigator: {} } as unknown as Window;

		expect(await teile('Hallo', f)).toBe('FEHLER');
	});
});
