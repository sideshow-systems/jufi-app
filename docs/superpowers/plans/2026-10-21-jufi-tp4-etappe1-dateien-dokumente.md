# JuFi TP4 Etappe 1 — Dateien-Grundlage und Dokumente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App kann Dateien annehmen, ablegen, ausliefern und wieder löschen. Der erste Nutzer sind die globalen Dokumente: Wer das Recht „Dokumente“ hat, pflegt unter Verwaltung › Dokumente Kategorien und lädt PDFs und Office-Dateien hoch; alle Mitglieder finden sie unter dem neuen fünften Eintrag „Medien“. Jeder Verein hat eine Speichergrenze, die der Plattform-Admin ändert. Das Volume wird mitgesichert (Spec 1.4 Etappe 1, Abschnitte 2, 3.1, 9, 12.4).

**Architecture:**

- Reine Regeln in `libs/domain/src/dateien/`: Typ am Inhalt erkennen, Dateinamen bereinigen, Grenzen, Kontingent, Namen von Kategorien und Dokumenten.
- Im Server ein Ordner `apps/jufi/src/server/dateien/`: die Speicher-Schnittstelle mit einer Verzeichnis-Umsetzung, das Einlesen eines Uploads als Strom in eine Temp-Datei, Ausliefern, Löschen über die Löschliste, Aufräumen. Die Dokumente-Routen bauen darauf auf.
- Speicher und Upload-Fensterzähler sind Abhängigkeiten in `AppDeps`; Tests geben ein Temp-Verzeichnis.
- Im Betrieb ein benanntes Volume `jufi-dateien` unter `/daten`, das `backup.sh` nach dem Dump mit restic sichert.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (Signale, OnPush, inline), Express 4, Prisma 7, Postgres 17, Vitest 4, Playwright, restic. Keine neuen Pakete (kein `multer`, kein `busboy`, kein `file-type`).

**Spec:** `docs/superpowers/specs/2026-10-21-jufi-tp4-module-medien-design.md`, Abschnitte 1.4, 2 (ohne 2.4), 3.1, 3.2 (nur Dokumente), 9, 12.4. Dazu TP3-Spec 4.1 bis 4.4 für Routen und Fehler.

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 9 trägt sie in die TP4-Spec ein.

1. **Fotoverarbeitung (Spec 2.4) und `img-src blob:` (2.5) wandern in Etappe 2.** Ohne Foto-Modul gäbe es keinen Weg, sie im laufenden Image zu prüfen, und die Speichermessung unter `mem_limit` braucht genau diesen Weg. Etappe 1 baut die Typerkennung für Fotos schon mit (sie ist eine reine Regel), nimmt aber nur Dateien an.
2. **Fehler bekommen ein Feld `code`** neben dem Klartext: `{ fehler: '<Text>', code: 'GROESSE' | 'KONTINGENT' | 'TYP' | 'HEIC' }`. Die API antwortet bisher nur mit `{ fehler }`; verworfen: Codes statt Text — der Client zeigt den Text überall direkt an.
3. **Speichergrenze in MB als `Int`** (`Verein.speicherGrenzeMb`, Vorgabe 5120). Das Schema meidet BigInt bewusst (Kommentar bei `aenderungsstand`: BigInt bricht `JSON.stringify`). Der Verbrauch ist eine Summe, die 2^31 übersteigt; sie wird als `number` geführt (sicher bis 2^53).
4. **Dokumente stehen alphabetisch nach Titel** (`localeCompare` mit `'de'`), nicht in Handreihenfolge. Spec 3.1 nannte `position`; verworfen: Handreihenfolge — sie bräuchte eine Sortier-Oberfläche je Kategorie, und alphabetisch findet man schneller. Kategorien behalten ihre Handreihenfolge.
5. **`Datei` verweist mit `NoAction` auf Modul und Dokument.** Ein Kaskadenlöschen umginge die Löschliste (Spec 2.7), und die Bytes fielen erst später durch den Waisen-Schritt weg. So muss jeder Löschpfad `loescheDateien` rufen.
6. **`DateiLoeschung` trägt `vereinId`** (ohne Fremdschlüssel auf `Verein`): Nur so darf ein Vereins-Pfad über `vereinDb` hineinschreiben. Der Aufräumer liest plattformweit über den schlichten Client.
7. **`pruefe-betrieb.sh` prüft ohne Sitzung:** `GET /<slug>/api/v1/dateien/x` und `GET /<slug>/api/v1/dokumente` ergeben 401. Spec 12.4 nannte „unbekannt → 404“; das Skript ist bewusst ohne Anmeldung.
8. **Upload-Körper als `application/octet-stream`.** Der globale `express.json` lässt ihn so in Ruhe, und der Typ zählt ohnehin nur am Inhalt.
9. **Dateiname kommt im Kopf `X-Dateiname`** (Prozent-kodiert); der Titel eines neuen Dokuments ist der bereinigte Name ohne Endung.

**Nicht in dieser Etappe:** Fotos, Foto- und Datei-Modul, Foto-Einwilligung, Reiter „Fotos & Dateien“ (Etappe 2); Datenauszug und Datenschutzerklärung (Etappe 6); Demo-Dokumente (Etappe 6, Spec 13.4).

## Global Constraints

- Code-Kommentare und Oberfläche sind deutsch. Commit-Nachrichten deutsch in ASCII (Umlaute umschrieben), mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Einrückung mit Tabs. Ausnahmen: YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative. **In `template:`/`styles:` keine Backticks in Kommentaren.**
- Angular: Vorlagen und Stile inline, `@if`/`@for`, Signale, `ChangeDetectionStrategy.OnPush`, Präfix `jf-`, Tokens aus `styles.css`.
- Regeln sind reine Funktionen; in `libs/domain` nie `new Date()` ohne Argument.
- Vereinsdaten nur über `vereinDb`; plattformweit (Aufräumer, Admin) über den schlichten `PrismaClient`.
- Was die Person nicht sieht: 404 (`statt404`). Ohne Sitzung: 401 (`brauchtMitglied`).
- Rechteprüfung **vor** dem Lesen eines Upload-Körpers (Muster `PUT /einstellungen/logo`).
- `apps/jufi/src/server.ts` läuft beim Bau: Der Speicher entsteht nur über `createApp` in `betriebsApp()`, nie beim Import.
- Werte: Datei höchstens `25 * 1024 * 1024` Bytes, Foto `20 * 1024 * 1024`; Upload-Fenster 60 je 600 000 ms je Person; Speichergrenze Vorgabe 5120 MB, Admin 100–1 048 576 MB; Hinweis ab 90 %; Löschliste 24 h; Temp-Dateien 1 h; Kategoriename 1–40, Dokumenttitel 1–120, Dateiname 1–120 Zeichen.
- Standard-Kategorien in dieser Reihenfolge: `Ordnungen`, `Merkblätter`, `Formulare`.
- Fehlertexte (wörtlich):
  - `GROESSE`: `Die Datei ist zu groß (höchstens 25 MB)`
  - `KONTINGENT`: `Der Speicher des Vereins ist voll (<belegt> von <grenze> belegt). Bitte wende dich an den Betreiber der Plattform.`
  - `TYP`: `Diese Dateiart geht nicht. Erlaubt sind PDF, Word, Excel, PowerPoint, OpenDocument, JPEG und PNG.`
  - `HEIC`: `HEIC-Bilder gehen nicht. Bitte als JPEG senden.`
