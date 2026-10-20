-- AlterEnum
ALTER TYPE "AenderungArt" ADD VALUE 'LISTE';

-- AlterTable
ALTER TABLE "Thread" ADD COLUMN     "bearbeitetStand" INTEGER NOT NULL DEFAULT 0;

-- Grenzen, die die Spec offen liess (Plan-Entscheidung 8), von Hand ergaenzt: Prisma
-- bildet CHECKs nicht ab. Wie die uebrigen sind sie Doppelschutz zu libs/domain: Der
-- Editor prueft zuerst und antwortet verstaendlich, die CHECKs fangen ab, was an ihm
-- vorbeikommt. Ein Leerstring ist kein Titel und kein Ort; "keine Angabe" heisst NULL.
ALTER TABLE "ThreadModul" ADD CONSTRAINT modul_titel CHECK (
	titel IS NULL OR char_length(titel) BETWEEN 1 AND 80
);
ALTER TABLE "TerminModul" ADD CONSTRAINT termin_ort CHECK (
	ort IS NULL OR char_length(ort) BETWEEN 1 AND 200
);
ALTER TABLE "TerminModul" ADD CONSTRAINT termin_treffpunkt CHECK (
	treffpunkt IS NULL OR char_length(treffpunkt) BETWEEN 1 AND 200
);
