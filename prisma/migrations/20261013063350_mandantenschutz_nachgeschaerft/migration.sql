-- DropForeignKey
ALTER TABLE "Bezugsperson" DROP CONSTRAINT "Bezugsperson_vereinId_erwachsenerId_fkey";

-- DropForeignKey
ALTER TABLE "Bezugsperson" DROP CONSTRAINT "Bezugsperson_vereinId_jungfischerId_fkey";

-- DropForeignKey
ALTER TABLE "Einladung" DROP CONSTRAINT "Einladung_vereinId_erstelltVonPersonId_fkey";

-- DropForeignKey
ALTER TABLE "Einladung" DROP CONSTRAINT "Einladung_vereinId_personId_fkey";

-- DropForeignKey
ALTER TABLE "Einwilligung" DROP CONSTRAINT "Einwilligung_vereinId_erteiltVon_fkey";

-- DropForeignKey
ALTER TABLE "Einwilligung" DROP CONSTRAINT "Einwilligung_vereinId_jungfischerId_fkey";

-- DropForeignKey
ALTER TABLE "Passkey" DROP CONSTRAINT "Passkey_vereinId_zugangId_fkey";

-- DropForeignKey
ALTER TABLE "RecoveryCode" DROP CONSTRAINT "RecoveryCode_vereinId_zugangId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_vereinId_zugangId_fkey";

-- DropForeignKey
ALTER TABLE "UntergruppeMitglied" DROP CONSTRAINT "UntergruppeMitglied_vereinId_personId_fkey";

-- DropForeignKey
ALTER TABLE "UntergruppeMitglied" DROP CONSTRAINT "UntergruppeMitglied_vereinId_untergruppeId_fkey";

-- DropForeignKey
ALTER TABLE "WebauthnChallenge" DROP CONSTRAINT "WebauthnChallenge_vereinId_personId_fkey";

-- DropForeignKey
ALTER TABLE "Zugang" DROP CONSTRAINT "Zugang_vereinId_personId_fkey";

-- AddForeignKey
ALTER TABLE "Bezugsperson" ADD CONSTRAINT "Bezugsperson_vereinId_erwachsenerId_fkey" FOREIGN KEY ("vereinId", "erwachsenerId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Bezugsperson" ADD CONSTRAINT "Bezugsperson_vereinId_jungfischerId_fkey" FOREIGN KEY ("vereinId", "jungfischerId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UntergruppeMitglied" ADD CONSTRAINT "UntergruppeMitglied_vereinId_untergruppeId_fkey" FOREIGN KEY ("vereinId", "untergruppeId") REFERENCES "Untergruppe"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UntergruppeMitglied" ADD CONSTRAINT "UntergruppeMitglied_vereinId_personId_fkey" FOREIGN KEY ("vereinId", "personId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Zugang" ADD CONSTRAINT "Zugang_vereinId_personId_fkey" FOREIGN KEY ("vereinId", "personId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_vereinId_zugangId_fkey" FOREIGN KEY ("vereinId", "zugangId") REFERENCES "Zugang"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_vereinId_zugangId_fkey" FOREIGN KEY ("vereinId", "zugangId") REFERENCES "Zugang"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WebauthnChallenge" ADD CONSTRAINT "WebauthnChallenge_vereinId_personId_fkey" FOREIGN KEY ("vereinId", "personId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_vereinId_zugangId_fkey" FOREIGN KEY ("vereinId", "zugangId") REFERENCES "Zugang"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Einladung" ADD CONSTRAINT "Einladung_vereinId_personId_fkey" FOREIGN KEY ("vereinId", "personId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Einladung" ADD CONSTRAINT "Einladung_vereinId_erstelltVonPersonId_fkey" FOREIGN KEY ("vereinId", "erstelltVonPersonId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Einwilligung" ADD CONSTRAINT "Einwilligung_vereinId_jungfischerId_fkey" FOREIGN KEY ("vereinId", "jungfischerId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Einwilligung" ADD CONSTRAINT "Einwilligung_vereinId_erteiltVon_fkey" FOREIGN KEY ("vereinId", "erteiltVon") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CHECK von Hand, wie in der ersten Migration (Prisma bildet CHECKs nicht ab).
-- Jede Challenge gehoert genau einer Art von Besitzer: Vereinszeilen haben eine
-- vereinId und nie eine adminId, Admin-Zeilen haben keine vereinId und deshalb
-- auch keine personId. Ohne vereinId prueft der zusammengesetzte Fremdschluessel
-- zu Person nichts (MATCH SIMPLE) — eine personId ohne vereinId waere ungeprueft
-- und ueberlebte das Loeschen ihres Vereins.
ALTER TABLE "WebauthnChallenge" ADD CONSTRAINT webauthn_challenge_besitzer CHECK (
	("personId" IS NULL OR "vereinId" IS NOT NULL) AND ("vereinId" IS NULL OR "adminId" IS NULL)
);
