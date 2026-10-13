// globalSetup der Tests von libs/db: frische Datenbank jufi_test_db je Lauf.
import { testDatenbankAufbau } from './testing.js';

export default testDatenbankAufbau('db');
