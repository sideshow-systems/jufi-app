-- Eine Antwort haelt ihre Umfrage fest (NO ACTION statt CASCADE): Kein Kaskadenweg
-- von Thread, Modul oder Umfrage fuehrt mehr zu UmfrageAntwort, auch nicht fuer eine
-- Antwort ohne gewaehlte Option (Spec 3.14). Verworfen: die Kaskade lassen und auf
-- UmfrageAntwortOption.option als Sperre bauen -- ob zuerst diese Sperre oder die
-- Kaskade ueber die Antwort greift, haengt von der Reihenfolge der Prueftrigger in
-- Postgres ab und kippt, sobald eine Migration einen der Fremdschluessel neu anlegt;
-- beantwortete Umfragen verschwaenden dann kommentarlos.

-- DropForeignKey
ALTER TABLE "UmfrageAntwort" DROP CONSTRAINT "UmfrageAntwort_vereinId_umfrageId_fkey";

-- AddForeignKey
ALTER TABLE "UmfrageAntwort" ADD CONSTRAINT "UmfrageAntwort_vereinId_umfrageId_fkey" FOREIGN KEY ("vereinId", "umfrageId") REFERENCES "UmfrageModul"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
