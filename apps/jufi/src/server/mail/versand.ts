import { createTransport, type Transporter } from 'nodemailer';
import type { Umgebung } from '../umgebung.js';

export interface MailVersand {
	sende(m: { empfaenger: string; betreff: string; text: string }): Promise<void>;
}

/**
 * Versand ueber SMTP. Nur Klartext: Die Mails enthalten einen Link und einen
 * Satz; HTML braechte Tracking-Fallen und Darstellungsfehler ohne Gewinn.
 *
 * Der Transport ist austauschbar, damit Tests mit jsonTransport die fertige
 * Nachricht pruefen, ohne einen Server zu brauchen. Kein TLS-Zwang: lokal faengt
 * Mailpit auf Port 1025 ohne TLS ab; Port 465 ist implizites TLS (secure), auf
 * 587 handelt nodemailer STARTTLS aus, sobald der Server es anbietet.
 */
export function nodemailerVersand(umgebung: Umgebung, transport?: Transporter): MailVersand {
	const t =
		transport ??
		createTransport({
			host: umgebung.smtp.host,
			port: umgebung.smtp.port,
			secure: umgebung.smtp.port === 465,
			auth: umgebung.smtp.user ? { user: umgebung.smtp.user, pass: umgebung.smtp.pass ?? '' } : undefined,
		});
	return {
		async sende(m) {
			await t.sendMail({
				from: umgebung.mailAbsender,
				replyTo: umgebung.mailAntwort,
				to: m.empfaenger,
				subject: `${umgebung.mailBetreffPraefix}${m.betreff}`,
				text: m.text,
			});
		},
	};
}
