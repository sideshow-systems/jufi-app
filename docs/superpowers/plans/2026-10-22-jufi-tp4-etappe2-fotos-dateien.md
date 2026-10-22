# JuFi TP4 Etappe 2 — Dateien, Fotos, Einwilligung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Threads bekommen die Module „Dateien“ und „Fotos“. Fotos werden beim Hochladen verkleinert, gedreht und ohne EXIF/GPS neu kodiert, immer eins nach dem anderen. Wer den Thread sieht, sieht die Dateien und Fotos; Fotos öffnen sich in einer Großansicht. Eltern pflegen die Foto-Einwilligung unter „Meine Jungfischer“, volljährige Jungfischer selbst im Profil. Im Foto-Modul steht, von wem keine Fotos gezeigt werden dürfen. Medien bekommt den Reiter „Fotos & Dateien“. Der Rauchtest misst die Fotoverarbeitung im gebauten Image unter `mem_limit` (Spec 1.4 Etappe 2, Abschnitte 2.4, 2.5, 3.2, 4).

**Architecture:**

- Reine Regeln in `libs/domain`:
  - `dateien/`: Fehlertexte je Art, Namen und Endungen, Medienblöcke, Lösch-Zahlen;
  - `threads/`: Hochladerecht, Modul-Entwürfe, Ansichten der neuen Module;
  - `einwilligung.ts`: Foto-Einwilligung und der Hinweis „Von … dürfen keine Fotos gezeigt werden“.
- Server, `apps/jufi/src/server/dateien/`:
  - Die Annahme eines Uploads wird aus `dokumente.ts` herausgelöst (`annehmen.ts`). Dokumente und die beiden Modul-Routen nutzen sie gemeinsam.
  - Fotos laufen dort durch `foto.ts` (sharp) und eine Warteschlange mit einem Platz.
  - Ausliefern prüft die Sichtbarkeit des Threads und liefert Vorschaubilder.
- Module folgen TP3:
  - Kopfzeile `ThreadModul` mit erweitertem `ModulTyp`, 1:1-Tabellen `DateienModul` und `FotosModul`.
  - Gespeichert über `POST/PUT /threads`; Bytes nur über die eigenen Upload-Routen.
- Client:
  - Die Upload-Warteschlange aus Verwaltung › Dokumente wird eine eigene Klasse `Hochladeschlange`.
  - Datei-Modul, Foto-Modul samt Großansicht und Editor nutzen sie.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (Signale, OnPush, inline), Express 4, Prisma 7, Postgres 17, Vitest 4, Playwright, sharp 0.35 (schon Abhängigkeit, im Image extern gebündelt). Keine neuen Pakete.

**Spec:** `docs/superpowers/specs/2026-10-21-jufi-tp4-module-medien-design.md`, Abschnitte 1.4, 2.3–2.5, 3.2, 4, 9, 10, 13.2. Dazu TP3-Spec 3.1 (Sichtbarkeit), 3.5 (Bearbeiten), 3.7 (Archiv), 3.10 (Namen), 3.12 (Teilnahme) und TP2 Entscheidung 6 (Einwilligung verfällt mit dem Erteiler).

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 13 trägt sie in die TP4-Spec ein. Die mit ⚑ hat der Eigentümer noch nicht bestätigt; sie stehen in der Übergabe.

1. **Die Speicherabnahme ist ein dauerhaftes Tor im Rauchtest** (`tools/deploy.sh`), nicht eine einmalige Messung.
   - Der Rauchtest-Container läuft dafür mit derselben Speichergrenze wie `jufi` in `deploy/jufi-services.yml`.
   - Im laufenden Container verarbeitet ein Probe-Skript ein 48-MP-JPEG und ein 20-MB-PNG mit genau der Datei `foto.ts` der App. Node 22 führt TypeScript ohne Bau aus. Danach liest das Tor `memory.peak` der cgroup.
   - Gemessen werden App im Leerlauf und Probe zusammen. Das liegt über dem Betrieb, wo nur ein Node-Prozess läuft, und ist damit die vorsichtige Seite.
   - Verworfen: die Messung über die echte Upload-Route. Sie bräuchte eine Mitgliedssitzung im Wegwerf-Verein, und Demo-Personen haben kein Passwort.
   - Verworfen: einmal von Hand messen. Die nächste sharp-Version kann es kippen, ohne dass es jemand merkt.
2. **`foto.ts` importiert nur `sharp` und `node:*` und nutzt nur löschbare TypeScript-Syntax** (keine `enum`, keine Parameter-Properties). Nur so läuft sie im Image ohne Bau (Entscheidung 1).
3. **Das Vorschaubild entsteht aus der fertigen 2560er-Fassung, nicht aus dem Original.** Ein 48-MP-Bild wird so nur einmal dekodiert.
4. **`Content-Length` kommt aus dem Speicher, nicht aus `Datei.groesse`.** Bei Fotos zählt `groesse` beide Fassungen (Spec 2.1). `DateiSpeicher.lies` liefert dafür `{ strom, bytes }`.
5. **Fehlende Rechte beim Hochladen, Umbenennen und Löschen ergeben 404**, auch für Leser eines archivierten Threads mit „Alle Leser laden hoch“. Das folgt Rahmen 8.3; der Client zeigt den Knopf dort ohnehin nicht.
   - Ein volles Modul (20 Dateien, 500 Fotos) ergibt 409 mit dem neuen Code `VOLL`, den Spec 9.3 für Helfer und Autos schon nennt.
   - Die Codes sind damit `GROESSE | KONTINGENT | TYP | HEIC | BESCHAEFTIGT | VOLL`.
6. ⚑ **Die Foto-Einwilligung eines volljährigen Jungfischers gilt nur, wenn er sie selbst erteilt hat** (`erteiltVon = jungfischerId`).
   - Die Einwilligung der Eltern erlischt mit dem 18. Geburtstag. Das folgt aus `darfEinwilligen` (TP2 Entscheidung 6) und gilt für die DSGVO-Einwilligung schon heute.
   - Bis er selbst einwilligt, steht er im Hinweis.
   - Er pflegt sie über eine eigene Route `POST /ich/einwilligung`.
   - Verworfen: die Elterneinwilligung über 18 hinaus gelten lassen. Ein Erwachsener entscheidet über Fotos von sich selbst.
7. **Die Einwilligungsroute der Jungfischer nimmt `art` als optionales Feld, Vorgabe `DSGVO_ART8`.** So bleiben Client und Tests der DSGVO-Einwilligung unverändert.
8. **Eigener Wortlaut für die Foto-Einwilligung** (`FOTO_EINWILLIGUNG_TEXT`, `FOTO_EINWILLIGUNG_TEXT_SELBST`, Version `'1'`) als Platzhalter in `einwilligung.ts`. `tools/pruefe-texte.sh` findet ihn dort ohne Änderung.
9. **Der Dateiname bekommt die Endung, die zum erkannten Typ passt** (Rückstand aus Etappe 1). Auch Dokumente bekommen sie.
   - Beispiele: `x.pdf` mit PNG-Inhalt wird `x.png`, `Packliste` wird `Packliste.pdf`.
   - Unsichtbare Formatzeichen (`\p{Cf}`, etwa U+202E) fallen aus Dateinamen.
   - Titel und Kategorienamen mit solchen Zeichen lehnt der Server mit 400 ab, wie bei Steuerzeichen (Spec 3.1).
10. **Im Editor wird nur hochgeladen.** Ein gespeichertes Datei- oder Foto-Modul zeigt dort die Zahl der Dateien bzw. Fotos und einen Upload; ein ungespeichertes zeigt „Erst speichern, dann hochladen“. Umbenennen und einzelnes Löschen gibt es auf der Thread-Seite. Verworfen: die volle Liste im Editor — sie stünde doppelt und bräuchte die Ansicht samt Rechten im Bearbeitungsweg.
11. **Ein Modul mit Fotos oder Dateien zu entfernen fragt im Editor nach**, mit Zahlen („Beim Speichern löscht das 23 Fotos von 5 Personen.“). Ein Modul ohne Medien wird weiter ohne Rückfrage entfernt.
12. **Fotos haben keinen Namen; beim Speichern heißen sie `foto-<erste 8 Zeichen der ID>.jpg`.**
13. **Der Reiter in Medien steht im Query-Parameter `reiter`** (`?reiter=dokumente`), damit „Zurück“ dorthin führt. Vorgabe ist „Fotos & Dateien“.
14. **Die Thread-Suche findet auch Dateinamen** in Datei-Modulen, wie sie Texte der übrigen Module findet.
15. **Demo-Fotos bleiben in Etappe 6** (Spec 13.4).
    - Für die lokale Abnahme erzeugt `tools/erzeuge-testbilder.mjs` bunte Testbilder aus Formen.
    - Dasselbe Skript erzeugt die beiden Bilder der Speicherprobe.
16. **Ist die Warteschlange voll, antwortet der Server mit 503 und `Retry-After: 2`.** Der Client wiederholt bis zu dreimal von selbst und zeigt erst dann „Nochmal“.

**Nicht in dieser Etappe:**

- Helfer, Fahrgemeinschaft, Kosten (Etappen 3–5).
- Datenauszug der Fotos und Einwilligungen, Demo-Zeltlager, Datenschutzerklärung (Etappe 6).
- Aus dem Etappe-1-Rückstand bleiben offen:
  - fsync vor rename, `Content-Length` über `MAX_SAFE_INTEGER`, NUL im Schlüssel;
  - die backup.sh- und README-Punkte;
  - die veraltete Kategorie-Auswahl nach gescheitertem Verschieben;
  - die Breite von `/admin/vereine/<id>`.

**Nach dem Deploy prüfen** (Eigentümer, echte Geräte):

