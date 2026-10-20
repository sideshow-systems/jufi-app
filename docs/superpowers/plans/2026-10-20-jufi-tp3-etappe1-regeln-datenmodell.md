# JuFi TP3 Etappe 1 — Regeln und Datenmodell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Datenbank kennt Threads, Module (Info-Text, Termin, Umfrage), Antworten, Verlauf, Gelesen-Stand und Änderungszähler; jeder Verein hat seinen Jugendsprecher-Austausch; alle Fachregeln aus Abschnitt 3 der TP3-Spec liegen testgetrieben als reine Funktionen in `libs/domain`.

**Architecture:** Ein Prisma-Schema-Schritt mit einer Migration (Tabellen, handgeschriebene CHECKs, Partial-Unique-Indizes, Austausch für bestehende Vereine). In `libs/db` kommen `austauschAnlegen` und `mitAenderung` dazu, beides gegen die Testdatenbank geprüft. Die Regeln entscheiden im Speicher über ein **Umfeld** (Personen, Familie, Untergruppen) und die **Thread-Daten**; Server und Oberfläche kommen erst ab Etappe 2. Keine neue Route, keine neue Seite.

**Tech Stack:** Nx 23, pnpm 10, Prisma 7, Postgres 17, Vitest 4, TypeScript (ESM, `.js`-Endungen in Importen).

**Spec:** `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md` — Abschnitte 2 (Datenmodell), 3 (Fachregeln), 8 (Austausch), 1.4 (Etappe 1). Dazu `2026-10-12-jufi-familie-jugendsprecher-kalender-design.md` 3.1/3.2 (Terminform) und die Rahmen-Spec.

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 9 trägt sie in die TP3-Spec ein.

1. **Endezeit ohne Beginn ist erlaubt.** FAM 3.1 zeigt „Fr 23.10. – So 25.10. 12:00“, der Entwurf „bis 12:00“. TP3-Spec 2.2 und 3.8 verbieten es fälschlich.
2. **Ein Änderungsstand je Transaktion, nicht je Zeile.** `mitAenderung` vergibt einen Stand, die Arbeit der Transaktion bekommt ihn vorab (ein Verlaufseintrag braucht seinen Stand beim Anlegen, seine ID entsteht erst dabei). `Aenderung` hat deshalb eine eigene ID und einen Index `(vereinId, stand)` statt eines eindeutigen Paars. Lückenlos bleibt der Zähler: Jede committete schreibende Transaktion hat genau einen Stand.
3. **Stände als `Int`, nicht `BigInt`.** 2,1 Milliarden Änderungen je Verein werden nie erreicht; `BigInt` bräche `JSON.stringify` an jeder API-Grenze.
4. **`position` von Modulen und Optionen ist in der Datenbank nicht eindeutig.** Umsortieren in einer Transaktion verletzte einen eindeutigen Index zeilenweise. Sortiert wird nach `(position, id)`; den Editor prüft die Domäne.
5. **Namen in den Ergebnissen sieht auch, wer den Thread bearbeiten darf** (zusätzlich zu „Antworten im Detail“). Wer nachträgt (3.3), muss sehen, wer fehlt; die Verwaltung zeigt es ohnehin (3.5).
6. **Später:** Der Renderer für den Info-Text (3.11) entsteht mit Etappe 2 im Client, das Aufräumen von `Aenderung` (2.6) mit Etappe 5, Systemeinträge schreibt Etappe 3.
7. **Austausch-IDs aus der Migration** sind `gen_random_uuid()::text`: Postgres kennt kein `cuid`; die IDs sind trotzdem zufällig und nicht erratbar (7.2).
8. **Fristende:** Ab `jetzt >= frist` ist die Frist abgelaufen („bis Do 18:00“ heißt: um 18:00:00 ist Schluss).

## Global Constraints

- Code-Kommentare, Commit-Nachrichten deutsch; Commit-Nachrichten ASCII (Umlaute umschrieben), Ende `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Einrückung Tabs; Ausnahmen YAML, `schema.prisma` (zwei Leerzeichen, `prisma format`), `package.json`, Markdown. SQL in Migrationen mit Tabs wie die bestehenden.
- Kommentare erklären das Warum und nennen die verworfene Alternative (im Schema als `///`-Kommentar, in der Migration als `--`-Kommentar, wie in `20261013132836_email_an_person`).
- Regeln sind reine Funktionen ohne Angular- und ohne Prisma-Abhängigkeit, mit `jetzt: Date` als Parameter; nie `new Date()` im Regelcode. `libs/domain` importiert nichts aus `@jufi/db`.
- Zeitzone der Regeln ist immer `Europe/Berlin` über `Intl.DateTimeFormat`, nie die Zeitzone des Prozesses.
- Vereinsdaten nur über `vereinDb`; der schlichte `PrismaClient` nur für Plattform-Operationen und Testaufbau.
- Neue Vereinsmodelle stehen in `VEREINS_MODELLE` (`libs/db/src/lib/verein-db.ts`); der Test „VEREINS_MODELLE stimmt mit dem Schema ueberein“ prüft das.
- Feste Werte: Titel 1–120 Zeichen; Info-Text höchstens 10 000; Nachricht 1–2000; höchstens 20 Module und 20 Optionen; Teilnahme-Schlüssel `dabei`, `vielleicht`, `abgesagt` mit Texten „Dabei“, „Vielleicht“, „Abgesagt“; neue Umfrage „Kommst du mit?“, pro Jungfischer, Ergebnisse für alle; Austausch-Titel „Jugendsprecher-Austausch“; Kurzname „Lena M.“; Entfernte heißen „ehemaliges Mitglied“.
- Nach jeder Task: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache` grün. Nach einer Schemaänderung vorher `pnpm run db:generate`. Vor dem Abschluss `pnpm exec prettier --check .`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp3-etappe1-regeln-datenmodell`.

## Review Focus

1. **Zeitumstellung am 25.10.2026**: Archivgrenze, Termin-Zeitpunkte und Berliner Kalendertag stimmen in der Nacht der Umstellung und um Mitternacht UTC ≠ Berlin (Tasks 4, 6).
2. **Bezugsperson, die zugleich Jugendleiter ist**, und **Bezugsperson mit Kindern in verschiedenen Untergruppen**: sieht, antwortet und heißt richtig (Tasks 5, 7).
3. **Antworten von Personen, die nicht (mehr) gefragt sind** (aus der Untergruppe gefallen, entfernt, Merkmal Jugendsprecher entzogen): weder gezählt noch angezeigt noch als „Braucht deine Antwort“ (Tasks 7, 8).
4. **Leere Zielgruppe** (`alleUntergruppen = false`, letzte Untergruppe gelöscht): nur Jugendleiter sehen den Thread, niemand ist gefragt (Tasks 1, 5, 7).
5. **Gleichzeitige Schreiber** auf den Änderungszähler: lückenlose Stände, eine zurückgerollte Transaktion verbraucht keinen (Task 3).

## Dateistruktur

