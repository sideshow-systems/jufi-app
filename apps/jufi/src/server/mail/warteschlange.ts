/**
 * Struktureller Parameter statt PrismaClient: Der Transaktions-Client aus
 * prisma.$transaction und der aus vereinDb(...).$transaction haben verschiedene
 * Typen. Wer eine Mail einreiht, tut es zusammen mit der Sache, die sie
 * ausloest (Einladung anlegen, Reset), und beides soll gemeinsam gelingen oder
 * scheitern -- eine Einladung ohne Mail oder eine Mail ohne Einladung ist ein Fehler.
 */
export interface MitMailWarteschlange {
	mailWarteschlange: {
		create(args: {
			data: {
				vereinId?: string;
				empfaenger: string;
				betreff: string;
				text: string;
				bezug?: string;
				naechsterVersuch: Date;
			};
		}): PromiseLike<unknown>;
	};
}

/**
 * Reiht eine Mail ein, sendet nicht: Das macht der Arbeiter. So haengt keine
 * Anfrage am Mailserver, und ein Ausfall des Servers verliert keine Mail.
 *
 * vereinId setzt nur, wer einen schlichten Client hat. vereinDb setzt den Verein
 * selbst und lehnt ihn im data ab -- auch als undefined, darum der bedingte Eintrag.
 */
export async function legeMailAn(
	tx: MitMailWarteschlange,
	m: { vereinId?: string; empfaenger: string; betreff: string; text: string; bezug?: string; jetzt: Date },
): Promise<void> {
	await tx.mailWarteschlange.create({
		data: {
			...(m.vereinId === undefined ? {} : { vereinId: m.vereinId }),
			empfaenger: m.empfaenger,
			betreff: m.betreff,
			text: m.text,
			...(m.bezug === undefined ? {} : { bezug: m.bezug }),
			// Faellig ab sofort, aber nach der Uhr des Aufrufers statt der der Datenbank:
			// Tests mit fester Uhr sehen so denselben Zeitpunkt wie der Arbeiter.
			naechsterVersuch: m.jetzt,
		},
	});
}
