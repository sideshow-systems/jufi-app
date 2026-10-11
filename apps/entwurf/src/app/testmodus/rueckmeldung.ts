import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { MeldungService } from '../gestaltung/meldung';
import { ThemaService } from '../gestaltung/thema';
import { AUFGABEN } from './aufgaben';
import { TM_STIL } from './stil';
import { TestmodusService } from './testmodus';
import type { Ergebnis, PersonKey, TestmodusStand } from './typen';
import { versenden, type Versandweg } from './versand';

const NAMEN: Record<PersonKey, string> = { sandra: 'Sandra', lena: 'Lena', thomas: 'Thomas' };
const SMILEY: Record<NonNullable<Ergebnis['smiley']>, string> = { gut: '😀', mittel: '😐', schlecht: '😟' };
const AUSGANG: Record<Ergebnis['ausgang'], string> = {
	geschafft: '✅',
	nichtWeiter: '❌ nicht weiter',
	uebersprungen: '⏭ übersprungen',
};

const dauer = (sek: number) => `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, '0')}`;
const zitat = (t: string) => `„${t}"`;

/**
 * Geraetezeile aus dem User-Agent, grob (Spec TP1 5.5): Geraetetyp, Browser,
 * Hell/Dunkel. Mehr nicht — keine Versionen, keine Kennungen.
 */
export function geraeteZeile(userAgent: string, dunkel: boolean): string {
	const ua = userAgent;
	const geraet = /iPhone/.test(ua)
		? 'iPhone'
		: /iPad/.test(ua)
			? 'iPad'
			: /Android/.test(ua)
				? 'Android'
				: /Macintosh|Mac OS X/.test(ua)
					? 'Mac'
					: /Windows/.test(ua)
						? 'Windows'
						: /Linux/.test(ua)
							? 'Linux'
							: null;
	// Reihenfolge zaehlt: Edge und Chrome nennen auch "Safari", Chrome auf iOS heisst CriOS.
	const browser = /Edg\//.test(ua)
		? 'Edge'
		: /SamsungBrowser/.test(ua)
			? 'Samsung Internet'
			: /Firefox\/|FxiOS/.test(ua)
				? 'Firefox'
				: /Chrome\/|CriOS/.test(ua)
					? 'Chrome'
					: /Safari\//.test(ua)
						? 'Safari'
						: null;
	const modus = dunkel ? 'dunkel' : 'hell';
	return geraet ? [geraet, browser, modus].filter(Boolean).join(' · ') : `Gerät unbekannt · ${modus}`;
}

function ergebnisZeile(k: PersonKey, e: Ergebnis): string {
	const i = AUFGABEN[k].findIndex((a) => a.id === e.aufgabeId);
	const kurz = AUFGABEN[k][i]?.kurz ?? e.aufgabeId;
	const teile = [String(i + 1), AUSGANG[e.ausgang]];
	if (e.smiley) teile.push(SMILEY[e.smiley]);
	teile.push(dauer(e.dauerSek), kurz);
	let zeile = teile.join(' ');
	if (e.fehlversuche > 0) zeile += ` (${e.fehlversuche} ${e.fehlversuche === 1 ? 'Fehlversuch' : 'Fehlversuche'})`;
	if (e.notiz) zeile += ` – ${zitat(e.notiz)}`;
	return zeile;
}

/** Der WhatsApp-Text der Rueckmeldung, Format nach Spec TP1 5.5. */
export function rueckmeldungText(z: TestmodusStand, geraet: string): string {
	const zeilen = ['📝 *JuFi-Entwurf – Rückmeldung*', `Gerät: ${geraet}`];
	const personen = (Object.keys(NAMEN) as PersonKey[]).filter((k) => z.ergebnisse[k]?.length);
	for (const k of personen) {
		zeilen.push(`*${NAMEN[k]}*`, ...z.ergebnisse[k].map((e) => ergebnisZeile(k, e)));
	}
	if (!personen.length) zeilen.push('Noch keine Aufgaben gespielt.');
	zeilen.push(...z.seitenNotizen.map((n) => `📍 ${n.pfad}: ${zitat(n.text)}`));
	if (z.wunsch) zeilen.push(`💬 Sonst noch: ${zitat(z.wunsch)}`);
	return zeilen.join('\n');
}

const MELDUNG: Record<Versandweg, string | null> = {
	whatsapp: 'WhatsApp ist offen – bitte dort noch auf Senden tippen',
	geteilt: 'Danke für deine Rückmeldung!',
	kopiert: 'Text kopiert – füg ihn in WhatsApp an Florian ein',
	abgebrochen: null,
	fehler: 'Senden hat nicht geklappt – versuch es bitte nochmal',
};

/** Dialog "Rueckmeldung senden": Vorschau, Wunschfeld, Versand. */
@Component({
	selector: 'jf-rueckmeldung',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 id="tm-titel">Rückmeldung senden</h2>
		@if (fertig()) {
			<p>Danke! Du hast alle Aufgaben für {{ name() }} durch.</p>
		}
		<label class="feld">
			Was würdest du dir noch wünschen?
			<textarea name="wunsch" rows="3" [value]="wunsch()" (input)="wunschAendern($event)"></textarea>
		</label>
		<details>
			<summary>So sieht die Nachricht aus</summary>
			<pre>{{ text() }}</pre>
		</details>
		<button type="button" class="tm-knopf" [disabled]="sendet()" (click)="senden()">An Florian schicken</button>
		<button type="button" class="tm-knopf leise" (click)="schliessen.emit()">Später</button>
	`,
	styles: [
		TM_STIL,
		`
			:host {
				display: contents;
			}
			h2 {
				margin: 0;
				font-size: var(--schrift-gross);
			}
			p {
				margin: 0;
			}
			summary {
				min-height: var(--tippflaeche);
				display: flex;
				align-items: center;
				cursor: pointer;
				font-weight: 600;
			}
			pre {
				margin: 0;
				padding: var(--a3);
				border-radius: var(--radius-klein);
				background: var(--seite);
				font-family: inherit;
				font-size: var(--schrift-klein);
				white-space: pre-wrap;
				overflow-wrap: anywhere;
			}
			textarea {
				resize: vertical;
			}
		`,
	],
})
export class RueckmeldungDialog {
	readonly schliessen = output<void>();

	private readonly testmodus = inject(TestmodusService);
	private readonly thema = inject(ThemaService);
	private readonly meldung = inject(MeldungService);

	protected readonly sendet = signal(false);
	protected readonly wunsch = computed(() => this.testmodus.zustand().wunsch ?? '');
	protected readonly name = computed(() => {
		const p = this.testmodus.zustand().person;
		return p ? NAMEN[p] : '';
	});
	protected readonly fertig = computed(
		() => this.testmodus.aufgaben().length > 0 && this.testmodus.index() >= this.testmodus.aufgaben().length,
	);
	protected readonly text = computed(() =>
		rueckmeldungText(this.testmodus.zustand(), geraeteZeile(navigator.userAgent, this.thema.aktiv() === 'dunkel')),
	);

	protected wunschAendern(e: Event): void {
		this.testmodus.wunschSetzen((e.target as HTMLTextAreaElement).value);
	}

	protected async senden(): Promise<void> {
		this.sendet.set(true);
		try {
			const weg = await versenden(this.text());
			const text = MELDUNG[weg];
			if (text) this.meldung.zeige(text);
			if (weg !== 'abgebrochen' && weg !== 'fehler') this.schliessen.emit();
		} finally {
			this.sendet.set(false);
		}
	}
}
