import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { EntwurfStore } from './daten/store';
import { Dokumente } from './mitglieder/dokumente';
import { MitgliederHuelle } from './mitglieder/huelle';
import { Medien } from './mitglieder/medien';
import { Mehr } from './mitglieder/mehr';
import { NichtGefunden } from './mitglieder/nicht-gefunden';
import { Start } from './mitglieder/start';
import { Termine } from './mitglieder/termine';
import { ThreadSeite } from './mitglieder/thread';
import { Threads } from './mitglieder/threads';
import { istJugendleiter } from './regeln/personen';
import { Einstieg } from './testmodus/einstieg';
import { TestmodusService } from './testmodus/testmodus';
import { VerwaltungAntworten } from './verwaltung/antworten';
import {
	VerwaltungDokumente,
	VerwaltungTermine,
	VerwaltungUebersicht,
	VerwaltungUntergruppen,
} from './verwaltung/ansichten';
import { ThreadEditor } from './verwaltung/editor';
import { VerwaltungEinstellungen } from './verwaltung/einstellungen';
import { VerwaltungHuelle } from './verwaltung/huelle';
import { VerwaltungPerson, VerwaltungPersonen } from './verwaltung/personen';
import { VerwaltungRechte } from './verwaltung/rechte';
import { VerwaltungThreads } from './verwaltung/threads';

const titel = (t: string) => `${t} · Verwaltung · JuFi Entwurf`;

/**
 * Routen nach dem echten URL-Schema (Rahmen 5.4) unter base href /entwurf/.
 * Der Slug steht fest im Pfad: der Entwurf kennt nur einen Verein, und eine
 * Platzhalter-Route wuerde jeden Tippfehler als Verein durchwinken.
 */
export const routes: Routes = [
	{
		// Der verteilte Link zeigt auf /entwurf/: wer noch keine Person gewaehlt
		// hat, landet im Einstieg. Tiefe Links (geteilte Threads) fuehren direkt hin.
		path: '',
		pathMatch: 'full',
		redirectTo: () => (inject(TestmodusService).zustand().person === null ? 'glonntal/willkommen' : 'glonntal'),
	},
	{ path: 'glonntal/willkommen', component: Einstieg, title: 'Willkommen · JuFi Entwurf' },
	{
		// Nur fuer Jugendleiter; alle anderen fallen durch auf "Nicht gefunden"
		// der Mitglieder-Huelle — wie bei unsichtbaren Threads (Rahmen 8).
		path: 'glonntal/verwaltung',
		canMatch: [() => istJugendleiter(inject(EntwurfStore).person())],
		component: VerwaltungHuelle,
		children: [
			{ path: '', component: VerwaltungUebersicht, title: titel('Übersicht') },
			{ path: 'threads', component: VerwaltungThreads, title: titel('Threads') },
			{ path: 'threads/neu', component: ThreadEditor, title: titel('Neuer Thread') },
			{ path: 'threads/:nr', component: ThreadEditor, title: titel('Thread bearbeiten') },
			{ path: 'threads/:nr/antworten', component: VerwaltungAntworten, title: titel('Antworten') },
			{ path: 'termine', component: VerwaltungTermine, title: titel('Termine') },
			{ path: 'personen', component: VerwaltungPersonen, title: titel('Personen') },
			{ path: 'personen/:id', component: VerwaltungPerson, title: titel('Person') },
			{ path: 'untergruppen', component: VerwaltungUntergruppen, title: titel('Untergruppen') },
			{ path: 'rechte', component: VerwaltungRechte, title: titel('Rechte') },
			{ path: 'dokumente', component: VerwaltungDokumente, title: titel('Dokumente') },
			{ path: 'einstellungen', component: VerwaltungEinstellungen, title: titel('Einstellungen') },
		],
	},
	{
		path: 'glonntal',
		component: MitgliederHuelle,
		children: [
			{ path: '', component: Start, title: 'Start · JuFi Entwurf' },
			{ path: 'threads', component: Threads, title: 'Threads · JuFi Entwurf' },
			{ path: 't/:nrSlug', component: ThreadSeite },
			{ path: 't/:nrSlug/m/:modulId', component: ThreadSeite },
			{ path: 'termine', component: Termine, title: 'Termine · JuFi Entwurf' },
			{ path: 'medien', component: Medien, title: 'Medien · JuFi Entwurf' },
			{ path: 'dokumente', component: Dokumente, title: 'Dokumente · JuFi Entwurf' },
			{ path: 'mehr', component: Mehr, title: 'Mehr · JuFi Entwurf' },
			{ path: '**', component: NichtGefunden },
		],
	},
	{ path: '**', component: NichtGefunden },
];
