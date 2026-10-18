import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, type Signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { pruefeSlug } from '@jufi/domain';
import { filter, map } from 'rxjs';
import { VereinApi, type OeffentlicherVerein } from '../daten/verein-api';
import { vereinsfarben } from '../gestaltung/farben';
import { ThemaService } from '../gestaltung/thema';

/** Gleich dem title in index.html; dorthin faellt der Titel zurueck, sobald kein Verein mehr gezeigt wird. */
const STANDARDTITEL = 'JuFi App';

/** Markiert jedes Element im head, das dieser Kontext angelegt hat, damit es sich gezielt entfernen laesst. */
const MARKE = 'data-jufi-verein';

/** Erster Pfadteil, aber nur ein moeglicher Slug: admin, entwurf und Co. sind reserviert und fallen heraus. */
function slugAusUrl(url: string): string | null {
	const teil = url.split(/[?#]/)[0]?.split('/')[1] ?? '';
	return pruefeSlug(teil).ok ? teil : null;
}

/**
 * Der Verein, in dessen Adresse die Person gerade steht, samt allem, was er im Dokument
 * einstellt: Vereinsfarbe, Seitentitel, Manifest-Link, apple-touch-icon und theme-color.
 *
 * Der Kontext haengt am Router statt in jeder Seite. Verworfen: Setzen und Aufraeumen
 * je Bauteil. Beim Seitenwechsel zerstoert Angular das alte Bauteil erst nach dem
 * Anlegen des neuen; zwei Bauteile fuer dieselbe Farbe raeumten sich dabei gegenseitig
 * ab oder liessen die Farbe des vorigen Vereins stehen. Ein einziger Effekt hat dieses
 * Problem nicht: er sieht immer nur den aktuellen Stand.
 *
 * App holt den Kontext beim Start, damit er schon vor der ersten Navigation lebt.
 */
@Injectable({ providedIn: 'root' })
export class VereinKontext {
	private readonly router = inject(Router);
	private readonly api = inject(VereinApi);
	private readonly thema = inject(ThemaService);
	private readonly dokument = inject(DOCUMENT);

	/** Slug aus dem ersten Pfadteil, null auf Plattform- und Admin-Seiten. */
	readonly slug: Signal<string | null> = toSignal(
		this.router.events.pipe(
			filter((e): e is NavigationEnd => e instanceof NavigationEnd),
			map((e) => slugAusUrl(e.urlAfterRedirects)),
		),
		{ initialValue: slugAusUrl(this.router.url) },
	);

	// Gleicher Slug, gleiche Anfrage: ein Wechsel innerhalb des Vereins laedt nichts neu.
	// Ohne Slug ist die Ressource im Ruhezustand und schickt nichts.
	private readonly ressource = rxResource({
		params: () => this.slug() ?? undefined,
		stream: ({ params }) => this.api.lade(params),
	});

	/** undefined = laedt (oder kein Verein in der Adresse, oder Ladefehler), 'nicht-gefunden', oder der Verein. */
	readonly verein: Signal<OeffentlicherVerein | 'nicht-gefunden' | undefined> = computed(() =>
		// value() wirft im Fehlerzustand; hasValue() fragt gefahrlos.
		this.ressource.hasValue() ? this.ressource.value() : undefined,
	);

	readonly ladefehler: Signal<boolean> = computed(() => this.ressource.error() !== undefined);

	/**
	 * Absoluter Pfad wie in VereinApi. Das Logo liegt ohne Anmeldung offen, damit die
	 * Anmeldeseite es zeigen kann (Rahmen-Entscheidung 4). logoStand als ?v= macht aus
	 * jeder Aenderung eine neue Adresse, sonst bliebe das alte Bild im Cache.
	 */
	readonly logoUrl: Signal<string | null> = computed(() => {
		const v = this.verein();
		if (!v || v === 'nicht-gefunden' || !v.hatLogo) return null;
		return logoAdresse(v.slug, v.logoStand);
	});

	constructor() {
		effect((onCleanup) => {
			const v = this.verein();
			if (!v || v === 'nicht-gefunden') return;
			this.thema.setzeVereinsfarbe(v.farbe);
			this.dokument.title = v.anzeigename;
			const elemente = this.legeKopfElementeAn(v);
			// Laeuft vor dem naechsten Durchlauf (anderer Verein, 404, Fehler, Plattform)
			// und beim Zerstoeren des Kontexts.
			onCleanup(() => {
				this.thema.entferneVereinsfarbe();
				this.dokument.title = STANDARDTITEL;
				for (const e of elemente) e.remove();
			});
		});
	}

	/** Nach Aenderungen in den Vereinseinstellungen: der gespeicherte Stand wird neu gelesen. */
	neuLaden(): void {
		this.ressource.reload();
	}

	private legeKopfElementeAn(v: OeffentlicherVerein): HTMLElement[] {
		const slug = encodeURIComponent(v.slug);
		const manifest = this.element('link', { rel: 'manifest', href: `/${slug}/manifest.webmanifest` });
		const icon = this.element('link', {
			rel: 'apple-touch-icon',
			href: `/${slug}/icon-192.png${versionsAnhang(v.logoStand)}`,
		});
		const themeColor = this.element('meta', { name: 'theme-color', content: vereinsfarben(v.farbe).hell.akzent });
		return [manifest, icon, themeColor];
	}

	private element(tag: 'link' | 'meta', attribute: Record<string, string>): HTMLElement {
		const e = this.dokument.createElement(tag);
		for (const [name, wert] of Object.entries(attribute)) e.setAttribute(name, wert);
		e.setAttribute(MARKE, '');
		this.dokument.head.appendChild(e);
		return e;
	}
}

/**
 * Adresse des Vereinslogos mit dem Stand als ?v=. Auch die Einstellungen bauen sie, denn dort
 * ist der Stand schon bekannt, bevor der Kontext neu geladen hat; verworfen: die Adresse dort
 * ein zweites Mal zu schreiben, die Pfade liefen sonst auseinander.
 */
export function logoAdresse(slug: string, logoStand: string | null): string {
	return `/${encodeURIComponent(slug)}/api/v1/verein/logo${versionsAnhang(logoStand)}`;
}

function versionsAnhang(logoStand: string | null): string {
	return logoStand ? `?v=${encodeURIComponent(logoStand)}` : '';
}