- Im Browser und in Tests nur erfundene Daten und erzeugte Dateien.
- Nach jeder Task grün: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache`.
- Vor dem Abschluss: `pnpm exec prettier --check .` und `pnpm run e2e`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp4-etappe1-dateien`.

## Review Focus

1. **Verbrauch über 2 GiB:** Ein Verein mit 100 Dateien zu je 25 MB (2,6 GB) hat einen Verbrauch von genau `100 * 26214400`, kein Überlauf, kein Fehler aus Prisma (Task 5).
2. **Upload bricht ab oder lügt:** Ohne `Content-Length` 411; mit `Content-Length` über der Grenze 413, bevor ein Byte auf der Platte liegt; ein Client, der mitten im Körper abbricht, hinterlässt weder Zeile noch Temp-Datei (Task 3).
3. **Dateinamen aus der Welt:** `../../etc/passwd`, `Anmeldung "Zeltlager" 2027.pdf`, `Übersicht 🎣.docx`, ein Name aus 300 Zeichen und einer mit Zeilenumbruch ergeben einen gültigen `Content-Disposition`-Kopf mit lesbarem Namen; der Speicherschlüssel hängt nie am Namen (Tasks 1, 4).
4. **Zwei Uploads an der Grenze:** Bleibt im Kontingent Platz für genau eine Datei und kommen zwei gleichzeitig, wird genau eine angenommen (Task 5).
5. **Ersetzen und Löschen:** Nach dem Ersetzen eines Dokuments liefert die alte Datei-ID 404 und die neue den neuen Inhalt; die alten Bytes liegen bis zum Aufräumen nach 24 h noch auf der Platte und sind dann weg (Tasks 4, 5).

## Dateistruktur

```
libs/domain/src/dateien/{typ,name,kontingent,dokumente,index}.ts   NEU: Regeln
prisma/schema.prisma, prisma/migrations/<stamp>_dateien/migration.sql
libs/db/src/lib/dokumente.ts                 NEU: standardKategorien()
libs/db/src/lib/verein-db.ts                 VEREINS_MODELLE
apps/jufi/src/server/umgebung.ts             dateienPfad
apps/jufi/src/server/dateien/speicher.ts     NEU: DateiSpeicher, VerzeichnisSpeicher
apps/jufi/src/server/dateien/hochladen.ts    NEU: nimmUpload
apps/jufi/src/server/dateien/ausliefern.ts   NEU: dateiRouten (GET), contentDisposition
apps/jufi/src/server/dateien/loeschen.ts     NEU: loescheDateien
apps/jufi/src/server/dateien/aufraeumen.ts   NEU: raeumeDateienAuf
apps/jufi/src/server/dateien/dokumente.ts    NEU: dokumentRouten, speicherRoute
apps/jufi/src/server/{abhaengigkeiten,verein,app}.ts, server.ts, threads/aufraeumen.ts
apps/jufi/src/server/admin/{daten,vereine}.ts      Verbrauch, Speichergrenze
apps/jufi/src/app/verein/{mitglieder-huelle,medien,dateien-api}.ts
apps/jufi/src/app/verein/verwaltung/{huelle,dokumente,einstellungen}.ts
apps/jufi/src/app/admin/{vereine,verein-seite,admin-api}.ts
deploy/jufi-services.yml, Dockerfile, .env.example, .gitignore
tools/{backup,restore-test,pruefe-betrieb}.sh, README.md, CLAUDE.md
apps/jufi-e2e/src/{aufbau,ablauf.spec,layout.spec}.ts
```

---

### Task 1: Regeln für Dateien und Dokumente

**Files:**

- Create: `libs/domain/src/dateien/typ.ts`, `name.ts`, `kontingent.ts`, `dokumente.ts`, `index.ts` und je ein `.spec.ts`
- Modify: `libs/domain/src/index.ts`

**Interfaces:**

- Produces:
  - `type DateiArt = 'FOTO' | 'DATEI'`
  - `GRENZE_BYTES: Record<DateiArt, number>` = `{ FOTO: 20 * 1024 * 1024, DATEI: 25 * 1024 * 1024 }`
  - `KOPF_BYTES = 16`
  - `erkenneTyp(kopf: Uint8Array, dateiname: string | null, art: DateiArt): { ok: true; typ: string } | { ok: false; grund: 'TYP' | 'HEIC' }`
  - `bereinigeDateiname(roh: string | undefined): string | null`
  - `ohneEndung(name: string): string`
  - `kontingentReicht(e: { verbrauchBytes: number; grenzeMb: number; zusatzBytes: number }): boolean`
  - `speicherText(bytes: number): string`, `fastVoll(verbrauchBytes: number, grenzeMb: number): boolean` (ab 0,9)
  - `MB = 1024 * 1024`
  - `pruefeKategorieName(roh: string): { ok: true; name: string } | { ok: false; fehler: string }`
  - `pruefeDokumentTitel(roh: string): { ok: true; titel: string } | { ok: false; fehler: string }`
  - `sortiereDokumente<T extends { titel: string }>(liste: readonly T[]): T[]`
  - `STANDARD_KATEGORIEN = ['Ordnungen', 'Merkblätter', 'Formulare'] as const`
  - `FEHLER_TEXT`: die vier Texte aus den Global Constraints; der für `KONTINGENT` ist eine Funktion `(belegt: string, grenze: string) => string`

Typen und Signaturen, auf die `erkenneTyp` prüft:

| Signatur                                                                                    | Typ                                                                                                                                                                                  | Art         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `FF D8 FF`                                                                                  | `image/jpeg`                                                                                                                                                                         | FOTO, DATEI |
| `89 50 4E 47 0D 0A 1A 0A`                                                                   | `image/png`                                                                                                                                                                          | FOTO, DATEI |
| `RIFF` + 4 Bytes + `WEBP`                                                                   | `image/webp`                                                                                                                                                                         | nur FOTO    |
| `%PDF-`                                                                                     | `application/pdf`                                                                                                                                                                    | nur DATEI   |
| `PK 03 04` und Endung `.docx`/`.xlsx`/`.pptx`/`.odt`/`.ods` (Groß/klein egal)               | die OOXML- bzw. OpenDocument-Typen (`…wordprocessingml.document`, `…spreadsheetml.sheet`, `…presentationml.presentation`, `application/vnd.oasis.opendocument.text`, `…spreadsheet`) | nur DATEI   |
| Bytes 4–7 `ftyp` und Marke in Bytes 8–11 aus `heic heix hevc heim heis hevm hevs mif1 msf1` | — (`grund: 'HEIC'`)                                                                                                                                                                  | beide       |

Alles andere `grund: 'TYP'`, auch SVG, GIF, AVIF, ZIP mit anderer Endung und ein Kopf unter 12 Bytes.

`bereinigeDateiname`: `decodeURIComponent` (ungültige Kodierung → `null`), nur der Teil nach dem letzten `/` oder `\`, Steuerzeichen (`\p{Cc}`) und `"` raus, Leerraum zu einem Leerzeichen, trimmen; über 120 Zeichen wird der Stamm gekürzt (nach Codepoints, die Endung bleibt); leer → `null`.

`speicherText`: deutsch mit Komma, eine Nachkommastelle, Basis 1024: `0` → `0 MB`, `1288490189` → `1,2 GB`, `5 * 1024 ** 3` → `5,0 GB`, `52428800` → `50,0 MB`.

- [ ] **Step 1: Branch anlegen:** `git switch -c feature/tp4-etappe1-dateien`
- [ ] **Step 2: Tests schreiben.** Je Datei eine Spec; Fälle:
  - `erkenneTyp`: jede Zeile der Tabelle mit erzeugtem Kopf; `.DOCX` in Großbuchstaben; ZIP mit `.zip` → `TYP`; WebP als `DATEI` → `TYP`; PDF als `FOTO` → `TYP`; `ftypheic` → `HEIC`; `ftypavif` → `TYP`; `<svg` → `TYP`; 5 Bytes → `TYP`.
  - `bereinigeDateiname`: `..%2F..%2Fetc%2Fpasswd` → `passwd`; `Anmeldung%20%22Zeltlager%22%202027.pdf` → `Anmeldung Zeltlager 2027.pdf`; `%C3%9Cbersicht%20%F0%9F%8E%A3.docx` → `Übersicht 🎣.docx`; 300 × `a` + `.pdf` → 120 Zeichen, endet auf `.pdf`; `a%0Ab.pdf` → `a b.pdf`; `%E0%A4%A` → `null`; `%20%20` → `null`.
  - `kontingentReicht`: Grenze 1 MB, Verbrauch `MB - 10`, Zusatz 10 → `true`, Zusatz 11 → `false`; `100 * 26214400` Verbrauch bei 5120 MB → Rechnung stimmt.
  - `speicherText`, `fastVoll` (genau 90 % → `true`).
  - `pruefeKategorieName`: `'  Für Eltern '` → `Für Eltern`; leer und 41 Zeichen → Fehler.
  - `sortiereDokumente`: `Zeltlager`, `Ärzte`, `anmeldung` → `anmeldung`, `Ärzte`, `Zeltlager`.
- [ ] **Step 3: Tests scheitern:** `pnpm nx test domain --skip-nx-cache -- dateien`, FAIL.
- [ ] **Step 4: Umsetzen**, über `index.ts` exportieren.
- [ ] **Step 5: Tests grün.**
- [ ] **Step 6: Commit:** `git commit -m "TP4 Etappe 1: Regeln fuer Dateien und Dokumente"`

---

### Task 2: Datenmodell, Migration, Umgebung

**Files:**

- Modify: `prisma/schema.prisma`, `libs/db/src/lib/verein-db.ts`, `libs/db/src/index.ts`, `apps/jufi/src/server/admin/daten.ts` (`legeVereinAn`), `apps/cli/src/demo.ts`, `apps/jufi/src/server/test-vereine.ts`, `apps/jufi/src/server/umgebung.ts` (+ spec), `apps/jufi/src/server/test-setup.ts`, `apps/jufi-e2e/src/aufbau.ts`, `.env.example`, `.gitignore`
- Create: `prisma/migrations/<stamp>_dateien/migration.sql` (über `pnpm prisma migrate dev --create-only --name dateien`, dann von Hand ergänzt), `libs/db/src/lib/dokumente.ts`
- Test: `libs/db/src/schema.spec.ts`, `libs/db/src/verein-db.spec.ts` (Abgleich läuft schon)

**Interfaces:**

- Produces (Prisma):
  - `enum DateiArt { FOTO DATEI }`
  - `Verein.speicherGrenzeMb Int @default(5120)`
  - `Datei (id cuid, vereinId, art, modulId?, dokumentId?, name String @default(""), typ, groesse Int, breite Int?, hoehe Int?, sha256, vonId, hochgeladenAm)`; `@@unique([vereinId, id])`, `@@index([vereinId])`. Fremdschlüssel: Verein `Cascade`; `[vereinId, modulId]` → `ThreadModul` `NoAction`; `[vereinId, dokumentId]` → `Dokument` `NoAction`; `[vereinId, vonId]` → `Person` `NoAction` (Relationsname `DateiVon`).
  - `DokumentKategorie (id cuid, vereinId, name, position Int)`, `@@unique([vereinId, name])`, `@@unique([vereinId, id])`
  - `Dokument (id cuid, vereinId, kategorieId, titel, angelegtAm)`; `[vereinId, kategorieId]` → `DokumentKategorie` `NoAction`; `@@unique([vereinId, id])`
  - `DateiLoeschung (schluessel String @id, vereinId String, geloeschtAm DateTime)`, `@@index([geloeschtAm])`, ohne Relation
  - `AdminAktion` bekommt `SPEICHERGRENZE` (für Task 6; hier, damit die Etappe eine Migration hat)
- Produces (TS): `standardKategorien(): Prisma.DokumentKategorieCreateWithoutVereinInput[]` aus `STANDARD_KATEGORIEN` mit `position` 0, 1, 2; `Umgebung.dateienPfad: string` (Pflicht, aus `DATEIEN_PFAD`).

Von Hand am Ende der Migration (Stil wie `20261020152933_threads`):