- HEIC am iPhone: `accept="image/*"` liefert JPEG.
- „Speichern“ per Web Share auf iOS und Android.
- `docker stats` während eines Uploads auf dem Server.

## Global Constraints

- Code-Kommentare und Oberfläche sind deutsch. Commit-Nachrichten deutsch in ASCII (Umlaute umschrieben), mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Einrückung mit Tabs. Ausnahmen: YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative. **In `template:`/`styles:` keine Backticks in Kommentaren.**
- Angular: Vorlagen und Stile inline, `@if`/`@for`/`@switch`, Signale, `ChangeDetectionStrategy.OnPush`, Präfix `jf-`, Tokens aus `styles.css`.
- Regeln sind reine Funktionen; in `libs/domain` nie `new Date()` ohne Argument.
- Vereinsdaten nur über `vereinDb`. Was die Person nicht sehen oder nicht tun darf: 404 (`statt404`). Ohne Sitzung: 401.
- Upload-Routen prüfen Ort, Sichtbarkeit, Recht, Anzahl, Rate-Limit und Kontingent **vor** dem Körper. Ein vorzeitiges Nein setzt `Connection: close`.
- Jede neue Schreibroute eines Moduls schreibt in `mitAenderung` eine Änderung der Art `MODUL` (`objektId` = Modul-ID), **ohne Systemeintrag**, und meldet nach dem Commit an `deps.bus`.
- Jeder Löschpfad für Dateien ruft `loescheDateien`; nie per Kaskade.
- Werte:
  - Foto höchstens `20 * 1024 * 1024` Bytes und `50_000_000` Pixel; Datei `25 * 1024 * 1024`.
  - Lange Seite 2560 px mit JPEG-Qualität 82; Vorschau 480 px mit Qualität 75. Transparenz auf `#ffffff`.
  - Warteschlange: ein Platz in Arbeit, 8 wartend, `sharp.concurrency(1)`, `sharp.cache(false)`.
  - Höchstens 20 Dateien je Datei-Modul und 500 Fotos je Foto-Modul.
  - Medienblock: bis 6 Vorschaubilder und bis 10 Dateien.
  - Upload-Fenster 60 je 600 000 ms je Person (vorhanden).
- Fehlertexte (wörtlich; `GROESSE` und `TYP` werden je Art ein `Record<DateiArt, string>`):
  - `GROESSE.DATEI`: `Die Datei ist zu groß (höchstens 25 MB)`
  - `GROESSE.FOTO`: `Das Foto ist zu groß (höchstens 20 MB)`
  - `PIXEL` (Code `GROESSE`): `Das Foto hat zu viele Pixel (höchstens 50 Megapixel)`
  - `TYP.DATEI`: wie bisher
  - `TYP.FOTO`: `Diese Bildart geht nicht. Erlaubt sind JPEG, PNG und WebP.`
  - `HEIC`: wie bisher
  - `BESCHAEFTIGT`: `Gerade werden viele Fotos verarbeitet. Bitte gleich noch einmal versuchen.`
  - `VOLL.DATEI`: `Hier passen höchstens 20 Dateien hinein`
  - `VOLL.FOTO`: `Hier passen höchstens 500 Fotos hinein`
- Weitere Texte (wörtlich):
  - Hinweis: `Von <Namen> dürfen keine Fotos gezeigt werden`, Namen nach `kurzname`, verbunden mit `, ` und vor dem letzten mit `und`.
  - Editor: `Erst speichern, dann hochladen`.
  - Leertexte: `Noch keine Dateien.`, `Noch keine Fotos.`, `Noch keine Fotos oder Dateien.`
- Im Browser und in Tests nur erfundene Daten und **erzeugte** Bilder, nie echte Fotos (Spec 1.2).
- Nach jeder Task grün: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache`.
- Vor dem Abschluss: `pnpm exec prettier --check .` und `pnpm run e2e`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp4-etappe2-fotos`.

## Review Focus

1. **Großes Foto im kleinen Container:** Ein 48-MP-JPEG und ein 20-MB-PNG werden im gebauten Image unter der Speichergrenze von `jufi` verarbeitet. Der Container überlebt, und der Rauchtest nennt den Spitzenwert (Task 13).
2. **Modul oder Thread mit Fotos löschen:** Entfernt der Editor ein Foto-Modul mit 3 Fotos, ergibt das Speichern 200, nicht 404 aus einem Fremdschlüsselfehler. Die Zeilen sind weg, und 6 Schlüssel stehen in der Löschliste. Ebenso beim Löschen des ganzen Threads (Task 4).
3. **Einwilligungsarten vermischen sich nicht:** Eine Foto-Einwilligung öffnet keinen Zugang, und der Widerruf der DSGVO-Einwilligung zieht die Foto-Einwilligung nicht mit (oder umgekehrt) (Task 3).
4. **Volljährig über Nacht:** Am Tag nach dem 18. Geburtstag gilt die Foto-Einwilligung der Eltern nicht mehr, und der Hinweis nennt die Person, bis sie selbst einwilligt (Tasks 1, 11).
5. **Länge und Inhalt beim Ausliefern:** `GET` auf ein Foto liefert genau die Bytes der 2560er-Fassung mit passender `Content-Length`, die Vorschau ebenso. Keine Antwort bricht ab, weil `groesse` beide Fassungen zählt (Task 7).

## Dateistruktur

```
libs/domain/src/dateien/{fehler,name,medien,module}.ts       Fehler je Art, Namen/Endung, Medienblöcke, Antworttypen
libs/domain/src/einwilligung.ts                              Foto-Einwilligung, Hinweis
libs/domain/src/threads/{namen,rechte,entwurf,vergleich,ansicht,liste,teilen,verwaltung}.ts
prisma/schema.prisma, prisma/migrations/<stamp>_fotos_dateien/migration.sql
libs/db/src/lib/verein-db.ts                                 VEREINS_MODELLE
apps/jufi/src/server/dateien/annehmen.ts                     NEU: gemeinsame Annahme eines Uploads
apps/jufi/src/server/dateien/foto.ts                         NEU: verarbeiteFoto (nur sharp, node:*)
apps/jufi/src/server/dateien/foto-schlange.ts                NEU: FotoSchlange
apps/jufi/src/server/dateien/modul-dateien.ts                NEU: Upload-, Umbenennen-, Löschrouten der Module
apps/jufi/src/server/dateien/medien.ts                       NEU: GET /medien
apps/jufi/src/server/dateien/{dokumente,ausliefern,speicher,aufraeumen}.ts
apps/jufi/src/server/dateien/test-bilder.ts                  NEU: erzeugte Testbilder für Specs
apps/jufi/src/server/threads/{schreiben,laden,lesen,verwalten,bearbeitung,test-threads}.ts
apps/jufi/src/server/mitglieder/{jungfischer,profil,personen,zugang}.ts, server/sicherheit.ts
apps/jufi/src/app/verein/{hochladeschlange,hochladen-feld,dateien-anzeige}.ts   NEU
apps/jufi/src/app/verein/threads/{dateien-modul,fotos-modul,foto-grossansicht}.ts NEU
apps/jufi/src/app/verein/verwaltung/threads/{dateien-felder,fotos-felder}.ts      NEU
apps/jufi/src/app/verein/{medien,dateien-api,hochladen,jungfischer,profil}.ts
apps/jufi/src/app/verein/verwaltung/{dokumente,personenseite}.ts, threads/{editor,vorschau}.ts
deploy/nginx-sicherheit.conf, tools/{deploy.sh,fotoprobe.mjs,erzeuge-testbilder.mjs}
apps/jufi-e2e/src/{ablauf.spec,hilfen}.ts, README.md, CLAUDE.md
```

---

### Task 1: Regeln für Fotos, Namen und Einwilligung

**Files:**

- Create: `libs/domain/src/dateien/fehler.ts`, `medien.ts` und Specs. `FEHLER_TEXT` zieht aus seinem bisherigen Ort nach `fehler.ts`; der Export bleibt.
- Modify: `libs/domain/src/dateien/name.ts`, `dokumente.ts` (Prüfungen auf `\p{Cf}`), `index.ts`, `libs/domain/src/einwilligung.ts`, `libs/domain/src/threads/namen.ts`, `threads/rechte.ts` und deren Specs. Die Etappe-1-Aufrufer von `FEHLER_TEXT.GROESSE`/`.TYP` im Server und in `apps/jufi/src/app/verein/hochladen.ts` nehmen `.DATEI`.

**Interfaces:**

- Produces:
  - `type DateiFehlerCode = 'GROESSE' | 'KONTINGENT' | 'TYP' | 'HEIC' | 'BESCHAEFTIGT' | 'VOLL'`
  - `FEHLER_TEXT`: `GROESSE`, `TYP` und `VOLL` als `Record<DateiArt, string>`, dazu `PIXEL`, `HEIC`, `BESCHAEFTIGT` als String und `KONTINGENT` wie bisher als Funktion. Alle Texte stehen in den Global Constraints.
  - `GRENZE_ANZAHL: Record<DateiArt, number>` = `{ DATEI: 20, FOTO: 500 }`, `FOTO_MAX_PIXEL = 50_000_000`
  - `pruefeDateiname(roh: string): { ok: true; name: string } | { ok: false; fehler: string }`. Gleiche Säuberung wie `bereinigeDateiname`, ohne Dekodieren; beide teilen sich eine private `saeubere`.
  - `passendeEndung(name: string, typ: string): string`
  - `undListe(teile: readonly string[]): string`: `[]` ergibt `''`, `['A']` ergibt `A`, `['A','B']` ergibt `A und B`, `['A','B','C']` ergibt `A, B und C`
  - `type FotoHochladen = 'JUGENDLEITER' | 'ALLE'`
  - `darfFotosHochladen(person: ThreadPerson, kopf: ThreadKopf, hochladen: FotoHochladen, e: { umfeld: Umfeld; termine: readonly TerminDaten[]; jetzt: Date }): boolean`
  - `darfFotoLoeschen(person: ThreadPerson, kopf: ThreadKopf, vonId: string): boolean`
  - `FOTO_EINWILLIGUNG_TEXT`, `FOTO_EINWILLIGUNG_TEXT_SELBST`, `FOTO_EINWILLIGUNG_TEXT_VERSION = '1'`
  - `type EinwilligungZeile = { erteiltVon: string; widerrufenAm: Date | null }`
  - `fotoEinwilligungGilt(kind: PersonSicht, zeilen: readonly EinwilligungZeile[], erteiler: ReadonlyMap<string, PersonSicht>, zuordnungen: readonly Zuordnung[], jetzt: Date): boolean`
  - `ohneFotoEinwilligung(kopf: ThreadKopf, umfeld: Umfeld, e: { fotoEinwilligungen: ReadonlyMap<string, readonly EinwilligungZeile[]>; dabei: ReadonlySet<string> | null }, jetzt: Date): ThreadPerson[]`
  - `fotoHinweis(personen: readonly ThreadPerson[]): string | null`
  - `dabeiKinder(daten: ThreadDaten): ReadonlySet<string> | null`
  - `type MedienZahl = { fotos: number; dateien: number; personen: number }`, `medienZahlText(z: MedienZahl): string | null`