```
prisma/schema.prisma                                  Enums und Modelle fuer Threads
prisma/migrations/<zeit>_threads/migration.sql        Tabellen, CHECKs, Partial-Unique, Austausch fuer bestehende Vereine
libs/db/src/lib/verein-db.ts                          VEREINS_MODELLE, Typ VereinTx
libs/db/src/lib/austausch.ts                          AUSTAUSCH_TITEL, austauschAnlegen
libs/db/src/lib/aenderung.ts                          mitAenderung
libs/db/src/schema.spec.ts                            Datenbankregeln der neuen Tabellen
libs/db/src/aenderung.spec.ts                         Zaehler gegen die Testdatenbank
libs/domain/src/zeit.ts                               berlinerTag, berlinZeitpunkt, tagPlus
libs/domain/src/module/termin/termin.ts               TerminDaten, Anzeige, Pruefung, Zeitpunkte, Listen, Karten-Link
libs/domain/src/module/umfrage/umfrage.ts             Teilnahme-Optionen, Vorlage, Einheiten, Aenderungspruefung
libs/domain/src/threads/typen.ts                      ThreadPerson, Umfeld, ThreadKopf, UmfrageDaten, ThreadDaten
libs/domain/src/threads/umfeld.ts                     baueUmfeld, kinderVon
libs/domain/src/threads/sichtbarkeit.ts               kinderImThread, siehtThread
libs/domain/src/threads/namen.ts                      kurzname, absenderName, eingetragenVon
libs/domain/src/threads/rechte.ts                     darfBearbeiten, darfArchivieren, darfLoeschen, darfSchreiben, darfLoeschenNachricht
libs/domain/src/threads/archiv.ts                     istArchiviert
libs/domain/src/threads/antworten.ts                  gefragte, antwortZeilen, darfAntworten, ergebnisAnsicht, auswertung
libs/domain/src/threads/start.ts                      brauchtAntwort, istNeu, ungeleseneNachrichten, neuKurzangabe
libs/domain/src/threads/testhilfe.ts                  erfundenes Umfeld fuer die Tests (Bowling)
libs/domain/src/threads/index.ts, libs/domain/src/index.ts   Exporte
apps/jufi/src/server/admin/daten.ts, apps/cli/src/demo.ts, apps/jufi/src/server/test-vereine.ts   Austausch beim Anlegen
```

---

### Task 1: Schema und Migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<zeit>_threads/migration.sql` (mit `pnpm exec prisma migrate dev --name threads --create-only`, dann von Hand ergänzt)
- Modify: `libs/db/src/lib/verein-db.ts` (`VEREINS_MODELLE`), `libs/db/src/lib/client.ts` (Modelltypen exportieren)
- Test: `libs/db/src/schema.spec.ts`

**Interfaces:**

- Produces: die Prisma-Modelle und Enums unten, exakt mit diesen Namen; `Verein.aenderungsstand: Int`. Aus `@jufi/db` zusätzlich exportiert: die Typen `Thread`, `ThreadModul`, `UmfrageModul`, `UmfrageAntwort`, `VerlaufEintrag`.

**Enums:** `ThreadArt { NORMAL JUGENDSPRECHER_AUSTAUSCH }`, `ThreadModus { AUSHANG KOMMENTARE CHAT }`, `Rollenfilter { JUNGFISCHER_FAMILIE NUR_FAMILIE NUR_JUGENDLEITER JUGENDLEITER_JUGENDSPRECHER }`, `ArchivModus { AUTOMATISCH ARCHIVIERT AKTIV_HALTEN }`, `ModulTyp { INFO TERMIN UMFRAGE }`, `AntwortEinheit { JUNGFISCHER ERWACHSENER PERSON }`, `ErgebnisSicht { ALLE SUMME JUGENDLEITER }`, `VerlaufArt { NACHRICHT SYSTEM }`, `SystemArt { VEROEFFENTLICHT TERMIN_GEAENDERT FRIST_GEAENDERT MODUS_GEAENDERT }`, `AenderungArt { THREAD MODUL ANTWORT VERLAUF SICHTBARKEIT GELOESCHT }`.

**Modelle** (alle mit `vereinId` + `verein … onDelete: Cascade`; Verweise auf Vereinszeilen als zusammengesetzte Fremdschlüssel mit `onUpdate: NoAction` wie im bestehenden Schema):

