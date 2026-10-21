-- CreateEnum
CREATE TYPE "DateiArt" AS ENUM ('FOTO', 'DATEI');

-- AlterEnum
ALTER TYPE "AdminAktion" ADD VALUE 'SPEICHERGRENZE';

-- AlterTable
ALTER TABLE "Verein" ADD COLUMN     "speicherGrenzeMb" INTEGER NOT NULL DEFAULT 5120;

-- CreateTable
CREATE TABLE "Datei" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "art" "DateiArt" NOT NULL,
    "modulId" TEXT,
    "dokumentId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "typ" TEXT NOT NULL,
    "groesse" INTEGER NOT NULL,
    "breite" INTEGER,
    "hoehe" INTEGER,
    "sha256" TEXT NOT NULL,
    "vonId" TEXT NOT NULL,
    "hochgeladenAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Datei_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DokumentKategorie" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "DokumentKategorie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dokument" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "kategorieId" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "angelegtAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dokument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DateiLoeschung" (
    "schluessel" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "geloeschtAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DateiLoeschung_pkey" PRIMARY KEY ("schluessel")
);

-- CreateIndex
CREATE INDEX "Datei_vereinId_idx" ON "Datei"("vereinId");

-- CreateIndex
CREATE UNIQUE INDEX "Datei_vereinId_id_key" ON "Datei"("vereinId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DokumentKategorie_vereinId_name_key" ON "DokumentKategorie"("vereinId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DokumentKategorie_vereinId_id_key" ON "DokumentKategorie"("vereinId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Dokument_vereinId_id_key" ON "Dokument"("vereinId", "id");

-- CreateIndex
CREATE INDEX "DateiLoeschung_geloeschtAm_idx" ON "DateiLoeschung"("geloeschtAm");

-- AddForeignKey
ALTER TABLE "Datei" ADD CONSTRAINT "Datei_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Datei" ADD CONSTRAINT "Datei_vereinId_modulId_fkey" FOREIGN KEY ("vereinId", "modulId") REFERENCES "ThreadModul"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Datei" ADD CONSTRAINT "Datei_vereinId_dokumentId_fkey" FOREIGN KEY ("vereinId", "dokumentId") REFERENCES "Dokument"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Datei" ADD CONSTRAINT "Datei_vereinId_vonId_fkey" FOREIGN KEY ("vereinId", "vonId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DokumentKategorie" ADD CONSTRAINT "DokumentKategorie_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dokument" ADD CONSTRAINT "Dokument_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dokument" ADD CONSTRAINT "Dokument_vereinId_kategorieId_fkey" FOREIGN KEY ("vereinId", "kategorieId") REFERENCES "DokumentKategorie"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Von Hand: CHECKs, ein Partial-Index und die Kategorien der schon bestehenden Vereine.

-- Eine Datei gehoert zu genau einem Modul oder genau einem Dokument. Beides oder
-- keins liesse sie ohne Besitzer oder doppelt aufgeraeumt zurueck.
ALTER TABLE "Datei" ADD CONSTRAINT datei_ein_verweis CHECK (("modulId" IS NULL) <> ("dokumentId" IS NULL));

-- 31457280 Bytes sind 30 MB und damit ueber den 25 MB fuer Dateien und den 20 MB
-- fuer Fotos: Der Code prueft die engere Grenze je Art, der CHECK faengt nur
-- Unsinn (leer, absurd gross) ab, falls ein Weg die Pruefung vergisst.
ALTER TABLE "Datei" ADD CONSTRAINT datei_groesse CHECK (groesse BETWEEN 1 AND 31457280);

-- Fotos kommen oft ohne brauchbaren Namen (die Kamera vergibt einen), eine Datei
-- im Dokument-Bereich wird aber unter ihrem Namen heruntergeladen und braucht einen.
ALTER TABLE "Datei" ADD CONSTRAINT datei_name CHECK (char_length(name) <= 120 AND (art = 'FOTO' OR char_length(name) >= 1));

-- Hoechstens eine Datei je Dokument: Ersetzen heisst, die alte Zeile zu loeschen und
-- eine neue anzulegen, nicht eine zweite danebenzustellen. Partial-Index statt
-- UNIQUE-Constraint, weil Dateien an Modulen dokumentId leer haben und NULL mehrfach
-- vorkommen darf.
CREATE UNIQUE INDEX datei_ein_dokument ON "Datei" ("dokumentId") WHERE "dokumentId" IS NOT NULL;

-- Name ohne Rand, damit "Formulare" und "Formulare " nicht zwei Kategorien werden.
ALTER TABLE "DokumentKategorie" ADD CONSTRAINT kategorie_name CHECK (char_length(name) BETWEEN 1 AND 40 AND name = btrim(name));
ALTER TABLE "DokumentKategorie" ADD CONSTRAINT kategorie_position CHECK (position >= 0);
ALTER TABLE "Dokument" ADD CONSTRAINT dokument_titel CHECK (char_length(titel) BETWEEN 1 AND 120 AND titel = btrim(titel));

-- Untergrenze 100 MB, damit ein Tippfehler im Admin den Verein nicht auf null setzt;
-- Obergrenze 1 TB (1048576 MB), damit die Summe in Byte weit unter 2^53 bleibt.
ALTER TABLE "Verein" ADD CONSTRAINT verein_speichergrenze CHECK ("speicherGrenzeMb" BETWEEN 100 AND 1048576);

-- Die drei Standard-Kategorien gehoeren zu jedem Verein, auch zu den schon
-- bestehenden. Fuer neue legt sie der Code beim Anlegen an (standardKategorien in
-- libs/db); die Namen und ihre Reihenfolge stehen deshalb an beiden Stellen, und
-- ein Test haelt sie zusammen. Die ID ist gen_random_uuid() statt cuid, weil
-- Postgres kein cuid kennt; sie ist trotzdem zufaellig und nicht erratbar.
INSERT INTO "DokumentKategorie" (id, "vereinId", name, position)
SELECT gen_random_uuid()::text, v.id, k.name, k.position FROM "Verein" v
CROSS JOIN (VALUES ('Ordnungen', 0), ('Merkblätter', 1), ('Formulare', 2)) AS k(name, position);