Regeln im Einzelnen:

- `passendeEndung`: Endungen je Typ
  - `image/jpeg`: `.jpg`, `.jpeg`
  - `image/png`: `.png`
  - `image/webp`: `.webp`
  - `application/pdf`: `.pdf`
  - die OOXML- und OpenDocument-Typen: ihre Endung aus `erkenneTyp`
  - Verhalten:
    - Passt die Endung (Groß/klein egal), bleibt der Name.
    - Ist sie die Endung eines **anderen** bekannten Typs, wird sie ersetzt.
    - Sonst wird angehängt.
  - Danach höchstens 120 Zeichen; gekürzt wird der Stamm.
- `\p{Cf}` fällt in `saeubere` weg. `pruefeKategorieName` und `pruefeDokumentTitel` lehnen es mit demselben Fehler ab wie Steuerzeichen.
- `darfFotosHochladen`:
  - `darfBearbeiten` ergibt immer `true`, auch im Entwurf und im Archiv.
  - Sonst nur bei `hochladen === 'ALLE'`, wenn `siehtThread` gilt, der Thread veröffentlicht ist und `istArchiviert(kopf, termine, jetzt)` falsch ist.
- `darfFotoLoeschen`: `vonId === person.id` oder `darfBearbeiten`. Die Sichtbarkeit prüft der Aufrufer.
- `fotoEinwilligungGilt`:
  - Volljährig (`istVolljaehrig`): Es gilt nur eine Zeile ohne Widerruf mit `erteiltVon === kind.id`.
  - Sonst `hatGueltigeEinwilligung` (Eltern).
- `ohneFotoEinwilligung`:
  - Grundlage ist `kinderImThread(kopf, umfeld)`. Ist `dabei` nicht `null`, zählen nur Kinder darin.
  - Davon bleiben die ohne gültige Foto-Einwilligung (`umfeld.personen` als Erteiler, `umfeld.zuordnungen`).
  - Sortiert nach `kurzname` mit `localeCompare('de')`.
- `dabeiKinder`: Die Umfrage mit `teilnahme` sucht ihre Option mit `schluessel === 'dabei'` und liefert die `fuerId` der Antworten, deren `optionIds` sie enthalten. Ohne Teilnahme-Umfrage ergibt sich `null`.
- `fotoHinweis`: `null` bei leerer Liste.
- `medienZahlText`:
  - `{3,0,…}` ergibt `3 Fotos von 2 Personen`.
  - Mit Dateien kommt ` und 2 Dateien` dazu.
  - Nur Dateien ergibt `2 Dateien`.
  - Einzahl `1 Foto von 1 Person`, `1 Datei`.
  - Beide 0 ergibt `null`.

- [ ] **Step 1: Branch anlegen:** `git switch -c feature/tp4-etappe2-fotos`
- [ ] **Step 2: Tests schreiben:**
  - `passendeEndung`: `('x.pdf','image/png')` → `x.png`; `('Packliste','application/pdf')` → `Packliste.pdf`; `('Foto.JPEG','image/jpeg')` → `Foto.JPEG`; `('Bericht.final','application/pdf')` → `Bericht.final.pdf`; `'a'.repeat(118) + '.docx'` mit PDF → 120 Zeichen, endet auf `.pdf`.
  - `bereinigeDateiname('a%E2%80%AEfdp.exe')` → `afdp.exe`; `pruefeDokumentTitel('a‮b')` → Fehler; `pruefeDateiname('  Pack\nliste.pdf ')` → `Pack liste.pdf`; leer → Fehler.
  - `undListe` mit 0–3 Teilen.
  - `darfFotosHochladen`: Bearbeiter im Entwurf und im Archiv → `true`; Leser bei `JUGENDLEITER` → `false`; Leser bei `ALLE` → `true`, im Archiv → `false`, im Entwurf → `false`; jemand, der den Thread nicht sieht, bei `ALLE` → `false`.
  - `darfFotoLoeschen`: eigenes → `true`, fremdes als Leser → `false`, fremdes als Bearbeiter → `true`.
  - `fotoEinwilligungGilt`:
    - Kind mit Elternzeile → `true`; widerrufen → `false`.
    - Zeile eines Erwachsenen ohne Erziehungsrecht → `false`.
    - Am Tag nach dem 18. Geburtstag: Elternzeile → `false`, eigene Zeile → `true`.
    - Am 18. Geburtstag selbst: Elternzeile → `false`; es gilt `istVolljaehrig`.
  - `ohneFotoEinwilligung`:
    - Thread mit Tim (ohne) und Lena (mit) → nur Tim.
    - Mit Teilnahme-Umfrage, in der nur Lena dabei ist → `[]`.
    - Rollenfilter `NUR_JUGENDLEITER` → `[]`.
  - `fotoHinweis`: zwei Namen → `Von Mats K. und Tim S. dürfen keine Fotos gezeigt werden` (sortiert).
  - `medienZahlText`: alle Fälle oben.
- [ ] **Step 3: Tests scheitern:** `pnpm nx test domain --skip-nx-cache`, FAIL.
- [ ] **Step 4: Umsetzen**, über `index.ts` exportieren. `kinderListe` (namen.ts) und `namenListe` (teilen.ts) nutzen `undListe`, wenn ihre Ausgabe dadurch gleich bleibt (ihre Tests entscheiden). Sonst bleiben sie.
- [ ] **Step 5: Tests grün**, dazu `pnpm nx run jufi:test-server --skip-nx-cache -- dokumente` und `pnpm nx test jufi --skip-nx-cache` (umgestellte `FEHLER_TEXT`-Aufrufer).
- [ ] **Step 6: Commit:** `git commit -m "TP4 Etappe 2: Regeln fuer Fotos, Namen und Foto-Einwilligung"`

---

### Task 2: Modul-Entwürfe und Ansichten der neuen Module

**Files:**

- Create: `libs/domain/src/dateien/module.ts` (+ spec)
- Modify: `libs/domain/src/threads/entwurf.ts`, `vergleich.ts`, `ansicht.ts`, `liste.ts` (`passtZuSuche`), `teilen.ts`, `typen.ts`, `verwaltung.ts` und Specs

**Interfaces:**

- Consumes: Task 1 (`FotoHochladen`, `darfFotosHochladen`, `darfFotoLoeschen`, `ohneFotoEinwilligung`, `fotoHinweis`, `dabeiKinder`, `EinwilligungZeile`, `MedienZahl`)
- Produces:
  - `ModulEntwurf` bekommt `{ typ: 'DATEIEN'; id: string | null; titel: string | null }` und `{ typ: 'FOTOS'; id: string | null; titel: string | null; hochladen: FotoHochladen }`. `MODULTYPEN` bekommt beide.
  - `neuesModul(typ: ModulEntwurf['typ'], …)` liefert für `FOTOS` `hochladen: 'JUGENDLEITER'`.
  - `DateiDaten = { id: string; name: string; typ: string; groesse: number; vonId: string; hochgeladenAm: Date }`, `FotoDaten = { id: string; breite: number; hoehe: number; vonId: string; hochgeladenAm: Date }`
  - `ModulDaten` bekommt `{ typ: 'DATEIEN'; id; titel; dateien: readonly DateiDaten[] }` und `{ typ: 'FOTOS'; id; titel; hochladen: FotoHochladen; fotos: readonly FotoDaten[] }`. Beide Listen sind nach `hochgeladenAm` aufsteigend sortiert.
  - In `dateien/module.ts`:
    - `DateiZeile = { id: string; name: string; typ: string; groesse: number; hochgeladenAm: string }`
    - `FotoZeile = { id: string; breite: number; hoehe: number; von: string; hochgeladenAm: string; darfLoeschen: boolean }`
    - `DateienModulAnsicht = { typ: 'DATEIEN'; id: string; titel: string | null; dateien: DateiZeile[]; darfAendern: boolean }`
    - `FotosModulAnsicht = { typ: 'FOTOS'; id: string; titel: string | null; hochladen: FotoHochladen; fotos: FotoZeile[]; darfHochladen: boolean; hinweis: string | null }`
  - `ModulAnsicht` = `Exclude<ModulDaten, { typ: 'UMFRAGE' | 'DATEIEN' | 'FOTOS' }> | UmfrageAnsicht | DateienModulAnsicht | FotosModulAnsicht`
  - `AnsichtEingabe.fotoEinwilligungen: ReadonlyMap<string, readonly EinwilligungZeile[]>`. Der Server füllt sie nur, wenn der Thread ein Foto-Modul hat.
  - `ThreadBearbeitung.medien: { gesamt: MedienZahl; module: Record<string, MedienZahl> }`

