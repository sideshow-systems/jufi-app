import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import {
	alsIcs,
	geraetAus,
	googleKalenderLink,
	kalenderEintrag,
	kartenLink,
	type ModulAnsicht,
	terminZeit,
	threadSegment,
} from '@jufi/domain';
import { herunterladen } from '../../gestaltung/herunterladen';
import { IconComponent } from '../../gestaltung/icon';

/**
 * Zeit, Ort mit Karten-Link, Treffpunkt und "In Kalender eintragen" (Spec 6.3, FAM 3.3 und 3.4).
 *
 * Der Kalenderknopf klappt zwei Wege auf, statt das Geraet zu erkennen: Android mit
 * Samsung-Kalender braucht die .ics, ein iPhone mit Google-Kalender den Link, und eine Erkennung
 * bricht bei Browser-Updates (Erkenntnis aus dem Entwurf). Google als a mit target statt
 * window.open: So oeffnet Android ueber App-Links die Kalender-App, und keine Popup-Sperre greift.
 * Beim Karten-Link dagegen entscheidet das Geraet, weil dort jedes System seine eigene App hat.
 */
@Component({
	selector: 'jf-termin-modul',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (modul().titel; as titel) {
			<h2>{{ titel }}</h2>
		}
		<p class="zeile"><jf-icon name="kalender" /> {{ zeit() }}</p>
		@if (modul().termin.ort; as ort) {
			<p class="zeile">
				<jf-icon name="ort" />
				<a [href]="karte()" [attr.target]="karteImBrowser() ? '_blank' : null" rel="noopener">{{ ort }}</a>
			</p>
		}
		@if (modul().termin.treffpunkt; as treffpunkt) {
			<p class="treffpunkt gedaempft">Treffpunkt: {{ treffpunkt }}</p>
		}
		<div class="kalender">
			<button type="button" class="knopf leise" [attr.aria-expanded]="offen()" (click)="offen.set(!offen())">
				<jf-icon name="kalender" /> In Kalender eintragen
			</button>
			@if (offen()) {
				<div class="wege">
					<button type="button" class="knopf" (click)="telefon()">Kalender des Telefons</button>
					<a class="knopf" [href]="google()" target="_blank" rel="noopener" (click)="offen.set(false)"
						>Google Kalender</a
					>
				</div>
			}
		</div>
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a1);
		}
		h2 {
			margin: 0 0 var(--a1);
			font-size: var(--schrift);
		}
		p {
			margin: 0;
		}
		.zeile {
			display: flex;
			align-items: center;
			gap: var(--a2);
			min-width: 0;
		}
		.zeile jf-icon {
			flex: none;
			color: var(--akzent);
		}
		.zeile a {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
			min-width: 0;
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		.treffpunkt {
			overflow-wrap: anywhere;
		}
		.kalender,
		.wege {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: var(--a2);
			max-width: 100%;
		}
		.kalender {
			margin-top: var(--a2);
		}
		.knopf {
			max-width: 100%;
		}
	`,
})
export class TerminModul {
	readonly modul = input.required<Extract<ModulAnsicht, { typ: 'TERMIN' }>>();
	/** Nur Id und Titel: Sie geben Dateiname, Kalendertitel und den Rueckweg in die App. */
	readonly thread = input.required<{ id: string; titel: string }>();
	readonly slug = input.required<string>();

	private readonly dokument = inject(DOCUMENT);
	protected readonly offen = signal(false);

	protected readonly zeit = computed(() => terminZeit(this.modul().termin));

	protected readonly karte = computed(() => {
		const ort = this.modul().termin.ort;
		return ort ? kartenLink(ort, geraetAus(this.dokument.defaultView?.navigator.userAgent ?? '')) : null;
	});

	/**
	 * Nur der Google-Link geht in ein neues Fenster. maps: und geo: oeffnen die Karten-App; mit
	 * target bliebe davor ein leerer Tab stehen, auf dem iPhone samt Rueckfrage.
	 */
	protected readonly karteImBrowser = computed(() => this.karte()?.startsWith('https:') ?? false);

	/**
	 * Der Rueckweg ist die kurze Modul-Adresse ohne Titelteil: Sie bleibt gueltig, wenn der Thread
	 * umbenannt wird, und die Seite schreibt den Titel beim Oeffnen selbst nach.
	 */
	private readonly eintrag = computed(() => {
		const t = this.thread();
		const m = this.modul();
		const link = `${this.dokument.location.origin}/${encodeURIComponent(this.slug())}/t/${t.id}/m/${m.id}`;
		return kalenderEintrag(m.termin, t.titel, m.titel, link);
	});

	protected readonly google = computed(() => googleKalenderLink(this.eintrag()));

	/** Die UID haengt nur am Modul, damit erneutes Eintragen den Eintrag aktualisiert statt ihn zu verdoppeln. */
	protected telefon(): void {
		const t = this.thread();
		const ics = alsIcs(this.eintrag(), `${this.modul().id}@jufi-app.de`, new Date());
		herunterladen(this.dokument, `${threadSegment(t.id, t.titel)}.ics`, ics, 'text/calendar;charset=utf-8');
		this.offen.set(false);
	}
}
