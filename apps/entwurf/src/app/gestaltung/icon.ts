import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import archiveIcon from 'lucide/dist/esm/icons/archive.mjs';
import arrowDownIcon from 'lucide/dist/esm/icons/arrow-down.mjs';
import arrowUpIcon from 'lucide/dist/esm/icons/arrow-up.mjs';
import bellIcon from 'lucide/dist/esm/icons/bell.mjs';
import bellOffIcon from 'lucide/dist/esm/icons/bell-off.mjs';
import calendarIcon from 'lucide/dist/esm/icons/calendar.mjs';
import calendarDaysIcon from 'lucide/dist/esm/icons/calendar-days.mjs';
import carIcon from 'lucide/dist/esm/icons/car.mjs';
import checkIcon from 'lucide/dist/esm/icons/check.mjs';
import chevronDownIcon from 'lucide/dist/esm/icons/chevron-down.mjs';
import chevronLeftIcon from 'lucide/dist/esm/icons/chevron-left.mjs';
import chevronRightIcon from 'lucide/dist/esm/icons/chevron-right.mjs';
import circleQuestionMarkIcon from 'lucide/dist/esm/icons/circle-question-mark.mjs';
import copyIcon from 'lucide/dist/esm/icons/copy.mjs';
import downloadIcon from 'lucide/dist/esm/icons/download.mjs';
import ellipsisIcon from 'lucide/dist/esm/icons/ellipsis.mjs';
import euroIcon from 'lucide/dist/esm/icons/euro.mjs';
import fileIcon from 'lucide/dist/esm/icons/file.mjs';
import fileTextIcon from 'lucide/dist/esm/icons/file-text.mjs';
import folderIcon from 'lucide/dist/esm/icons/folder.mjs';
import gripVerticalIcon from 'lucide/dist/esm/icons/grip-vertical.mjs';
import houseIcon from 'lucide/dist/esm/icons/house.mjs';
import imageIcon from 'lucide/dist/esm/icons/image.mjs';
import imagesIcon from 'lucide/dist/esm/icons/images.mjs';
import infoIcon from 'lucide/dist/esm/icons/info.mjs';
import keyRoundIcon from 'lucide/dist/esm/icons/key-round.mjs';
import layoutDashboardIcon from 'lucide/dist/esm/icons/layout-dashboard.mjs';
import linkIcon from 'lucide/dist/esm/icons/link.mjs';
import listChecksIcon from 'lucide/dist/esm/icons/list-checks.mjs';
import mapPinIcon from 'lucide/dist/esm/icons/map-pin.mjs';
import messageCircleIcon from 'lucide/dist/esm/icons/message-circle.mjs';
import messagesSquareIcon from 'lucide/dist/esm/icons/messages-square.mjs';
import monitorIcon from 'lucide/dist/esm/icons/monitor.mjs';
import moonIcon from 'lucide/dist/esm/icons/moon.mjs';
import paletteIcon from 'lucide/dist/esm/icons/palette.mjs';
import pencilIcon from 'lucide/dist/esm/icons/pencil.mjs';
import pinIcon from 'lucide/dist/esm/icons/pin.mjs';
import plusIcon from 'lucide/dist/esm/icons/plus.mjs';
import sendIcon from 'lucide/dist/esm/icons/send.mjs';
import settingsIcon from 'lucide/dist/esm/icons/settings.mjs';
import share2Icon from 'lucide/dist/esm/icons/share-2.mjs';
import shieldIcon from 'lucide/dist/esm/icons/shield.mjs';
import smartphoneIcon from 'lucide/dist/esm/icons/smartphone.mjs';
import sunIcon from 'lucide/dist/esm/icons/sun.mjs';
import triangleAlertIcon from 'lucide/dist/esm/icons/triangle-alert.mjs';
import userIcon from 'lucide/dist/esm/icons/user.mjs';
import userPlusIcon from 'lucide/dist/esm/icons/user-plus.mjs';
import usersIcon from 'lucide/dist/esm/icons/users.mjs';
import xIcon from 'lucide/dist/esm/icons/x.mjs';