Ansicht:

- `von` ist `absenderName(vonId, umfeld)` und ergibt „ehemaliges Mitglied“ für Entfernte.
- `darfAendern` ist `darfBearbeiten`.
- `hinweis` gibt es nur, wenn `darfHochladen` gilt: `fotoHinweis(ohneFotoEinwilligung(kopf, umfeld, { fotoEinwilligungen, dabei: dabeiKinder(daten) }, jetzt))`.
- `vergleicheBestehendes` erkennt bei `FOTOS` eine Änderung von `hochladen` und bei beiden Typen eine Änderung des Titels als Modul-Änderung. Dateien zählen nie zum Vergleich.
- `entwurfAusThread` übernimmt `hochladen`.
- `passtZuSuche` sucht in Titel und Dateinamen (Entscheidung 14).
- `teilen.ts` ergibt für beide Typen keine Zeile (Spec 11).

- [ ] **Step 1: Tests schreiben:**
  - `entwurfAus` nimmt beide Typen an; `hochladen: 'X'` → Feldfehler.
  - `neuesModul('FOTOS')` → `hochladen: 'JUGENDLEITER'`.
  - `vergleicheEntwurf`: `hochladen` umgestellt → eine Modul-Änderung; unverändert → keine.
  - `threadAnsicht`:
    - Fotos mit `darfLoeschen` je Person.
    - Leser bei `JUGENDLEITER` → `darfHochladen: false`, `hinweis: null`.
    - Bearbeiter → Hinweis mit Tim.
    - Entfernte hochladende Person → `von: 'ehemaliges Mitglied'`.
  - `passtZuSuche` findet `Packliste` über den Dateinamen.
  - `teilenText` mit Foto-Modul enthält keine Fotozeile.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test domain --skip-nx-cache -- threads dateien`, FAIL.
- [ ] **Step 3: Umsetzen.** Jede Weiche über `typ` (`switch` oder `if`-Kette mit Umfrage im `else`) bekommt die neuen Typen ausdrücklich. Ein `else`, das stillschweigend Umfrage annimmt, wird zu einem erschöpfenden `switch` mit `never`-Prüfung.
- [ ] **Step 4: Tests grün**, dazu `pnpm nx run-many -t typecheck`. Weichen in Server und Client, die die neuen Typen noch nicht kennen, bekommen hier einen Zweig, der nichts tut bzw. nichts zeigt; Tasks 4, 8, 9 und 10 füllen ihn. Kein `// TODO`, kein `as`, das den Fehler verdeckt.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Entwuerfe und Ansichten der Module Dateien und Fotos"`

---

### Task 3: Datenmodell, Migration, Einwilligungsart

**Files:**

- Modify: `prisma/schema.prisma`, `libs/db/src/lib/verein-db.ts`, `libs/db/src/schema.spec.ts`
- Modify: `apps/jufi/src/server/mitglieder/zugang.ts` (76), `personen.ts` (68), `jungfischer.ts` (213, 222, 233), `apps/jufi/src/server/mitglieder/einladung.ts` (366), `apps/cli/src/demo.ts` (257, 265) und ihre Specs
- Create: `prisma/migrations/<stamp>_fotos_dateien/migration.sql` (`pnpm prisma migrate dev --create-only --name fotos_dateien`, dann von Hand)

**Interfaces:**

- Produces (Prisma):
  - `ModulTyp` bekommt `DATEIEN`, `FOTOS`
  - `EinwilligungArt` bekommt `FOTOS`
  - `enum FotoHochladen { JUGENDLEITER ALLE }`
  - `DateienModul (id, vereinId)` und `FotosModul (id, vereinId, hochladen FotoHochladen @default(JUGENDLEITER))`
    - nach dem Muster `InfoModul`: `id` = Modul-ID, Relation über `[vereinId, id]` auf `ThreadModul` mit `Cascade`, Back-Relation am `Verein`
    - beide in `VEREINS_MODELLE`
- Neue Enum-Werte per `ALTER TYPE … ADD VALUE` wie in den Migrationen `…threads_verwalten` und `…dateien`. In derselben Migration nutzt kein Ausdruck die neuen Werte.

Jede Abfrage auf `einwilligung`, die die DSGVO-Einwilligung meint, filtert `art: 'DSGVO_ART8'`; jede Anlage setzt sie ausdrücklich. Die Stellen oben sind die bekannten.

- [ ] **Step 1: Tests schreiben:**
  - `schema.spec.ts`: Ein `FotosModul` hat die Vorgabe `JUGENDLEITER`. Löschen des `ThreadModul` nimmt die 1:1-Zeile mit. Ein `ThreadModul` mit `Datei` lässt sich nicht löschen (NoAction aus Etappe 1, jetzt mit Foto-Modul).
  - `zugang`: Ein Kind mit nur einer `FOTOS`-Einwilligung hat keinen Zugang.
  - `jungfischer`:
    - Widerruf der DSGVO-Einwilligung lässt eine `FOTOS`-Zeile unberührt.
    - Die Zählung „hat schon eingewilligt“ übersieht `FOTOS`-Zeilen.
  - `personen`: Der Warnhinweis „ohne Einwilligung“ erscheint trotz `FOTOS`-Zeile.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test db --skip-nx-cache -- schema` und `pnpm nx run jufi:test-server --skip-nx-cache -- zugang jungfischer personen`, FAIL.
- [ ] **Step 3: Umsetzen**, `pnpm run db:generate`. Danach `grep -rn "einwilligung\.\(find\|count\|update\|create\|delete\)" apps libs`. Jede Fundstelle filtert die Art, oder ein Kommentar sagt, warum alle Arten gemeint sind (Datenauszug, Vereinslöschung).
- [ ] **Step 4: Tests grün**, dazu `pnpm nx test db cli --skip-nx-cache` (`demo.spec` zählt weiter „2 Einwilligungen“).
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Datenmodell fuer Datei- und Foto-Modul, Einwilligungsart FOTOS"`

---

### Task 4: Module speichern, laden und mit Dateien löschen

**Files:**

- Modify: `apps/jufi/src/server/threads/schreiben.ts` (`schreibeModul`, `loescheModule`), `laden.ts` (`ladeThreads`, `modulVon`, `modulOrt`), `lesen.ts` (`ladeThreadAnsicht`), `verwalten.ts` (Thread löschen), `bearbeitung.ts` (`ladeBearbeitung`), `test-threads.ts` und Specs

**Interfaces:**

- Consumes: Tasks 2, 3; `loescheDateien` (Etappe 1)
- Produces:
  - `modulOrt` kennt `DATEIEN`/`FOTOS`.
  - `GeladenerThread.module` enthält deren `ModulDaten` mit Dateien und Fotos. `ladeThreads` lädt `datei.findMany({ where: { modulId: { in: ids } } })` einmal für alle Module.
  - Die Testhilfe `test-threads.ts` legt beide Typen an, Fotos und Dateien als Zeilen ohne Bytes.
  - `ThreadBearbeitung.medien`

Löschpfade, jeweils in der vorhandenen Transaktion **vor** dem Löschen der Module:

- `loescheModule(tx, plan)`: `tx.datei.findMany({ where: { modulId: { in: plan.loeschen } }, select: { id, art } })`, dann `loescheDateien(tx, vereinId, dateien, jetzt)`.
- Thread löschen (`verwalten.ts`): dasselbe mit `where: { modul: { threadId } }`, dann `tx.thread.delete`.

`ladeThreadAnsicht` lädt für Threads mit Foto-Modul die `FOTOS`-Einwilligungen der Kinder in `kinderImThread` (`art: 'FOTOS'`, ohne Widerruf), gruppiert nach `jungfischerId`.

- [ ] **Step 1: Tests schreiben** (Testdatenbank):
  - `POST /threads` mit Datei- und Foto-Modul (`hochladen: 'ALLE'`) → 201, `GET /threads/:id` zeigt beide mit leeren Listen.
  - `PUT /threads/:id`, das `hochladen` umstellt → Änderung `MODUL`. Die Zeilen der Dateien bleiben.
  - `PUT /threads/:id` ohne das Foto-Modul mit 3 Fotos → 200, keine `Datei`-Zeile mehr, 6 Schlüssel in `DateiLoeschung` (Review Focus 2).
  - Thread mit Datei-Modul (2 Dateien) und Foto-Modul (3 Fotos) löschen → 204, Löschliste mit 2 + 6 Schlüsseln.
  - `GET` der Bearbeitung → `medien.gesamt` = `{ fotos: 3, dateien: 2, personen: <Zahl verschiedener Hochlader der Fotos> }`, `medien.module[<id>]` je Modul.
  - Ansicht als Jugendleiter mit Kind ohne Foto-Einwilligung → `hinweis` nennt es. Mit eingetragener Einwilligung der Mutter → `hinweis: null`.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- threads`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Module Dateien und Fotos speichern, laden und loeschen"`

---

### Task 5: Fotoverarbeitung und Warteschlange

**Files:**

- Create: `apps/jufi/src/server/dateien/foto.ts`, `foto-schlange.ts`, `test-bilder.ts` und Specs
- Modify: `apps/jufi/src/server/abhaengigkeiten.ts`

**Interfaces:**

