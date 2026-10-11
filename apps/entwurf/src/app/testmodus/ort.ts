import { inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

/** Der aktuelle Pfad als Signal, ohne base href (z. B. "/glonntal/t/2-bowling"). */
export function aktuellerPfad() {
	const router = inject(Router);
	return toSignal(
		router.events.pipe(
			filter((e): e is NavigationEnd => e instanceof NavigationEnd),
			map((e) => e.urlAfterRedirects),
		),
		{ initialValue: router.url },
	);
}
