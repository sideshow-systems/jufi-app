import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	ElementRef,
	inject,
	input,
	linkedSignal,
	output,
	signal,
	viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import type { FotoZeile } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { BestaetigungComponent } from '../../admin/bestaetigung';
import { alsApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { IconComponent } from '../../gestaltung/icon';
import { dateiAdresse } from '../dateien-anzeige';
import { DateienApi } from '../dateien-api';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';

/** Ab dieser waagerechten Strecke (in px) zaehlt eine Bewegung als Wischen und nicht als Antippen. */
const WISCH_SCHWELLE = 50;

/** Je Ansicht eigene id fuer aria-labelledby, falls je zwei zugleich im DOM stuenden. */
let naechsteId = 0;

/**
 * Ein Foto in voller Groesse ueber der ganzen Seite, mit Blaettern, Speichern und (mit Recht) Loeschen.
 *
 * Eine Ueberlagerung statt des nativen dialog-Elements mit showModal, aus demselben Grund wie in
 * jf-bestaetigung: jsdom kennt showModal nicht, die Tests liefen gegen etwas anderes als der Browser.
 * Dafuer gehoert die Fokusfuehrung hierher: Beim Oeffnen landet der Fokus auf Schliessen, Tab bleibt
 * im Dialog, und beim Schliessen kehrt er zu dem Element zurueck, das ihn davor hatte (dem
 * angetippten Vorschaubild). Das merkt sich die Ansicht selbst, statt dass die Kachel es abfragen muss.
 *
 * Wischen laeuft ueber Pointer-Events und nicht ueber Touch-Events: Eine Quelle fuer Finger, Stift
 * und Maus. Die Buehne sperrt dafuer das senkrechte Scrollen nicht (touch-action: pan-y), aber das
 * waagerechte, sonst bricht der Browser die Bewegung nach ein paar Pixeln mit pointercancel ab.
 *
 * Verworfen: Vor- und Zurueck-Knoepfe am Bild. Geblaettert wird mit Pfeiltasten und Wischen; ein Knopf,
 * der am ersten und letzten Foto verschwindet, risse dabei den Fokus mit.
 */
@Component({
	selector: 'jf-foto-grossansicht',
	imports: [BestaetigungComponent, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown)': 'taste($event)' },
	template: `
		@if (foto(); as f) {
			<div
				#dialog
				class="dialog"
				role="dialog"
				aria-modal="true"
				[attr.aria-labelledby]="titelId"
				tabindex="-1"
				(keydown)="tabulator($event)"
			>
				<div
					class="buehne"
					(pointerdown)="beginneWischen($event)"
					(pointerup)="beendeWischen($event)"
					(pointercancel)="startX = null"
				>
					<img class="gross" [src]="adresse(f.id)" [alt]="'Foto von ' + f.von" draggable="false" />
				</div>
				<div class="leiste">
					<p [id]="titelId" class="name">Foto von {{ f.von }}</p>
					@if (fehler(); as text) {
						<p class="fehler" role="alert">{{ text }}</p>
					}
					<div class="knoepfe">
						<button type="button" class="knopf" [disabled]="laeuft()" (click)="speichere(f)">Speichern</button>
						@if (f.darfLoeschen) {
							<button type="button" class="knopf" [disabled]="laeuft()" (click)="frage.set(true)">Löschen</button>
						}
						<button #schliessenKnopf type="button" class="knopf primaer" (click)="schliessen.emit()">
							<jf-icon name="schliessen" /> Schließen
						</button>
					</div>
				</div>
			</div>
			@if (frage()) {
				<jf-bestaetigung
					titel="Foto löschen"
					[text]="'Das Foto von ' + f.von + ' löschen?'"
					bestaetigung="Löschen"
					(bestaetigt)="loesche(f)"
					(abgebrochen)="frage.set(false)"
				/>
			}
		}
	`,
	styles: `
		/* Fest ueber der ganzen Seite und ueber der unteren Leiste; die Rueckfrage (z-index 50) liegt darueber. */
		:host {
			position: fixed;
			inset: 0;
			z-index: 40;
			display: block;
		}
		/* Dunkel in beiden Themen: Ein Foto wirkt auf Weiss nicht, und der Rand soll nicht mitleuchten. */
		.dialog {
			display: grid;
			grid-template-rows: minmax(0, 1fr) auto;
			width: 100%;
			height: 100%;
			background: rgb(0 0 0 / 0.94);
			color: #fff;
			overscroll-behavior: contain;
		}
		.dialog:focus {
			outline: none;
		}
		.buehne {
			display: grid;
			min-height: 0;
			padding: var(--a3);
			touch-action: pan-y;
			user-select: none;
		}
		.gross {
			width: 100%;
			height: 100%;
			min-width: 0;
			min-height: 0;
			object-fit: contain;
		}
		.leiste {
			display: grid;
			gap: var(--a2);
			padding: var(--a3) var(--a4) max(var(--a4), env(safe-area-inset-bottom));
		}
		p {
			margin: 0;
		}
		.name {
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		.fehler {
			padding: var(--a2) var(--a3);
			border-radius: var(--radius-klein);
			background: var(--fehler-flaeche);
			color: var(--fehler);
		}
		.knoepfe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
		}
	`,
})
export class FotoGrossansichtComponent {
	readonly slug = input.required<string>();
	readonly fotos = input.required<FotoZeile[]>();
	/** Das Foto, mit dem die Ansicht aufgeht; geblaettert wird danach in der Ansicht selbst. */
	readonly index = input.required<number>();
	readonly schliessen = output<void>();
	/** Das Foto ist auf dem Server geloescht; der Elternteil laedt neu und schliesst. */
	readonly geloescht = output<void>();

	private readonly api = inject(DateienApi);
	private readonly router = inject(Router);

	protected readonly titelId = `foto-gross-titel-${naechsteId++}`;
	protected readonly frage = signal(false);
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<string | null>(null);
	protected startX: number | null = null;
	private startY = 0;
	/** Eine Antwort, die erst nach dem Schliessen eintrifft, soll nichts mehr ausloesen. */
	private weg = false;

	/**
	 * Wo die Ansicht steht. Aendert sich die Liste unter ihr (die Seite laedt nach einer fremden
	 * Aenderung neu), bleibt sie bei ihrem Foto, statt beim Index zu bleiben und ploetzlich ein
	 * anderes zu zeigen; ist das Foto weg, rueckt sie auf den Nachbarn.
	 */
	protected readonly position = linkedSignal<{ index: number; fotos: FotoZeile[] }, number>({
		source: () => ({ index: this.index(), fotos: this.fotos() }),
		computation: (quelle, vorher) => {
			if (!vorher || quelle.index !== vorher.source.index) return quelle.index;
			const id = vorher.source.fotos[vorher.value]?.id;
			const neu = quelle.fotos.findIndex((f) => f.id === id);
			return neu >= 0 ? neu : Math.min(vorher.value, quelle.fotos.length - 1);
		},
	});
	protected readonly foto = computed(() => this.fotos()[this.position()] ?? null);

	private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
	private readonly schliessenKnopf = viewChild<ElementRef<HTMLButtonElement>>('schliessenKnopf');

	constructor() {
		const davor = document.activeElement;
		afterNextRender(() => this.schliessenKnopf()?.nativeElement.focus());
		inject(DestroyRef).onDestroy(() => {
			this.weg = true;
			if (davor instanceof HTMLElement && davor.isConnected) davor.focus();
		});
	}

	protected adresse(id: string): string {
		return dateiAdresse(this.slug(), id);
	}

	/**
	 * Escape und Pfeile gelten auf dem ganzen Dokument, nicht nur im Dialog: Der Fokus liegt nach einem
	 * Klick auf das Bild nirgends. Offen die Rueckfrage, gehoeren die Tasten ihr (sie bricht mit Escape
	 * selbst ab); sonst schlosse ein Escape beide.
	 */
	protected taste(ereignis: KeyboardEvent): void {
		if (this.frage()) return;
		switch (ereignis.key) {
			case 'Escape':
				this.schliessen.emit();
				break;
			case 'ArrowLeft':
				this.blaettere(-1);
				break;
			case 'ArrowRight':
				this.blaettere(1);
				break;
		}
	}

	/** Haelt Tab im Dialog: Vom letzten Knopf geht es zum ersten, von Umschalt+Tab auf dem Dialog zum letzten. */
	protected tabulator(ereignis: KeyboardEvent): void {
		const dialog = this.dialog()?.nativeElement;
		if (ereignis.key !== 'Tab' || !dialog) return;
		const knoepfe = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
		const erster = knoepfe[0];
		const letzter = knoepfe[knoepfe.length - 1];
		const aktiv = document.activeElement;
		if (ereignis.shiftKey && (aktiv === erster || aktiv === dialog)) {
			ereignis.preventDefault();
			letzter?.focus();
		} else if (!ereignis.shiftKey && aktiv === letzter) {
			ereignis.preventDefault();
			erster?.focus();
		}
	}

	private blaettere(schritt: -1 | 1): void {
		const ziel = this.position() + schritt;
		if (ziel < 0 || ziel >= this.fotos().length) return;
		this.fehler.set(null);
		this.position.set(ziel);
	}

	protected beginneWischen(ereignis: PointerEvent): void {
		this.startX = ereignis.clientX;
		this.startY = ereignis.clientY;
	}

	/** Waagerecht mehr als die Schwelle und mehr als senkrecht: nach links das naechste, nach rechts das vorige. */
	protected beendeWischen(ereignis: PointerEvent): void {
		if (this.startX === null) return;
		const dx = ereignis.clientX - this.startX;
		const dy = ereignis.clientY - this.startY;
		this.startX = null;
		if (Math.abs(dx) <= WISCH_SCHWELLE || Math.abs(dx) <= Math.abs(dy)) return;
		this.blaettere(dx < 0 ? 1 : -1);
	}

	protected async loesche(f: FotoZeile): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			await firstValueFrom(this.api.loescheDatei(this.slug(), f.id));
			this.frage.set(false);
			if (!this.weg) this.geloescht.emit();
		} catch (ursache) {
			this.frage.set(false);
			if (this.weg) return;
			const e = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), e)) return;
			if (e.status === 404) {
				// Schon weg oder das Recht entzogen: Die Seite laedt neu und zeigt, was der Server hat.
				this.geloescht.emit();
			} else {
				this.fehler.set(fehlertext(e));
			}
		} finally {
			this.laeuft.set(false);
		}
	}

	/**
	 * Speichern. Wo das Geraet Dateien teilen kann (Web Share, am Handy), geht das Foto ueber das
	 * Teilen-Blatt, denn nur dort landet es in der Fotos-App; ein Download legte es am iPhone in
	 * Dateien ab. Sonst ein Link mit download.
	 *
	 * Ohne canShare wird das Bild gar nicht erst geholt: Der Link laedt es selbst, und ein Abruf
	 * obendrein kostete bei einem 2560er Bild Datenvolumen fuer nichts. Verworfen: das Bild
	 * immer vorab holen, um erst danach zu entscheiden.
	 *
	 * Der Abruf hat ein eigenes fetch mit Sitzung (Cookie) und keinen HttpClient-Blob: Ein Blob ueber
	 * den Client liefe durch die Interceptoren, die hier nichts zu tun haben.
	 */
	protected async speichere(f: FotoZeile): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			if (typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') {
				this.lade(f);
				return;
			}
			const antwort = await fetch(this.adresse(f.id), { credentials: 'same-origin' });
			if (!antwort.ok) throw new Error(String(antwort.status));
			const blob = await antwort.blob();
			const datei = new File([blob], `foto-${f.id.slice(0, 8)}.jpg`, { type: blob.type || 'image/jpeg' });
			if (!navigator.canShare({ files: [datei] })) {
				this.lade(f);
				return;
			}
			try {
				await navigator.share({ files: [datei] });
			} catch (ursache) {
				// Wer das Blatt wegwischt, hat nichts falsch gemacht. Alles andere (etwa NotAllowedError, wenn
				// der Abruf die Freigabe des Fingertipps aufgebraucht hat) faellt auf den Download zurueck.
				if (ursache instanceof Error && ursache.name === 'AbortError') return;
				this.lade(f);
			}
		} catch {
			if (!this.weg) this.fehler.set('Das Foto ließ sich nicht holen. Bitte noch einmal versuchen.');
		} finally {
			this.laeuft.set(false);
		}
	}

	/** Ein unsichtbarer Link mit download, nur fuer den Klick angelegt und gleich wieder entfernt. */
	private lade(f: FotoZeile): void {
		const link = document.createElement('a');
		link.href = dateiAdresse(this.slug(), f.id, true);
		link.download = `foto-${f.id.slice(0, 8)}.jpg`;
		link.hidden = true;
		document.body.append(link);
		link.click();
		link.remove();
	}
}
