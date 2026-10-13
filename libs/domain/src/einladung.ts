// Gueltigkeitsdauern der Links (Spec 3.4, 5.3). Die Einladung ist lang, weil sie
// ueber Messenger an Leute geht, die nicht taeglich nachsehen; ein Reset ist kurz,
// weil er ein bestehendes Konto uebernehmen koennte. Die Einrichtung des Plattform-
// Admins ist kurz, weil der Link in einer Shell auf dem Server entsteht und sofort
// benutzt wird.
export const EINLADUNG_GUELTIG_MS = 14 * 24 * 60 * 60 * 1000;
export const RESET_GUELTIG_MS = 60 * 60 * 1000;
export const EINRICHTUNG_GUELTIG_MS = 60 * 60 * 1000;

// Die Art als Literal-Union statt des Prisma-Enums: libs/domain haengt nicht an
// @jufi/db (reine Regeln, auch in der Oberflaeche nutzbar). Prisma-Enum-Werte sind
// Strings gleichen Namens und daher ohne Umwandlung zuweisbar.
export function einladungsAblauf(art: 'EINLADUNG' | 'RESET', jetzt: Date): Date {
	const dauer = art === 'EINLADUNG' ? EINLADUNG_GUELTIG_MS : RESET_GUELTIG_MS;
	return new Date(jetzt.getTime() + dauer);
}
