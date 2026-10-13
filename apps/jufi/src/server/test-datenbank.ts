// globalSetup der Servertests: frische Datenbank jufi_test_server je Lauf.
import { testDatenbankAufbau } from '@jufi/db/testing';

export default testDatenbankAufbau('server');
