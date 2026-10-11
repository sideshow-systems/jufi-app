import { Routes } from '@angular/router';
import { MitgliederHuelle } from './mitglieder/huelle';
import { NichtGefunden } from './mitglieder/nicht-gefunden';
import { Start } from './mitglieder/start';
import { ThreadSeite } from './mitglieder/thread';
import { Threads } from './mitglieder/threads';

/**
 * Routen nach dem echten URL-Schema (Rahmen 5.4) unter base href /entwurf/.
 * Der Slug steht fest im Pfad: der Entwurf kennt nur einen Verein, und eine
 * Platzhalter-Route wuerde jeden Tippfehler als Verein durchwinken.
 */
export const routes: Routes = [
	{ path: '', pathMatch: 'full', redirectTo: 'glonntal' },
	{
		path: 'glonntal',
		component: MitgliederHuelle,
		children: [
			{ path: '', component: Start, title: 'Start · JuFi Entwurf' },
			{ path: 'threads', component: Threads, title: 'Threads · JuFi Entwurf' },
			{ path: 't/:nrSlug', component: ThreadSeite },
			{ path: 't/:nrSlug/m/:modulId', component: ThreadSeite },
			{ path: '**', component: NichtGefunden },
		],
	},
	{ path: '**', component: NichtGefunden },
];