```sql
ALTER TABLE "Datei" ADD CONSTRAINT datei_ein_verweis CHECK (("modulId" IS NULL) <> ("dokumentId" IS NULL));
ALTER TABLE "Datei" ADD CONSTRAINT datei_groesse CHECK (groesse BETWEEN 1 AND 31457280);
ALTER TABLE "Datei" ADD CONSTRAINT datei_name CHECK (char_length(name) <= 120 AND (art = 'FOTO' OR char_length(name) >= 1));
CREATE UNIQUE INDEX datei_ein_dokument ON "Datei" ("dokumentId") WHERE "dokumentId" IS NOT NULL;
ALTER TABLE "DokumentKategorie" ADD CONSTRAINT kategorie_name CHECK (char_length(name) BETWEEN 1 AND 40 AND name = btrim(name));
ALTER TABLE "DokumentKategorie" ADD CONSTRAINT kategorie_position CHECK (position >= 0);
ALTER TABLE "Dokument" ADD CONSTRAINT dokument_titel CHECK (char_length(titel) BETWEEN 1 AND 120 AND titel = btrim(titel));
ALTER TABLE "Verein" ADD CONSTRAINT verein_speichergrenze CHECK ("speicherGrenzeMb" BETWEEN 100 AND 1048576);
INSERT INTO "DokumentKategorie" (id, "vereinId", name, position)
SELECT gen_random_uuid()::text, v.id, k.name, k.position FROM "Verein" v
CROSS JOIN (VALUES ('Ordnungen', 0), ('Merkblätter', 1), ('Formulare', 2)) AS k(name, position);
```

- [ ] **Step 1: Tests schreiben** in `schema.spec.ts`:
  - Ein neuer Verein über `legeVereinAn` (Testhelfer) hat genau die drei Kategorien in Reihenfolge.
  - Eine `Datei` mit beiden Verweisen und eine ohne Verweis scheitern (CHECK).
  - Zwei Dateien zum selben Dokument scheitern.
  - Ein `Dokument` mit Datei lässt sich nicht löschen, eine Kategorie mit Dokument nicht (NoAction).
  - Löschen des Vereins nimmt Kategorien, Dokumente und Dateien mit.
  - `speicherGrenzeMb` 99 scheitert.
  - `umgebung.spec.ts`: ohne `DATEIEN_PFAD` → Fehler, der den Namen nennt; mit Wert → `dateienPfad`.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test db --skip-nx-cache -- schema` und `pnpm nx run jufi:test-server --skip-nx-cache -- umgebung`, FAIL.
- [ ] **Step 3: Umsetzen:** Schema, Migration, `pnpm run db:generate`, `VEREINS_MODELLE` um `Datei`, `DokumentKategorie`, `Dokument`, `DateiLoeschung`. `kategorien: { create: standardKategorien() }` an allen drei Anlagestellen neben `threads: { create: austauschAnlegen(jetzt) }`. `TEST_UMGEBUNG.dateienPfad` ist ein Verzeichnis unter `os.tmpdir()` je Prozess (`jufi-test-dateien-<pid>`). `.env.example` bekommt im Stil der Datei einen Abschnitt `# --- Dateien ---` mit `DATEIEN_PFAD="./.daten/dateien"`; `.gitignore` bekommt `.daten/`. Der E2E-Server braucht den Wert auch: `serverUmgebung` in `apps/jufi-e2e/src/aufbau.ts` bekommt `DATEIEN_PFAD: join(ZUSTAND, 'dateien')`.
- [ ] **Step 4: Tests grün**, dazu `pnpm nx test db --skip-nx-cache` (Abgleich `VEREINS_MODELLE`).
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 1: Datenmodell fuer Dateien und Dokumente"`

---

### Task 3: Speicher und Einlesen eines Uploads

**Files:**

- Create: `apps/jufi/src/server/dateien/speicher.ts`, `hochladen.ts` und Specs
- Modify: `apps/jufi/src/server/abhaengigkeiten.ts`

**Interfaces:**

- Produces:
  - ```ts
    interface DateiSpeicher {
    	neueTempDatei(): Promise<string>; // Pfad unter tmp/, Verzeichnis wird angelegt
    	uebernimm(tempPfad: string, schluessel: string): Promise<void>; // atomar (rename)
    	lies(schluessel: string): Promise<Readable | null>; // null, wenn es die Bytes nicht gibt
    	loesche(schluessel: string): Promise<void>; // fehlende Bytes sind kein Fehler
    	liste(): AsyncIterable<{ schluessel: string; geaendertAm: Date }>; // ohne tmp/
    	raeumeTempAuf(aelterAls: Date): Promise<number>;
    }
    class VerzeichnisSpeicher implements DateiSpeicher {
    	constructor(wurzel: string);
    }
    ```
  - `dateiSchluessel(vereinId: string, dateiId: string, vorschau?: boolean): string` = `<vereinId>/<dateiId>` bzw. `….vorschau`
  - `nimmUpload(req: Request, e: { speicher: DateiSpeicher; maxBytes: number }): Promise<UploadErgebnis>` mit
    `UploadErgebnis = { ok: true; tempPfad: string; bytes: number; sha256: string; kopf: Uint8Array } | { ok: false; status: 411 | 413; code?: 'GROESSE' }`
  - `AppDeps.dateiSpeicher?: DateiSpeicher` (Vorgabe `new VerzeichnisSpeicher(umgebung.dateienPfad)`), `AppDeps.uploadFenster?: Fensterzaehler` (Vorgabe `new Fensterzaehler(60, 600_000, …)`)

`nimmUpload` liest `Content-Length` (fehlt oder keine Ganzzahl → 411; über `maxBytes` → 413, **ohne** den Körper zu lesen) und schreibt den Körper über `stream.pipeline` durch einen zählenden, hashenden Transform in die Temp-Datei; die ersten `KOPF_BYTES` merkt er sich. Endet der Strom vorzeitig (`aborted`, `close` vor `end`), löscht er die Temp-Datei und wirft. Ein Aufrufer, der vorzeitig antwortet, setzt `Connection: close`, weil der Körper ungelesen bleibt.

- [ ] **Step 1: Tests schreiben** (Temp-Verzeichnis je Test, `nimmUpload` über einen kleinen Express-Server in der Spec):
  - `VerzeichnisSpeicher`: `uebernimm` legt das Vereinsverzeichnis an; `lies` liefert den Inhalt; `lies` unbekannt → `null`; `loesche` zweimal → kein Fehler; `liste` nennt `v1/d1` und `v1/d1.vorschau`, nicht `tmp/…`; `raeumeTempAuf` löscht nur ältere Temp-Dateien (Änderungszeit per `fs.utimes` gesetzt).
  - `nimmUpload`: 3 Bytes → `bytes: 3`, `sha256` gleich `createHash('sha256')`; ohne `Content-Length` (chunked) → 411; `Content-Length` über Grenze → 413, im `tmp/` liegt nichts; Client bricht nach der Hälfte ab (`req.destroy()`) → Promise lehnt ab, `tmp/` ist leer.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- dateien/`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 1: Dateispeicher und Upload als Strom"`

