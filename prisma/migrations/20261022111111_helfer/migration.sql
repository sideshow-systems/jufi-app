-- AlterEnum
-- Kein Ausdruck dieser Migration nutzt den neuen Wert: Postgres lehnt das in derselben
-- Transaktion ab.
ALTER TYPE "ModulTyp" ADD VALUE 'HELFER';

-- CreateTable
CREATE TABLE "HelferModul" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "einheit" "AntwortEinheit" NOT NULL DEFAULT 'ERWACHSENER',
    "frist" TIMESTAMP(3),

    CONSTRAINT "HelferModul_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelferPosition" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "modulId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "anzahl" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "schluessel" TEXT NOT NULL,

    CONSTRAINT "HelferPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelferEintrag" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "fuerId" TEXT NOT NULL,
    "vonId" TEXT NOT NULL,
    "notiz" TEXT,
    "eingetragenAm" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "HelferEintrag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HelferModul_vereinId_id_key" ON "HelferModul"("vereinId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HelferPosition_modulId_schluessel_key" ON "HelferPosition"("modulId", "schluessel");

-- CreateIndex
CREATE UNIQUE INDEX "HelferPosition_vereinId_id_key" ON "HelferPosition"("vereinId", "id");

-- CreateIndex
CREATE INDEX "HelferEintrag_vereinId_fuerId_idx" ON "HelferEintrag"("vereinId", "fuerId");

-- CreateIndex
CREATE INDEX "HelferEintrag_vereinId_vonId_idx" ON "HelferEintrag"("vereinId", "vonId");

-- CreateIndex
CREATE UNIQUE INDEX "HelferEintrag_positionId_fuerId_key" ON "HelferEintrag"("positionId", "fuerId");

-- CreateIndex
CREATE UNIQUE INDEX "HelferEintrag_vereinId_clientId_key" ON "HelferEintrag"("vereinId", "clientId");

-- AddForeignKey
ALTER TABLE "HelferModul" ADD CONSTRAINT "HelferModul_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelferModul" ADD CONSTRAINT "HelferModul_vereinId_id_fkey" FOREIGN KEY ("vereinId", "id") REFERENCES "ThreadModul"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HelferPosition" ADD CONSTRAINT "HelferPosition_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelferPosition" ADD CONSTRAINT "HelferPosition_vereinId_modulId_fkey" FOREIGN KEY ("vereinId", "modulId") REFERENCES "HelferModul"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HelferEintrag" ADD CONSTRAINT "HelferEintrag_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelferEintrag" ADD CONSTRAINT "HelferEintrag_vereinId_positionId_fkey" FOREIGN KEY ("vereinId", "positionId") REFERENCES "HelferPosition"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HelferEintrag" ADD CONSTRAINT "HelferEintrag_vereinId_fuerId_fkey" FOREIGN KEY ("vereinId", "fuerId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HelferEintrag" ADD CONSTRAINT "HelferEintrag_vereinId_vonId_fkey" FOREIGN KEY ("vereinId", "vonId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CHECK-Constraints, von Hand ergaenzt: Prisma bildet sie nicht ab und meldet fuer
-- sie auch keine Abweichung. Sie sind Doppelschutz zu libs/domain (GRENZEN in
-- entwurf.ts): Der Code prueft zuerst und antwortet verstaendlich, die CHECKs fangen
-- ab, was an ihm vorbeikommt. Dieselben Zahlen stehen dort.

-- Der Text steht als Zeile in der Liste; leer waere dort eine Luecke, laenger als 80
-- Zeichen bricht sie um. Anders als bei Titeln kein btrim: Der Code trimmt vor dem
-- Speichern, und ein Rand in der Datenbank schadet der Anzeige nicht.
ALTER TABLE "HelferPosition" ADD CONSTRAINT helfer_position_text CHECK (char_length(text) BETWEEN 1 AND 80);

-- Eine Position ohne Platz liesse sich nie belegen, und ueber 99 hinaus waere der
-- Fuellstand ("12/100") keine Zeile mehr.
ALTER TABLE "HelferPosition" ADD CONSTRAINT helfer_position_anzahl CHECK (anzahl BETWEEN 1 AND 99);

-- Wie modul_position und option_position: nicht eindeutig (Umsortieren in einer
-- Transaktion), nur nicht negativ.
ALTER TABLE "HelferPosition" ADD CONSTRAINT helfer_position_position CHECK (position >= 0);

-- Der Schluessel haengt in Anfragen und Aenderungsmeldungen; nur Kleinbuchstaben,
-- Ziffern und Bindestrich wie bei option_schluessel.
ALTER TABLE "HelferPosition" ADD CONSTRAINT helfer_position_schluessel CHECK (schluessel ~ '^[a-z0-9-]{1,40}$');

-- Keine Notiz heisst NULL, nie ein Leerstring: So gibt es genau eine Darstellung
-- fuer "ohne Notiz", und die Anzeige haengt keinen leeren Strich an den Namen.
ALTER TABLE "HelferEintrag" ADD CONSTRAINT helfer_eintrag_notiz CHECK (notiz IS NULL OR char_length(notiz) BETWEEN 1 AND 80);
