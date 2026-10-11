import { geraeteZeile, rueckmeldungText } from './rueckmeldung';
import type { TestmodusStand } from './typen';
import { versenden, whatsappUrl } from './versand';

const IPHONE =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0';

function stand(teil: Partial<TestmodusStand>): TestmodusStand {
	return {
		person: 'sandra',
		mitAufgaben: true,
		index: { sandra: 0, lena: 0, thomas: 0 },
		ergebnisse: { sandra: [], lena: [], thomas: [] },
		ereignisse: [],
		seitenNotizen: [],
		...teil,
	};
}

describe('rueckmeldungText', () => {
	const z = stand({
		ergebnisse: {
			sandra: [
				{ aufgabeId: 'sandra-1', ausgang: 'geschafft', dauerSek: 42, smiley: 'gut', fehlversuche: 0 },
				{
					aufgabeId: 'sandra-2',
					ausgang: 'nichtWeiter',
					dauerSek: 130,
					notiz: 'Hab das Herbstfest erst nicht gefunden',
					fehlversuche: 0,
				},
			],
			lena: [],
			thomas: [],
		},
		seitenNotizen: [{ pfad: '/glonntal/t/2-bowling', text: 'Der Teilen-Knopf ist schwer zu finden' }],
	});

	it('baut Kopf, Geraet, Person, Ergebnisse und Seitennotiz nach Spec 5.5', () => {
		expect(rueckmeldungText(z, 'iPhone · Safari · dunkel').split('\n')).toEqual([
			'📝 *JuFi-Entwurf – Rückmeldung*',
			'Gerät: iPhone · Safari · dunkel',
			'*Sandra*',
			'1 ✅ 😀 0:42 Max fürs Bowling',
			'2 ❌ nicht weiter 2:10 Kuchen eintragen – „Hab das Herbstfest erst nicht gefunden"',
			'📍 /glonntal/t/2-bowling: „Der Teilen-Knopf ist schwer zu finden"',
		]);
	});

	it('haengt den Wunsch zuletzt an und nennt Uebersprungenes', () => {
		const text = rueckmeldungText(
			{
				...z,
				ergebnisse: {
					...z.ergebnisse,
					lena: [{ aufgabeId: 'lena-2', ausgang: 'uebersprungen', dauerSek: 20, fehlversuche: 0 }],
				},
				wunsch: 'Dunkler Modus top!',
			},
			'Android · Chrome · hell',
		).split('\n');
		expect(text).toContain('*Lena*');
		expect(text).toContain('2 ⏭ übersprungen 0:20 Mitfahrt finden');
		expect(text.at(-1)).toBe('💬 Sonst noch: „Dunkler Modus top!"');
	});

	it('nennt Fehlversuche bei Suchaufgaben', () => {
		const text = rueckmeldungText(
			stand({
				ergebnisse: {
					sandra: [{ aufgabeId: 'sandra-5', ausgang: 'geschafft', dauerSek: 65, smiley: 'mittel', fehlversuche: 2 }],
					lena: [],
					thomas: [],
				},
			}),
			'x',
		);
		expect(text).toContain('5 ✅ 😐 1:05 Nächstes Treffen (2 Fehlversuche)');
	});

	it('meldet ohne Ergebnisse, dass noch nichts gespielt wurde', () => {
		expect(rueckmeldungText(stand({}), 'x')).toContain('Noch keine Aufgaben gespielt.');
	});
});

describe('geraeteZeile', () => {
	it('erkennt iPhone mit Safari im dunklen Modus', () => {
		expect(geraeteZeile(IPHONE, true)).toBe('iPhone · Safari · dunkel');
	});

	it('erkennt Android mit Chrome und Mac mit Firefox', () => {
		expect(geraeteZeile(ANDROID, false)).toBe('Android · Chrome · hell');
		expect(geraeteZeile(MAC_FIREFOX, false)).toBe('Mac · Firefox · hell');
	});

	it('nennt Unbekanntes "Geraet unbekannt"', () => {
		expect(geraeteZeile('curl/8.0', false)).toBe('Gerät unbekannt · hell');
	});
});

describe('whatsappUrl', () => {
	it('kodiert Sonderzeichen so, dass der Text unveraendert ankommt', () => {
		const text = 'ä ö ü ß 🎳 „Zitat" & # ? \n zweite Zeile + 100%';
		const url = new URL(whatsappUrl('491701234567', text));
		expect(url.origin + url.pathname).toBe('https://wa.me/491701234567');
		expect(url.searchParams.get('text')).toBe(text);
	});
});

describe('versenden', () => {
	afterEach(() => vi.restoreAllMocks());

	it('oeffnet mit Nummer WhatsApp mit dem Text', async () => {
		const offen = vi.spyOn(window, 'open').mockReturnValue({} as Window);
		expect(await versenden('Hallo & tschüss', '491701234567')).toBe('whatsapp');
		expect(offen).toHaveBeenCalledWith('https://wa.me/491701234567?text=Hallo%20%26%20tsch%C3%BCss', '_blank');
	});

	it('kopiert, wenn der Browser das Fenster blockiert und nicht teilen kann', async () => {
		vi.spyOn(window, 'open').mockReturnValue(null);
		const schreiben = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText: schreiben } });
		expect(await versenden('Text', '491701234567')).toBe('kopiert');
		expect(schreiben).toHaveBeenCalledWith('Text');
		vi.unstubAllGlobals();
	});

	it('kopiert ohne Nummer, ohne WhatsApp zu oeffnen', async () => {
		const offen = vi.spyOn(window, 'open');
		vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText: vi.fn() } });
		expect(await versenden('Text', null)).toBe('kopiert');
		expect(offen).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