| Modell                 | Felder                                                                                                                                                                                                                                                                                                                                                                                                              | Schlüssel und Verweise                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Thread`               | `id` cuid, `art ThreadArt @default(NORMAL)`, `titel`, `modus ThreadModus`, `rollenfilter Rollenfilter`, `alleUntergruppen Boolean @default(true)`, `angepinnt Boolean @default(false)`, `archivModus @default(AUTOMATISCH)`, `veroeffentlichtAm DateTime?`, `erstelltVonId String?`, `letzteAktivitaetAm DateTime @default(now())`, `letzteAktivitaetStand Int @default(0)`, `angelegtAm`, `geaendertAm @updatedAt` | `@@unique([vereinId, id])`, `@@index([vereinId, letzteAktivitaetAm])`; `erstelltVon` → `Person (vereinId, erstelltVonId)` `onDelete: NoAction`                                                                                                            |
| `ThreadUntergruppe`    | `threadId`, `untergruppeId`                                                                                                                                                                                                                                                                                                                                                                                         | `@@id([threadId, untergruppeId])`, `@@index([vereinId, untergruppeId])`; Thread und Untergruppe je `onDelete: Cascade`                                                                                                                                    |
| `ThreadModul`          | `id` cuid, `threadId`, `typ ModulTyp`, `position Int`, `titel String?`                                                                                                                                                                                                                                                                                                                                              | `@@unique([vereinId, id])`, `@@unique([vereinId, id, threadId])`, `@@index([vereinId, threadId])`; Thread `Cascade`                                                                                                                                       |
| `InfoModul`            | `id` (= Modul-ID, `@id`), `text`                                                                                                                                                                                                                                                                                                                                                                                    | `modul` → `ThreadModul (vereinId, id)` `Cascade`                                                                                                                                                                                                          |
| `TerminModul`          | `id` (`@id`), `startDatum DateTime @db.Date`, `endDatum DateTime? @db.Date`, `beginn String?`, `ende String?`, `ort String?`, `treffpunkt String?`                                                                                                                                                                                                                                                                  | `modul` → `ThreadModul (vereinId, id)` `Cascade`; `@@index([vereinId, startDatum])`                                                                                                                                                                       |
| `UmfrageModul`         | `id` (`@id`), `threadId`, `frage`, `einheit AntwortEinheit`, `mehrfach Boolean @default(false)`, `teilnahme Boolean @default(false)`, `vielleicht Boolean @default(true)`, `frist DateTime?`, `ergebnisse ErgebnisSicht @default(ALLE)`                                                                                                                                                                             | `modul` → `ThreadModul (vereinId, id, threadId)` `Cascade` (so stimmt `threadId` immer mit dem Modul überein); `@@unique([vereinId, id])`                                                                                                                 |
| `UmfrageOption`        | `id` cuid, `umfrageId`, `text`, `position Int`, `schluessel`                                                                                                                                                                                                                                                                                                                                                        | `@@unique([umfrageId, schluessel])`, `@@unique([vereinId, umfrageId, id])`; Umfrage `Cascade`                                                                                                                                                             |
| `UmfrageAntwort`       | `id` cuid, `umfrageId`, `fuerId`, `vonId`, `abgegebenAm DateTime`, `clientId`                                                                                                                                                                                                                                                                                                                                       | `@@unique([umfrageId, fuerId])`, `@@unique([vereinId, clientId])`, `@@unique([vereinId, umfrageId, id])`, `@@index([vereinId, fuerId])`, `@@index([vereinId, vonId])`; Umfrage `Cascade`; `fuer` und `von` → Person `NoAction`                            |
| `UmfrageAntwortOption` | `umfrageId`, `antwortId`, `optionId`                                                                                                                                                                                                                                                                                                                                                                                | `@@id([antwortId, optionId])`; `antwort` → `UmfrageAntwort (vereinId, umfrageId, antwortId)` `Cascade`; `option` → `UmfrageOption (vereinId, umfrageId, optionId)` `NoAction` (eine beantwortete Option lässt sich nicht löschen; zweiter Riegel zu 3.14) |
| `VerlaufEintrag`       | `id` cuid, `threadId`, `art VerlaufArt`, `autorId String?`, `text String?`, `systemArt SystemArt?`, `systemDaten Json?`, `stand Int`, `angelegtAm`, `geloeschtAm DateTime?`, `geloeschtVonId String?`, `clientId String?`                                                                                                                                                                                           | `@@unique([vereinId, clientId])`, `@@index([vereinId, threadId, stand])`; Thread `Cascade`; `autor`, `geloeschtVon` → Person `NoAction`                                                                                                                   |
| `GelesenStand`         | `personId`, `threadId`, `gelesenBis Int`, `verlaufGelesenBis Int`, `gelesenAm DateTime`                                                                                                                                                                                                                                                                                                                             | `@@id([personId, threadId])`, `@@index([vereinId, threadId])`; Person und Thread `Cascade`                                                                                                                                                                |
| `Aenderung`            | `id` cuid, `stand Int`, `threadId String?`, `art AenderungArt`, `objektId`, `urheberId String?`, `angelegtAm @default(now())`                                                                                                                                                                                                                                                                                       | `@@index([vereinId, stand])`, `@@index([vereinId, threadId, stand])`, `@@index([angelegtAm])`; `threadId`, `objektId`, `urheberId` **ohne** Fremdschlüssel (das Löschen eines Threads bleibt als Änderung erhalten, Spec 2.6)                             |

`Verein` bekommt `aenderungsstand Int @default(0)` mit Kommentar (Entscheidungen 2 und 3) und die Rückrelationen; `Person` und `Untergruppe` die nötigen Rückrelationen (benannte Relationen bei mehreren Verweisen auf `Person`).

**Von Hand in der Migration** (nach dem erzeugten Teil, je mit Warum-Kommentar; Spaltennamen in Anführungszeichen, wo camelCase):

- `thread_titel`: `char_length(titel) BETWEEN 1 AND 120 AND titel = btrim(titel)`
- `thread_ersteller`: `art = 'JUGENDSPRECHER_AUSTAUSCH' OR "erstelltVonId" IS NOT NULL`
- `CREATE UNIQUE INDEX thread_ein_austausch ON "Thread" ("vereinId") WHERE art = 'JUGENDSPRECHER_AUSTAUSCH'`
- `modul_position`: `position >= 0` (auf `ThreadModul` und `UmfrageOption`, zwei Namen: `modul_position`, `option_position`)
- `info_text`: `char_length(text) <= 10000`
- `termin_reihenfolge`: `"endDatum" IS NULL OR "endDatum" >= "startDatum"`
- `termin_uhrzeit`: `beginn` und `ende` je `IS NULL OR ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`
- `termin_eintaegig`: `NOT (("endDatum" IS NULL OR "endDatum" = "startDatum") AND beginn IS NOT NULL AND ende IS NOT NULL AND ende <= beginn)`
- `umfrage_frage`: `char_length(btrim(frage)) BETWEEN 1 AND 200`
- `CREATE UNIQUE INDEX umfrage_eine_teilnahme ON "UmfrageModul" ("threadId") WHERE teilnahme`
- `option_schluessel`: `schluessel ~ '^[a-z0-9-]{1,40}$'`; `option_text`: `char_length(btrim(text)) BETWEEN 1 AND 200`
- `verlauf_nachricht`: `art <> 'NACHRICHT' OR ("autorId" IS NOT NULL AND "systemArt" IS NULL AND (text IS NULL) = ("geloeschtAm" IS NOT NULL))`
- `verlauf_system`: `art <> 'SYSTEM' OR ("systemArt" IS NOT NULL AND text IS NULL)`
- `verlauf_geloescht`: `("geloeschtAm" IS NULL) = ("geloeschtVonId" IS NULL)`
- `verlauf_text`: `text IS NULL OR char_length(text) BETWEEN 1 AND 2000`
- Austausch für bestehende Vereine: `INSERT INTO "Thread" (id, "vereinId", art, titel, modus, rollenfilter, "alleUntergruppen", angepinnt, "archivModus", "veroeffentlichtAm", "letzteAktivitaetAm", "letzteAktivitaetStand", "angelegtAm", "geaendertAm") SELECT gen_random_uuid()::text, id, 'JUGENDSPRECHER_AUSTAUSCH', 'Jugendsprecher-Austausch', 'CHAT', 'JUGENDLEITER_JUGENDSPRECHER', true, true, 'AUTOMATISCH', now(), now(), 0, now(), now() FROM "Verein";` (Entscheidung 7)

Steps:

- [ ] **Step 1: Branch anlegen.** `git switch -c feature/tp3-etappe1-regeln-datenmodell`
- [ ] **Step 2: Tests schreiben** in `libs/db/src/schema.spec.ts`, neuer `describe('Threads (TP3)')`, mit eigenen Hilfen `thread(vereinId, erstelltVonId, daten?)`, `modul(...)`, `umfrage(...)` über den schlichten Client:
  - `ThreadModul zu Thread aus fremdem Verein abgelehnt` → `P2003`
  - `Antwort fuer Person aus fremdem Verein abgelehnt` → `P2003`
  - `zweiter Austausch je Verein abgelehnt, je einer in zwei Vereinen erlaubt` → `P2002`
  - `zweite Teilnahme-Umfrage im Thread abgelehnt, zwei gewoehnliche erlaubt` → `P2002`
  - `zweite Antwort fuer dieselbe Person und Umfrage abgelehnt` → `P2002`
  - `Antwortoption aus anderer Umfrage abgelehnt` → `P2003`
  - `UmfrageModul mit threadId eines anderen Threads abgelehnt` → `P2003`
  - `beantwortete Option laesst sich nicht loeschen` → Fehler (Code `P2003`)
  - `Termin: Ende vor Start, gleicher Tag 17:00–14:00 und 14:00–14:00, 24:00 abgelehnt` → Meldungen enthalten `termin_reihenfolge`, `termin_eintaegig`, `termin_eintaegig`, `termin_uhrzeit`
  - `Termin: mehrtaegig 17:00–12:00 und Ende ohne Beginn erlaubt`
  - `Titel leer, mit Rand oder 121 Zeichen abgelehnt; normaler Thread ohne Ersteller abgelehnt` → `thread_titel`, `thread_ersteller`
  - `Verlauf: Nachricht ohne Autor, mit 2001 Zeichen, geloescht mit Text abgelehnt` → `verlauf_nachricht`, `verlauf_text`, `verlauf_nachricht`
  - `Untergruppe loeschen nimmt die Auswahl mit, der Thread bleibt`
  - `Verein loeschen mit Thread, Modulen, Antworten, Verlauf, Gelesen-Stand und Aenderung geht durch`
- [ ] **Step 3:** Run `pnpm nx run db:test --skip-nx-cache` — Expected: FAIL (Modelle fehlen; Typfehler genügen).
- [ ] **Step 4: Schema, Migration, `VEREINS_MODELLE`, Typ-Exporte.** `prisma format`, `migrate dev --create-only`, Hand-SQL anhängen, `pnpm exec prisma migrate dev` gegen die Entwicklungsdatenbank, `pnpm run db:generate`. `VEREINS_MODELLE` um alle zwölf neuen Modelle ergänzen (`Aenderung` eingeschlossen).
- [ ] **Step 5:** Run `pnpm nx run db:test --skip-nx-cache` — Expected: PASS, auch „VEREINS_MODELLE stimmt mit dem Schema ueberein“.
- [ ] **Step 6: Migration an bestehenden Daten prüfen.** Vor Step 4 musste die Entwicklungsdatenbank den Demo-Verein enthalten (`pnpm run demo`). Danach: `pnpm run db:psql` → `SELECT v.slug, count(t.*) FROM "Verein" v LEFT JOIN "Thread" t ON t."vereinId" = v.id AND t.art = 'JUGENDSPRECHER_AUSTAUSCH' GROUP BY v.slug;` — Expected: jeder Verein genau 1.
- [ ] **Step 7: Commit** `TP3: Datenmodell Threads, Module, Antworten, Verlauf, Aenderungen`

---

### Task 2: Austausch beim Anlegen eines Vereins

**Files:**

- Create: `libs/db/src/lib/austausch.ts`; Modify: `libs/db/src/index.ts`
- Modify: `apps/jufi/src/server/admin/daten.ts` (`legeVereinAn`), `apps/cli/src/demo.ts`, `apps/jufi/src/server/test-vereine.ts`
- Test: `libs/db/src/schema.spec.ts`, `apps/jufi/src/server/admin/vereine.spec.ts`, `apps/cli/src/demo.spec.ts`

**Interfaces:**

- Produces: `AUSTAUSCH_TITEL = 'Jugendsprecher-Austausch'`; `austauschAnlegen(jetzt: Date): Prisma.ThreadCreateWithoutVereinInput` — Daten für ein verschachteltes `threads: { create: austauschAnlegen(jetzt) }` in `verein.create`: `art JUGENDSPRECHER_AUSTAUSCH`, Titel, `modus CHAT`, `rollenfilter JUGENDLEITER_JUGENDSPRECHER`, `alleUntergruppen true`, `angepinnt true`, `veroeffentlichtAm`, `letzteAktivitaetAm` und `angelegtAm` = `jetzt`, ohne Ersteller. Verschachtelt statt eigener Aufruf, damit kein Weg den Verein ohne Austausch anlegt.

- [ ] **Step 1: Tests.** `libs/db`: `austauschAnlegen ergibt einen veroeffentlichten, angepinnten Austausch ohne Ersteller`. Admin: im Test `Verein anlegen legt Verein, erste Leitung …` zusätzlich genau ein Thread mit `art = JUGENDSPRECHER_AUSTAUSCH` und `veroeffentlichtAm` = dem `jetzt` des Tests. Demo: neuer Test `der Demo-Verein hat genau einen Austausch`; „zweimal einspielen ergibt denselben Stand“ zählt Threads mit.
- [ ] **Step 2:** Run `pnpm nx run-many -t test test-server --projects=db,jufi,cli --skip-nx-cache` — Expected: die neuen Prüfungen FAIL.
- [ ] **Step 3: Implementieren** an allen drei Anlegestellen.
- [ ] **Step 4:** Tests erneut — Expected: PASS.
- [ ] **Step 5: Commit** `TP3: Jugendsprecher-Austausch entsteht mit jedem Verein`

---

### Task 3: Änderungszähler `mitAenderung`

**Files:**

- Create: `libs/db/src/lib/aenderung.ts`; Modify: `libs/db/src/lib/verein-db.ts` (Typ `VereinTx`), `libs/db/src/index.ts`
- Test: `libs/db/src/aenderung.spec.ts`

**Interfaces:**

- Produces:
  - `type VereinTx` — der Client, den `vereinDb(...).$transaction(async (tx) => …)` übergibt. Ableitung aus der Callback-Überladung von `$transaction`; trifft TypeScript sie nicht, `Omit<VereinDb, '$transaction' | '$connect' | '$disconnect' | '$on' | '$extends'>` wie Prismas eigener `TransactionClient`.
  - `interface AenderungEingabe { threadId: string | null; art: AenderungArt; objektId: string }`
  - `mitAenderung<T>(tx: VereinTx, vereinId: string, urheberId: string | null, jetzt: Date, arbeit: (stand: number) => Promise<{ ergebnis: T; aenderungen: readonly AenderungEingabe[] }>): Promise<{ stand: number; ergebnis: T; aenderungen: readonly AenderungEingabe[] }>`
- Ablauf: `verein.update` erhöht `aenderungsstand` um 1 und liefert ihn (das sperrt die Vereinszeile bis zum Commit, wie `sperreVereinszeile`); `arbeit(stand)`; `aenderung.createMany` mit `stand`, `urheberId`, `angelegtAm = jetzt`; für jede `threadId` aus Änderungen mit `art` ∉ {`GELOESCHT`, `SICHTBARKEIT`} `thread.updateMany` mit `letzteAktivitaetAm = jetzt`, `letzteAktivitaetStand = stand`. Der Bus nach dem Commit kommt mit Etappe 5; die Rückgabe trägt dafür alles. Kommentar: Entscheidung 2 und die verworfene Sequenz (Spec 4.2).

- [ ] **Step 1: Tests** (gegen `jufi_test_db`, über `vereinDb(prisma, v.id).$transaction`):
  - `vergibt fortlaufende Staende ab 1 und schreibt je Eingabe eine Aenderung`
  - `20 gleichzeitige Transaktionen ergeben genau die Staende 1 bis 20` (`Promise.all`, Ergebnis sortiert gleich `[1..20]`)
  - `eine Transaktion, deren Arbeit wirft, verbraucht keinen Stand` (danach liefert die naechste denselben Stand)
  - `setzt letzteAktivitaet des Threads, nicht bei GELOESCHT und SICHTBARKEIT`
  - `zweiter Verein zaehlt unabhaengig`
  - `die Arbeit kennt ihren Stand vorab` (legt einen `VerlaufEintrag` mit `stand` an; Stand des Eintrags = zurückgegebener Stand)
- [ ] **Step 2:** Run `pnpm nx run db:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** Tests erneut — Expected: PASS.
- [ ] **Step 5: Commit** `TP3: Aenderungszaehler mitAenderung`

