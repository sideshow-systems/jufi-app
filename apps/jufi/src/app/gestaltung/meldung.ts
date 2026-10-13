import { ChangeDetectionStrategy, Component, inject, Injectable, signal } from '@angular/core';

/** Kurze Meldung am unteren Rand ("Text kopiert"). */
@Injectable({ providedIn: 'root' })
export class MeldungService {
	readonly text = signal<string | null>(null);
	private uhr: ReturnType<typeof setTimeout> | undefined;

	zeige(text: string): void {
		this.text.set(text);
		clearTimeout(this.uhr);
		this.uhr = setTimeout(() => this.text.set(null), 2800);
	}
}

@Component({
	selector: 'jf-meldung',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (meldung.text(); as t) {
			<div role="status">{{ t }}</div>
		}
	`,
	styles: `
		div {
			position: fixed;
			z-index: 100;
			left: 50%;
			bottom: calc(80px + var(--sicher-unten));
			transform: translateX(-50%);
			max-width: calc(100vw - 32px);
			padding: var(--a3) var(--a4);
			border-radius: var(--radius-pille);
			background: var(--text);
			color: var(--seite);
			font-weight: 600;
			box-shadow: var(--schatten);
		}
	`,
})
export class MeldungComponent {
	protected readonly meldung = inject(MeldungService);
}
