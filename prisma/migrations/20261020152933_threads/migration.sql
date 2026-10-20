-- CreateEnum
CREATE TYPE "ThreadArt" AS ENUM ('NORMAL', 'JUGENDSPRECHER_AUSTAUSCH');

-- CreateEnum
CREATE TYPE "ThreadModus" AS ENUM ('AUSHANG', 'KOMMENTARE', 'CHAT');

-- CreateEnum
CREATE TYPE "Rollenfilter" AS ENUM ('JUNGFISCHER_FAMILIE', 'NUR_FAMILIE', 'NUR_JUGENDLEITER', 'JUGENDLEITER_JUGENDSPRECHER');

-- CreateEnum
CREATE TYPE "ArchivModus" AS ENUM ('AUTOMATISCH', 'ARCHIVIERT', 'AKTIV_HALTEN');

-- CreateEnum
CREATE TYPE "ModulTyp" AS ENUM ('INFO', 'TERMIN', 'UMFRAGE');

-- CreateEnum
CREATE TYPE "AntwortEinheit" AS ENUM ('JUNGFISCHER', 'ERWACHSENER', 'PERSON');

-- CreateEnum
CREATE TYPE "ErgebnisSicht" AS ENUM ('ALLE', 'SUMME', 'JUGENDLEITER');

-- CreateEnum
CREATE TYPE "VerlaufArt" AS ENUM ('NACHRICHT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SystemArt" AS ENUM ('VEROEFFENTLICHT', 'TERMIN_GEAENDERT', 'FRIST_GEAENDERT', 'MODUS_GEAENDERT');

-- CreateEnum
CREATE TYPE "AenderungArt" AS ENUM ('THREAD', 'MODUL', 'ANTWORT', 'VERLAUF', 'SICHTBARKEIT', 'GELOESCHT');

-- AlterTable
ALTER TABLE "Verein" ADD COLUMN     "aenderungsstand" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "art" "ThreadArt" NOT NULL DEFAULT 'NORMAL',
    "titel" TEXT NOT NULL,
    "modus" "ThreadModus" NOT NULL,
    "rollenfilter" "Rollenfilter" NOT NULL,
    "alleUntergruppen" BOOLEAN NOT NULL DEFAULT true,
    "angepinnt" BOOLEAN NOT NULL DEFAULT false,
    "archivModus" "ArchivModus" NOT NULL DEFAULT 'AUTOMATISCH',
    "veroeffentlichtAm" TIMESTAMP(3),
    "erstelltVonId" TEXT,
    "letzteAktivitaetAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "letzteAktivitaetStand" INTEGER NOT NULL DEFAULT 0,
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geaendertAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadUntergruppe" (
    "vereinId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "untergruppeId" TEXT NOT NULL,

    CONSTRAINT "ThreadUntergruppe_pkey" PRIMARY KEY ("threadId","untergruppeId")
);

-- CreateTable
CREATE TABLE "ThreadModul" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "typ" "ModulTyp" NOT NULL,
    "position" INTEGER NOT NULL,
    "titel" TEXT,

    CONSTRAINT "ThreadModul_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfoModul" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "InfoModul_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminModul" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "startDatum" DATE NOT NULL,
    "endDatum" DATE,
    "beginn" TEXT,
    "ende" TEXT,
    "ort" TEXT,
    "treffpunkt" TEXT,

    CONSTRAINT "TerminModul_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UmfrageModul" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "frage" TEXT NOT NULL,
    "einheit" "AntwortEinheit" NOT NULL,
    "mehrfach" BOOLEAN NOT NULL DEFAULT false,
    "teilnahme" BOOLEAN NOT NULL DEFAULT false,
    "vielleicht" BOOLEAN NOT NULL DEFAULT true,
    "frist" TIMESTAMP(3),
    "ergebnisse" "ErgebnisSicht" NOT NULL DEFAULT 'ALLE',

    CONSTRAINT "UmfrageModul_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UmfrageOption" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "umfrageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "schluessel" TEXT NOT NULL,

    CONSTRAINT "UmfrageOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UmfrageAntwort" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "umfrageId" TEXT NOT NULL,
    "fuerId" TEXT NOT NULL,
    "vonId" TEXT NOT NULL,
    "abgegebenAm" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "UmfrageAntwort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UmfrageAntwortOption" (
    "vereinId" TEXT NOT NULL,
    "umfrageId" TEXT NOT NULL,
    "antwortId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "UmfrageAntwortOption_pkey" PRIMARY KEY ("antwortId","optionId")
);