---

### Task 4: Zeit und Termine

**Files:**

- Create: `libs/domain/src/zeit.ts`, `libs/domain/src/module/termin/termin.ts`; Modify: `libs/domain/src/index.ts`
- Test: `libs/domain/src/zeit.spec.ts`, `libs/domain/src/module/termin/termin.spec.ts`

**Interfaces:**

- Produces (`zeit.ts`): `berlinerTag(d: Date): string` (`'JJJJ-MM-TT'` in Europe/Berlin); `berlinZeitpunkt(tag: string, uhrzeit?: string | null): Date` (Wandzeit Berlin → Zeitpunkt; ohne Uhrzeit Mitternacht; eine Uhrzeit in der übersprungenen Stunde der Sommerzeit rückt um eine Stunde vor); `tagPlus(tag: string, tage: number): string`.
- Produces (`termin.ts`):
  - `interface TerminDaten { modulId: string; startDatum: string; endDatum: string | null; beginn: string | null; ende: string | null; ort: string | null; treffpunkt: string | null }` (Daten als `'JJJJ-MM-TT'`, Zeiten als `'HH:MM'`; der Server wandelt `@db.Date` mit `toISOString().slice(0, 10)`)
  - `interface TerminEintrag { threadId: string; titel: string; termin: TerminDaten }`
  - `letzterTag(t): string`, `istMehrtaegig(t): boolean` (Enddatum gleich Startdatum zählt als eintägig)
  - `terminZeit(t): string` — Anzeigeformen FAM 3.1, Wochentag kurz („Sa 17.10.“), Gedankenstrich „–“
  - `terminFehler(t): string | null` — `'Das Enddatum liegt vor dem Startdatum.'`, `'Das Ende liegt vor dem Beginn.'` (am selben Tag, auch bei Gleichheit), `'Uhrzeit bitte als HH:MM.'`
  - `beginnZeitpunkt(t): Date`, `endeZeitpunkt(t): Date` (ohne Ende: Mitternacht Berlin nach dem letzten Tag; eintägig mit Beginn ohne Ende: wie ohne Ende)
  - `naechsteTermine(eintraege: readonly TerminEintrag[], jetzt: Date, anzahl: number): TerminEintrag[]` — `endeZeitpunkt > jetzt`, sortiert nach Startdatum, dann Beginn (ohne Beginn zuerst), dann `threadId`
  - `termineImMonat(eintraege, jahr: number, monat: number): TerminEintrag[]` — `monat` 1–12, auch über die Monatsgrenze, gleiche Sortierung
  - `type Geraet = 'IOS' | 'ANDROID' | 'ANDERE'`; `geraetAus(userAgent: string): Geraet` (iPhone/iPad/iPod → IOS, Android → ANDROID); `kartenLink(ort: string, geraet: Geraet): string` — `maps://?q=…`, `geo:0,0?q=…`, `https://www.google.com/maps/search/?api=1&query=…`, Ort mit `encodeURIComponent`
