// Schreibt apps/entwurf/src/konfig.generated.ts aus der Umgebung.
//
// Die WhatsApp-Nummer fuer Rueckmeldungen kommt aus JUFI_ENTWURF_WHATSAPP und
// steht nicht im Repo (Spec TP1 5.5). Eine erzeugte Datei statt
// `define` in project.json: so bleibt der Import typisiert, und `nx test`
// sieht denselben Wert wie der Bau. Ohne Variable wird `null` geschrieben;
// der Entwurf faellt dann auf Teilen bzw. Kopieren zurueck.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ziffern = (process.env.JUFI_ENTWURF_WHATSAPP ?? '').replace(/\D/g, '');
const wert = ziffern ? `'${ziffern}'` : 'null';
const ziel = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'entwurf', 'src', 'konfig.generated.ts');

writeFileSync(
	ziel,
	`// Erzeugt von tools/entwurf-konfig.mjs — nicht bearbeiten.
// Die Nummer ist im ausgelieferten Buendel lesbar; fuer einen Entwurf, dessen
// Link ohnehin per WhatsApp verteilt wird, ist das hingenommen (Spec TP1 5.5).
export const WHATSAPP_NUMMER: string | null = ${wert};
`,
);