---

### Task 4: Ausliefern, Löschen, Aufräumen

**Files:**

- Create: `apps/jufi/src/server/dateien/ausliefern.ts`, `loeschen.ts`, `aufraeumen.ts` und Specs
- Modify: `apps/jufi/src/server/verein.ts` (`vereinsApi`), `apps/jufi/src/server/threads/aufraeumen.ts`, `apps/jufi/src/server.ts`, `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: Task 3 (`DateiSpeicher`, `dateiSchluessel`), Task 1 (`bereinigeDateiname`)
- Produces:
  - `dateiRouten(router: Router, deps: VolleAppDeps): void` mit `GET /dateien/:id`
  - `contentDisposition(name: string, inline: boolean): string`: `inline` bzw. `attachment`; `filename="<ASCII-Ersatz>"` (Nicht-ASCII → `_`, `"` und `\` raus) und `filename*=UTF-8''<encodeURIComponent>`
  - `darfDateiSehen(datei: { dokumentId: string | null; modulId: string | null }): boolean`: Dokument → `true` (jedes Mitglied); Modul → `false` bis Etappe 2 (Kommentar: Etappe 2 prüft dort die Sichtbarkeit des Threads)
  - `loescheDateien(tx: VereinTx, vereinId: string, dateien: readonly { id: string; art: DateiArt }[], jetzt: Date): Promise<void>`: löscht die Zeilen und legt für jede Datei `dateiSchluessel(vereinId, id)` und bei `FOTO` zusätzlich `…vorschau` in `DateiLoeschung` an
  - `raeumeDateienAuf(prisma: PrismaClient, speicher: DateiSpeicher, jetzt: Date): Promise<{ geloescht: number; waisen: number; temp: number; fehlend: number }>`
  - `starteAufraeumen` bekommt `speicher?: DateiSpeicher`; mit Speicher ruft jeder Durchlauf zusätzlich `raeumeDateienAuf`

`GET /dateien/:id` (nach `brauchtMitglied`): Zeile über `vereinDb` laden; fehlt sie oder `darfDateiSehen` ist falsch → 404; `speicher.lies` → `null` → 404 und `console.error` mit Datei-ID (nie Namen). Köpfe:

- `Content-Type: <typ>`, `Content-Length: <groesse>`, `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: sandbox; default-src 'none'` (ersetzt die App-CSP für diese Antwort)
- `Content-Disposition`: `inline` bei PDF, JPEG, PNG, sonst `attachment`; `?herunterladen=1` → immer `attachment`
- `Cache-Control: private, max-age=31536000, immutable`

`raeumeDateienAuf`, in dieser Reihenfolge:

1. `DateiLoeschung` mit `geloeschtAm < jetzt − 24 h`: `speicher.loesche`, dann Zeile löschen.
2. `speicher.liste()`: Schlüssel ohne `Datei`-Zeile (Vereins- und Datei-ID aus dem Schlüssel, `.vorschau` abgeschnitten) und ohne Eintrag in `DateiLoeschung`, Änderungszeit älter als 24 h → löschen (`waisen`).
3. `speicher.raeumeTempAuf(jetzt − 1 h)`.
4. `Datei`-Zeilen, deren Hauptschlüssel in der Liste aus Schritt 2 fehlt → nur `console.error` mit Anzahl (`fehlend`), nichts löschen.

- [ ] **Step 1: Tests schreiben:**
  - Ausliefern (Testdatenbank, Dokument mit Datei von Hand angelegt, Bytes im Speicher): Mitglied bekommt Inhalt und alle Köpfe wie oben; PDF `inline`, DOCX `attachment`; `?herunterladen=1` → `attachment`; Name `Übersicht 🎣 (neu).docx` ergibt einen Kopf, der nur Zeichen 0x20–0x7E enthält, dessen `filename="…"` kein `"` und kein `\` im Wert hat und dessen `filename*` per `decodeURIComponent` genau den Namen ergibt (Einheitentest von `contentDisposition` zusätzlich mit `a"b\c.pdf`); Datei mit `modulId` → 404; unbekannte ID → 404; ohne Sitzung → 401; Zeile da, Bytes fehlen → 404.
  - `loescheDateien`: Zeilen weg, Löschliste mit den Schlüsseln (bei `FOTO` zwei).
  - `raeumeDateienAuf` mit fester `JETZT` weit in der Vergangenheit (Muster `threads/aufraeumen.spec.ts`): Eintrag von vor 23 h bleibt samt Bytes, von vor 25 h ist weg; Waise mit Änderungszeit vor 25 h weg, vor 23 h bleibt; Bytes mit Zeile bleiben; Zeile ohne Bytes → `fehlend: 1`, Zeile bleibt.
  - `starteAufraeumen` mit Fake-Speicher ruft `raeumeDateienAuf` im ersten Durchlauf.
  - Mandanten-Test: Fall `'GET /dateien/:id'` (fremde Datei-ID → 404, gesperrt → 404, fremder Verein → 401).
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- dateien/ aufraeumen mandanten`, FAIL.
- [ ] **Step 3: Umsetzen.** `dateiRouten` in `vereinsApi` eintragen; in `betriebsApp()` `starteAufraeumen({ prisma, jetzt, speicher })` mit demselben Speicher, den `createApp` bekommt (in `betriebsApp` einmal erzeugen und beiden geben).
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 1: Dateien ausliefern, Loeschliste und Aufraeumer"`

---

### Task 5: Dokumente-API und Speicherstand

**Files:**

- Create: `apps/jufi/src/server/dateien/dokumente.ts`, `dokumente.spec.ts`
- Modify: `apps/jufi/src/server/verein.ts`, `apps/jufi/src/server/mandanten.spec.ts` (Fälle; `eigenerLeiter` bekommt `DOKUMENTE`)

**Interfaces:**

- Consumes: Tasks 1, 3, 4
- Produces (Antworttypen in `libs/domain/src/dateien/dokumente.ts`):
  - `DokumentAnsicht = { id: string; titel: string; dateiId: string; typ: string; groesse: number; name: string; hochgeladenAm: string }`
  - `KategorieAnsicht = { id: string; name: string; dokumente: DokumentAnsicht[] }`
  - `DokumenteAntwort = { kategorien: KategorieAnsicht[]; darfPflegen: boolean }`
  - `SpeicherAntwort = { verbrauchBytes: number; grenzeMb: number }`
  - `verbrauchBytes(db: VereinDb | VereinTx): Promise<number>` in `dokumente.ts` (Server)

