import { DOCUMENT } from '@angular/common';
import {
	afterRenderEffect,
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	ElementRef,
	inject,
	linkedSignal,
} from '@angular/core';
import { EntwurfStore } from '../daten/store';
import { MeldungService } from '../gestaltung/meldung';
import { aktuellerPfad } from './ort';
import { TM_STIL } from './stil';
import { TestmodusService } from './testmodus';

function gemischt<T>(liste: T[]): T[] {
	const l = [...liste];
	for (let i = l.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[l[i], l[j]] = [l[j], l[i]];
	}
	return l;
}

/**
 * Aufgabenband (Spec TP1 5.2): oben fixiert, die Huellen ruecken per
 * --band-hoehe darunter, damit es nichts verdeckt. Die Hoehe misst ein
 * ResizeObserver, weil lange Aufgaben am Handy zweizeilig umbrechen.
 */
@Component({
	selector: 'jf-band',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (sichtbar()) {
			@let a = aufgabe()!;
			<section class="band" aria-label="Testaufgabe" aria-live="polite">
				<p>
					<strong>Aufgabe {{ nummer() }} von {{ anzahl() }}:</strong>
					{{ a.text }}
				</p>
				@if (antworten(); as liste) {
					<div class="antworten" role="group" aria-label="Deine Antwort">
						@for (t of liste; track t) {
							<button type="button" class="tm-knopf leise" (click)="antworten.set(null); waehle(t)">{{ t }}</button>
						}
					</div>
				}
				<div class="knoepfe">
					@if (a.art === 'suche' && !antworten()) {
						<button type="button" class="tm-knopf hell" (click)="habIch()">Ich hab's</button>
					}
					<button type="button" class="tm-knopf rand" (click)="testmodus.dialog.set({ art: 'nichtWeiter' })">
						Ich komme nicht weiter
					</button>
					<button type="button" class="tm-knopf rand" (click)="testmodus.ueberspringen()">Überspringen</button>
				</div>
			</section>
		}
	`,
	styles: [
		TM_STIL,
		`
			:host {
				position: fixed;
				z-index: 100;
				top: 0;
				left: 0;
				right: 0;
			}
			.band {
				display: grid;
				gap: var(--a2);
				padding: calc(var(--sicher-oben) + var(--a2)) calc(var(--a3) + var(--sicher-rechts)) var(--a2)
					calc(var(--a3) + var(--sicher-links));
				background: var(--tm);
				color: var(--auf-tm);
				font-size: var(--schrift-klein);
				box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
			}
			p {
				margin: 0;
				max-width: 720px;
			}
			.knoepfe,
			.antworten {
				display: flex;
				flex-wrap: wrap;
				gap: var(--a2);
			}
			.tm-knopf {
				padding: 0 var(--a3);
				font-size: var(--schrift-klein);
			}
			.tm-knopf.rand {
				border-color: rgb(255 255 255 / 0.6);
				background: transparent;
			}
			.tm-knopf.hell {
				background: var(--auf-tm);
				color: var(--tm);
			}
			.tm-knopf.leise {
				background: var(--auf-tm);
				color: #4c1d95;
			}
		`,
	],
})
export class Band {
	protected readonly testmodus = inject(TestmodusService);
	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);
	private readonly pfad = aktuellerPfad();

	protected readonly aufgabe = this.testmodus.aktuelleAufgabe;
	protected readonly sichtbar = computed(() => !!this.aufgabe() && !this.pfad().includes('/willkommen'));
	protected readonly nummer = computed(() => this.testmodus.index() + 1);
	protected readonly anzahl = computed(() => this.testmodus.aufgaben().length);
	/** Die drei Antworten einer Suchaufgabe, einmal gemischt beim Oeffnen; neue Aufgabe schliesst sie. */
	protected readonly antworten = linkedSignal<string | undefined, string[] | null>({
		source: () => this.aufgabe()?.id,
		computation: () => null,
	});

	constructor() {
		const wurzel = inject(DOCUMENT).documentElement;
		const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
		const setzen = () => wurzel.style.setProperty('--band-hoehe', `${host.getBoundingClientRect().height}px`);
		if (typeof ResizeObserver !== 'undefined') {
			const beobachter = new ResizeObserver(setzen);
			beobachter.observe(host);
			inject(DestroyRef).onDestroy(() => {
				beobachter.disconnect();
				wurzel.style.removeProperty('--band-hoehe');
			});
		}
		// Ohne ResizeObserver (und vor dessen erstem Aufruf) nach jedem Zeichnen messen.
		afterRenderEffect(() => {
			this.sichtbar();
			this.antworten();
			setzen();
		});
	}

	protected habIch(): void {
		const a = this.aufgabe();
		if (a?.art !== 'suche') return;
		const { richtig, falsch } = a.antworten(this.store.stand());
		this.antworten.set(gemischt([richtig, ...falsch]));
	}

	protected waehle(text: string): void {
		if (!this.testmodus.sucheBeantworten(text)) this.meldung.zeige('Nicht ganz, schau nochmal');
	}
}
