import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TESTEREIGNISSE } from '../daten/ereignisse';
import { EntwurfStore } from '../daten/store';
import type { TerminModul, Thread } from '../daten/typen';
import { herunterladen } from '../gestaltung/herunterladen';
import { IconComponent } from '../gestaltung/icon';
import { pfadZuThread } from '../mitglieder/pfade';
import { alsIcs, googleLink, kalenderEintrag } from '../regeln/kalender';
import { threadPfad } from '../regeln/teilen';

/**
 * "In Kalender eintragen" (Spec 2026-10-12, 3.4) klappt zwei Wege auf, statt
 * das Geraet zu erkennen: Android mit Samsung-Kalender braucht die .ics,
 * iPhone mit Google-Kalender den Link, und eine Erkennung bricht bei
 * Browser-Updates. Google als a mit target statt window.open: so oeffnet
 * Android ueber App-Links die Kalender-App, und keine Popup-Sperre greift.
 */
@Component({
	selector: 'jf-kalender-knopf',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<button
			type="button"
			class="knopf leise"
			[attr.aria-expanded]="offen()"
			[disabled]="vorschau()"
			(click)="offen.set(!offen())"
		>
			<jf-icon name="kalender" /> In Kalender eintragen
		</button>
		@if (offen()) {
			<div class="wege">
				<button type="button" class="knopf" (click)="telefon()">Kalender des Telefons</button>
				<a class="knopf" [href]="google()" target="_blank" rel="noopener" (click)="melden('google')">Google Kalender</a>
			</div>
		}
	`,
	styles: `
		:host {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: var(--a2);
			margin-top: var(--a2);
		}
		.wege {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: var(--a2);
			max-width: 100%;
		}
		.knopf {
			max-width: 100%;
		}
		a.knopf {
			text-decoration: none;
			color: inherit;
		}
	`,
})
export class KalenderKnopf {
	readonly thread = input.required<Thread>();
	readonly modul = input.required<TerminModul>();
	readonly vorschau = input(false);

	private readonly store = inject(EntwurfStore);
	private readonly dokument = inject(DOCUMENT);
	private readonly ereignisse = inject(TESTEREIGNISSE);
	protected readonly offen = signal(false);

	/**
	 * Die Testpersonen tragen erfundene Termine in ihre echten, oft mit der
	 * Familie geteilten Kalender ein. Ohne Kennzeichnung saehe "Zeltlager 2027"
	 * Monate spaeter wie ein echter Termin der Jugendgruppe aus. Nur im Entwurf;
	 * die Regel kalenderEintrag bleibt dafuer frei.
	 */
	private readonly eintrag = computed(() => {
		const pfad = pfadZuThread(this.store.stand(), this.thread().id, this.modul().id);
		const e = kalenderEintrag(this.modul(), this.thread().titel, `${this.dokument.location.origin}/entwurf${pfad}`);
		return {
			...e,
			titel: `[Entwurf] ${e.titel}`,
			beschreibung: `Testeintrag aus dem JuFi-Entwurf – kann gelöscht werden.\n${e.beschreibung}`,
		};
	});
	protected readonly google = computed(() => googleLink(this.eintrag()));

	/** Die UID haengt nur am Termin-Modul, damit erneutes Eintragen moeglichst aktualisiert statt verdoppelt. */
	protected telefon(): void {
		const slug = this.store.stand().verein.slug;
		const ics = alsIcs(this.eintrag(), `${slug}-${this.modul().id}@jufi-app.de`, this.store.jetzt());
		const datei = `${threadPfad(this.thread(), slug).split('/').at(-1)}.ics`;
		herunterladen(this.dokument, datei, ics, 'text/calendar;charset=utf-8');
		this.melden('ics');
	}

	protected melden(weg: 'ics' | 'google'): void {
		if (this.vorschau()) return;
		this.ereignisse.next({ art: 'kalenderEingetragen', threadId: this.thread().id, modulId: this.modul().id, weg });
		this.offen.set(false);
	}
}