- Produces:
  - `verarbeiteFoto(eingabe: string, ausgabe: { haupt: string; vorschau: string }): Promise<FotoErgebnis>` mit
    `FotoErgebnis = { ok: true; breite: number; hoehe: number; bytes: number; sha256: string } | { ok: false; grund: 'PIXEL' | 'TYP' }`.
    `bytes` zählt beide Fassungen, `sha256` gilt der Hauptfassung (Restore-Probe, Spec 12.4).
  - `class FotoSchlange { constructor(wartend = 8); voll(): boolean; reihe<T>(arbeit: () => Promise<T>): Promise<T> | null }`. `null` heißt voll. Eine Arbeit läuft, bis zu `wartend` warten.
  - `AppDeps.fotoSchlange?: FotoSchlange` (Vorgabe `new FotoSchlange()`)
  - Testhilfe `erzeugeBild(e: { breite: number; hoehe: number; format: 'jpeg' | 'png' | 'webp'; alpha?: boolean; orientierung?: number; gps?: boolean }): Promise<Buffer>` (sharp `create`, Farbverlauf). `gps` schreibt über `withExif` `IFD0.Make = 'Erfunden'` und GPS-Felder in `IFD3`.

`verarbeiteFoto`:

1. `sharp(eingabe, { limitInputPixels: 50_000_000, failOn: 'error', sequentialRead: true })`
2. `.rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toFile(haupt)`
3. Vorschau aus `haupt`: `resize` 480, `jpeg({ quality: 75 })`, `toFile(vorschau)`.
4. `sha256` über einen Lesestrom von `haupt`.

- Pixelgrenze (Muster `istPixelLimit` in `verein/logo.ts`) ergibt `PIXEL`; jeder andere sharp-Fehler `TYP`.
- Beim Laden des Moduls stehen `sharp.concurrency(1)` und `sharp.cache(false)` mit Kommentar. Sie gelten prozessweit, also auch fürs Logo; das ist gewollt.
- Entscheidung 2 steht als Kommentar oben in der Datei.

- [ ] **Step 1: Tests schreiben:**
  - 4000 × 3000 JPEG mit GPS → Hauptfassung 2560 × 1920, Vorschau 480 × 360.
    - Die Eingabe hat EXIF mit `Erfunden` (Vorbedingung).
    - Die Ausgabe hat `metadata().exif === undefined` und kein `Erfunden` in den Bytes.
  - 200 × 100 JPEG mit Orientierung 6 → Ausgabe 100 × 200.
  - 800 × 600 PNG mit Alpha 0 → das Pixel (0,0) der Ausgabe ist `255,255,255` (`.raw()`).
  - 300 × 200 WebP → nicht vergrößert, 300 × 200.
  - 7100 × 7100 PNG (einfarbig) → `{ ok: false, grund: 'PIXEL' }`.
  - JPEG-Kopf mit Müll dahinter → `TYP`.
  - `bytes` = Summe der Dateigrößen; `sha256` = Hash der Hauptdatei.
  - `FotoSchlange` mit aufgeschobenen Promises:
    - 1 + 8 angenommen, die zehnte ergibt `null`, `voll()` ist `true`.
    - Höchstens eine Arbeit gleichzeitig (Zähler).
    - Nach dem Ende der ersten wird wieder angenommen.
    - Eine abgelehnte Arbeit hält die Schlange nicht an.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- foto`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Prüfen: `node --experimental-strip-types -e "import('./apps/jufi/src/server/dateien/foto.ts').then(m => console.log(typeof m.verarbeiteFoto))"` gibt `function` aus (Entscheidung 2).
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Fotoverarbeitung mit sharp und Warteschlange"`

---

### Task 6: Gemeinsame Annahme und Upload-Routen der Module

**Files:**

- Create: `apps/jufi/src/server/dateien/annehmen.ts`, `modul-dateien.ts`, `modul-dateien.spec.ts`
- Modify: `apps/jufi/src/server/dateien/dokumente.ts`, `apps/jufi/src/server/verein.ts` (`vereinsApi`), `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: Tasks 1, 4, 5; Etappe 1 (`nimmUpload`, `DateiSpeicher`, `loescheDateien`, `verbrauchBytes`)
- Produces (`annehmen.ts`):
  - `class Abbruch extends Error { constructor(status: number, body: { fehler: string; code?: DateiFehlerCode; feld?: string }) }`
  - `fruehAntwort(res: Response, status: number, body: object): void` (setzt `Connection: close`)
  - `antworteBeiAbbruch(res: Response, fehler: unknown): boolean`. Der Helfer für die sechs gleichen `catch`-Blöcke aus Etappe 1.
  - `NeueDatei = { id: string; art: DateiArt; name: string; typ: string; groesse: number; breite: number | null; hoehe: number | null; sha256: string }`
  - `nimmDatei<T>(req: Request, res: Response, deps: VolleAppDeps, e: { art: DateiArt; name: string | null; freiBytes: number; schreibe: (tx: VereinTx, datei: NeueDatei) => Promise<T>; nachDemCommit?: () => void }): Promise<{ ok: true; wert: T } | { ok: false }>`. Bei `ok: false` ist die Antwort schon gesendet.
- Produces (Routen, alle nach `brauchtMitglied`):

| Route                           | Verhalten                                                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /module/:modulId/dateien` | `modulOrt` Typ `DATEIEN`, sichtbar und `darfBearbeiten`, sonst 404; 20 schon da → 409 `VOLL`; 201 mit `DateiZeile`                                                                  |
| `POST /module/:modulId/fotos`   | Typ `FOTOS`, `darfFotosHochladen`, sonst 404; 500 → 409 `VOLL`; Schlange voll → 503 `BESCHAEFTIGT`; 201 mit `FotoZeile`                                                             |
| `PUT /dateien/:id`              | `{ name }`; nur `DATEI` in einem Datei-Modul mit `darfBearbeiten`, sonst 404; `pruefeDateiname` → 400 `{ fehler, feld: 'name' }`; `passendeEndung(name, typ)`; 200 mit `DateiZeile` |
| `DELETE /dateien/:id`           | Modul-Datei, Thread sichtbar; `FOTO`: `darfFotoLoeschen`, `DATEI`: `darfBearbeiten`, sonst 404; `loescheDateien`; 204                                                               |

`nimmDatei`, in dieser Reihenfolge:

1. `uploadFenster` → 429 mit `Retry-After`.
2. Bei `FOTO`: `fotoSchlange.voll()` → 503 `BESCHAEFTIGT` mit `Retry-After: 2`.
3. Kontingent mit `Content-Length` als Schätzung → 413 `KONTINGENT`.
4. `nimmUpload` mit `GRENZE_BYTES[art]` → 411/413 `GROESSE` mit `FEHLER_TEXT.GROESSE[art]`.
5. `erkenneTyp(kopf, name, art)` → 415 `TYP`/`HEIC`.
6. Weiter je Art:
   - `DATEI`: Name über `passendeEndung`.
   - `FOTO`: zwei Temp-Pfade, `fotoSchlange.reihe(() => verarbeiteFoto(…))`.
     - `null` → 503.
     - `PIXEL` → 413 `GROESSE` mit `FEHLER_TEXT.PIXEL`.
     - `TYP` → 415.
     - Die Eingabe-Temp-Datei wird danach immer gelöscht.
7. `randomUUID`, `uebernimm` (bei `FOTO` beide Schlüssel).
8. Transaktion mit `sperreVereinszeile`, Kontingent mit echter Größe (abzüglich `freiBytes`) und `schreibe`.
9. `nachDemCommit`.

Temp-Dateien verschwinden in jedem Fehlerzweig.

Die Modul-Routen rufen in `schreibe` `mitAenderung` (Änderung `MODUL`, kein Systemeintrag) und prüfen dort die Anzahl unter der Sperre erneut. `nachDemCommit` meldet an `deps.bus`. `PUT` und `DELETE` laufen ebenso über `mitAenderung` und `bus`. Die Dokumente-Routen nutzen `nimmDatei` und `antworteBeiAbbruch`, ohne ihr Verhalten zu ändern; ihre Specs bleiben unverändert grün (bis auf die Endung aus Task 1).

- [ ] **Step 1: Tests schreiben** (`modul-dateien.spec.ts`, Testdatenbank, Speicher im Temp-Verzeichnis, Bilder aus `erzeugeBild`, Bodies `application/octet-stream`):
  - Bearbeiter lädt eine PDF ohne Endung (`X-Dateiname: Packliste`) → 201, `name: 'Packliste.pdf'`, Änderung `MODUL` ohne Systemeintrag, `bus` gemeldet.
  - Foto-Upload:
    - JPEG mit GPS → 201, `breite`/`hoehe` der verkleinerten Fassung.
    - Die Bytes unter `dateiSchluessel(v, id)` haben kein EXIF (Spec 13.2).
    - `groesse` = Summe beider Fassungen.
  - Leser bei `JUGENDLEITER` → 404, bevor der Körper gelesen ist (5-MB-Körper, `tmp/` bleibt leer). Leser bei `ALLE` → 201; im Archiv → 404.
  - Thread, den die Person nicht sieht → 404 (Spec 13.2). Modul eines anderen Typs → 404.
  - Grenzen:
    - Foto 21 MB → 413 `GROESSE` mit Foto-Text.
    - 7100 × 7100 PNG → 413 `GROESSE` mit `PIXEL`-Text.
    - PDF als Foto → 415 `TYP` mit Foto-Text.
    - `ftypheic` → 415 `HEIC`.
  - `fotoSchlange` mit `wartend = 0` und einer blockierten Arbeit → 503 `BESCHAEFTIGT`, `Retry-After: 2` (Spec 13.2).
  - 19 Dateien da, zwei gleichzeitige Uploads (Barriere aus `dokumente.spec.ts`) → genau einer 201, der andere 409 `VOLL`.
  - `PUT /dateien/:id`:
    - `{ name: 'Neu' }` → `Neu.pdf`.
    - Leer → 400 `feld: 'name'`.
    - Foto → 404.
    - Dokument-Datei → 404.
  - `DELETE`: eigenes Foto als Leser → 204, Löschliste mit zwei Schlüsseln; fremdes als Leser → 404; als Bearbeiter → 204; Datei als Leser → 404.
  - Mandanten-Test: Fälle `'POST /module/:modulId/dateien'`, `'POST /module/:modulId/fotos'`, `'PUT /dateien/:id'`, `'DELETE /dateien/:id'` mit fremdem Modul bzw. fremder Datei → 404, fremde Daten unverändert.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- modul-dateien mandanten`, FAIL.
- [ ] **Step 3: Umsetzen**, Routen in `vereinsApi`.
- [ ] **Step 4: Tests grün**, dazu `-- dokumente` (Umbau ohne Verhaltensänderung).
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Gemeinsame Annahme und Upload-Routen der Module"`

