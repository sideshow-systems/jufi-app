import { ChangeDetectionStrategy, Component, input, resource, ViewEncapsulation } from '@angular/core';
import type { ModulAnsicht } from '@jufi/domain';
import { infoHtml } from './info-text';

/**
 * Der Info-Text als Markdown-Teilmenge (Spec 3.11). Der Text stammt von Mitgliedern und ist
 * damit fremd: infoHtml laesst nur die Teilmenge als HTML durch, Angulars Sanitizer bei
 * [innerHTML] bleibt der zweite Riegel. Verworfen: bypassSecurityTrustHtml, das genau diesen
 * Riegel abnaehme.
 *
 * Encapsulation None aus demselben Grund wie bei den Rechtstexten: [innerHTML] erzeugt Elemente
 * ohne Kapselungsattribut, gekapselte Regeln traefen sie nicht. Jede Regel haengt deshalb an
 * jf-info-modul, damit sie nirgends sonst wirkt.
 */
@Component({
	selector: 'jf-info-modul',
	changeDetection: ChangeDetectionStrategy.OnPush,
	encapsulation: ViewEncapsulation.None,
	template: `
		@if (modul().titel; as titel) {
			<h2>{{ titel }}</h2>
		}
		@if (html.hasValue()) {
			<div class="text" [innerHTML]="html.value()"></div>
		} @else if (html.error()) {
			<!-- Ohne Parser (Netz weg beim Nachladen) bleibt der Text lesbar, nur ohne Formatierung. -->
			<p class="text roh">{{ modul().text }}</p>
		}
	`,
	styles: `
		jf-info-modul {
			display: grid;
			gap: var(--a2);
		}
		jf-info-modul h2 {
			margin: 0;
			font-size: var(--schrift);
		}
		jf-info-modul .text {
			overflow-wrap: anywhere;
		}
		jf-info-modul .text :is(p, ul) {
			margin: 0 0 var(--a2);
		}
		jf-info-modul .text > :last-child {
			margin-bottom: 0;
		}
		jf-info-modul .text ul {
			padding-left: var(--a5);
		}
		jf-info-modul .text a {
			font-weight: 600;
		}
		jf-info-modul .roh {
			margin: 0;
			white-space: pre-line;
		}
	`,
})
export class InfoModul {
	readonly modul = input.required<Extract<ModulAnsicht, { typ: 'INFO' }>>();

	protected readonly html = resource({
		params: () => this.modul().text,
		loader: ({ params }) => infoHtml(params),
	});
}
