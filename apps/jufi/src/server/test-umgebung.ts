// setupFiles der Servertests: Jeder Worker verbindet sich mit der Datenbank,
// die test-datenbank.ts vorbereitet hat (Begruendung in libs/db/src/testing.ts).
import { uebernimmTestDatenbank } from '@jufi/db/testing';
import { TEST_SITZUNGSGEHEIMNIS, TEST_TOTP_SCHLUESSEL } from './test-setup.js';

uebernimmTestDatenbank();

// Vor jedem createPrismaClientFromEnv: dessen loadEnvFile ueberschreibt gesetzte
// Variablen nicht. Ohne das liefen die Tests mit den Geheimnissen der lokalen
// .env -- auf jedem Rechner mit anderen, auf einem frischen Klon mit keinen.
process.env['SESSION_SECRET'] = TEST_SITZUNGSGEHEIMNIS;
process.env['TOTP_ENC_KEY'] = TEST_TOTP_SCHLUESSEL;