- Vorlage: `apps/entwurf/src/app/regeln/terminzeit.ts` und `termine.ts`, aber mit Berliner Zeitpunkten statt lokaler Zeichenketten.

- [ ] **Step 1: Tests.**
  - `berlinerTag`: `2026-10-23T22:30:00Z` → `'2026-10-24'`; `2026-10-24T21:59:00Z` → `'2026-10-24'`; `2026-10-25T22:59:00Z` → `'2026-10-25'`; `2026-10-25T23:00:00Z` → `'2026-10-26'`.
  - `berlinZeitpunkt('2026-10-24', '14:00')` → `2026-10-24T12:00:00Z`; `('2026-10-31', '14:00')` → `2026-10-31T13:00:00Z`; `('2026-10-24')` → `2026-10-23T22:00:00Z`; `('2026-03-29', '02:30')` → `2026-03-29T01:30:00Z`.
  - `tagPlus('2026-02-28', 1)` → `'2026-03-01'`; `tagPlus('2026-12-31', 1)` → `'2027-01-01'`.
  - `terminZeit`: nur Datum 2026-10-17 → `'Sa 17.10. · ganztägig'`; 14:00–17:00 → `'Sa 17.10. · 14:00–17:00'`; nur Beginn → `'Sa 17.10. · 14:00'`; nur Ende → `'Sa 17.10. · bis 12:00'`; 23.–25.10. ohne Zeiten → `'Fr 23.10. – So 25.10.'`; mit 17:00/12:00 → `'Fr 23.10. 17:00 – So 25.10. 12:00'`; nur Ende 12:00 → `'Fr 23.10. – So 25.10. 12:00'`.
  - `terminFehler`: Ende 2026-10-16 bei Start 17.10. → Enddatum-Text; selber Tag 17:00–14:00 und 14:00–14:00 → Ende-Text; mehrtägig 17:00–12:00 → `null`; `'25:00'` → Uhrzeit-Text; Enddatum = Startdatum mit 17:00–14:00 → Ende-Text.
  - `beginnZeitpunkt`/`endeZeitpunkt`: Sa 24.10. 14:00–17:00 → `12:00Z`/`15:00Z`; ganztägig 25.10. → Ende `2026-10-25T23:00:00Z`; Fr 23.–So 25.10. ohne Zeiten → Ende `2026-10-25T23:00:00Z`.
  - `naechsteTermine`: laufendes Zeltlager 23.–25.10. ist am 24.10. dabei; Termin von gestern nicht; zwei am selben Tag: ganztägig vor 14:00; `anzahl` 3 begrenzt.
  - `termineImMonat(…, 2026, 10)`: Termin 30.09.–02.10. dabei, 01.11. nicht, 31.10. dabei.
  - `geraetAus`/`kartenLink`: iPhone-UA → IOS, Android-UA → ANDROID, Mac-UA → ANDERE; `kartenLink('Bowlingcenter Am See 1', 'ANDERE')` → `'https://www.google.com/maps/search/?api=1&query=Bowlingcenter%20Am%20See%201'`.
- [ ] **Step 2:** Run `pnpm nx test domain --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** `berlinZeitpunkt`: Kandidat = UTC-Wert der Wandzeit minus Berliner Versatz an diesem Kandidaten, dann Versatz am Ergebnis nachprüfen (bei Abweichung erneut abziehen); Versatz über `Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', … formatToParts })`. Einen Formatter je Zweck einmal auf Modulebene anlegen.
- [ ] **Step 4:** Tests erneut — Expected: PASS.
- [ ] **Step 5: Commit** `TP3: Termin- und Zeitregeln in Europe/Berlin`

---

### Task 5: Thread-Typen, Umfeld, Sichtbarkeit, Namen

**Files:**

- Create: `libs/domain/src/threads/typen.ts`, `umfeld.ts`, `sichtbarkeit.ts`, `namen.ts`, `testhilfe.ts`, `index.ts`; Modify: `libs/domain/src/index.ts`
- Test: `libs/domain/src/threads/sichtbarkeit.spec.ts`, `namen.spec.ts`

**Interfaces:**

- Consumes: `PersonSicht`, `Zuordnung`, `RechtName`, `istJugendleiter`, `hatRecht`, `darfFuerKindHandeln` (`rechte.ts`), `Beziehung` (`personen.ts`), `TerminDaten` (Task 4).
- Produces (`typen.ts`):
  ```ts
  export type ThreadArt = 'NORMAL' | 'JUGENDSPRECHER_AUSTAUSCH';
  export type ThreadModus = 'AUSHANG' | 'KOMMENTARE' | 'CHAT';
  export type Rollenfilter = 'JUNGFISCHER_FAMILIE' | 'NUR_FAMILIE' | 'NUR_JUGENDLEITER' | 'JUGENDLEITER_JUGENDSPRECHER';
  export type ArchivModus = 'AUTOMATISCH' | 'ARCHIVIERT' | 'AKTIV_HALTEN';
  export type AntwortEinheit = 'JUNGFISCHER' | 'ERWACHSENER' | 'PERSON';
  export type ErgebnisSicht = 'ALLE' | 'SUMME' | 'JUGENDLEITER';
  export interface ThreadPerson extends PersonSicht {
  	vorname: string;
  	nachname: string;
  	jugendsprecher: boolean;
  }
  export interface Bezug extends Zuordnung {
  	beziehung: Beziehung;
  	beziehungFreitext: string | null;
  }
  export interface Umfeld {
  	personen: ReadonlyMap<string, ThreadPerson>; // nur nicht entfernte (wie ladeUmfeld)
  	zuordnungen: readonly Bezug[];
  	untergruppenVon: ReadonlyMap<string, ReadonlySet<string>>; // personId -> untergruppeIds
  }
  export interface ThreadKopf {
  	id: string;
  	art: ThreadArt;
  	titel: string;
  	modus: ThreadModus;
  	rollenfilter: Rollenfilter;
  	alleUntergruppen: boolean;
  	untergruppenIds: readonly string[];
  	angepinnt: boolean;
  	archivModus: ArchivModus;
  	veroeffentlichtAm: Date | null;
  	erstelltVonId: string | null;
  }
  export interface UmfrageOptionDaten {
  	id: string;
  	schluessel: string;
  	text: string;
  }
  export interface AntwortDaten {
  	fuerId: string;
  	vonId: string;
  	optionIds: readonly string[];
  	abgegebenAm: Date;
  }
  export interface UmfrageDaten {
  	modulId: string;
  	frage: string;
  	einheit: AntwortEinheit;
  	mehrfach: boolean;
  	teilnahme: boolean;
  	vielleicht: boolean;
  	frist: Date | null;
  	ergebnisse: ErgebnisSicht;
  	optionen: readonly UmfrageOptionDaten[];
  	antworten: readonly AntwortDaten[];
  }
  export interface ThreadDaten {
  	kopf: ThreadKopf;
  	termine: readonly TerminDaten[];
  	umfragen: readonly UmfrageDaten[];
  }
  ```
