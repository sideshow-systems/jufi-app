import { CliFehler } from './fehler.js';

/**
 * BASIS_URL als reiner Ursprung (Schema, Host, Port, kein Pfad, kein Schrägstrich am
 * Ende). Dieselbe Regel gilt fuer den Server (Origin-Pruefung, Spec 4.5); haengt
 * hier ein Pfad dran, fuehrte der Einrichtungslink ins Leere und der Admin
 * koennte sich nie einrichten. Deshalb bricht der Befehl ab, bevor er etwas schreibt.
 */
export function pruefeBasisUrl(wert: string | undefined): string {
	if (!wert) throw new CliFehler('BASIS_URL fehlt. In der .env eintragen, z.B. BASIS_URL="http://localhost:4200".');
	let ursprung: string;
	try {
		ursprung = new URL(wert).origin;
	} catch {
		throw new CliFehler(`BASIS_URL ist keine gültige Adresse: ${wert}`);
	}
	if (ursprung !== wert) {
		throw new CliFehler(
			`BASIS_URL muss ein reiner Ursprung sein (${ursprung}), ohne Pfad und ohne Schrägstrich am Ende: ${wert}`,
		);
	}
	return wert;
}
