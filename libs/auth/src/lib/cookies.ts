/**
 * Sitzungs-Cookies: Aufbau und Auslesen.
 *
 * Reine Funktionen ohne Request-Objekt, damit die Sicherheitsattribute testbar
 * sind statt nur behauptet.
 *
 * Name und Pfad sind Parameter, weil es zwei Cookies mit getrenntem Geltungsbereich
 * gibt: das Mitglieder-Cookie gilt nur unter dem Pfad des eigenen Vereins
 * (/<slug>/), das Admin-Cookie nur unter /admin/. Ein Pfad / für beide, wie in
 * hwyd, würde jedes Cookie an jeden Verein und an die Verwaltung schicken.
 */

export const MITGLIEDER_COOKIE = 'jufi_sitzung';
export const ADMIN_COOKIE = 'jufi_admin';

export interface CookieOptions {
	path: string;
	maxAgeSeconds: number;
	/**
	 * `Secure` weglassen, wenn lokal über http entwickelt wird — sonst schickt der
	 * Browser das Cookie nie und der Login scheitert scheinbar grundlos.
	 */
	secure: boolean;
}

/**
 * `SameSite=Lax` statt `Strict`: bei `Strict` würde ein Klick aus einer
 * E-Mail oder Nachricht heraus ohne Sitzung landen. `HttpOnly`, damit ein
 * XSS-Fund nicht gleich das Token abzieht.
 */
export function serializeCookie(name: string, token: string, options: CookieOptions): string {
	const parts = [
		`${name}=${token}`,
		`Path=${options.path}`,
		'HttpOnly',
		'SameSite=Lax',
		`Max-Age=${options.maxAgeSeconds}`,
	];
	if (options.secure) parts.push('Secure');
	return parts.join('; ');
}

/**
 * Löscht das Cookie, indem es sofort abläuft. Der Pfad muss dem beim Setzen
 * entsprechen, sonst legt der Browser ein zweites Cookie an, statt das erste zu
 * entfernen.
 */
export function serializeClearedCookie(name: string, options: Pick<CookieOptions, 'path' | 'secure'>): string {
	const parts = [`${name}=`, `Path=${options.path}`, 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
	if (options.secure) parts.push('Secure');
	return parts.join('; ');
}

/** Liest ein Cookie aus einem Cookie-Header; der Name muss ganz übereinstimmen. */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
	if (!cookieHeader) return undefined;
	for (const part of cookieHeader.split(';')) {
		const index = part.indexOf('=');
		if (index < 0) continue;
		if (part.slice(0, index).trim() !== name) continue;
		const value = part.slice(index + 1).trim();
		return value === '' ? undefined : value;
	}
	return undefined;
}