---

### Task 7: Ausliefern mit Sichtbarkeit, Vorschau und CSP

**Files:**

- Modify: `apps/jufi/src/server/dateien/ausliefern.ts`, `speicher.ts`, `aufraeumen.ts` und Specs, `apps/jufi/src/server/sicherheit.ts` (+ spec), `deploy/nginx-sicherheit.conf`, `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: Task 6; `darfThreadSehen(db, personId, threadId)`
- Produces:
  - `DateiSpeicher.lies(schluessel): Promise<{ strom: Readable; bytes: number } | null>` (Entscheidung 4; `fstat` auf dem geöffneten Deskriptor)
  - `darfDateiSehen(db: VereinDb, personId: string, datei: { dokumentId: string | null; modulId: string | null }): Promise<boolean>`: Dokument → `true`, Modul → `darfThreadSehen` des Threads dieses Moduls
  - `GET /dateien/:id/vorschau`: nur `FOTO`, sonst 404; Schlüssel `dateiSchluessel(v, id, true)`, `image/jpeg`, `inline`
  - App-CSP: `img-src 'self' blob:` an beiden Stellen

Köpfe wie Etappe 1, dazu:

- `Content-Length` aus `lies().bytes`.
- `INLINE_TYPEN` bekommt `image/webp`.
- Fotos heißen beim Ausliefern `foto-<id.slice(0, 8)>.jpg` (Entscheidung 12).
- Der ENOENT-Pfad (Zeile da, Bytes fehlen) antwortet 404 **mit** `nosniff` und Datei-CSP (Rückstand).

Rückstand im Aufräumer: Ein Fehler an einem Schlüssel (Löschliste oder Waise) wird mit `console.error` gemeldet und übersprungen, statt den Lauf abzubrechen. Das Ergebnis bekommt `fehler: number`.

- [ ] **Step 1: Tests schreiben:**
  - Foto in sichtbarem Thread: Hauptfassung → 200, `Content-Length` = Größe der Hauptdatei auf der Platte, Bytes gleich (Review Focus 5); `/vorschau` ebenso mit der Vorschau-Datei.
  - Thread im Entwurf, Person kein Jugendleiter → 404 für beide.
  - Thread für die Person unsichtbar (Rollenfilter) → 404.
  - `/vorschau` einer `DATEI` → 404. WebP wäre inline (Einheitentest über `INLINE_TYPEN`).
  - Fehlende Bytes → 404 mit `X-Content-Type-Options: nosniff`.
  - `sicherheit.spec`: Die CSP enthält `img-src 'self' blob:`. Die nginx-Datei enthält dieselbe Direktive (Textvergleich der `img-src`-Teile beider Quellen im Spec).
  - Aufräumer: Fake-Speicher, dessen `loesche` für einen Schlüssel wirft → die anderen werden gelöscht, `fehler: 1`.
  - Mandanten-Test: `'GET /dateien/:id/vorschau'`.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- ausliefern speicher aufraeumen sicherheit mandanten`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Fotos und Modul-Dateien ausliefern, Vorschau, CSP blob"`

---

### Task 8: Hochladeschlange und Datei-Modul

**Files:**

- Create: `apps/jufi/src/app/verein/hochladeschlange.ts`, `hochladen-feld.ts`, `dateien-anzeige.ts`, `threads/dateien-modul.ts` und Specs
- Modify: `apps/jufi/src/app/verein/hochladen.ts`, `dateien-api.ts`, `medien.ts`, `verwaltung/dokumente.ts`, `threads/thread-seite.ts` und Specs

**Interfaces:**

- Consumes: Tasks 2, 6, 7
- Produces:
  - `ladeHoch(url, datei, methode, http, art: DateiArt = 'DATEI')`: prüft vorab gegen `GRENZE_BYTES[art]`. Bei 401 nimmt es denselben Weg zur Anmeldung wie die übrigen Anfragen der App (Rückstand).
  - `Hochladung = { schluessel: number; datei: File; ziel: string; methode: 'POST' | 'PUT'; zustand: 'wartet' | 'laeuft' | 'fertig' | 'fehler'; anteil: number; fehler: string | null; code: string | null; vorschau: string | null }`
  - `class Hochladeschlange { constructor(e: { http: HttpClient; art: DateiArt; nachErfolg: (h: Hochladung, antwort: unknown) => void }); readonly reihe: Signal<readonly Hochladung[]>; fuegeHinzu(dateien: readonly File[], ziel: string, methode?: 'POST' | 'PUT'): void; nochmal(schluessel: number): void; verwirf(schluessel: number): void; beende(): void }`
    - lädt nacheinander, eine Datei zur Zeit;
    - bei `code === 'BESCHAEFTIGT'` wartet sie `Retry-After` (Vorgabe 2 s) und versucht es bis zu dreimal neu (Entscheidung 16);
    - bei `FOTO` setzt sie `vorschau` per `URL.createObjectURL` und gibt sie bei `fertig`, `verwirf` und `beende` frei;
    - erfolgreiche Zeilen verschwinden.
  - `HochladenFeldComponent` (`jf-hochladen-feld`):
    - Eingaben `ziel: string`, `art: DateiArt`, `beschriftung: string`; Ausgabe `hochgeladen`.
    - Ein Knopf öffnet die Dateiauswahl (`multiple`; `accept`: Foto `image/*` (Spec 2.3), Datei die Liste aus Etappe 1).
    - Je Hochladung eine Zeile: Name bzw. Vorschaubild, Balken nur bei `laeuft`, „Wartet“ bei `wartet` (Rückstand: kein unbestimmter Balken), Fehlertext, „Nochmal“, „Verwerfen“.
    - `aria-label` am `input`, nicht am `label` (Rückstand).
  - `dateien-anzeige.ts`: `typKuerzel(typ)`, `imBrowser(typ)` (mit WebP) und `dateiLink(slug, datei)`, herausgelöst aus `medien.ts`
  - `DateienApi`: `vorschauAdresse(slug, id)`, `modulDateienAdresse(slug, modulId)`, `modulFotosAdresse(slug, modulId)`, `benenneDatei(slug, id, name)`, `loescheDatei(slug, id)`
  - `DateienModulComponent` (`jf-dateien-modul`): Eingaben `slug`, `modul: DateienModulAnsicht`; Ausgabe `geaendert`

Datei-Modul auf der Thread-Seite:

- Titel, dann je Datei eine Zeile im Stil der Medien-Dokumente: Icon, Name, Typ-Kürzel und `speicherText`. PDF und Bilder öffnen in neuem Tab, alles andere lädt herunter.
- Leer: „Noch keine Dateien.“
- Mit `darfAendern`:
  - je Zeile „Umbenennen“ (inline, Fehler des Servers am Feld) und „Löschen“ mit Bestätigung („‚<Name>‘ löschen?“);
  - darunter `jf-hochladen-feld` mit „Dateien hochladen“.
- Nach Erfolg und Änderung gibt `geaendert` aus. Die Thread-Seite lädt dann still neu, wie nach einer Umfrage-Antwort.

Verwaltung › Dokumente nutzt die `Hochladeschlange` statt ihrer eingebauten Warteschlange. Ihre Specs bleiben bis auf Selektoren gleich.

- [ ] **Step 1: Tests schreiben:**
  - `Hochladeschlange`:
    - drei Dateien → nacheinander, nie zwei `laeuft`;
    - Fehler bleibt mit Text; `nochmal` lädt neu;
    - 503 `BESCHAEFTIGT` zweimal, dann Erfolg → ohne sichtbaren Fehler fertig (Fake-Timer);
    - viermal 503 → Fehler mit Text;
    - `vorschau` wird freigegeben (`URL.revokeObjectURL` gezählt).
  - `jf-hochladen-feld`: `aria-label` am `input`; „Wartet“ statt Balken.
  - `jf-dateien-modul`:
    - Leser sieht Liste ohne Knöpfe.
    - Bearbeiter sieht Umbenennen, Löschen und Hochladen.
    - Löschen erst nach Bestätigung, ruft `DELETE`.
    - Umbenennen mit 400 zeigt den Text am Feld.
  - Verwaltung › Dokumente: vorhandene Specs grün.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Im Browser (`pnpm run dev`, Demo-Verein, Thread mit Datei-Modul über den Editor-Endpunkt per `curl` oder nach Task 10): hochladen, umbenennen, löschen; 375 × 812 und 1280 × 800, hell und dunkel, kein waagerechter Überlauf (`scrollWidth`). Werte in den Bericht.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Hochladeschlange und Datei-Modul auf der Thread-Seite"`

---

### Task 9: Foto-Modul mit Großansicht

**Files:**

- Create: `apps/jufi/src/app/verein/threads/fotos-modul.ts`, `foto-grossansicht.ts` und Specs
- Modify: `apps/jufi/src/app/verein/threads/thread-seite.ts`

**Interfaces:**

- Consumes: Task 8 (`jf-hochladen-feld`, `DateienApi`), Task 2 (`FotosModulAnsicht`)
- Produces:
  - `FotosModulComponent` (`jf-fotos-modul`): Eingaben `slug`, `modul: FotosModulAnsicht`; Ausgabe `geaendert`
  - `FotoGrossansichtComponent` (`jf-foto-grossansicht`): Eingaben `slug`, `fotos: FotoZeile[]`, `index: number`; Ausgaben `schliessen`, `geloescht`