- Produces (`umfeld.ts`): `baueUmfeld(personen: readonly ThreadPerson[], zuordnungen: readonly Bezug[], mitgliedschaften: readonly { personId: string; untergruppeId: string }[]): Umfeld` (lässt Entfernte weg); `kinderVon(umfeld, erwachsenerId): ThreadPerson[]` (zugeordnete, nicht entfernte Kinder, nach Vorname).
- Produces (`sichtbarkeit.ts`): `kinderImThread(kopf: ThreadKopf, umfeld: Umfeld): ThreadPerson[]` (Spec 3.1: Jungfischer der gewählten Untergruppen bzw. aller bei `alleUntergruppen`; bei `JUGENDLEITER_JUGENDSPRECHER` die Jugendsprecher ohne Untergruppen; bei `NUR_JUGENDLEITER` und bei leerer Auswahl `[]`); `siehtThread(person: ThreadPerson, kopf: ThreadKopf, umfeld: Umfeld): boolean`.
- Produces (`namen.ts`): `kurzname(p: Pick<ThreadPerson, 'vorname' | 'nachname'>): string` („Lena M.“, ohne Nachnamen nur der Vorname); `absenderName(autorId: string | null, umfeld): string` (Spec 3.10); `eingetragenVon(vonId: string, fuerId: string, betrachterId: string, umfeld): string | null` (Spec 3.3: `null` bei `von === fuer`; „von dir eingetragen“; „eingetragen von Mutter Sandra“ wenn `von` dem Kind `fuer` zugeordnet ist; sonst „eingetragen von Thomas K.“; entfernt „eingetragen von ehemaligem Mitglied“). Beziehungswörter: Mutter, Vater, Großmutter, Großvater, Tante, Onkel, Geschwister, Pflegeperson, bei `ANDERE` der Freitext (wie `apps/jufi/src/app/verein/verwaltung/texte.ts`). Mehrere Kinder: Beziehung zum ersten Kind nach Vorname; „Lena und Max“, ab drei „Lena, Max und 1 weiteren“ bzw. „… und 2 weiteren“.
- Produces (`testhilfe.ts`, nur für Tests): `JETZT = new Date('2026-10-22T10:00:00Z')` und `bowlingUmfeld()` mit diesen erfundenen Personen (IDs = Kleinbuchstaben des Vornamens): Thomas Keller (alle Rechte, Vater von Jonas, erziehungsberechtigt), Petra Lang (nur `THREADS_ERSTELLEN`), Bea Roth (Betreuerin, nur `ANTWORTEN_DETAIL`), Sandra Maier (Mutter von Lena und Max), Hans Maier (Großvater von Max, nicht erziehungsberechtigt), Peter Vogt (Vater von Paul), Lena Maier (2013-03-01, Jugendsprecherin, Untergruppe `gross`), Max Maier (2016-06-01, `klein`), Jonas Keller (2011-01-01, `gross`), Tim Sommer (2012-05-05, `gross`, ohne Familie), Paul Vogt (2008-01-01, volljährig, `gross`), Mia Kunz (entfernt). Dazu `kopf(daten?: Partial<ThreadKopf>): ThreadKopf` mit dem Bowling-Kopf als Vorgabe (`id 'bowling'`, Titel „🎳 Bowling“, `KOMMENTARE`, `JUNGFISCHER_FAMILIE`, alle Untergruppen, veröffentlicht am Vortag, Ersteller `thomas`).

- [ ] **Step 1: Tests.**
  - `siehtThread`: Jugendleiter (auch Bea) sehen Entwurf und `NUR_JUGENDLEITER`; Sandra sieht Bowling, nicht den Entwurf; Lena, Max sehen Bowling; bei Untergruppe `klein` sieht Lena ihn nicht, Sandra schon (über Max), Hans auch; `NUR_FAMILIE` sieht Sandra, Lena nicht; `JUGENDLEITER_JUGENDSPRECHER` sieht Lena, nicht Jonas, nicht Sandra; Peter sieht Bowling über den volljährigen Paul; leere Auswahl (`alleUntergruppen false`, `[]`) sieht nur ein Jugendleiter; Mia (entfernt, in `personen` übergeben mit `entferntAm`) sieht nichts.
  - `kinderImThread`: Untergruppe `gross` → Jonas, Lena, Paul, Tim; Austausch-Filter → nur Lena; Mia nie.
  - `kurzname`: Lena Maier → `'Lena M.'`.
  - `absenderName`: `thomas` → `'Thomas K. (Jugendleiter)'` (obwohl Vater); `sandra` → `'Sandra M. (Mutter von Lena und Max)'`; `hans` → `'Hans M. (Großvater von Max)'`; `lena` → `'Lena M.'`; `'mia'` und unbekannte ID → `'ehemaliges Mitglied'`; `null` → `'ehemaliges Mitglied'`; eine Bezugsperson mit drei Kindern → `'… (Mutter von A, B und 1 weiteren)'`; `ANDERE` mit Freitext „Nachbarin“ → `'… (Nachbarin von Max)'`.
  - `eingetragenVon`: (`sandra`, `max`, Betrachter `sandra`) → `'von dir eingetragen'`; (`sandra`, `max`, Betrachter `hans`) → `'eingetragen von Mutter Sandra'`; (`thomas`, `max`, …) → `'eingetragen von Thomas K.'`; (`lena`, `lena`, …) → `null`.
- [ ] **Step 2:** Run `pnpm nx test domain --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Vorlage für die Sichtbarkeit: `apps/entwurf/src/app/regeln/sichtbarkeit.ts`, erweitert um `JUGENDLEITER_JUGENDSPRECHER`, leere Auswahl und Entfernte.
- [ ] **Step 4:** Tests erneut — Expected: PASS.
- [ ] **Step 5: Commit** `TP3: Sichtbarkeit und Namen in Threads`

---

### Task 6: Rechte am Thread und Archiv

**Files:**

- Create: `libs/domain/src/threads/rechte.ts`, `libs/domain/src/threads/archiv.ts`
- Test: `libs/domain/src/threads/rechte.spec.ts`, `archiv.spec.ts`

**Interfaces:**

- Consumes: Task 4 (`letzterTag`, `berlinerTag`, `tagPlus`), Task 5.
- Produces:
  - `istArchiviert(kopf: ThreadKopf, termine: readonly TerminDaten[], jetzt: Date): boolean` — Reihenfolge der Spec 3.7; Grenze: `berlinerTag(jetzt) >= tagPlus(spätester letzterTag, 7)`.
  - `darfBearbeiten(person: ThreadPerson, kopf: ThreadKopf): boolean` — nicht entfernt und (`ALLE_THREADS` oder `THREADS_ERSTELLEN` und Ersteller); der Austausch nur mit `ALLE_THREADS`.
  - `darfArchivieren(person, kopf): boolean` — `darfBearbeiten` und kein Austausch.
  - `darfLoeschen(person, kopf, zaehler: { antworten: number; nachrichten: number }): boolean`
  - `darfSchreiben(person, kopf, umfeld, termine, jetzt): boolean` — sieht, veröffentlicht, Modus ≠ `AUSHANG`, nicht archiviert.
  - `darfLoeschenNachricht(person, eintrag: { autorId: string | null; art: 'NACHRICHT' | 'SYSTEM'; geloeschtAm: Date | null }, kopf): boolean` — nur Nachrichten, nicht schon gelöscht; eigene immer, fremde mit `darfBearbeiten`.

- [ ] **Step 1: Tests.**
  - `istArchiviert`: Termin Sa 2026-10-17: `2026-10-23T21:59:59Z` aktiv, `2026-10-23T22:00:00Z` archiviert; Termin So 2026-10-18: `2026-10-24T21:59:59Z` aktiv, `2026-10-24T22:00:00Z` archiviert (Zeitumstellung); 23.–25.10.: `2026-10-31T22:59:59Z` aktiv, `2026-10-31T23:00:00Z` archiviert; zwei Termine → der spätere zählt; `ARCHIVIERT` mit künftigem Termin → archiviert; `AKTIV_HALTEN` mit altem Termin → aktiv; angepinnt → aktiv; Austausch → aktiv; ohne Termin → aktiv.
  - `darfBearbeiten`: Thomas fremd und eigen ja; Petra eigen ja, fremd nein; Bea nein; Sandra nein; Austausch: Thomas ja, Petra nein.
  - `darfArchivieren`: Austausch auch für Thomas nein.
  - `darfLoeschen`: Thomas ohne Antworten und Nachrichten ja; mit 1 Antwort nein; mit 1 Nachricht nein; Austausch nein.
  - `darfSchreiben`: Sandra in `KOMMENTARE` ja; in `AUSHANG` nein; im Entwurf (auch Thomas) nein; archiviert nein; nicht sichtbar nein.
  - `darfLoeschenNachricht`: Sandra eigene ja, fremde nein; Thomas fremde ja; Systemeintrag nein; schon gelöscht nein.
- [ ] **Step 2:** Run `pnpm nx test domain --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** Tests erneut — Expected: PASS.
- [ ] **Step 5: Commit** `TP3: Rechte am Thread und Archivregel zur Lesezeit`