Routen (alle nach `brauchtMitglied`; Pflege-Routen mit eigenem `brauchtDokumente` → sonst `statt404`, **vor** jedem Körper):

| Route                                  | Verhalten                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /dokumente`                       | Kategorien nach `position`, Dokumente nach `sortiereDokumente`; leere Kategorien nur bei `darfPflegen`              |
| `POST /dokumente?kategorie=<id>`       | Upload (Ablauf unten), 201 mit `DokumentAnsicht`; unbekannte Kategorie → 404                                        |
| `PUT /dokumente/:id`                   | JSON `{ titel?: string; kategorieId?: string }`; 400 mit `{ fehler, feld }` bei ungültigem Titel                    |
| `PUT /dokumente/:id/datei`             | Upload, ersetzt die Datei: neue `Datei` anlegen, alte per `loescheDateien`; Titel bleibt; 200 mit `DokumentAnsicht` |
| `DELETE /dokumente/:id`                | `loescheDateien` für die Datei, dann das Dokument; 204                                                              |
| `POST /dokument-kategorien`            | `{ name }`, angehängt mit `position = max + 1`; doppelter Name → 409 `{ fehler: 'Diese Kategorie gibt es schon' }`  |
| `PUT /dokument-kategorien/:id`         | `{ name }`, wie oben                                                                                                |
| `PUT /dokument-kategorien/reihenfolge` | `{ ids: string[] }`, genau alle Kategorien des Vereins, sonst 400; setzt `position` 0…n−1                           |
| `DELETE /dokument-kategorien/:id`      | nur leer, sonst 409 `{ fehler: 'Die Kategorie ist nicht leer' }`; 204                                               |
| `GET /speicher`                        | `SpeicherAntwort`; nur mit irgendeinem Recht (`istJugendleiter`), sonst 404                                         |

Upload-Ablauf (POST und PUT `…/datei`), in dieser Reihenfolge:

1. `brauchtDokumente`; Dokument bzw. Kategorie existiert (404).
2. `uploadFenster.pruefe(personId)` > 0 → 429 mit `Retry-After`.
3. `X-Dateiname` → `bereinigeDateiname`; `null` → 400 `{ fehler: 'Dateiname fehlt' }`.
4. Kontingent mit `Content-Length` als Schätzung (`kontingentReicht`) → sonst 413 `KONTINGENT`, `Connection: close`.
5. `nimmUpload` (`maxBytes = GRENZE_BYTES.DATEI`); 411/413 mit `GROESSE` weiterreichen.
6. `erkenneTyp(kopf, name, 'DATEI')`; nicht ok → 415 mit `TYP` bzw. `HEIC`, Temp-Datei löschen.
7. Neue Datei-ID mit `randomUUID()` aus `node:crypto` (die Spalte hat `@default(cuid())`, nimmt aber jeden String; die ID muss vor der Zeile feststehen, weil die Bytes vorher abgelegt werden), dann `speicher.uebernimm(tempPfad, dateiSchluessel(…))`.
8. `db.$transaction`: `sperreVereinszeile`, `verbrauchBytes` neu, `kontingentReicht` mit `bytes` → sonst Abbruch 413 `KONTINGENT` (die Bytes bleiben als Waise für den Aufräumer); Zeilen anlegen (beim Ersetzen erst alte `Datei` per `loescheDateien`, dann neue).

`verbrauchBytes` summiert `Datei.groesse` des Vereins. Liefert `aggregate._sum` bei mehr als 2^31 einen Fehler oder einen falschen Wert, nimmt die Funktion `$queryRaw` mit `SUM(groesse)::bigint` und wandelt mit `Number()`; der Test unten entscheidet.

- [ ] **Step 1: Tests schreiben** (`dokumente.spec.ts`, Testdatenbank, Speicher im Temp-Verzeichnis, Bodies mit `Content-Type: application/octet-stream` und `X-Dateiname`):
  - Mitglied ohne Recht: `GET /dokumente` ohne leere Kategorien, `darfPflegen: false`; `POST /dokumente` → 404, **bevor** der Körper gelesen ist (Speicher-`tmp/` bleibt leer bei 5-MB-Körper).
  - Pflege: PDF hochladen → 201, `titel` = Name ohne Endung, `GET /dateien/<dateiId>` liefert dieselben Bytes; ZIP als `x.docx` mit gültiger Signatur → 201; PNG-Bytes mit Namen `x.pdf` → 201 mit `typ: 'image/png'`; Text als `x.pdf` → 415 `TYP`; `ftypheic` → 415 `HEIC`; 26 MB → 413 `GROESSE`.
  - Titel ändern, Kategorie wechseln, ungültiger Titel → 400 mit `feld: 'titel'`.
  - Ersetzen: alte Datei-ID → 404, neue liefert neuen Inhalt, alte Schlüssel stehen in `DateiLoeschung`.
  - Löschen: Dokument und Datei weg, Löschliste gefüllt.
  - Kategorien: anlegen, doppelt → 409, umbenennen, Reihenfolge mit fehlender ID → 400, löschen mit Dokument → 409, leer → 204.
  - Kontingent: `speicherGrenzeMb` 100, Verbrauch per angelegten Zeilen auf `100 * MB - 1000`; Upload von 2000 Bytes → 413 `KONTINGENT` mit Text aus `FEHLER_TEXT`; zwei gleichzeitige Uploads zu je 600 Bytes bei 1000 Bytes Rest → genau einer 201.
  - Verbrauch über 2^31: 100 `Datei`-Zeilen zu je `26214400` (direkt angelegt, ohne Bytes) → `GET /speicher` liefert `verbrauchBytes: 2621440000`.
  - Rate-Limit: 61. Upload in 10 Minuten → 429.
  - Mandanten-Test: je Route ein Fall (Schlüssel wörtlich wie in der Tabelle); fremde Dokument- und Kategorie-ID → 404, fremde Daten unverändert.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- dokumente mandanten`, FAIL.
- [ ] **Step 3: Umsetzen**, Routen in `vereinsApi` eintragen.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 1: Dokumente-API und Speicherstand"`

---

### Task 6: Speichergrenze beim Plattform-Admin

**Files:**

- Modify: `apps/jufi/src/server/admin/daten.ts`, `vereine.ts` (+ Specs), `apps/jufi/src/app/admin/vereine.ts`, `verein-seite.ts`, `admin-api.ts` (+ Specs)

**Interfaces:**

