import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Routes } from '@angular/router';

/** Vorlaeufiger Platzhalter, bis die Mitglieder-Huelle steht (Task 7). */
@Component({
	selector: 'jf-platzhalter',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<p>JuFi Entwurf</p>`,
})
class Platzhalter {}

export const routes: Routes = [
	{ path: '', pathMatch: 'full', redirectTo: 'glonntal' },
	{ path: 'glonntal', component: Platzhalter },
];
