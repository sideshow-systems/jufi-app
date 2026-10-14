import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Platzhalter, bis die echten Seiten kommen (Einladung, Anmeldung, Zugang verloren,
 * Profil). Je Pfad ein Bauteil, damit die Routen schon ihre endgueltige Form haben
 * und die spaeteren Aufgaben nur den loadComponent-Zeiger austauschen.
 */
@Component({
	selector: 'jf-platzhalter-anmelden',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<main><h1>Anmelden</h1></main>`,
})
export class PlatzhalterAnmeldenComponent {}

@Component({
	selector: 'jf-platzhalter-einladung',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<main><h1>Einladung</h1></main>`,
})
export class PlatzhalterEinladungComponent {}

@Component({
	selector: 'jf-platzhalter-zugang-verloren',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<main><h1>Zugang verloren</h1></main>`,
})
export class PlatzhalterZugangVerlorenComponent {}

@Component({
	selector: 'jf-platzhalter-profil',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<main><h1>Profil</h1></main>`,
})
export class PlatzhalterProfilComponent {}
