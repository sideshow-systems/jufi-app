const WEITER_MAX = 500;

// Ein fester Ursprung nur zum Aufloesen: Der Wert kommt nie zurueck, er dient dem
// Vergleich, ob die Adresse nach dem Normalisieren noch auf demselben Ursprung liegt.
const BASIS = 'http://jufi.invalid';

// Die Seiten, die selbst zur Anmeldung gehoeren: Wer nach der Anmeldung dorthin
// zurueckgeschickt wuerde, landete in einer Schleife oder auf einer Einladung, die er
// gerade nicht braucht.
const ANMELDE_SEGMENTE: readonly string[] = ['anmelden', 'einladung', 'zugang-verloren'];

// Angular loest ein Segment erst nach dem Dekodieren und ohne Matrixparameter auf,
// "%61nmelden" und "anmelden;x=1" sind also dieselbe Seite wie "anmelden". Nur fuer
// diesen Ausschluss wird dekodiert; der Praefix- und Ursprungsvergleich bleibt am
// Pfad, den URL normalisiert hat.
function routenSegment(segment: string): string {
	const ohneParameter = segment.split(';')[0];
	try {
		return decodeURIComponent(ohneParameter);
	} catch {
		return ohneParameter;
	}
}

// Wohin der Browser nach der Anmeldung zurueckgeht (Spec 2.4). `weiter` kommt aus der
// Adresszeile und ist damit Angreifereingabe: Erlaubt ist nur ein Pfad innerhalb
// des eigenen Vereins, alles andere fuehrt zum Start `/<slug>/`.
//
// `URL` statt eigener Zerlegung, weil Browser eine Adresse genau so aufloesen: Ein
// selbst gebauter Parser wuerde `..`, `%2e%2e`, Backslash oder verschluckte Tabulatoren
// anders lesen als der Browser und so eine Luecke lassen. Verworfen: eine Positivliste
// der erlaubten Seiten, sie muesste mit jeder neuen Seite des Vereins wachsen.
export function sichererWeiterPfad(slug: string, weiter: string | null | undefined): string {
	const start = `/${slug}/`;
	if (!weiter || weiter.length > WEITER_MAX) return start;
	// Vor dem Aufloesen: "//host" und "/\host" waeren sonst eine Adresse auf fremdem
	// Host, die mit "/" beginnt.
	if (weiter[0] !== '/' || weiter[1] === '/' || weiter[1] === '\\') return start;

	let url: URL;
	try {
		url = new URL(weiter, BASIS);
	} catch {
		return start;
	}
	if (url.origin !== BASIS) return start;
	if (!url.pathname.startsWith(start)) return start;

	const erstesSegment = url.pathname.slice(start.length).split('/')[0];
	if (ANMELDE_SEGMENTE.includes(routenSegment(erstesSegment))) return start;

	return url.pathname + url.search + url.hash;
}