-- CreateTable
CREATE TABLE "VerlaufEintrag" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "art" "VerlaufArt" NOT NULL,
    "autorId" TEXT,
    "text" TEXT,
    "systemArt" "SystemArt",
    "systemDaten" JSONB,
    "stand" INTEGER NOT NULL,
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geloeschtAm" TIMESTAMP(3),
    "geloeschtVonId" TEXT,
    "clientId" TEXT,

    CONSTRAINT "VerlaufEintrag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GelesenStand" (
    "vereinId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "gelesenBis" INTEGER NOT NULL,
    "verlaufGelesenBis" INTEGER NOT NULL,
    "gelesenAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GelesenStand_pkey" PRIMARY KEY ("personId","threadId")
);

-- CreateTable
CREATE TABLE "Aenderung" (
    "id" TEXT NOT NULL,
    "vereinId" TEXT NOT NULL,
    "stand" INTEGER NOT NULL,
    "threadId" TEXT,
    "art" "AenderungArt" NOT NULL,
    "objektId" TEXT NOT NULL,
    "urheberId" TEXT,
    "angelegtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aenderung_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Thread_vereinId_letzteAktivitaetAm_idx" ON "Thread"("vereinId", "letzteAktivitaetAm");

-- CreateIndex
CREATE UNIQUE INDEX "Thread_vereinId_id_key" ON "Thread"("vereinId", "id");

-- CreateIndex
CREATE INDEX "ThreadUntergruppe_vereinId_untergruppeId_idx" ON "ThreadUntergruppe"("vereinId", "untergruppeId");

-- CreateIndex
CREATE INDEX "ThreadModul_vereinId_threadId_idx" ON "ThreadModul"("vereinId", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadModul_vereinId_id_key" ON "ThreadModul"("vereinId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadModul_vereinId_id_threadId_key" ON "ThreadModul"("vereinId", "id", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "InfoModul_vereinId_id_key" ON "InfoModul"("vereinId", "id");

-- CreateIndex
CREATE INDEX "TerminModul_vereinId_startDatum_idx" ON "TerminModul"("vereinId", "startDatum");

-- CreateIndex
CREATE UNIQUE INDEX "TerminModul_vereinId_id_key" ON "TerminModul"("vereinId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UmfrageModul_vereinId_id_key" ON "UmfrageModul"("vereinId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UmfrageModul_vereinId_id_threadId_key" ON "UmfrageModul"("vereinId", "id", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "UmfrageOption_umfrageId_schluessel_key" ON "UmfrageOption"("umfrageId", "schluessel");

-- CreateIndex
CREATE UNIQUE INDEX "UmfrageOption_vereinId_umfrageId_id_key" ON "UmfrageOption"("vereinId", "umfrageId", "id");

-- CreateIndex
CREATE INDEX "UmfrageAntwort_vereinId_fuerId_idx" ON "UmfrageAntwort"("vereinId", "fuerId");

-- CreateIndex
CREATE INDEX "UmfrageAntwort_vereinId_vonId_idx" ON "UmfrageAntwort"("vereinId", "vonId");

-- CreateIndex
CREATE UNIQUE INDEX "UmfrageAntwort_umfrageId_fuerId_key" ON "UmfrageAntwort"("umfrageId", "fuerId");

-- CreateIndex
CREATE UNIQUE INDEX "UmfrageAntwort_vereinId_clientId_key" ON "UmfrageAntwort"("vereinId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "UmfrageAntwort_vereinId_umfrageId_id_key" ON "UmfrageAntwort"("vereinId", "umfrageId", "id");

-- CreateIndex
CREATE INDEX "VerlaufEintrag_vereinId_threadId_stand_idx" ON "VerlaufEintrag"("vereinId", "threadId", "stand");

-- CreateIndex
CREATE UNIQUE INDEX "VerlaufEintrag_vereinId_clientId_key" ON "VerlaufEintrag"("vereinId", "clientId");

-- CreateIndex
CREATE INDEX "GelesenStand_vereinId_threadId_idx" ON "GelesenStand"("vereinId", "threadId");

-- CreateIndex
CREATE INDEX "Aenderung_vereinId_stand_idx" ON "Aenderung"("vereinId", "stand");

-- CreateIndex
CREATE INDEX "Aenderung_vereinId_threadId_stand_idx" ON "Aenderung"("vereinId", "threadId", "stand");

-- CreateIndex
CREATE INDEX "Aenderung_angelegtAm_idx" ON "Aenderung"("angelegtAm");

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_vereinId_erstelltVonId_fkey" FOREIGN KEY ("vereinId", "erstelltVonId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ThreadUntergruppe" ADD CONSTRAINT "ThreadUntergruppe_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadUntergruppe" ADD CONSTRAINT "ThreadUntergruppe_vereinId_threadId_fkey" FOREIGN KEY ("vereinId", "threadId") REFERENCES "Thread"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ThreadUntergruppe" ADD CONSTRAINT "ThreadUntergruppe_vereinId_untergruppeId_fkey" FOREIGN KEY ("vereinId", "untergruppeId") REFERENCES "Untergruppe"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ThreadModul" ADD CONSTRAINT "ThreadModul_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadModul" ADD CONSTRAINT "ThreadModul_vereinId_threadId_fkey" FOREIGN KEY ("vereinId", "threadId") REFERENCES "Thread"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InfoModul" ADD CONSTRAINT "InfoModul_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfoModul" ADD CONSTRAINT "InfoModul_vereinId_id_fkey" FOREIGN KEY ("vereinId", "id") REFERENCES "ThreadModul"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TerminModul" ADD CONSTRAINT "TerminModul_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminModul" ADD CONSTRAINT "TerminModul_vereinId_id_fkey" FOREIGN KEY ("vereinId", "id") REFERENCES "ThreadModul"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UmfrageModul" ADD CONSTRAINT "UmfrageModul_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UmfrageModul" ADD CONSTRAINT "UmfrageModul_vereinId_id_threadId_fkey" FOREIGN KEY ("vereinId", "id", "threadId") REFERENCES "ThreadModul"("vereinId", "id", "threadId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UmfrageOption" ADD CONSTRAINT "UmfrageOption_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UmfrageOption" ADD CONSTRAINT "UmfrageOption_vereinId_umfrageId_fkey" FOREIGN KEY ("vereinId", "umfrageId") REFERENCES "UmfrageModul"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UmfrageAntwort" ADD CONSTRAINT "UmfrageAntwort_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UmfrageAntwort" ADD CONSTRAINT "UmfrageAntwort_vereinId_umfrageId_fkey" FOREIGN KEY ("vereinId", "umfrageId") REFERENCES "UmfrageModul"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UmfrageAntwort" ADD CONSTRAINT "UmfrageAntwort_vereinId_fuerId_fkey" FOREIGN KEY ("vereinId", "fuerId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UmfrageAntwort" ADD CONSTRAINT "UmfrageAntwort_vereinId_vonId_fkey" FOREIGN KEY ("vereinId", "vonId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UmfrageAntwortOption" ADD CONSTRAINT "UmfrageAntwortOption_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UmfrageAntwortOption" ADD CONSTRAINT "UmfrageAntwortOption_vereinId_umfrageId_antwortId_fkey" FOREIGN KEY ("vereinId", "umfrageId", "antwortId") REFERENCES "UmfrageAntwort"("vereinId", "umfrageId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UmfrageAntwortOption" ADD CONSTRAINT "UmfrageAntwortOption_vereinId_umfrageId_optionId_fkey" FOREIGN KEY ("vereinId", "umfrageId", "optionId") REFERENCES "UmfrageOption"("vereinId", "umfrageId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "VerlaufEintrag" ADD CONSTRAINT "VerlaufEintrag_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerlaufEintrag" ADD CONSTRAINT "VerlaufEintrag_vereinId_threadId_fkey" FOREIGN KEY ("vereinId", "threadId") REFERENCES "Thread"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "VerlaufEintrag" ADD CONSTRAINT "VerlaufEintrag_vereinId_autorId_fkey" FOREIGN KEY ("vereinId", "autorId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "VerlaufEintrag" ADD CONSTRAINT "VerlaufEintrag_vereinId_geloeschtVonId_fkey" FOREIGN KEY ("vereinId", "geloeschtVonId") REFERENCES "Person"("vereinId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GelesenStand" ADD CONSTRAINT "GelesenStand_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GelesenStand" ADD CONSTRAINT "GelesenStand_vereinId_personId_fkey" FOREIGN KEY ("vereinId", "personId") REFERENCES "Person"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GelesenStand" ADD CONSTRAINT "GelesenStand_vereinId_threadId_fkey" FOREIGN KEY ("vereinId", "threadId") REFERENCES "Thread"("vereinId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Aenderung" ADD CONSTRAINT "Aenderung_vereinId_fkey" FOREIGN KEY ("vereinId") REFERENCES "Verein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK-Constraints und Partial-Unique-Indizes, von Hand ergaenzt: Prisma bildet
-- sie nicht ab und meldet fuer sie auch keine Abweichung zwischen Schema und
-- Datenbank. Wie in den frueheren Migrationen sind die CHECKs Doppelschutz zu
-- libs/domain: Der Code prueft zuerst und antwortet verstaendlich, die CHECKs
-- fangen ab, was an ihm vorbeikommt.

-- Titel erscheinen in der Liste und im Kopf des Threads. Ein Leerstring oder ein
-- Titel mit Leerzeichen am Rand waere dort unsichtbar bzw. verrutscht; die Obergrenze
-- haelt die Liste einzeilig lesbar.
ALTER TABLE "Thread" ADD CONSTRAINT thread_titel CHECK (
	char_length(titel) BETWEEN 1 AND 120 AND titel = btrim(titel)
);

-- Nur den Austausch legt das System an, jeden anderen Thread ein Jugendleiter.
-- Ein normaler Thread ohne Ersteller waere ein Thread, den niemand bearbeiten
-- darf und dem man nicht ansieht, woher er kommt.
ALTER TABLE "Thread" ADD CONSTRAINT thread_ersteller CHECK (
	art = 'JUGENDSPRECHER_AUSTAUSCH' OR "erstelltVonId" IS NOT NULL
);

-- Je Verein genau ein Jugendsprecher-Austausch. Ein gewoehnlicher UNIQUE ueber
-- (vereinId, art) haette auch die normalen Threads auf einen je Verein begrenzt,
-- darum der Index nur ueber die Zeilen des Austauschs.
CREATE UNIQUE INDEX thread_ein_austausch ON "Thread" ("vereinId") WHERE art = 'JUGENDSPRECHER_AUSTAUSCH';

-- position ist absichtlich nicht eindeutig (Umsortieren in einer Transaktion
-- verletzte einen eindeutigen Index zeilenweise); nur negative Werte bleiben
-- ausgeschlossen, damit "nach vorn schieben" nie unter die erste Stelle faellt.
ALTER TABLE "ThreadModul" ADD CONSTRAINT modul_position CHECK (position >= 0);
ALTER TABLE "UmfrageOption" ADD CONSTRAINT option_position CHECK (position >= 0);

-- Obergrenze des Info-Texts; sie schuetzt Datenbank und Anzeige vor einem Text,
-- den ein Fehler im Client aufblaeht. Eine Untergrenze gibt es nicht: Ob ein
-- Modul ohne Text zulaessig ist, entscheidet der Editor in libs/domain.
ALTER TABLE "InfoModul" ADD CONSTRAINT info_text CHECK (char_length(text) <= 10000);

-- Ein Termin endet nicht vor seinem Beginn. endDatum ist optional (eintaegig).
ALTER TABLE "TerminModul" ADD CONSTRAINT termin_reihenfolge CHECK (
	"endDatum" IS NULL OR "endDatum" >= "startDatum"
);

-- Uhrzeiten sind Text HH:MM (Wandzeit, kein Zeitpunkt). Ohne das Muster liesse
-- "24:00" oder "9:5" zu, und der Textvergleich in termin_eintaegig stimmte nicht
-- mehr mit der Reihenfolge der Uhrzeiten ueberein.
ALTER TABLE "TerminModul" ADD CONSTRAINT termin_uhrzeit CHECK (
	(beginn IS NULL OR beginn ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
	AND (ende IS NULL OR ende ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

-- Am selben Tag muss das Ende nach dem Beginn liegen; ueber mehrere Tage darf es
-- frueher sein ("Fr 17:00 bis So 12:00"). Ein Ende ohne Beginn ist erlaubt ("Fr
-- 23.10. - So 25.10. 12:00", im Entwurf "bis 12:00"). Verworfen: Ende nur mit
-- Beginn, wie TP3-Spec 2.2 es zunaechst verlangte -- es verbote diese Anzeige.
ALTER TABLE "TerminModul" ADD CONSTRAINT termin_eintaegig CHECK (
	NOT (
		("endDatum" IS NULL OR "endDatum" = "startDatum")
		AND beginn IS NOT NULL AND ende IS NOT NULL AND ende <= beginn
	)
);

-- Die Frage steht als Ueberschrift ueber den Antworten; leer oder nur aus
-- Leerzeichen waere dort eine Luecke.
ALTER TABLE "UmfrageModul" ADD CONSTRAINT umfrage_frage CHECK (char_length(btrim(frage)) BETWEEN 1 AND 200);

-- Hoechstens eine Teilnahme-Umfrage je Thread ("Kommst du mit?"): Die Anzeige
-- der Teilnahme am Thread und die Liste "Braucht deine Antwort" rechnen mit
-- genau einer. Partial-Index statt CHECK, weil die Regel mehrere Zeilen betrifft.
CREATE UNIQUE INDEX umfrage_eine_teilnahme ON "UmfrageModul" ("threadId") WHERE teilnahme;

-- Der Schluessel ist die stabile Kennung einer Option und steht in Adressen und
-- Auswertungen; darum nur Kleinbuchstaben, Ziffern und Bindestrich.
ALTER TABLE "UmfrageOption" ADD CONSTRAINT option_schluessel CHECK (schluessel ~ '^[a-z0-9-]{1,40}$');
ALTER TABLE "UmfrageOption" ADD CONSTRAINT option_text CHECK (char_length(btrim(text)) BETWEEN 1 AND 200);

-- Eine Nachricht hat immer einen Autor, nie eine Systemart, und ihr Text fehlt
-- genau dann, wenn sie geloescht ist. Ohne die letzte Bedingung bliebe der
-- Wortlaut einer "geloeschten" Nachricht in der Datenbank stehen, oder eine
-- lebende Nachricht haette keinen.
ALTER TABLE "VerlaufEintrag" ADD CONSTRAINT verlauf_nachricht CHECK (
	art <> 'NACHRICHT'
	OR ("autorId" IS NOT NULL AND "systemArt" IS NULL AND (text IS NULL) = ("geloeschtAm" IS NOT NULL))
);

-- Ein Systemeintrag nennt seine Art und traegt nie Text: Den Satz baut die
-- Anzeige aus systemArt und systemDaten, ein gespeicherter Wortlaut wuerde nach
-- einer Umbenennung veralten.
ALTER TABLE "VerlaufEintrag" ADD CONSTRAINT verlauf_system CHECK (
	art <> 'SYSTEM' OR ("systemArt" IS NOT NULL AND text IS NULL)
);

-- Zeitpunkt und Person des Loeschens gehoeren zusammen; sonst zeigte die Anzeige
-- "Von einem Jugendleiter entfernt" ohne zu wissen, wer.
ALTER TABLE "VerlaufEintrag" ADD CONSTRAINT verlauf_geloescht CHECK (
	("geloeschtAm" IS NULL) = ("geloeschtVonId" IS NULL)
);

-- Nachrichten sind 1 bis 2000 Zeichen Klartext; ein leerer Text wuerde als
-- Nachricht ohne Inhalt erscheinen, deshalb bedeutet "geloescht" NULL, nicht ''.
ALTER TABLE "VerlaufEintrag" ADD CONSTRAINT verlauf_text CHECK (
	text IS NULL OR char_length(text) BETWEEN 1 AND 2000
);

-- Der Jugendsprecher-Austausch gehoert zu jedem Verein, auch zu den schon
-- bestehenden. Fuer neue Vereine legt ihn spaeter der Code beim Anlegen an; hier
-- holt die Migration die vorhandenen nach. Die ID ist gen_random_uuid() statt
-- cuid, weil Postgres kein cuid kennt; sie ist trotzdem zufaellig und nicht
-- erratbar.
INSERT INTO "Thread" (
	id, "vereinId", art, titel, modus, rollenfilter, "alleUntergruppen", angepinnt,
	"archivModus", "veroeffentlichtAm", "letzteAktivitaetAm", "letzteAktivitaetStand",
	"angelegtAm", "geaendertAm"
)
SELECT
	gen_random_uuid()::text, id, 'JUGENDSPRECHER_AUSTAUSCH', 'Jugendsprecher-Austausch', 'CHAT',
	'JUGENDLEITER_JUGENDSPRECHER', true, true, 'AUTOMATISCH', now(), now(), 0, now(), now()
FROM "Verein";
