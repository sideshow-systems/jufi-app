#!/usr/bin/env node
//
// Schickt eine Klartext-Testmail ueber dieselben SMTP-Einstellungen wie die App,
// um vor dem ersten echten Versand zu sehen, ob der Server annimmt und ob die
// Mail bei Gmail oder Apple Mail als echt durchgeht (SPF, DKIM, DMARC).
// Aufruf: node tools/mail-testen.mjs <empfaenger>
//
// Im Container, wo die Werte schon in der Umgebung stehen (die Datei liegt nicht
// im Image, daher ueber stdin):
//   docker compose -f docker-compose.yml exec -T jufi node --input-type=module - <adresse> < tools/mail-testen.mjs
//
// Gelesen wird ausschliesslich process.env, Namen wie in apps/jufi (SMTP_HOST,
// SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_ABSENDER, MAIL_ANTWORT,
// MAIL_BETREFF_PRAEFIX). Verworfen: eine eigene Konfigurationsdatei -- die
// Probe soll genau das pruefen, was die App auch sieht, nicht eine Kopie davon.
//
// Transport wie server/mail/versand.ts: secure nur bei Port 465, Anmeldung nur
// mit gesetztem SMTP_USER. Ausgegeben werden nur Message-ID und Host, nie
// Zugangsdaten -- die Ausgabe landet in Terminalverlaeufen und Berichten.

import { createTransport } from 'nodemailer';

const empfaenger = process.argv[2];
const env = process.env;

// Pflicht sind genau die Werte, ohne die die App selbst nicht startet. User und
// Passwort nicht: Mailpit nimmt ohne Anmeldung an.
const fehlend = ['SMTP_HOST', 'SMTP_PORT', 'MAIL_ABSENDER', 'MAIL_ANTWORT'].filter((name) => !env[name]);
if (!empfaenger || fehlend.length > 0) {
	if (!empfaenger) console.error('Aufruf: node tools/mail-testen.mjs <empfaenger>');
	if (fehlend.length > 0) console.error(`Fehlende Umgebungsvariablen: ${fehlend.join(', ')}`);
	process.exit(2);
}

const port = Number(env.SMTP_PORT);
if (!Number.isInteger(port) || port <= 0) {
	console.error('SMTP_PORT ist keine gueltige Portnummer.');
	process.exit(2);
}

const transport = createTransport({
	host: env.SMTP_HOST,
	port,
	secure: port === 465,
	auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
});

try {
	const info = await transport.sendMail({
		from: env.MAIL_ABSENDER,
		replyTo: env.MAIL_ANTWORT,
		to: empfaenger,
		subject: `${env.MAIL_BETREFF_PRAEFIX ?? ''}Testmail der JuFi App`,
		text: [
			'Das ist eine Testmail der JuFi App.',
			`Sie wurde ueber den Mailserver ${env.SMTP_HOST} verschickt.`,
			'',
			'Bitte in Gmail oder Apple Mail die Originalnachricht ansehen und nach',
			'spf=pass, dkim=pass und dmarc=pass suchen. Fehlt eines davon, landen',
			'Einladungen und Passwort-Mails bei Mitgliedern im Spam.',
		].join('\n'),
	});
	console.log(`Gesendet. Message-ID: ${info.messageId}, Host: ${env.SMTP_HOST}`);
} catch (fehler) {
	console.error(`Versand gescheitert (${env.SMTP_HOST}): ${fehler instanceof Error ? fehler.message : fehler}`);
	process.exit(1);
}
