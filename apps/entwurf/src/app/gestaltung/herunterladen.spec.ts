import { herunterladen } from './herunterladen';

describe('herunterladen', () => {
	const original = { erzeugen: URL.createObjectURL, freigeben: URL.revokeObjectURL };

	beforeEach(() => {
		vi.useFakeTimers();
		URL.createObjectURL = vi.fn(() => 'blob:test');
		URL.revokeObjectURL = vi.fn();
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		URL.createObjectURL = original.erzeugen;
		URL.revokeObjectURL = original.freigeben;
		vi.restoreAllMocks();
	});

	// iOS Safari fragt vor dem Download nach; die URL muss die Rueckfrage ueberleben.
	it('gibt die Blob-URL erst nach einer Minute frei', () => {
		herunterladen(document, 'a.ics', 'x', 'text/calendar');
		vi.advanceTimersByTime(30_000);
		expect(URL.revokeObjectURL).not.toHaveBeenCalled();
		vi.advanceTimersByTime(30_000);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
	});
});
