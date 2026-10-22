-- CreateEnum
CREATE TYPE "FotoHochladen" AS ENUM ('JUGENDLEITER', 'ALLE');

-- AlterEnum
ALTER TYPE "EinwilligungArt" ADD VALUE 'FOTOS';

-- AlterEnum
-- Zwei Werte in einer Migration gehen erst ab Postgres 12 (Produktion und lokal laufen mit 17).
-- Kein Ausdruck dieser Migration nutzt die neuen Werte: Postgres lehnt das in derselben
-- Transaktion ab.
ALTER TYPE "ModulTyp" ADD VALUE 'DATEIEN';
ALTER TYPE "ModulTyp" ADD VALUE 'FOTOS';

-- CreateTable
CREATE TABLE "DateienModul" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,

    CONSTRAINT "DateienModul_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FotosModul" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "hochladen" "FotoHochladen" NOT NULL DEFAULT 'JUGENDLEITER',

    CONSTRAINT "FotosModul_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DateienModul_vereinId_id_key" ON "DateienModul"("vereinId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FotosModul_vereinId_id_key" ON "FotosModul"("vereinId", "id");

-- AddForeignKey
ALTER TABLE "DateienModul" ADD CONSTRAINT "DateienModul_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DateienModul" ADD CONSTRAINT "DateienModul_vereinId_id_fkey" FOREIGN KEY ("vereinId", "id") REFERENCES "ThreadModul"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FotosModul" ADD CONSTRAINT "FotosModul_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FotosModul" ADD CONSTRAINT "FotosModul_vereinId_id_fkey" FOREIGN KEY ("vereinId", "id") REFERENCES "ThreadModul"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