Foto-Modul:

- `hinweis` (falls da) steht als Hinweiszeile mit `jf-icon warnung` über dem Raster.
- Raster mit 3 Spalten aus quadratischen Vorschaubildern (`object-fit: cover`, `loading="lazy"`, `alt="Foto von <von>"`). Darunter die Zahl („23 Fotos“).
- Leer: „Noch keine Fotos.“
- Mit `darfHochladen`: `jf-hochladen-feld` mit „Fotos hochladen“, `art: 'FOTO'`.

Großansicht:

- Overlay mit `role="dialog"`, `aria-modal="true"` über der ganzen Seite: Bild (`dateiAdresse`, `object-fit: contain`), „Foto von <von>“, „Speichern“, „Löschen“ (nur `darfLoeschen`, mit Bestätigung) und „Schließen“.
- Steuerung: Escape schließt, Pfeil links und rechts blättern. Wischen über Pointer-Events: waagerecht mehr als 50 px blättert.
- Fokus beim Öffnen auf „Schließen“, beim Schließen zurück auf das angetippte Vorschaubild.
- „Speichern“:
  - Das Bild wird geholt (`fetch` mit Sitzung).
  - Kann `navigator.canShare({ files: [datei] })`, geht es über `navigator.share`.
  - Sonst ein Link auf `dateiAdresse(slug, id, true)` mit `download`.

- [ ] **Step 1: Tests schreiben:**
  - Raster hat 3 Spalten (berechnetes `grid-template-columns` mit drei Werten); Hinweis nur bei `hinweis`.
  - Leser ohne `darfHochladen` sieht kein Upload-Feld.
  - Antippen öffnet die Großansicht am richtigen Index.
  - Escape schließt und setzt den Fokus zurück.
  - Pfeil rechts blättert und hält am letzten Foto.
  - Wischen um 80 px nach links blättert.
  - „Löschen“ nur bei `darfLoeschen`; ruft nach Bestätigung `DELETE` und gibt `geloescht` aus.
  - „Speichern“ mit gefälschtem `navigator.canShare`/`share` → `share` mit einer Datei `foto-….jpg`; ohne `canShare` → Link mit `download` und `?herunterladen=1`.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen**, Weiche in `thread-seite.ts`.
- [ ] **Step 4: Tests grün.**
  - Im Browser mit Bildern aus `node tools/erzeuge-testbilder.mjs --bunt 5 <Verzeichnis>` (das Skript entsteht in Task 13; bis dahin mit `erzeugeBild` aus Task 5): hochladen mit Vorschau vor dem Senden (keine CSP-Meldung in der Konsole), Raster, Großansicht, Blättern, Löschen.
  - Gemessen bei 375 × 812 und 1280 × 800, hell und dunkel: drei gleich breite Spalten, Overlay deckt den Viewport (`getBoundingClientRect`).
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Foto-Modul mit Raster und Grossansicht"`

---

### Task 10: Editor für Datei- und Foto-Modul

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/threads/dateien-felder.ts`, `fotos-felder.ts` und Specs
- Modify: `apps/jufi/src/app/verein/verwaltung/threads/editor.ts`, `vorschau.ts` und Specs

**Interfaces:**

- Consumes: Task 2 (`ModulEntwurf`, `neuesModul`, `ThreadBearbeitung.medien`, `medienZahlText`), Task 8 (`jf-hochladen-feld`, `DateienApi`), Task 9 (`jf-fotos-modul`)
- Produces: `jf-dateien-felder`, `jf-fotos-felder` mit Eingaben `modul` (der jeweilige Entwurf), `slug`, `zahl: MedienZahl | null` und Ausgabe `aendern`

- „Modul hinzufügen“ bekommt „Dateien“ und „Fotos“ (`TYPEN`).
- Felder:
  - beide: Titel wie bei den übrigen Typen;
  - Fotos zusätzlich ein Schalter „Alle Leser dürfen Fotos hochladen“ mit dem Satz „Sonst nur, wer den Thread bearbeiten darf.“
- Darunter (Entscheidung 10):
  - bei `id === null` der Satz `Erst speichern, dann hochladen`;
  - sonst die Zahl („3 Dateien“ / „23 Fotos“) und `jf-hochladen-feld` auf die Modul-Adresse. Nach einem Upload lädt der Editor `medien` neu, ohne den Entwurf anzufassen.
- Entfernen eines Moduls mit `medienZahlText(zahl) !== null` fragt über `BestaetigungComponent`: „Modul ‚<Titel oder Typ>‘ entfernen? Beim Speichern löscht das <Text>.“ (Entscheidung 11).
- Die Bestätigung beim Thread-Löschen bekommt, wenn `medien.gesamt` etwas zählt, den Satz „Das löscht auch <Text>.“.
- Vorschau: beide Typen über `jf-dateien-modul`/`jf-fotos-modul` mit leeren Listen, ohne Upload und ohne Hinweis.

- [ ] **Step 1: Tests schreiben:**
  - Hinzufügen beider Typen; Fotos startet mit Schalter aus.
  - Ungespeichert → `Erst speichern, dann hochladen`, kein Upload-Feld.
  - Gespeichert → Upload-Feld mit Ziel `/<slug>/api/v1/module/<id>/fotos`.
  - Entfernen mit 23 Fotos von 5 Personen fragt mit genau diesem Text; ohne Medien keine Rückfrage.
  - Thread-Löschen nennt „Das löscht auch 3 Fotos von 2 Personen und 2 Dateien.“
  - Vorschau zeigt „Noch keine Fotos.“
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.** Die neuen Felder entstehen in den eigenen Komponenten, nicht in `modul-felder.ts` (Spec 10).
- [ ] **Step 4: Tests grün.** Im Browser: Thread mit beiden Modulen anlegen, speichern, im Editor hochladen, Modul mit Fotos entfernen und speichern; 1280 × 800 und 375 × 812, hell und dunkel.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Datei- und Foto-Modul im Editor"`

---

### Task 11: Foto-Einwilligung pflegen und anzeigen

**Files:**

- Modify: `apps/jufi/src/server/mitglieder/jungfischer.ts`, `profil.ts`, `personen.ts` und Specs, `apps/jufi/src/server/mandanten.spec.ts`
- Modify: `apps/jufi/src/app/verein/mitglieder-api.ts`, `jungfischer.ts`, `profil.ts`, `verwaltung/personenseite.ts` und Specs

**Interfaces:**

- Consumes: Task 1 (`fotoEinwilligungGilt`, Texte), Task 3
- Produces:
  - `POST /meine-jungfischer/:kindId/einwilligung` nimmt `{ erteilen: boolean; art?: 'DSGVO_ART8' | 'FOTOS' }`, Vorgabe `DSGVO_ART8`; eine unbekannte Art → 400 (Entscheidung 7).
    - Für `FOTOS`: dieselbe Prüfung `darfEinwilligen`; ein volljähriges Kind → 404.
    - `erteilen: true` legt eine Zeile mit `FOTO_EINWILLIGUNG_TEXT_VERSION` an, wenn noch keine gültige da ist.
    - `false` widerruft alle offenen `FOTOS`-Zeilen des Kindes.
    - Danach `vermerkeUmfeld` wie bei der DSGVO-Einwilligung.
  - `POST /ich/einwilligung` mit `{ erteilen: boolean }`: nur volljährige Jungfischer, sonst 404; Art `FOTOS`, `erteiltVon = jungfischerId = ich`; unter derselben Sperre wie die Route oben.
  - `KindAnsicht.fotos: { erlaubt: boolean; darfAendern: boolean }` (`darfAendern` = erziehungsberechtigt und nicht volljährig)
  - `GET /ich` → `fotoEinwilligung: { erlaubt: boolean } | null` (`null`, wenn die Person kein volljähriger Jungfischer ist)
  - Personenansicht der Verwaltung → `fotoEinwilligung: boolean | null` (`null` für Nicht-Jungfischer)
  - `MitgliederApi`: `setzeFotoEinwilligung(slug, kindId, erteilen)`, `setzeEigeneFotoEinwilligung(slug, erteilen)`

Oberflächen:

- **Meine Jungfischer:** je Kind eine Zeile „Fotos: erlaubt“ bzw. „Fotos: nicht erlaubt“.
  - Mit `darfAendern`: „Fotos erlauben“ öffnet die Bestätigung mit `FOTO_EINWILLIGUNG_TEXT`; „Erlaubnis zurückziehen“ fragt nach.
  - Bei volljährigen Kindern: „Pflegt <Vorname> selbst im Profil.“
- **Profil:** Abschnitt „Fotos“ mit demselben Paar und `FOTO_EINWILLIGUNG_TEXT_SELBST`.
- **Verwaltung › Person:** bei Jungfischern „Fotos: erlaubt / nicht erlaubt“ neben dem vorhandenen Einwilligungshinweis.

- [ ] **Step 1: Tests schreiben:**
  - Server:
    - Mutter erteilt `FOTOS` → `GET /meine-jungfischer` zeigt `erlaubt: true`, DSGVO-Zustand unverändert.
    - Widerruf → `false`.
    - `art: 'X'` → 400.
    - Volljähriges Kind über die Elternroute → 404.
    - Volljähriger Jungfischer über `/ich/einwilligung` → `GET /ich` zeigt `erlaubt: true`.
    - Minderjähriger über `/ich/einwilligung` → 404.
    - Eltern-Erlaubnis von gestern, Kind heute 18 → `erlaubt: false` (Review Focus 4, mit `jetzt` aus den Deps).
    - Mandanten-Test `'POST /ich/einwilligung'`; fremdes Kind über die Elternroute → 404.
  - Client:
    - Zeile und Knöpfe je Fall; Erteilen erst nach Bestätigung mit dem Text.
    - Profil-Abschnitt nur bei `fotoEinwilligung !== null`.
    - Personenseite zeigt den Stand.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- jungfischer profil personen mandanten` und `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Im Browser: Mutter erlaubt Fotos für ein Kind, der Hinweis im Foto-Modul verliert den Namen ohne Neuladen; 375 × 812 hell und dunkel.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Foto-Einwilligung fuer Eltern, Volljaehrige und Verwaltung"`

