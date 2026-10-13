// setupFiles der Servertests: Jeder Worker verbindet sich mit der Datenbank,
// die test-datenbank.ts vorbereitet hat (Begruendung in libs/db/src/testing.ts).
import { uebernimmTestDatenbank } from '@jufi/db/testing';

uebernimmTestDatenbank();
