import { createTransport } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { TEST_UMGEBUNG } from '../test-setup.js';
import { nodemailerVersand } from './versand.js';

async function gesendet(praefix: string) {
	const transport = createTransport({ jsonTransport: true });
	const versand = nodemailerVersand(
		{
			...TEST_UMGEBUNG,
			mailAbsender: 'app@jufi-app.de',
			mailAntwort: 'kontakt@jufi-app.de',
			mailBetreffPraefix: praefix,
		},
		transport,
	);
	const sendMail = vi.spyOn(transport, 'sendMail');
	await versand.sende({ empfaenger: 'a@jufi.test', betreff: 'Hallo', text: 'Zeile 1\nZeile 2 – äö' });
	// jsonTransport liefert die fertig gebaute Nachricht als JSON zurueck.
	const info = (await sendMail.mock.results[0]?.value) as { message: string };
	return JSON.parse(info.message) as Record<string, unknown>;
}

describe('nodemailerVersand', () => {
	it('setzt Absender, Antwortadresse, Betreff mit Praefix und den Klartext unveraendert', async () => {
		const mail = await gesendet('[Test] ');
		expect(mail).toMatchObject({
			from: { address: 'app@jufi-app.de' },
			replyTo: [{ address: 'kontakt@jufi-app.de' }],
			to: [{ address: 'a@jufi.test' }],
			subject: '[Test] Hallo',
			text: 'Zeile 1\nZeile 2 – äö',
		});
		expect(mail).not.toHaveProperty('html');
	});

	it('setzt ohne Praefix keine Leerstelle vor den Betreff', async () => {
		expect((await gesendet(''))['subject']).toBe('Hallo');
	});
});
