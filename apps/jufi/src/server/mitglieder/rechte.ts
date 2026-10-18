import { sperreVereinszeile, type Recht } from '@jufi/db';
import { ALLE_RECHTE, darfRechteAendern, hatRecht, wuerdeLetzteLeitungVerlieren, type RechtName } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron } from '../admin/asynchron.js';
import { vereinsKontext } from '../verein.js';
import { brauchtMitglied, mitgliedKontext } from './sitzung.js';
import { alsSicht, statt404 } from './verwaltung.js';

const LETZTE_LEITUNG = {
	fehler: 'Der Verein braucht mindestens eine Person mit Recht zum Vergeben von Rechten',
	code: 'LETZTE_LEITUNG',
};

/** Ende einer Entscheidung unter der Sperre; innerhalb der Transaktion geworfen, damit nichts halb bleibt. */
class Abbruch extends Error {
	constructor(
		readonly status: number,
		readonly antwort: object,
	) {
		super('Rechte abgebrochen');
	}
}

export function rechteRouten(router: Router, _deps: VolleAppDeps): void {
	router.put(
		'/personen/:id/rechte',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person: handelnder } = mitgliedKontext(res);
			// Vor jeder Pruefung des Bodys: wer Rechte nicht vergeben darf, erfaehrt auch nicht, was gueltig waere.
			// Gilt ebenso fuer den Selbstversuch -- wer JUGENDLEITER_RECHTE nicht hat, kann sie sich nicht geben.
			if (!hatRecht(handelnder, 'JUGENDLEITER_RECHTE')) {
				return statt404(res);
			}
			const roh = ((req.body ?? {}) as Record<string, unknown>)['rechte'];
			if (!Array.isArray(roh) || !roh.every((r) => ALLE_RECHTE.includes(r as RechtName))) {
				return void res.status(400).json({ fehler: 'Eine Liste bekannter Rechte erwartet', feld: 'rechte' });
			}
			const rechte = [...new Set(roh as RechtName[])];
			const { verein, db } = vereinsKontext(res);
			const zielId = req.params['id'] ?? '';
			try {
				await db.$transaction(async (tx) => {
					// Sperre statt Serializable (Plan-Entscheidung 1; Serializable verwarf schon Etappe 1: es
					// liesse gleichzeitige Anfragen mit Serialisierungsfehlern scheitern und der Aufrufer
					// muesste wiederholen). Die Sperre reiht sie hintereinander.
					await sperreVereinszeile(tx, verein.id);
					// Die Personen werden erst jetzt gelesen: ein Stand aus ladeUmfeld vor der Sperre waere
					// veraltet, sobald eine andere Anfrage zwischen Lesen und Sperre Rechte entzogen hat --
					// beide sahen dann den jeweils anderen noch als Leitung.
					const erwachsene = await tx.person.findMany({ where: { art: 'ERWACHSENER', entferntAm: null } });
					// Auch der Handelnde wird hier neu bewertet: der Stand aus der Sitzung stammt von vor der
					// Sperre. Hat eine andere Anfrage ihm das Recht inzwischen entzogen (oder ihn entfernt),
					// ergaebe sich sonst ein Ablauf, den keine serielle Reihenfolge erzeugt: sein Schreiben
					// hebelte den Entzug aus. Die Vorpruefung oben bleibt, damit Unberechtigte nichts erfahren.
					const ich = erwachsene.find((p) => p.id === handelnder.id);
					const ziel = erwachsene.find((p) => p.id === zielId);
					if (!ich || !ziel || !darfRechteAendern(alsSicht(ich), alsSicht(ziel), rechte)) {
						throw new Abbruch(404, { fehler: 'nicht gefunden' });
					}
					if (wuerdeLetzteLeitungVerlieren(erwachsene.map(alsSicht), zielId, rechte)) {
						throw new Abbruch(409, LETZTE_LEITUNG);
					}
					await tx.person.update({ where: { id: zielId }, data: { rechte: rechte as Recht[] } });
				});
				res.json({ rechte });
			} catch (error) {
				if (error instanceof Abbruch) return void res.status(error.status).json(error.antwort);
				throw error;
			}
		}),
	);
}
