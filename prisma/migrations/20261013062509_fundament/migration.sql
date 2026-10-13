-- CreateEnum
CREATE TYPE "VereinStatus" AS ENUM ('AKTIV', 'GESPERRT');

-- CreateEnum
CREATE TYPE "PersonArt" AS ENUM ('JUNGFISCHER', 'ERWACHSENER');

-- CreateEnum
CREATE TYPE "Recht" AS ENUM ('MITGLIEDER', 'THREADS_ERSTELLEN', 'ALLE_THREADS', 'DOKUMENTE', 'ANTWORTEN_DETAIL', 'JUGENDLEITER_RECHTE', 'EINSTELLUNGEN');

-- CreateEnum
CREATE TYPE "Beziehung" AS ENUM ('MUTTER', 'VATER', 'GROSSMUTTER', 'GROSSVATER', 'TANTE', 'ONKEL', 'GESCHWISTER', 'PFLEGEPERSON', 'ANDERE');

-- CreateEnum
CREATE TYPE "EinladungArt" AS ENUM ('EINLADUNG', 'RESET');

-- CreateEnum
CREATE TYPE "EinwilligungArt" AS ENUM ('DSGVO_ART8');

-- CreateEnum
CREATE TYPE "AdminAktion" AS ENUM ('VEREIN_ANGELEGT', 'GESPERRT', 'ENTSPERRT', 'SLUG_KORRIGIERT', 'NOTFALL_LINK', 'ERSTE_EINLADUNG_ERNEUERT');

-- CreateTable
CREATE TABLE "Verein" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "anzeigename" TEXT NOT NULL,
    "farbe" TEXT NOT NULL,
    "kontakt" TEXT,
    "status" "VereinStatus" NOT NULL DEFAULT 'AKTIV',
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verein_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VereinLogo" (
    "vereinId" TEXT NOT NULL,
    "bild" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "icon192" BYTEA NOT NULL,
    "icon512" BYTEA NOT NULL,
    "geaendertAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VereinLogo_pkey" PRIMARY KEY ("vereinId")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "art" "PersonArt" NOT NULL,
    "vorname" TEXT NOT NULL,
    "nachname" TEXT NOT NULL,
    "geburtsdatum" DATE,
    "jugendsprecher" BOOLEAN NOT NULL DEFAULT false,
    "zugangErlaubt" BOOLEAN NOT NULL DEFAULT true,
    "volljaehrigGeprueftAm" TIMESTAMP(3),
    "rechte" "Recht"[] DEFAULT ARRAY[]::"Recht"[],
    "entferntAm" TIMESTAMP(3),
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bezugsperson" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "erwachsenerId" TEXT NOT NULL,
    "jungfischerId" TEXT NOT NULL,
    "beziehung" "Beziehung" NOT NULL,
    "beziehungFreitext" TEXT,
    "erziehungsberechtigt" BOOLEAN NOT NULL,
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bezugsperson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Untergruppe" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Untergruppe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UntergruppeMitglied" (
    "vereinId" TEXT NOT NULL,
    "untergruppeId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "UntergruppeMitglied_pkey" PRIMARY KEY ("untergruppeId","personId")
);

-- CreateTable
CREATE TABLE "Zugang" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "email" TEXT,
    "anmeldename" TEXT,
    "passwortHash" TEXT,
    "totpGeheimnis" TEXT,
    "totpAktivAm" TIMESTAMP(3),
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Zugang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "zugangId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "zugangId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "verwendetAm" TIMESTAMP(3),

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebauthnChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "vereinId" TEXT,
    "personId" TEXT,
    "adminId" TEXT,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebauthnChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "zugangId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ablauf" TIMESTAMP(3) NOT NULL,
    "zuletztGesehen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Einladung" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "art" "EinladungArt" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ablauf" TIMESTAMP(3) NOT NULL,
    "eingeloestAm" TIMESTAMP(3),
    "erstelltVonPersonId" TEXT,
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Einladung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Einwilligung" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "jungfischerId" TEXT NOT NULL,
    "erteiltVon" TEXT NOT NULL,
    "art" "EinwilligungArt" NOT NULL,
    "textVersion" TEXT NOT NULL,
    "erteiltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "widerrufenAm" TIMESTAMP(3),

    CONSTRAINT "Einwilligung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailWarteschlange" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT,
    "empfaenger" TEXT NOT NULL,
    "betreff" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "versuche" INTEGER NOT NULL DEFAULT 0,
    "naechsterVersuch" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gesendetAm" TIMESTAMP(3),
    "fehler" TEXT,
    "bezug" TEXT,
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailWarteschlange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlattformAdmin" (
    "id" TEXT NOT NULL,
    "benutzername" TEXT NOT NULL,
    "passwortHash" TEXT,
    "totpGeheimnis" TEXT,
    "totpAktivAm" TIMESTAMP(3),
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlattformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ablauf" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPasskey" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AdminPasskey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminRecoveryCode" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "verwendetAm" TIMESTAMP(3),

    CONSTRAINT "AdminRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminEinrichtung" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ablauf" TIMESTAMP(3) NOT NULL,
    "eingeloestAm" TIMESTAMP(3),
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminEinrichtung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminProtokoll" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "zeitpunkt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktion" "AdminAktion" NOT NULL,
    "vereinId" TEXT NOT NULL,
    "vereinSlug" TEXT NOT NULL,
    "betroffenePersonId" TEXT,

    CONSTRAINT "AdminProtokoll_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Verein_slug_key" ON "Verein"("slug");

