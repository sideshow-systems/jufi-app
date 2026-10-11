import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import { IconComponent } from '../gestaltung/icon';
import { ThreadTeilen } from '../gestaltung/teilen-aktion';
import { zielgruppeText } from '../gestaltung/texte';
import { KarteComponent } from '../gestaltung/ui';
import { ModulWeiche } from '../module/modul';
import { VerlaufBauteil } from '../module/verlauf';
import { threadZuNr } from '../regeln/sichtbarkeit';
import { NichtGefunden } from './nicht-gefunden';

/**
 * Nummer aus dem Adress-Segment "2-bowling". Nur die Nummer zaehlt (Rahmen
 * 5.4): ein spaeter geaenderter Titel macht alte Links nicht ungueltig.
 */
export function nrAusSegment(seg: string): number | null {
	const treffer = /^(\d+)(?:-|$)/.exec(seg);
	return treffer ? Number(treffer[1]) : null;
}

/** Thread mit Reitern Uebersicht und Verlauf (Spec TP1 4.2). */
@Component({
	selector: 'jf-thread',
	imports: [RouterLink, IconComponent, KarteComponent, ModulWeiche, VerlaufBauteil, NichtGefunden],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (thread(); as t) {
			<header>
				<a class="knopf leise nur-icon" routerLink="../.." aria-label="Zurück zu den Threads">
					<jf-icon name="zurueck" />
				</a>
				<div class="titel">
					<h1>{{ t.titel }}</h1>
					<span class="gedaempft klein">{{ zielgruppe() }}</span>
				</div>
				<button type="button" class="knopf leise nur-icon" aria-label="Teilen" (click)="teilen()">
					<jf-icon name="teilen" />
				</button>
			</header>

			@if (mitVerlauf()) {
				<nav class="reiter" aria-label="Ansicht">
					<a
						[routerLink]="[]"
						[queryParams]="{ reiter: null }"
						[class.aktiv]="!zeigtVerlauf()"
						[attr.aria-current]="!zeigtVerlauf() ? 'page' : null"
						>Übersicht</a
					>
					<a
						[routerLink]="[]"
						[queryParams]="{ reiter: 'verlauf' }"
						[class.aktiv]="zeigtVerlauf()"
						[attr.aria-current]="zeigtVerlauf() ? 'page' : null"
					>
						Verlauf
						@if (neueImVerlauf()) {
							<span class="zahl">{{ neueImVerlauf() }}</span>
						}
					</a>
				</nav>
			}

			@if (zeigtVerlauf()) {
				<jf-verlauf [thread]="t" [seit]="seit()" />
			} @else {
				<div class="module">
					@for (m of t.module; track m.id) {
						<jf-karte [id]="'modul-' + m.id" [class.hervor]="hervor() === m.id">
							<jf-modul [thread]="t" [modul]="m" />
						</jf-karte>
					}
				</div>
			}
		} @else {
			<jf-nicht-gefunden />
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		header {
			display: flex;
			align-items: center;
			gap: var(--a2);
		}
		.titel {
			flex: 1;
			min-width: 0;
		}
		h1 {
			margin: 0;
			font-size: var(--schrift-gross);
			overflow-wrap: anywhere;
		}
		.reiter {
			display: grid;
			grid-template-columns: 1fr 1fr;
			padding: 4px;
			border-radius: var(--radius-pille);
			background: var(--karte);
			border: 1px solid var(--linie);
		}
		.reiter a {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: var(--a2);
			min-height: var(--tippflaeche);
			border-radius: var(--radius-pille);
			color: var(--text-gedaempft);
			font-weight: 600;
			text-decoration: none;
		}
		.reiter a.aktiv {
			background: var(--akzent);
			color: var(--auf-akzent);
		}
		.zahl {
			min-width: 20px;
			padding: 0 6px;
			border-radius: var(--radius-pille);
			background: var(--akzent-flaeche);
			color: var(--akzent);
			font-size: var(--schrift-klein);
			text-align: center;
		}
		.module {
			display: grid;
			gap: var(--a3);
		}
		jf-karte {
			scroll-margin-top: calc(72px + max(var(--band-hoehe), var(--sicher-oben)));
			transition: box-shadow 0.3s;
		}
		jf-karte.hervor {
			box-shadow: 0 0 0 3px var(--akzent);
		}
	`,
})
export class ThreadSeite {
	/** Aus der Route t/:nrSlug, z. B. "2-bowling". */
	readonly nrSlug = input<string>('');
	/** Aus der Route t/:nrSlug/m/:modulId. */
	readonly modulId = input<string | undefined>(undefined);
	/** Query-Parameter, damit ein Link direkt den Verlauf oeffnen kann. */
	readonly reiter = input<string | undefined>(undefined);

	private readonly store = inject(EntwurfStore);
	private readonly teiler = inject(ThreadTeilen);
	private readonly dokument = inject(DOCUMENT);

	protected readonly thread = computed(() => {
		const nr = nrAusSegment(this.nrSlug());
		return nr === null ? undefined : threadZuNr(this.store.stand(), this.store.ich(), nr);
	});
	protected readonly zielgruppe = computed(() => zielgruppeText(this.store.stand(), this.thread()!.zielgruppe));
	protected readonly mitVerlauf = computed(() => this.thread()?.modus !== 'aushang');
	protected readonly zeigtVerlauf = computed(() => this.mitVerlauf() && this.reiter() === 'verlauf');
	protected readonly seit = computed(() => this.store.stand().letzterBesuch[this.store.ich()]);
	protected readonly neueImVerlauf = computed(() => {
		const seit = this.seit();
		const ich = this.store.ich();
		return (this.thread()?.verlauf ?? []).filter((e) => (!seit || e.zeit > seit) && e.von !== ich).length;
	});
	protected readonly hervor = signal<string | null>(null);

	constructor() {
		const titel = inject(Title);
		effect(() => {
			const t = this.thread();
			titel.setTitle(t ? `${t.titel} · JuFi Entwurf` : 'Nicht gefunden · JuFi Entwurf');
		});

		// Deep Link auf ein Modul: hinscrollen und kurz hervorheben, sobald es gezeichnet ist.
		effect((aufraeumen) => {
			const id = this.modulId();
			if (!id || !this.thread() || this.zeigtVerlauf()) return;
			const uhr = setTimeout(() => {
				this.dokument.getElementById(`modul-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
				this.hervor.set(id);
			});
			const aus = setTimeout(() => this.hervor.set(null), 2000);
			aufraeumen(() => {
				clearTimeout(uhr);
				clearTimeout(aus);
			});
		});
	}

	protected teilen(): void {
		const t = this.thread();
		if (t) void this.teiler.teilen(t);
	}
}
