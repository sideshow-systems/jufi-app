-- CreateEnum
CREATE TYPE "Richtung" AS ENUM ('HIN', 'RUECK');

-- AlterEnum
-- Kein Ausdruck dieser Migration nutzt die neuen Werte: Postgres lehnt das in derselben
-- Transaktion ab.
ALTER TYPE "ModulTyp" ADD VALUE 'FAHRT';

-- AlterEnum
ALTER TYPE "SystemArt" ADD VALUE 'AUTO_ZURUECKGEZOGEN';

-- CreateTable
CREATE TABLE "FahrtModul" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "hin" BOOLEAN NOT NULL DEFAULT true,
    "rueck" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FahrtModul_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auto" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "modulId" TEXT NOT NULL,
    "fahrerId" TEXT NOT NULL,
    "richtung" "Richtung" NOT NULL,
    "plaetze" INTEGER NOT NULL,
    "abfahrtTag" DATE,
    "abfahrtZeit" TEXT,
    "ort" TEXT,
    "notiz" TEXT,
    "angelegtAm" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "Auto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mitfahrt" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "modulId" TEXT NOT NULL,
    "richtung" "Richtung" NOT NULL,
    "kindId" TEXT NOT NULL,
    "autoId" TEXT,
    "vonId" TEXT NOT NULL,
    "eingetragenAm" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "Mitfahrt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FahrtModul_vereinId_threadId_key" ON "FahrtModul"("vereinId", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "FahrtModul_vereinId_id_threadId_key" ON "FahrtModul"("vereinId", "id", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "FahrtModul_vereinId_id_key" ON "FahrtModul"("vereinId", "id");

-- CreateIndex
CREATE INDEX "Auto_vereinId_fahrerId_idx" ON "Auto"("vereinId", "fahrerId");

-- CreateIndex
CREATE UNIQUE INDEX "Auto_modulId_fahrerId_richtung_key" ON "Auto"("modulId", "fahrerId", "richtung");

-- CreateIndex
CREATE UNIQUE INDEX "Auto_vereinId_clientId_key" ON "Auto"("vereinId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Auto_vereinId_modulId_richtung_id_key" ON "Auto"("vereinId", "modulId", "richtung", "id");

-- CreateIndex
CREATE INDEX "Mitfahrt_vereinId_autoId_idx" ON "Mitfahrt"("vereinId", "autoId");

-- CreateIndex
CREATE INDEX "Mitfahrt_vereinId_kindId_idx" ON "Mitfahrt"("vereinId", "kindId");

-- CreateIndex
CREATE INDEX "Mitfahrt_vereinId_vonId_idx" ON "Mitfahrt"("vereinId", "vonId");

-- CreateIndex
CREATE UNIQUE INDEX "Mitfahrt_modulId_richtung_kindId_key" ON "Mitfahrt"("modulId", "richtung", "kindId");

-- CreateIndex
CREATE UNIQUE INDEX "Mitfahrt_vereinId_clientId_key" ON "Mitfahrt"("vereinId", "clientId");

-- AddForeignKey
ALTER TABLE "FahrtModul" ADD CONSTRAINT "FahrtModul_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FahrtModul" ADD CONSTRAINT "FahrtModul_vereinId_id_threadId_fkey" FOREIGN KEY ("vereinId", "id", "threadId") REFERENCES "ThreadModul"("vereinId", "id", "threadId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Auto" ADD CONSTRAINT "Auto_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auto" ADD CONSTRAINT "Auto_vereinId_modulId_fkey" FOREIGN KEY ("vereinId", "modulId") REFERENCES "FahrtModul"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Auto" ADD CONSTRAINT "Auto_vereinId_fahrerId_fkey" FOREIGN KEY ("vereinId", "fahrerId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Mitfahrt" ADD CONSTRAINT "Mitfahrt_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mitfahrt" ADD CONSTRAINT "Mitfahrt_vereinId_modulId_fkey" FOREIGN KEY ("vereinId", "modulId") REFERENCES "FahrtModul"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Mitfahrt" ADD CONSTRAINT "Mitfahrt_vereinId_kindId_fkey" FOREIGN KEY ("vereinId", "kindId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Mitfahrt" ADD CONSTRAINT "Mitfahrt_vereinId_modulId_richtung_autoId_fkey" FOREIGN KEY ("vereinId", "modulId", "richtung", "autoId") REFERENCES "Auto"("vereinId", "modulId", "richtung", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Mitfahrt" ADD CONSTRAINT "Mitfahrt_vereinId_vonId_fkey" FOREIGN KEY ("vereinId", "vonId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CHECK-Constraints, von Hand ergaenzt: Prisma bildet sie nicht ab und meldet fuer
-- sie auch keine Abweichung. Sie sind Doppelschutz zu libs/domain (GRENZEN in
-- entwurf.ts): Der Code prueft zuerst und antwortet verstaendlich, die CHECKs fangen
-- ab, was an ihm vorbeikommt. Dieselben Zahlen stehen dort.

-- Eine Fahrgemeinschaft ohne Richtung waere leer und liesse sich nie nutzen.
ALTER TABLE "FahrtModul" ADD CONSTRAINT fahrt_richtung CHECK (hin OR rueck);

-- Ein Auto ohne Platz nimmt niemanden mit, ueber 8 hinaus ist es kein Auto mehr.
ALTER TABLE "Auto" ADD CONSTRAINT auto_plaetze CHECK (plaetze BETWEEN 1 AND 8);

-- Nur die Uhrzeit, wie bei termin_uhrzeit: 00:00 bis 23:59.
ALTER TABLE "Auto" ADD CONSTRAINT auto_zeit CHECK ("abfahrtZeit" IS NULL OR "abfahrtZeit" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Keine Angabe heisst NULL, nie ein Leerstring: So gibt es genau eine Darstellung
-- fuer "ohne Treffpunkt" bzw. "ohne Notiz", und die Anzeige haengt keine leere Zeile an.
ALTER TABLE "Auto" ADD CONSTRAINT auto_ort CHECK (ort IS NULL OR char_length(ort) BETWEEN 1 AND 200);
ALTER TABLE "Auto" ADD CONSTRAINT auto_notiz CHECK (notiz IS NULL OR char_length(notiz) BETWEEN 1 AND 200);
