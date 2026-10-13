import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	ElementRef,
	inject,
	OnInit,
	output,
	signal,
	viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AdminApi, alsAdminFehler, fehlertext, type TotpStart } from './admin-api';
import { wertVon } from './formular';

/**
 * Zweiter Faktor einrichten: QR-Code, Geheimnis, Bestaetigungscode, Wiederherstellungscodes.
 * Eigenes Bauteil, weil Einrichten (direkt nach dem Passwort) und Konto es teilen.
 *
 * Geheimnis und Codes liegen erst nach dem Bestaetigen beim Server in der Datenbank;
 * bis dahin reist alles in der verschluesselten Zwischenmarke (siehe totpStart).
 */
@Component({
	selector: 'jf-totp-einrichtung',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (start(); as s) {
			<div class="spalten">
				<div class="qr">
					<!--
						Ein canvas statt eines img mit Data-URL: die Sicherheitsregel des Servers
						erlaubt Bilder nur von der eigenen Adresse, kein data:. Das canvas braucht
						keine Bildquelle. Der weisse Grund bleibt auch im Dunkelmodus, sonst liest
						keine App den Code.
					-->
					<canvas #qr width="200" height="200" aria-label="QR-Code für die Authenticator-App" role="img"></canvas>
					@if (qrFehler()) {
						<p class="klein gedaempft">Der QR-Code konnte nicht gezeichnet werden. Gib das Geheimnis von Hand ein.</p>
					}
				</div>
				<div class="rest">
					<p>Scanne den Code mit der Authenticator-App oder gib dort das Geheimnis ein:</p>
					<code class="geheimnis">{{ geheimnisGruppiert() }}</code>
					<form (submit)="bestaetigen($event)">
						<label class="feld">
							Code aus der Authenticator-App
							<input
								name="code"
								inputmode="numeric"
								autocomplete="one-time-code"
								maxlength="7"
								[value]="code()"
								(input)="code.set(wert($event))"
							/>
						</label>
						<button type="submit" class="knopf primaer" [disabled]="laeuft() || code().trim() === ''">
							Bestätigen
						</button>
					</form>
					@if (fehler(); as text) {
						<p class="fehler" role="alert">{{ text }}</p>
						@if (abgelaufen()) {
							<button type="button" class="knopf leise" (click)="beginne()">Neu beginnen</button>
						}
					}
				</div>
			</div>
			<section class="codes">
				<h3>Wiederherstellungscodes</h3>
				<ul>
					@for (c of s.wiederherstellungscodes; track c) {
						<li>
							<code>{{ c }}</code>
						</li>
					}
				</ul>
				<p class="klein gedaempft">Bewahre sie getrennt vom Gerät auf. Jeder gilt einmal.</p>
				<button type="button" class="knopf klein" (click)="kopieren(s.wiederherstellungscodes)">
					{{ kopiert() === 'ja' ? 'Kopiert' : 'Kopieren' }}
				</button>
				@if (kopiert() === 'fehler') {
					<p class="klein fehler" role="alert">Kopieren nicht möglich – schreibe die Codes bitte ab.</p>
				}
			</section>
		} @else if (fehler(); as text) {
			<p class="fehler" role="alert">{{ text }}</p>
			<button type="button" class="knopf leise" (click)="beginne()">Nochmal versuchen</button>
		} @else {
			<p class="gedaempft">Wird vorbereitet …</p>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a4);
		}
		.spalten {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: var(--a5);
			align-items: start;
		}
		.rest {
			display: grid;
			gap: var(--a3);
		}
		.rest p {
			margin: 0;
		}
		canvas {
			display: block;
			width: 200px;
			height: 200px;
			background: #ffffff;
			/* Der Rand gehoert zum Code: Lesegeraete brauchen die ruhige Flaeche drumherum. */
			padding: var(--a2);
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
			box-sizing: content-box;
		}
		.geheimnis {
			font-size: var(--schrift-gross);
			letter-spacing: 0.08em;
			word-spacing: 0.4em;
			overflow-wrap: anywhere;
		}
		form {
			display: grid;
			gap: var(--a3);
			max-width: 20rem;
		}
		h3 {
			margin: 0 0 var(--a2);
			font-size: var(--schrift);
		}
		ul {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
			gap: var(--a1) var(--a4);
			margin: 0 0 var(--a3);
			padding: 0;
			list-style: none;
		}
		.codes p {
			margin: 0 0 var(--a3);
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class TotpEinrichtungComponent implements OnInit {
	private readonly api = inject(AdminApi);
	private readonly leinwand = viewChild<ElementRef<HTMLCanvasElement>>('qr');

	/** Das Konto hat jetzt einen zweiten Faktor. */
	readonly eingerichtet = output<void>();

	protected readonly start = signal<TotpStart | null>(null);
	protected readonly code = signal('');
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<string | null>(null);
	protected readonly abgelaufen = signal(false);
	protected readonly qrFehler = signal(false);
	protected readonly kopiert = signal<'nein' | 'ja' | 'fehler'>('nein');

	protected readonly wert = wertVon;
	/** In Vierergruppen, weil man 16 Zeichen so von Hand abtippt, ohne sich zu verzaehlen. */
	protected readonly geheimnisGruppiert = computed(() => this.start()?.geheimnis.replace(/(.{4})(?=.)/g, '$1 ') ?? '');

	constructor() {
		effect(() => {
			const uri = this.start()?.uri;
			const leinwand = this.leinwand()?.nativeElement;
			if (uri && leinwand) void this.zeichne(leinwand, uri);
		});
	}

	ngOnInit(): void {
		void this.beginne();
	}

	protected async beginne(): Promise<void> {
		this.fehler.set(null);
		this.abgelaufen.set(false);
		this.code.set('');
		this.qrFehler.set(false);
		try {
			this.start.set(await firstValueFrom(this.api.totpStart()));
		} catch (ursache) {
			this.start.set(null);
			this.fehler.set(fehlertext(alsAdminFehler(ursache)));
		}
	}

	protected async bestaetigen(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const s = this.start();
		if (!s || this.laeuft()) return;
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			await firstValueFrom(this.api.totpBestaetigen(s.zwischenmarke, this.code().trim()));
			this.eingerichtet.emit();
		} catch (ursache) {
			const f = alsAdminFehler(ursache);
			this.fehler.set(fehlertext(f));
			// 400: Zwischenmarke verfallen (10 Minuten) -- der Code allein hilft nicht, es braucht ein neues Geheimnis.
			this.abgelaufen.set(f.status === 400);
		} finally {
			this.laeuft.set(false);
		}
	}

	protected async kopieren(codes: string[]): Promise<void> {
		try {
			await navigator.clipboard.writeText(codes.join('\n'));
			this.kopiert.set('ja');
		} catch {
			// Ohne Zwischenablage (kein sicherer Kontext, verweigert) bleibt das Abschreiben.
			this.kopiert.set('fehler');
		}
	}

	/**
	 * qrcode erst hier laden: Die Anmeldeseite braucht es nicht, und so liegt es in
	 * einem eigenen nachgeladenen Stueck statt im Admin-Buendel. Ein Fehler
	 * (kein canvas-Kontext, Datei nicht ladbar) laesst das Geheimnis zum Abtippen stehen.
	 */
	private async zeichne(leinwand: HTMLCanvasElement, uri: string): Promise<void> {
		try {
			const { toCanvas } = await import('qrcode');
			await toCanvas(leinwand, uri, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
		} catch {
			this.qrFehler.set(true);
		}
	}
}
