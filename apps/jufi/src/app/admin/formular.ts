/** Wert eines input-Ereignisses; spart in den Vorlagen den Umweg ueber $any. */
export function wertVon(ereignis: Event): string {
	return (ereignis.target as HTMLInputElement).value;
}
