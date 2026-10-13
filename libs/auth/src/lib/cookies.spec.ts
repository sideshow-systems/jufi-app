import { describe, expect, it } from 'vitest';
import { ADMIN_COOKIE, MITGLIEDER_COOKIE, readCookie, serializeClearedCookie, serializeCookie } from './cookies.js';

describe('serializeCookie', () => {
	const opts = { path: '/glonntal/', maxAgeSeconds: 3600, secure: true };

	it('traegt Name, Pfad, HttpOnly, SameSite=Lax und Secure nur bei https', () => {
		const c = serializeCookie('jufi_sitzung', 'abc', { path: '/glonntal/', maxAgeSeconds: 60, secure: true });
		expect(c).toContain('jufi_sitzung=abc');
		expect(c).toContain('Path=/glonntal/');
		expect(c).toContain('HttpOnly');
		expect(c).toContain('SameSite=Lax');
		expect(c).toContain('Secure');
		expect(serializeCookie('x', 'y', { path: '/', maxAgeSeconds: 1, secure: false })).not.toContain('Secure');
	});

	it('setzt SameSite=Lax statt Strict, damit ein Klick aus einer Nachricht die Sitzung behaelt', () => {
		const c = serializeCookie('x', 'abc', opts);
		expect(c).toContain('SameSite=Lax');
		expect(c).not.toContain('SameSite=Strict');
	});

	it('traegt die Laufzeit', () => {
		expect(serializeCookie('x', 'abc', opts)).toContain('Max-Age=3600');
	});

	it('trennt Mitglieder- und Admin-Cookie nach Name', () => {
		expect(MITGLIEDER_COOKIE).toBe('jufi_sitzung');
		expect(ADMIN_COOKIE).toBe('jufi_admin');
		expect(MITGLIEDER_COOKIE).not.toBe(ADMIN_COOKIE);
	});
});

describe('serializeClearedCookie', () => {
	it('laeuft sofort ab und behaelt Pfad und Sicherheitsattribute', () => {
		const c = serializeClearedCookie(ADMIN_COOKIE, { path: '/admin/', secure: true });
		expect(c).toContain('jufi_admin=;');
		// Ein Cookie wird nur geloescht, wenn der Pfad genau dem gesetzten entspricht.
		expect(c).toContain('Path=/admin/');
		expect(c).toContain('Max-Age=0');
		expect(c).toContain('HttpOnly');
		expect(c).toContain('SameSite=Lax');
		expect(c).toContain('Secure');
	});

	it('laesst Secure bei http weg', () => {
		expect(serializeClearedCookie('x', { path: '/', secure: false })).not.toContain('Secure');
	});
});

describe('readCookie', () => {
	it('liest das Cookie aus einem einzelnen Eintrag', () => {
		expect(readCookie('jufi_sitzung=abc', 'jufi_sitzung')).toBe('abc');
	});

	it('findet es zwischen anderen Cookies', () => {
		expect(readCookie('theme=dark; jufi_sitzung=abc; other=1', 'jufi_sitzung')).toBe('abc');
	});

	it('findet das Cookie unter mehreren, auch mit gleichem Praefix', () => {
		expect(readCookie('jufi_sitzung_alt=1; jufi_sitzung=zwei', 'jufi_sitzung')).toBe('zwei');
	});

	it('verwechselt kein Cookie mit aehnlichem Namen', () => {
		expect(readCookie('jufi_sitzung_alt=abc', 'jufi_sitzung')).toBeUndefined();
	});

	it('verkraftet Leerraum', () => {
		expect(readCookie('  jufi_sitzung = abc  ', 'jufi_sitzung')).toBe('abc');
	});

	it('liefert undefined ohne Header oder ohne das Cookie', () => {
		expect(readCookie(undefined, 'jufi_sitzung')).toBeUndefined();
		expect(readCookie('theme=dark', 'jufi_sitzung')).toBeUndefined();
	});

	it('liefert undefined bei leerem Wert statt eines leeren Strings', () => {
		expect(readCookie('jufi_sitzung=', 'jufi_sitzung')).toBeUndefined();
	});

	it('behaelt base64url-Zeichen im Wert', () => {
		expect(readCookie('jufi_sitzung=a-b_c9', 'jufi_sitzung')).toBe('a-b_c9');
	});
});