---

### Task 7: Umfragen — Gefragte, Antworten, Ergebnisse

**Files:**

- Create: `libs/domain/src/threads/antworten.ts`, `libs/domain/src/module/umfrage/umfrage.ts`
- Test: `libs/domain/src/threads/antworten.spec.ts`, `libs/domain/src/module/umfrage/umfrage.spec.ts`

**Interfaces:**

- Consumes: Tasks 5, 6 (`darfBearbeiten`).
- Produces (`antworten.ts`):
  - `gefragte(umfrage: Pick<UmfrageDaten, 'einheit'>, kopf, umfeld): ThreadPerson[]` — Tabelle Spec 3.2; Jugendleiter = nicht entfernte Erwachsene mit Rechten; ohne Doppelte; sortiert nach Vorname, Nachname, ID (`localeCompare(…, 'de')`).
  - `interface AntwortZeile { fuerId: string; vorname: string; selbst: boolean }`; `antwortZeilen(betrachter, umfrage, kopf, umfeld): AntwortZeile[]` — leer, wenn der Betrachter den Thread nicht sieht; zuerst die eigene Zeile (falls gefragt), dann die gefragten eigenen Kinder (`darfFuerKindHandeln`) nach Vorname.
  - `type AntwortErlaubnis = 'ERLAUBT' | 'NICHT_GEFUNDEN' | 'ENTWURF' | 'FRIST_ABGELAUFEN'`; `darfAntworten(person, fuerId: string, umfrage: Pick<UmfrageDaten, 'einheit' | 'frist'>, kopf, umfeld, jetzt): AntwortErlaubnis` — Reihenfolge: sieht nicht → `NICHT_GEFUNDEN`; `fuer` nicht gefragt → `NICHT_GEFUNDEN`; Entwurf → `ENTWURF`; `darfBearbeiten` → `ERLAUBT`; weder selbst noch eigenes Kind → `NICHT_GEFUNDEN`; `jetzt >= frist` → `FRIST_ABGELAUFEN`; sonst `ERLAUBT`. (Server: 404, 409, 410.)
  - `ergebnisAnsicht(betrachter, umfrage: Pick<UmfrageDaten, 'ergebnisse'>, kopf): 'NAMEN' | 'SUMME' | 'NICHTS'` — Tabelle Spec 3.4, `NAMEN` auch mit `darfBearbeiten` (Entscheidung 5).
  - `interface AuswertungsName { fuerId: string; name: string; eingetragenVon: string | null }`; `interface Auswertung { ansicht: 'NAMEN' | 'SUMME'; optionen: { optionId: string; anzahl: number; namen: AuswertungsName[] | null }[]; offen: { anzahl: number; namen: AuswertungsName[] | null } }`; `auswertung(betrachter, umfrage: UmfrageDaten, kopf, umfeld): Auswertung | null` — `null` bei `NICHTS`; zählt nur Antworten Gefragter; Namen als `kurzname`; `eingetragenVon` = `kurzname` von `von` (entfernt: „ehemaliges Mitglied“) nur für Jugendleiter-Betrachter und nur bei `von ≠ fuer`; Optionen in der gegebenen Reihenfolge, Namen nach Vorname.
- Produces (`umfrage.ts`):
  - `TEILNAHME_OPTIONEN: readonly { schluessel: 'dabei' | 'vielleicht' | 'abgesagt'; text: string }[]` = Dabei, Vielleicht, Abgesagt; `teilnahmeOptionen(vielleicht: boolean)` (ohne „Vielleicht“, wenn abgeschaltet).
  - `neueUmfrageVorlage(): { frage: string; einheit: AntwortEinheit; mehrfach: false; teilnahme: true; vielleicht: true; frist: null; ergebnisse: 'ALLE'; optionen: { schluessel: string; text: string }[] }` — „Kommst du mit?“, `JUNGFISCHER`, alle drei Teilnahme-Optionen.
  - `einheitenFuer(rollenfilter: Rollenfilter): AntwortEinheit[]` — `JUNGFISCHER_FAMILIE` und `JUGENDLEITER_JUGENDSPRECHER`: alle drei; `NUR_FAMILIE` und `NUR_JUGENDLEITER`: `ERWACHSENER`, `PERSON`.
  - `type UmfrageKonflikt = { feld: 'optionen'; schluessel: string } | { feld: 'einheit' } | { feld: 'teilnahme' } | { feld: 'mehrfach' }`; `pruefeUmfrageAenderung(alt: UmfrageDaten, neu: { einheit: AntwortEinheit; mehrfach: boolean; teilnahme: boolean; optionen: readonly { schluessel: string }[] }): UmfrageKonflikt[]` — Spec 3.14; ohne gespeicherte Antworten immer `[]`.