- Produces:
  - `Kennzahlen` bekommt `speicherBytes: number` und `speicherGrenzeMb: number` (Liste und Details)
  - `PUT /admin/api/v1/vereine/:id/speichergrenze` mit `{ grenzeMb: number }` (Ganzzahl 100–1 048 576, sonst 400); schreibt einen `AdminProtokoll`-Eintrag im Stil der vorhandenen (Aktion `SPEICHERGRENZE` aus Task 2; das Protokoll hat kein Wertfeld, die aktuelle Grenze steht am Verein); 404 bei unbekanntem Verein
  - `adminDaten(prisma).setzeSpeichergrenze(id: string, grenzeMb: number, adminId: string, jetzt: Date): Promise<boolean>`

Der Admin sieht nur Zahlen, keine Dateinamen (Rahmen 8.3).

- [ ] **Step 1: Tests schreiben:** Server — Liste enthält `speicherBytes` aus angelegten `Datei`-Zeilen; `PUT` mit 2048 → 204, Wert gesetzt, Protokolleintrag; 99 und `"abc"` → 400; ohne Admin-Sitzung → 401. Client — Spalte „Speicher“ zeigt `speicherText` von Verbrauch und Grenze („1,2 GB von 5,0 GB“); die Detailseite hat ein Zahlenfeld „Speichergrenze (MB)“ mit Speichern, bei Fehler die Meldung des Servers.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- admin` und `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 1: Speichergrenze beim Plattform-Admin"`

---

### Task 7: Leiste und Medien für Mitglieder

**Files:**

- Create: `apps/jufi/src/app/verein/medien.ts`, `medien.spec.ts`, `apps/jufi/src/app/verein/dateien-api.ts`
- Modify: `apps/jufi/src/app/verein/mitglieder-huelle.ts` (+ spec), `apps/jufi/src/app/app.routes.ts`

**Interfaces:**

- Consumes: `DokumenteAntwort`, `speicherText`
- Produces:
  - `DateienApi` (`providedIn: 'root'`): `dokumente(slug): Observable<DokumenteAntwort>`, `dateiAdresse(slug, dateiId, herunterladen?: boolean): string` (`/<slug>/api/v1/dateien/<id>` bzw. mit `?herunterladen=1`); die Pflege-Methoden kommen in Task 8 dazu
  - Route `medien` unter der Mitglieder-Hülle, `MedienComponent` (`jf-medien`)

Leiste: Einträge `Start · Threads · Termine · Medien · Mehr`, Medien mit `pfad: 'medien'`, `icon: 'medien'`, `auch: []`; die Spaltenzahl folgt der Zahl der Einträge (`repeat(5, 1fr)`); der Kommentar „Medien kommt mit TP4 dazu“ wird ersetzt.

Medien-Seite in Etappe 1: Überschrift „Medien“, darunter die Dokumente nach Kategorien (Überschrift je Kategorie), je Dokument eine Zeile mit `jf-icon` `dokument`, Titel, darunter Typ-Kürzel (`PDF`, `Word`, `Excel`, `PowerPoint`, `OpenDocument`, `Bild`) und `speicherText(groesse)`. PDF und Bilder öffnen per Link mit `target="_blank" rel="noopener"`, alle anderen laden herunter. Ohne Dokumente: „Noch keine Dokumente.“ Der Reiter „Fotos & Dateien“ kommt in Etappe 2; Etappe 1 zeigt keine Reiterleiste.

- [ ] **Step 1: Tests schreiben:** Hülle — fünf Links in dieser Reihenfolge, `Medien` aktiv auf `/<slug>/medien`. Medien — Kategorien in Antwortreihenfolge, Typ-Kürzel und Größe, Link-Ziel und `target` je Typ, Leertext.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Im Browser (`pnpm run dev`, Demo-Verein, ein Dokument per `curl` oder Task-8-Oberfläche): Leiste bei 375 × 812 hell und dunkel ohne Überlauf (`scrollWidth`, jedes Label in seinem Feld per `getBoundingClientRect`); Werte in den Bericht.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 1: Medien in der Leiste mit Dokumenten"`

---

### Task 8: Verwaltung › Dokumente und Speicherstand

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/dokumente.ts`, `dokumente.spec.ts`, `apps/jufi/src/app/verein/hochladen.ts` (+ spec)
- Modify: `apps/jufi/src/app/verein/dateien-api.ts`, `verwaltung/huelle.ts`, `verwaltung/einstellungen.ts` (+ spec), `app.routes.ts`

**Interfaces:**

- Consumes: Task 5 (Routen, `SpeicherAntwort`), Task 7 (`DateienApi`), `BestaetigungComponent`
- Produces:
  - `ladeHoch(url: string, datei: File, methode: 'POST' | 'PUT'): Observable<HochladenStand>` in `hochladen.ts`, mit `HochladenStand = { art: 'fortschritt'; anteil: number } | { art: 'fertig'; antwort: unknown } | { art: 'fehler'; text: string; code?: string }`. Über `HttpClient.request` mit `reportProgress: true`, Kopf `Content-Type: application/octet-stream` und `X-Dateiname: encodeURIComponent(datei.name)`. Vorab prüft es `datei.size > GRENZE_BYTES.DATEI` → sofort `fehler` mit dem `GROESSE`-Text.
  - `DateienApi`: `speicher(slug)`, `legeKategorieAn`, `benenneKategorie`, `sortiereKategorien`, `loescheKategorie`, `aendereDokument`, `loescheDokument`, `dokumentAdresse(slug, kategorieId)`, `dokumentDateiAdresse(slug, id)`
  - Verwaltungs-Punkt `{ schluessel: 'dokumente', pfad: ['dokumente'], text: 'Dokumente', icon: 'ordner', recht: 'DOKUMENTE' }` zwischen Threads und Untergruppen; Route `verwaltung/dokumente`

Seite Verwaltung › Dokumente (1280 × 800 und 375 × 812 benutzbar):

- Oben der Speicherstand „1,2 GB von 5,0 GB belegt“, ab `fastVoll` mit `jf-icon warnung` und „Der Speicher ist fast voll.“.
- Je Kategorie ein Abschnitt: Name (umbenennen inline), Pfeile hoch/runter (`sortiereKategorien`), Löschen nur bei leerer Kategorie, „Dokument hochladen“ (Dateiauswahl, `accept` mit `.pdf,.docx,.xlsx,.pptx,.odt,.ods,.jpg,.jpeg,.png`, mehrere Dateien nacheinander, je Datei eine Zeile mit Fortschritt und bei Fehler dem Text und „Nochmal“).
- Je Dokument: Titel (umbenennen), Kategorie wechseln (Auswahl), „Ersetzen“, „Löschen“ mit Bestätigung („‚<Titel>‘ löschen?“).
- Unten „Kategorie anlegen“.

Verwaltung › Einstellungen bekommt einen Abschnitt „Speicher“ mit demselben Stand (`GET /speicher`).

- [ ] **Step 1: Tests schreiben:** `ladeHoch` — Fortschritt aus `HttpEventType.UploadProgress`, Fehlertext und `code` aus dem Server-JSON, zu große Datei ohne Anfrage. Seite — Kategorien und Dokumente gerendert, Hochladen ruft die richtige URL, Fehlerzeile mit „Nochmal“, Löschen erst nach Bestätigung, Löschen-Knopf nur bei leerer Kategorie, Warnhinweis bei 90 %. Hülle — Punkt nur mit `DOKUMENTE`.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Im Browser mit erzeugten Dateien (z. B. `printf '%%PDF-1.4\n%%%%EOF\n' > /tmp/x.pdf`, eine leere DOCX aus `zip`): hochladen, ersetzen, verschieben, löschen; 1280 × 800 und 375 × 812, hell und dunkel, ohne waagerechten Überlauf. Werte in den Bericht.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 1: Dokumente in der Verwaltung"`