-- CreateIndex
CREATE INDEX "Person_vereinId_art_idx" ON "Person"("vereinId", "art");

-- CreateIndex
CREATE UNIQUE INDEX "Person_vereinId_id_key" ON "Person"("vereinId", "id");

-- CreateIndex
CREATE INDEX "Bezugsperson_vereinId_erwachsenerId_idx" ON "Bezugsperson"("vereinId", "erwachsenerId");

-- CreateIndex
CREATE INDEX "Bezugsperson_vereinId_jungfischerId_idx" ON "Bezugsperson"("vereinId", "jungfischerId");

-- CreateIndex
CREATE UNIQUE INDEX "Bezugsperson_erwachsenerId_jungfischerId_key" ON "Bezugsperson"("erwachsenerId", "jungfischerId");

-- CreateIndex
CREATE UNIQUE INDEX "Untergruppe_vereinId_name_key" ON "Untergruppe"("vereinId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Untergruppe_vereinId_id_key" ON "Untergruppe"("vereinId", "id");

-- CreateIndex
CREATE INDEX "UntergruppeMitglied_vereinId_personId_idx" ON "UntergruppeMitglied"("vereinId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "Zugang_personId_key" ON "Zugang"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Zugang_vereinId_id_key" ON "Zugang"("vereinId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Zugang_vereinId_personId_key" ON "Zugang"("vereinId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "Zugang_vereinId_email_key" ON "Zugang"("vereinId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Zugang_vereinId_anmeldename_key" ON "Zugang"("vereinId", "anmeldename");

-- CreateIndex
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");

-- CreateIndex
CREATE INDEX "Passkey_vereinId_zugangId_idx" ON "Passkey"("vereinId", "zugangId");

-- CreateIndex
CREATE INDEX "RecoveryCode_vereinId_zugangId_idx" ON "RecoveryCode"("vereinId", "zugangId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_zugangId_codeHash_key" ON "RecoveryCode"("zugangId", "codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "WebauthnChallenge_challenge_key" ON "WebauthnChallenge"("challenge");

-- CreateIndex
CREATE INDEX "WebauthnChallenge_expiresAt_idx" ON "WebauthnChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_vereinId_zugangId_idx" ON "Session"("vereinId", "zugangId");

-- CreateIndex
CREATE UNIQUE INDEX "Einladung_tokenHash_key" ON "Einladung"("tokenHash");

-- CreateIndex
CREATE INDEX "Einladung_vereinId_personId_art_idx" ON "Einladung"("vereinId", "personId", "art");

-- CreateIndex
CREATE INDEX "Einladung_vereinId_erstelltVonPersonId_idx" ON "Einladung"("vereinId", "erstelltVonPersonId");

-- CreateIndex
CREATE INDEX "Einwilligung_vereinId_jungfischerId_idx" ON "Einwilligung"("vereinId", "jungfischerId");

-- CreateIndex
CREATE INDEX "Einwilligung_vereinId_erteiltVon_idx" ON "Einwilligung"("vereinId", "erteiltVon");

-- CreateIndex
CREATE INDEX "MailWarteschlange_gesendetAm_naechsterVersuch_idx" ON "MailWarteschlange"("gesendetAm", "naechsterVersuch");

-- CreateIndex
CREATE INDEX "MailWarteschlange_vereinId_bezug_idx" ON "MailWarteschlange"("vereinId", "bezug");

-- CreateIndex
CREATE UNIQUE INDEX "PlattformAdmin_benutzername_key" ON "PlattformAdmin"("benutzername");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_adminId_idx" ON "AdminSession"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPasskey_credentialId_key" ON "AdminPasskey"("credentialId");

-- CreateIndex
CREATE INDEX "AdminPasskey_adminId_idx" ON "AdminPasskey"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRecoveryCode_adminId_codeHash_key" ON "AdminRecoveryCode"("adminId", "codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "AdminEinrichtung_tokenHash_key" ON "AdminEinrichtung"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminEinrichtung_adminId_idx" ON "AdminEinrichtung"("adminId");

-- CreateIndex
CREATE INDEX "AdminProtokoll_vereinId_zeitpunkt_idx" ON "AdminProtokoll"("vereinId", "zeitpunkt");

-- AddForeignKey
ALTER TABLE "VereinLogo" ADD CONSTRAINT "VereinLogo_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bezugsperson" ADD CONSTRAINT "Bezugsperson_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bezugsperson" ADD CONSTRAINT "Bezugsperson_vereinId_erwachsenerId_fkey" FOREIGN KEY ("vereinId", "erwachsenerId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bezugsperson" ADD CONSTRAINT "Bezugsperson_vereinId_jungfischerId_fkey" FOREIGN KEY ("vereinId", "jungfischerId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Untergruppe" ADD CONSTRAINT "Untergruppe_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UntergruppeMitglied" ADD CONSTRAINT "UntergruppeMitglied_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UntergruppeMitglied" ADD CONSTRAINT "UntergruppeMitglied_vereinId_untergruppeId_fkey" FOREIGN KEY ("vereinId", "untergruppeId") REFERENCES "Untergruppe"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UntergruppeMitglied" ADD CONSTRAINT "UntergruppeMitglied_vereinId_personId_fkey" FOREIGN KEY ("vereinId", "personId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zugang" ADD CONSTRAINT "Zugang_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zugang" ADD CONSTRAINT "Zugang_vereinId_personId_fkey" FOREIGN KEY ("vereinId", "personId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_vereinId_zugangId_fkey" FOREIGN KEY ("vereinId", "zugangId") REFERENCES "Zugang"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_vereinId_zugangId_fkey" FOREIGN KEY ("vereinId", "zugangId") REFERENCES "Zugang"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebauthnChallenge" ADD CONSTRAINT "WebauthnChallenge_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebauthnChallenge" ADD CONSTRAINT "WebauthnChallenge_vereinId_personId_fkey" FOREIGN KEY ("vereinId", "personId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebauthnChallenge" ADD CONSTRAINT "WebauthnChallenge_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlattformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_vereinId_zugangId_fkey" FOREIGN KEY ("vereinId", "zugangId") REFERENCES "Zugang"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Einladung" ADD CONSTRAINT "Einladung_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Einladung" ADD CONSTRAINT "Einladung_vereinId_personId_fkey" FOREIGN KEY ("vereinId", "personId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Einladung" ADD CONSTRAINT "Einladung_vereinId_erstelltVonPersonId_fkey" FOREIGN KEY ("vereinId", "erstelltVonPersonId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Einwilligung" ADD CONSTRAINT "Einwilligung_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Einwilligung" ADD CONSTRAINT "Einwilligung_vereinId_jungfischerId_fkey" FOREIGN KEY ("vereinId", "jungfischerId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Einwilligung" ADD CONSTRAINT "Einwilligung_vereinId_erteiltVon_fkey" FOREIGN KEY ("vereinId", "erteiltVon") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailWarteschlange" ADD CONSTRAINT "MailWarteschlange_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlattformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPasskey" ADD CONSTRAINT "AdminPasskey_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlattformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRecoveryCode" ADD CONSTRAINT "AdminRecoveryCode_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlattformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminEinrichtung" ADD CONSTRAINT "AdminEinrichtung_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlattformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminProtokoll" ADD CONSTRAINT "AdminProtokoll_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlattformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK-Constraints, von Hand ergaenzt: Prisma bildet sie nicht ab und meldet
-- fuer sie auch keine Abweichung zwischen Schema und Datenbank.
--
-- Doppelschutz zu libs/domain (Spec 3.3): Die Regeln prueft zuerst der Code und
-- antwortet mit einer verstaendlichen Meldung. Die CHECKs fangen ab, was an ihm
-- vorbeikommt (Kommandozeile, Skripte, ein vergessener Aufruf), bevor ein
-- widerspruechlicher Datensatz entsteht.
--
-- Beim Jungfischer ist das Geburtsdatum Pflicht, ausser beim Grabstein
-- (entferntAm gesetzt): Entfernen leert Namen und Geburtsdatum (Spec 5.8), die
-- Zeile bleibt nur, damit spaetere Antworten und die Einwilligung als Nachweis
-- weiter auf sie verweisen koennen.
ALTER TABLE "Verein" ADD CONSTRAINT verein_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 30);
ALTER TABLE "Verein" ADD CONSTRAINT verein_anzeigename CHECK (char_length(anzeigename) BETWEEN 1 AND 24);
ALTER TABLE "Person" ADD CONSTRAINT person_art_felder CHECK (
	(art = 'JUNGFISCHER' AND cardinality(rechte) = 0 AND (geburtsdatum IS NOT NULL OR "entferntAm" IS NOT NULL))
	OR (art = 'ERWACHSENER' AND geburtsdatum IS NULL AND jugendsprecher = false AND "volljaehrigGeprueftAm" IS NULL)
);
ALTER TABLE "Bezugsperson" ADD CONSTRAINT bezugsperson_freitext CHECK (
	(beziehung = 'ANDERE') = ("beziehungFreitext" IS NOT NULL AND btrim("beziehungFreitext") <> '')
);
ALTER TABLE "Zugang" ADD CONSTRAINT zugang_kennung CHECK (email IS NOT NULL OR anmeldename IS NOT NULL);
ALTER TABLE "Zugang" ADD CONSTRAINT zugang_kleinschreibung CHECK (email = lower(email) AND anmeldename = lower(anmeldename));
