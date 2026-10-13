// setupFiles der Tests von libs/db: Jeder Worker verbindet sich mit der
// Datenbank, die test-setup.ts vorbereitet hat (Begruendung in testing.ts).
import { uebernimmTestDatenbank } from './testing.js';

uebernimmTestDatenbank();