- [ ] **Step 1: Tests** (Umfeld und Kopf aus `testhilfe.ts`, Umfrage mit Teilnahme-Optionen `o-dabei`, `o-vielleicht`, `o-abgesagt`):
  - `gefragte`: pro Jungfischer, alle Untergruppen → Jonas, Lena, Max, Paul, Tim; Untergruppe `klein` → Max; `NUR_FAMILIE` → `[]`; Austausch-Filter → Lena. Pro Erwachsenem → Bea, Hans, Peter, Petra, Sandra, Thomas (Thomas einmal, obwohl Vater und Jugendleiter); `NUR_JUGENDLEITER` → Bea, Petra, Thomas. Pro Person bei `NUR_FAMILIE` → Bea, Hans, Peter, Petra, Sandra, Thomas (keine Kinder); pro Person bei `JUNGFISCHER_FAMILIE` → beide Listen zusammen, elf Personen. Leere Auswahl → pro Jungfischer `[]`.
  - `antwortZeilen`: Sandra pro Jungfischer → Lena, Max (je `selbst: false`); Sandra pro Person → Sandra (`selbst`), Lena, Max; Lena pro Jungfischer → Lena (`selbst`); Thomas pro Jungfischer → Jonas; Hans bei Untergruppe `klein` → Max; Bea pro Jungfischer → `[]`.
  - `darfAntworten`: Sandra für Max vor der Frist `ERLAUBT`, um genau `frist` `FRIST_ABGELAUFEN`; Sandra für Tim `NICHT_GEFUNDEN`; Lena für Max `NICHT_GEFUNDEN`; Thomas für Tim nach der Frist `ERLAUBT`; Petra (nicht Ersteller) für Tim `NICHT_GEFUNDEN`; Entwurf → `ENTWURF`; Sandra für Lena bei Untergruppe `klein` → `NICHT_GEFUNDEN`; Peter für den volljährigen Paul `ERLAUBT`.
  - `ergebnisAnsicht`: die neun Felder der Tabelle 3.4 (Thomas, Bea, Petra-ohne-Ersteller, Sandra) plus Petra als Ersteller bei `SUMME` → `NAMEN`.
  - `auswertung`: Lena „dabei“ (von Lena), Max „dabei“ (von Sandra), Tim „abgesagt“ (von Thomas); Betrachter Sandra bei `ALLE` → Dabei 2 [`Lena M.`, `Max M.`] ohne `eingetragenVon`, Abgesagt 1, Offen 2 [`Jonas K.`, `Paul V.`]; Betrachter Thomas → bei Max `eingetragenVon 'Sandra M.'`, bei Tim `'Thomas K.'`; Antwort für Mia (entfernt) und für Max bei Untergruppe `gross` zählen nicht; `SUMME` für Sandra → nur Zahlen, `namen: null`; `JUGENDLEITER` für Sandra → `null`.
  - `pruefeUmfrageAenderung`: ohne Antworten alles erlaubt; Antwort auf `vielleicht`, neu ohne `vielleicht` → `[{ feld: 'optionen', schluessel: 'vielleicht' }]`; unbeantwortete Option entfernen → `[]`; Einheit geändert → `einheit`; Teilnahme aus → `teilnahme`; `mehrfach` aus bei Antwort mit zwei Optionen → `mehrfach`, bei Antworten mit je einer → `[]`.
  - `einheitenFuer`, `teilnahmeOptionen(false)`, `neueUmfrageVorlage` mit den Werten oben.
- [ ] **Step 2:** Run `pnpm nx test domain --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Vorlage für Zeilen: `apps/entwurf/src/app/regeln/antworten.ts`, aber „pro Person“ nach Spec 3.2.
- [ ] **Step 4:** Tests erneut — Expected: PASS.
- [ ] **Step 5: Commit** `TP3: Regeln fuer Umfragen, Antworten und Ergebnisse`

---

### Task 8: Start-Regeln — Braucht deine Antwort, Neu, Zähler

**Files:**

- Create: `libs/domain/src/threads/start.ts`
- Test: `libs/domain/src/threads/start.spec.ts`

**Interfaces:**

- Consumes: Tasks 5–7.
- Produces:
  - `interface OffenerPunkt { threadId: string; titel: string; modulId: string; fuerId: string; vorname: string | null; frist: Date | null }` (`vorname: null` = die eigene Zeile)
  - `brauchtAntwort(person, threads: readonly ThreadDaten[], umfeld, jetzt): OffenerPunkt[]` — Spec 3.13: sichtbar, veröffentlicht, nicht archiviert, Frist offen oder keine; je `antwortZeile` ohne Antwort; sortiert nach Frist (ohne Frist zuletzt), dann Titel (`'de'`), dann Vorname.
  - `istNeu(e: { personId: string; zugangSeit: Date; gelesenBis: number | null; erstelltVonId: string | null; veroeffentlichtAm: Date | null; aenderungen: readonly { stand: number; urheberId: string | null; angelegtAm: Date }[] }): boolean` — Spec 3.9; ohne Gelesen-Stand: veröffentlicht ab `zugangSeit` und nicht selbst erstellt, oder fremde Änderung ab `zugangSeit`.
  - `ungeleseneNachrichten(e: { personId: string; zugangSeit: Date; verlaufGelesenBis: number | null; nachrichten: readonly { stand: number; autorId: string | null; angelegtAm: Date; geloeschtAm: Date | null }[] }): number` — fremde, nicht gelöschte; ohne Stand die ab `zugangSeit`.
  - `neuKurzangabe(modus: ThreadModus, e: { neuerThread: boolean; nachrichten: number; antworten: boolean }): string` — Vorrang: „Neuer Thread“; „1 neuer Kommentar“/„2 neue Kommentare“ (bei `CHAT`: „1 neue Nachricht“/„2 neue Nachrichten“); „Neue Antworten“; sonst „Aushang geändert“.

- [ ] **Step 1: Tests.**
  - `brauchtAntwort` (Sandra, Bowling mit Frist Do 2026-10-22T16:00Z, eine weitere Umfrage ohne Frist in „Zeltlager“): ohne Antworten → Bowling/Lena, Bowling/Max, dann Zeltlager; Lena hat geantwortet → nur Max; „Vielleicht“ zählt als Antwort; nach der Frist → Bowling fehlt; archivierter Thread fehlt; Entwurf fehlt; Antwort von Tim im Thread ändert bei Sandra nichts; Thomas → Jonas; Untergruppe `klein` → nur Max.
  - `istNeu`: fremde Änderung mit `stand 5 > gelesenBis 4` → neu; nur eigene → nicht neu; `stand 4 = gelesenBis` → nicht neu; ohne Gelesen-Stand: veröffentlicht nach `zugangSeit` von Thomas, Betrachter Sandra → neu, Betrachter Thomas (Ersteller) → nicht neu; veröffentlicht vor `zugangSeit` ohne Aktivität danach → nicht neu.
  - `ungeleseneNachrichten`: zwei fremde über dem Stand, eine eigene, eine gelöschte → 2.
  - `neuKurzangabe`: die vier Fälle und Singular/Plural für `KOMMENTARE` und `CHAT`.
- [ ] **Step 2:** Run `pnpm nx test domain --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** Tests erneut — Expected: PASS.
- [ ] **Step 5: Commit** `TP3: Regeln fuer Start, Neu und Zaehler`

---

### Task 9: Spec nachziehen und Abschluss

**Files:**

- Modify: `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md` (2.2, 2.6, 3.4, 3.8, 11), `CLAUDE.md` (Abschnitt „Stand“)

- [ ] **Step 1: Spec.** Entscheidungen 1–5 und 8 an den genannten Stellen eintragen (1: CHECK und `terminFehler` ohne „Endezeit ohne Beginn“; 2/3: `Aenderung` mit eigener ID, ein Stand je Transaktion, `Int`; 4: `position` nicht eindeutig; 5: Namen für Bearbeitende in der Tabelle 3.4; 8: Fristende).
- [ ] **Step 2: CLAUDE.md.** Unter „Stand“ eine Zeile: „TP3 Etappe 1 ist da: Datenmodell für Threads und Regeln in `libs/domain/src/threads` und `module/`; jeder Verein hat seinen Jugendsprecher-Austausch. Schreibende Thread-Routen laufen über `mitAenderung` (`@jufi/db`).“
- [ ] **Step 3: Alles prüfen.** `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache` — Expected: alles grün. `pnpm exec prettier --check .` — Expected: keine Funde. `pnpm run e2e` — Expected: grün (Austausch stört die bestehenden Szenarien nicht).
- [ ] **Step 4: Commit** `TP3 Etappe 1: Spec und CLAUDE.md nachgezogen`
