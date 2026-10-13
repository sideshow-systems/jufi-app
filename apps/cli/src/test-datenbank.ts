// globalSetup der Tests: frische Datenbank jufi_test_cli je Lauf.
import { testDatenbankAufbau } from '@jufi/db/testing';

export default testDatenbankAufbau('cli');