/**
 * Lucide-Symbole wie in HWYD: einzeln importiert, als Knoten selbst gezeichnet.
 * Verworfen: lucide-angular (zieht eine eigene Bauteil-Schicht mit) und
 * [innerHTML] (umgeht die Bereinigung nur mit bypassSecurityTrust).
 * Groesse 1em, damit das Symbol der Schriftgroesse seines Knopfs folgt.
 */
const ICONS = {
	start: houseIcon,
	threads: messagesSquareIcon,
	termine: calendarDaysIcon,
	medien: imagesIcon,
	mehr: ellipsisIcon,
	teilen: share2Icon,
	zurueck: chevronLeftIcon,
	vor: chevronRightIcon,
	aufklappen: chevronDownIcon,
	schliessen: xIcon,
	haken: checkIcon,
	kalender: calendarIcon,
	ort: mapPinIcon,
	auto: carIcon,
	euro: euroIcon,
	datei: fileTextIcon,
	foto: imageIcon,
	kopieren: copyIcon,
	glocke: bellIcon,
	glockeAus: bellOffIcon,
	plus: plusIcon,
	griff: gripVerticalIcon,
	warnung: triangleAlertIcon,
	info: infoIcon,
	nutzer: userIcon,
	personen: usersIcon,
	einstellungen: settingsIcon,
	dokument: fileIcon,
	pin: pinIcon,
	hoch: arrowUpIcon,
	runter: arrowDownIcon,
	archiv: archiveIcon,
	link: linkIcon,
	senden: sendIcon,
	stift: pencilIcon,
	uebersicht: layoutDashboardIcon,
	schild: shieldIcon,
	farbe: paletteIcon,
	dunkel: moonIcon,
	hell: sunIcon,
	system: monitorIcon,
	offline: downloadIcon,
	handy: smartphoneIcon,
	nachricht: messageCircleIcon,
	liste: listChecksIcon,
	frage: circleQuestionMarkIcon,
	schluessel: keyRoundIcon,
	einladen: userPlusIcon,
	ordner: folderIcon,
} as const;

export type IconName = keyof typeof ICONS;

@Component({
	selector: 'jf-icon',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<svg viewBox="0 0 24 24" aria-hidden="true">
			@for (part of nodes(); track $index) {
				@switch (part[0]) {
					@case ('path') {
						<path [attr.d]="part[1]['d']" />
					}
					@case ('circle') {
						<circle [attr.cx]="part[1]['cx']" [attr.cy]="part[1]['cy']" [attr.r]="part[1]['r']" />
					}
					@case ('ellipse') {
						<ellipse
							[attr.cx]="part[1]['cx']"
							[attr.cy]="part[1]['cy']"
							[attr.rx]="part[1]['rx']"
							[attr.ry]="part[1]['ry']"
						/>
					}
					@case ('line') {
						<line
							[attr.x1]="part[1]['x1']"
							[attr.y1]="part[1]['y1']"
							[attr.x2]="part[1]['x2']"
							[attr.y2]="part[1]['y2']"
						/>
					}
					@case ('rect') {
						<rect
							[attr.x]="part[1]['x']"
							[attr.y]="part[1]['y']"
							[attr.width]="part[1]['width']"
							[attr.height]="part[1]['height']"
							[attr.rx]="part[1]['rx']"
							[attr.ry]="part[1]['ry']"
						/>
					}
					@case ('polyline') {
						<polyline [attr.points]="part[1]['points']" />
					}
					@case ('polygon') {
						<polygon [attr.points]="part[1]['points']" />
					}
				}
			}
		</svg>
	`,
	styles: `
		/* inline-flex statt inline-block: ein inline-block-SVG sitzt auf der
		   Grundlinie und steht dann ueber der Mitte seines Knopfs. */
		:host {
			display: inline-flex;
			width: 1em;
			height: 1em;
			flex: none;
		}
		svg {
			width: 100%;
			height: 100%;
			fill: none;
			stroke: currentColor;
			stroke-width: 2;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
	`,
})
export class IconComponent {
	readonly name = input.required<IconName>();
	protected readonly nodes = computed(() => ICONS[this.name()]);
}