---

### Task 9: Betrieb, Ende-zu-Ende und Doku

**Files:**

- Modify: `deploy/jufi-services.yml`, `Dockerfile`, `tools/backup.sh`, `tools/restore-test.sh`, `tools/pruefe-betrieb.sh`, `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-21-jufi-tp4-module-medien-design.md`, `apps/jufi-e2e/src/ablauf.spec.ts`, `apps/jufi-e2e/src/layout.spec.ts`
- Unverändert: `tools/probe-sicherung.sh` läuft mit `--no-restic` und deckt den restic-Zweig ohnehin nicht ab; die Prüfsummen prüft `restore-test.sh --dateien`.

**Compose und Image:**

- Dienst `jufi`: `DATEIEN_PFAD: /daten`, `volumes: - jufi-dateien:/daten`. Unten bei den Volumes `jufi-dateien:` mit `name: jufi-dateien` (fester Name, damit `backup.sh` den Pfad ohne Projektnamen findet) und Kommentar zur Sicherung.
- `Dockerfile`, Stufe `runtime`, vor `USER node`: `RUN mkdir -p /daten && chown node:node /daten`. Ein leeres benanntes Volume übernimmt beim ersten Einhängen den Besitzer aus dem Image. Der Kommentar „die App schreibt nirgends hin …“ wird berichtigt.

**Sicherung:**

- `backup.sh`: nach dem geprüften Dump, nur mit restic: `MP=$(docker volume inspect jufi-dateien --format '{{ .Mountpoint }}')`; fehlt das Volume → `warn` und weiter (Server vor dem ersten Deploy dieser Etappe). `restic backup --tag jufi-dateien --exclude "$MP/tmp" "$MP"`, dann `restic forget --tag jufi-dateien` mit denselben `--keep-*`-Werten wie beim Dump. Prüfung: `restic snapshots --tag jufi-dateien --latest 1 --json` nennt einen Snapshot von heute.
- `restore-test.sh`: neue Option `--dateien`. Damit stellt es zusätzlich `latest --tag jufi-dateien` in das Arbeitsverzeichnis wieder her und prüft für bis zu 20 zufällige Zeilen aus `SELECT "vereinId", id, sha256 FROM "Datei" ORDER BY random() LIMIT 20` des wiederhergestellten Dumps, dass `sha256sum` der Datei `<vereinId>/<id>` passt; je Zeile ✓/✗ im vorhandenen Stil, Exit 1 bei einem ✗.
- `pruefe-betrieb.sh`: Abschnitt `# --- 10. Dateien ---` mit `--slug`: `GET $URL/$SLUG/api/v1/dateien/x` und `GET $URL/$SLUG/api/v1/dokumente` ohne Cookie → je 401.

**Ende-zu-Ende** als weitere Schritte im seriellen Ablauf `ablauf.spec.ts` nach „Leitung teilt den Stand“, mit den dort angemeldeten Personen Leitung (erste Person des Vereins, hat alle Rechte) und Mutter:

1. Leitung öffnet Verwaltung › Dokumente, lädt eine erzeugte PDF `Jugendfischereiordnung.pdf` in „Ordnungen“ hoch.
2. Mutter öffnet Medien, sieht „Ordnungen“ und „Jugendfischereiordnung“; `request.get` auf die Link-Adresse mit ihrer Sitzung liefert 200, `application/pdf` und die Bytes.
3. Leitung löscht das Dokument; Mutter lädt Medien neu und sieht „Noch keine Dokumente.“ — leere Kategorien erscheinen bei ihr nicht.

`layout.spec.ts`: Leiste mit fünf Einträgen bei 375 × 812, kein Eintrag breiter als `375 / 5` px, kein Label abgeschnitten (`scrollWidth <= clientWidth`).

**Doku:**

- README: Abschnitt „Dateien“ (lokal `DATEIEN_PFAD`, Aufräumen nach 24 h, Sicherung mit Tag `jufi-dateien`, `restore-test.sh --dateien`).
- CLAUDE.md, Stand: Zeile „TP4 Etappe 1 ist da: …“. Stolpersteine:
  - Dateien nie per Kaskade löschen: jeder Pfad ruft `loescheDateien` (Löschliste, sonst fehlen nach einer Wiederherstellung Bytes).
  - Vor dem ersten Deploy dieser Etappe `jufi-dateien` in die gemeinsame Compose-Datei übernehmen und `tools/install-backup.sh` erneut ausführen.
  - Upload-Routen prüfen Recht und Kontingent vor dem Körper.
- TP4-Spec: die Entscheidungen 1–9 dieses Plans an ihren Stellen (1.4 Etappentabelle, 2.1, 2.4, 2.5, 2.6, 3.1, 9.3, 12.4).

- [ ] **Step 1: E2E-Tests schreiben.**
- [ ] **Step 2: Scheitern sehen:** `pnpm run e2e`, die neuen Fälle FAIL (die Leiste hat dann schon fünf Einträge; scheitert nur der Dokumente-Test, ist das in Ordnung, solange die Ursache stimmt).
- [ ] **Step 3: Betrieb und Doku umsetzen**, dazu `pnpm run deploy:app --dry-run` (braucht `pnpm run db:up` und Docker): Image baut, `/daten` gehört `node`. Danach im gebauten Image: `docker run --rm -e … --entrypoint sh <image> -c 'ls -ld /daten'` ausgeben.
- [ ] **Step 4: Alles grün:** `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`, `pnpm run e2e`, `pnpm exec prettier --check .`. `bash -n` auf die drei geänderten Skripte.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 1: Volume, Sicherung, Ende-zu-Ende und Doku"`
