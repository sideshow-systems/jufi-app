-- AlterTable
ALTER TABLE "Verein" ADD COLUMN     "sperrzaehler" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Zugang" ADD COLUMN     "letzteAnmeldungAm" TIMESTAMP(3);
