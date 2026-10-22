export const MB = 1024 * 1024;

// Ganze Bytes und keine Gleitkomma-Anteile: Der Verbrauch eines Vereins uebersteigt
// leicht 2^31 (100 Dateien zu je 25 MB), bleibt als number aber weit unter 2^53.
export function kontingentReicht(e: { verbrauchBytes: number; grenzeMb: number; zusatzBytes: number }): boolean {
	return e.verbrauchBytes + e.zusatzBytes <= e.grenzeMb * MB;
}

// Basis 1024, weil auch die Grenze in MB (= 1024 * 1024 Bytes) gefuehrt wird; ein Text
// zur Basis 1000 wuerde neben der Grenze im Admin-Bereich nie zusammenpassen. Der Wechsel
// auf GB richtet sich nach dem gerundeten Wert, sonst stuende dort "1024,0 MB".
// Unter einem MB (nach dem Runden) stehen ganze KB: Ein typisches Dokument ist ein paar
// Dutzend KB gross und stuende sonst als "0,0 MB" in der Liste. Mindestens 1 KB, damit
// eine nicht leere Datei nie wie eine leere aussieht; nur 0 Bytes bleiben "0 MB".
export function speicherText(bytes: number): string {
	if (bytes === 0) return '0 MB';
	const mb = bytes / MB;
	if (Math.round(mb * 10) / 10 < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	const [wert, einheit] = Math.round(mb * 10) / 10 >= 1024 ? [mb / 1024, 'GB'] : [mb, 'MB'];
	return `${wert.toFixed(1).replace('.', ',')} ${einheit}`;
}

// Ganzzahlig gerechnet (verbrauch >= 0,9 * grenze): 0.9 laesst sich nicht exakt als
// Gleitkommazahl darstellen, und "genau 90 %" soll sicher schon anschlagen.
export function fastVoll(verbrauchBytes: number, grenzeMb: number): boolean {
	return verbrauchBytes * 10 >= grenzeMb * MB * 9;
}