---

### Task 12: Medien „Fotos & Dateien“

**Files:**

- Create: `apps/jufi/src/server/dateien/medien.ts` (+ spec)
- Modify: `libs/domain/src/dateien/medien.ts` (+ spec), `apps/jufi/src/server/verein.ts`, `apps/jufi/src/server/mandanten.spec.ts`, `apps/jufi/src/app/verein/medien.ts` (+ spec), `dateien-api.ts`

**Interfaces:**

- Consumes: Tasks 2, 4, 8
- Produces:
  - `MedienBlock = { threadId: string; segment: string; titel: string; archiviert: boolean; fotos: number; vorschau: string[]; dateien: DateiZeile[]; weitereDateien: number }`, `MedienAntwort = { bloecke: MedienBlock[] }`
  - `medienBloecke(threads: readonly { kopf: ThreadKopf; segment: string; archiviert: boolean; letzteAktivitaetAm: Date; module: readonly ModulDaten[] }[]): MedienBlock[]`
    - Threads ohne Foto und ohne Datei fallen weg.
    - Sortiert nach `letzteAktivitaetAm` absteigend.
    - `vorschau`: die IDs der 6 neuesten Fotos über alle Foto-Module, neueste zuerst.
    - `dateien`: die ersten 10 über alle Datei-Module in Modul- und Hochladereihenfolge; `weitereDateien` zählt den Rest.
  - `GET /medien` → `MedienAntwort`
    - nur veröffentlichte Threads, die die Person nach `siehtThread` sieht, archivierte eingeschlossen;
    - `segment` und `letzteAktivitaetAm` aus derselben Quelle wie die Thread-Liste.
  - `DateienApi.medien(slug): Observable<MedienAntwort>`

Seite Medien:

- Reiterleiste „Fotos & Dateien“ | „Dokumente“ (`role="tablist"`), Zustand im Query-Parameter `reiter` (Entscheidung 13).
- Reiter „Fotos & Dateien“, je Block:
  - der Titel als Link auf den Thread, bei Archiv ein Kennzeichen „Archiv“;
  - bis zu 6 Vorschaubilder in einer Reihe und „23 Fotos“;
  - die Dateien wie im Datei-Modul (`dateien-anzeige.ts`), dann „und 3 weitere“;
  - „Zum Thread“.
- Leer: „Noch keine Fotos oder Dateien.“
- Der Reiter „Dokumente“ ist der bisherige Inhalt.

- [ ] **Step 1: Tests schreiben:**
  - `medienBloecke`: Reihenfolge nach Aktivität; 8 Fotos ergeben 6 Vorschauen, neueste zuerst; 13 Dateien ergeben 10 und `weitereDateien: 3`; Thread nur mit Info-Modul fällt weg.
  - Server:
    - Entwurf erscheint nicht, auch nicht für Jugendleiter.
    - Unsichtbarer Thread erscheint nicht.
    - Archivierter Thread erscheint mit `archiviert: true`.
    - Mandanten-Test `'GET /medien'` (keine fremden Threads).
  - Client:
    - Vorgabe-Reiter, Wechsel setzt `?reiter=dokumente`.
    - Block mit Link, Zahl, „und 3 weitere“, Leertext.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test domain jufi --skip-nx-cache` und `pnpm nx run jufi:test-server --skip-nx-cache -- medien mandanten`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Im Browser: 375 × 812 und 1280 × 800, hell und dunkel; die Vorschau-Reihe läuft bei 375 px nicht über (`scrollWidth`).
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Medien mit Fotos und Dateien der Threads"`

---

### Task 13: Speicherprobe im Image, Ende-zu-Ende und Doku

**Files:**

- Create: `tools/erzeuge-testbilder.mjs`, `tools/fotoprobe.mjs`
- Modify: `tools/deploy.sh`, `apps/jufi-e2e/src/ablauf.spec.ts`, `apps/jufi-e2e/src/hilfen.ts`, `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-21-jufi-tp4-module-medien-design.md`

**Testbilder** (`node tools/erzeuge-testbilder.mjs <verzeichnis> [--bunt <n>]`, sharp auf dem Entwicklungsrechner):

- `gross.jpg`: 8000 × 6000, Farbverlauf mit leichtem Rauschen, Qualität 90. Das Skript bricht ab, wenn die Datei über 20 MB liegt.
- `gross.png`: RGB-Rauschen so bemessen, dass die Datei zwischen 18 und 20 MB groß ist (Größe prüfen, sonst abbrechen).
- Mit `--bunt <n>`: n Bilder 1600 × 1200 aus Kreisen und Rechtecken in zufälligen Farben (`bunt-1.jpg` …) für die lokale Abnahme (Entscheidung 15).

**Probe im Rauchtest** (Entscheidung 1), in `deploy.sh` nach dem Initialen-Icon:

- Der Rauchtest-Container startet mit `--memory <m> --memory-swap <m>`. `<m>` ist der `mem_limit` des Dienstes `jufi`, aus `deploy/jufi-services.yml` gelesen; fehlt er, bricht der Rauchtest ab.
- Testbilder erzeugen, dann `docker cp` von `foto.ts`, `fotoprobe.mjs` und beiden Bildern nach `/app/probe/` (dort findet Node `sharp` in `/app/node_modules`).
- `docker exec <app> node /app/probe/fotoprobe.mjs /app/probe/gross.jpg /app/probe/gross.png`. Die Probe ruft `verarbeiteFoto` je Bild und gibt Maße und Bytes aus.
- Danach:
  - Exit 137 oder ein beendeter App-Container → `fail` mit „Speicher reicht nicht; mem_limit anheben (Spec 2.4)“.
  - `cat /sys/fs/cgroup/memory.peak` → `note "Fotoprobe: 48 MP und 20-MB-PNG verarbeitet, Spitze <MiB> von <m>"`.
  - Die App antwortet danach weiter auf `/healthz`.
- Reicht der Speicher nicht: **nicht** die Fotogrenze senken, sondern dem Eigentümer die gemessenen Werte für einen neuen `mem_limit` vorlegen (Spec 2.4).

**Ende-zu-Ende** im seriellen Ablauf nach den Dokument-Schritten, mit Bildern aus einem neuen Erzeuger `erzeugeJpeg(breite, hoehe, gps?)` in `hilfen.ts`:

1. Leitung öffnet im Editor den vorhandenen Thread des Ablaufs, fügt „Dateien“ und „Fotos“ mit „Alle Leser dürfen Fotos hochladen“ hinzu und speichert. Danach lädt sie im Editor eine erzeugte `Packliste.pdf` hoch.
2. Mutter öffnet den Thread. Das Foto-Modul zeigt „Von … dürfen keine Fotos gezeigt werden“, darin Mia. Der Test prüft vorher, dass Mia zur Zielgruppe gehört und bei einer Teilnahme-Umfrage „Dabei“ ist. Die Mutter lädt zwei JPEGs hoch, eines mit GPS.
3. Kind (Mia) hat den Thread offen und sieht beide Vorschaubilder ohne Neuladen.
4. `request.get` auf ein Foto mit der Sitzung der Mutter → 200, `image/jpeg`; `sharp(body).metadata()` hat kein `exif`, die lange Seite ist höchstens 2560.
5. Mutter erlaubt unter „Meine Jungfischer“ Fotos für Mia. Im Thread verschwindet Mia aus dem Hinweis, ohne Neuladen.
6. Leitung öffnet die Großansicht, löscht ein Foto; die Mutter sieht noch eins.
7. Mutter öffnet Medien: Der Block des Threads zeigt „1 Foto“ und „Packliste.pdf“. Im Reiter „Dokumente“ greifen die bisherigen Prüfungen, die dafür den Reiter wechseln.

**Doku:**

- README:
  - Abschnitt „Fotos“: Verarbeitung, Warteschlange, Testbilder-Skript;
  - im Deploy-Abschnitt die Fotoprobe und was bei „Speicher reicht nicht“ zu tun ist.
- CLAUDE.md:
  - Stand: Zeile „TP4 Etappe 2 ist da: …“.
  - Stolperstein: `foto.ts` importiert nur `sharp` und `node:*` und nutzt nur löschbare TS-Syntax, sonst scheitert die Fotoprobe im Rauchtest.
  - Stolperstein: Die DSGVO-Abfragen filtern `art`.
- TP4-Spec:
  - die Entscheidungen 1–16 an ihren Stellen (2.4, 2.5, 4.1–4.4, 9.1, 9.3, 3.2);
  - Fehlercodes in 9.3 um `VOLL` für Module ergänzen;
  - in 4.4 die Regel für Volljährige.

- [ ] **Step 1: E2E-Tests schreiben.**
- [ ] **Step 2: Scheitern sehen:** `pnpm run e2e`, die neuen Schritte FAIL nur dort, wo noch etwas fehlt. Sonst die Ursache klären.
- [ ] **Step 3: Skripte und Doku umsetzen**, dann `pnpm run deploy:app --dry-run` (braucht `pnpm run db:up` und Docker). Die Zeile `Fotoprobe: …` mit Spitzenwert kommt wörtlich in den Bericht (Abnahme Spec 2.4, Review Focus 1).
- [ ] **Step 4: Alles grün:** `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`, `pnpm run e2e`, `pnpm exec prettier --check .`, `bash -n tools/deploy.sh`.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 2: Fotoprobe im Rauchtest, Ende-zu-Ende und Doku"`
