# JuFi TP3 Etappe 6 — Teilen und Abschluss — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder Leser teilt den Stand eines Threads als WhatsApp-Text. Ein geteilter Link zeigt in WhatsApp Titel und Vereins-Icon, aber nur bei veröffentlichten Familien-Threads. Der Datenauszug nennt Antworten, Nachrichten und Gelesen-Stände, und die Demo spielt das Bowling-Szenario samt Zeltlager und Archiv ein. Der Ende-zu-Ende-Test deckt die fehlenden Schritte aus 1.1 ab, und die Datenschutzerklärung beschreibt Threads. Danach ist Teilprojekt 3 abgeschlossen (Spec 1.4, Abschnitte 7, 9, 10).

**Architecture:**

- `teilenText` ist eine reine Funktion in `@jufi/domain`. Sie baut den Text aus der `ThreadAnsicht`, die der Client ohnehin hat; die Ansicht wendet die Namensregel 3.4 schon an.
- Die Thread-Seite teilt am Handy über `navigator.share` und kopiert am Rechner in die Zwischenablage.
- Die Link-Vorschau ist eine Express-Route vor dem Angular-Handler. Sie holt die Seite über eine Abhängigkeit `seitenHtml`; in `server.ts` ist das `angularApp.handle`. In diese Seite setzt sie Open-Graph-Tags ein, deren Titel die Domänenregel `vorschauTitel` bestimmt.
- Datenauszug, Entfernen, Demo, Ende-zu-Ende-Test und Texte ergänzen den Bestand.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (Signale, OnPush, inline), Express 4, Prisma 7, Postgres 17, Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md`, Abschnitte:

- 1.1 (Schritte 9–11)
- 1.4 (Etappe 6)
- 3.4
- 7.1, 7.2
- 9.1–9.4
- 10.2–10.4

Eingabe außerdem: Memory „TP3-Rückstand“. Diese Etappe übernimmt nur, was ihre eigenen Dateien berührt:

- Demo schreibt keine `MODUL`-Änderungen.
- `urheberId` des Austauschs in der Demo ist Thomas statt null.
- Der Satz in Spec 2.6 zu `POST /personen` ist unvollständig.

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 7 trägt sie in die TP3-Spec ein.

1. **Der Teilen-Text entsteht im Client aus der `ThreadAnsicht`.**
   - Die Domänenfunktion ist `teilenText({ ansicht, basisUrl, slug, jetzt })`. Die Ansicht ist schon je Betrachter gerechnet (`auswertung` nach 3.4), also steht im Text nur, was der Teilende sieht.
   - Verworfen: eine Route `GET /threads/:id/teilen`. Safari verlangt `navigator.share` innerhalb der Nutzergeste, und eine Anfrage davor verbraucht sie. Teilen ginge dann am iPhone nicht.
2. **Der Link nimmt `location.origin` statt `BASIS_URL`.**
   - Die App ist nur unter `BASIS_URL` erreichbar: `security.allowedHosts` lässt keinen anderen Host zu, und der Proxy leitet um. Also ist beides dasselbe.
   - Verworfen: `BASIS_URL` an den Client ausliefern. Das wäre ein Feld nur für diesen Zweck.
3. **Teilen oder Kopieren entscheidet der Zeiger.**
   - Bei `(pointer: coarse)` und vorhandenem `navigator.share` wird geteilt, sonst kopiert.
   - Bricht die Person das Teilen ab (`AbortError`), passiert nichts. Scheitert das Teilen sonst, wird kopiert.
   - Scheitert das Kopieren, erscheint der Text in einem schreibgeschützten Feld zum Markieren, wie bei `einladung-anzeige.ts`.
   - Verworfen: immer `navigator.share`, wenn vorhanden. Unter Windows öffnet Chrome dann den Systemdialog statt zu kopieren (Spec 7.1: „am Rechner ‚Kopieren‘“).
4. **Kein Teilen bei Entwürfen.** Den Link öffnet außer den Bearbeitern niemand, also hätte das Teilen keinen Empfänger.
5. **Die Link-Vorschau holt die Seite über `deps.seitenHtml(req)`.**
   - In `server.ts` ist das `angularApp.handle(req)` → `antwort.text()`, in Tests ein festes Gerüst. So kommen die Tags unter `ng serve` und im Image in dieselbe `index.html`, die Angular sonst ausliefert, samt aktuellen Skript-Hashes.
   - Verworfen: `index.csr.html` aus `dist` lesen. Die Datei gibt es unter `ng serve` nicht.
   - Verworfen: eine eigene HTML-Vorlage in Express. Sie liefe dem Angular-Bau hinterher.
6. **Unbekannter oder gesperrter Verein: die Route reicht weiter** (`next()`). Angular antwortet dann wie bisher, und die Antwort trägt keine Tags. „404 wie bisher“ in 7.2 heißt also: Nichts ändert sich, auch keine Datenbankauskunft.
   - Verworfen: `vereinAusSlug` vorschalten. Es antwortet mit JSON-404, und ein Mensch mit einem Tippfehler im Link sähe statt der Seite JSON.
7. **Tags der Vorschau**, alle Werte HTML-maskiert (`& < > " '`):
   - `og:type` = `website`
   - `og:site_name` = Anzeigename des Vereins
   - `og:title` = Thread-Titel oder Anzeigename
   - `og:image` = `<BASIS_URL>/<slug>/icon-512.png`
   - `og:image:width` und `og:image:height` = `512`

   Sonst nichts, auch keine Beschreibung (7.2: „keine weiteren Daten“). Ein Segment ohne lesbare ID gilt als unbekannte ID.

8. **Datenauszug, Antworten:** Darin stehen die Antworten, deren `fuer` die Person selbst oder eines ihrer zugeordneten Kinder ist, auch wenn ein anderer sie eingetragen hat.
   - „Zugeordnet“ heißt jedes nicht entfernte Kind, nicht nur bei Erziehungsberechtigung. Wer zugeordnet ist, darf für das Kind antworten (`darfFuerKindHandeln`).
   - Nicht darin: Antworten, die die Person für fremde Kinder nachgetragen hat. Das wären deren Daten.
   - Personen heißen wie im übrigen Auszug: `'ich'` oder voller Name bzw. „(entfernte Person)“.
9. **Demo:**
   - Das Zeltlager trägt das Jahr seines Termins: 2. bis 8. August des Folgejahrs, Titel `Zeltlager <Jahr>`, eingespielt 2026 also „Zeltlager 2027“.
   - Der archivierte Thread „🎣 Fischerfest“ hat `archivModus: AUTOMATISCH` und einen Termin vor 14 Tagen. Er zeigt damit die Zeitregel 3.7, nicht einen Knopfdruck.
   - Jeder angelegte Thread schreibt je Modul eine `MODUL`-Änderung im Stand des Threads. Der Austausch bekommt `urheberId: null`.
   - Neu ist Tim (Jungfischer ohne Familie, Jüngere), damit Thomas in 1.1 Schritt 8 jemanden zum Nachtragen hat.

**Nicht in dieser Etappe** (bleibt im Rückstand, Memory „TP3-Rückstand“):

- übrige Punkte aus Etappe 2–5
- die Prüfung von WebSockets hinter Traefik beim nächsten Deploy
- die Leerstring-Prüfung vor `deploy:app`

## Global Constraints

- Code-Kommentare und Oberfläche sind deutsch.
- Commit-Nachrichten sind deutsch in ASCII (Umlaute umschrieben) und enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Einrückung mit Tabs. Ausnahmen: YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative. **In `template:`/`styles:` keine Backticks in Kommentaren.**
- Angular:
  - Vorlagen und Stile inline, `@if`/`@for`, Signale, `changeDetection: ChangeDetectionStrategy.OnPush`, Selektor-Präfix `jf-`, Tokens aus `styles.css`.
  - Browser-APIs (`navigator`, `matchMedia`) nur über `DOCUMENT.defaultView` und erst beim Klick.
- Regeln sind reine Funktionen mit `jetzt: Date`; in `libs/domain` nie `new Date()` ohne Argument.
- Vereinsdaten nur über `vereinDb`; die Vorschau liest den Verein über `ladeVereinAusSlug`.
- Was die Person nicht sieht, ist 404. Die Vorschau eines unsichtbaren Threads unterscheidet sich nicht von der einer unbekannten ID.
- Werte:
  - höchstens 10 Namen je Zeile, danach `, …`
  - Icon 512 px
  - `Cache-Control: no-store` für die Vorschau
- Textbausteine:
  - Titelzeile `<Emoji> *<Titel>* – Stand <Wt> <HH:MM>` (Berliner Zeit)
  - `📅`, `✅`, `🤔`, `❌`, `❓ Offen`, `📊`, `• `
  - `👉 Antworten: <Link>`
  - Knopf `Stand teilen` (aria-label)
  - Meldung `Kopiert`
- `server.ts` läuft auch beim Bau. `angularApp` steht außerhalb von `betriebsApp()`; `seitenHtml` wird erst bei einer Anfrage gerufen.
- Im Browser und in Tests nur erfundene Daten.
- Nach jeder Task grün: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache`.
- Vor dem Abschluss: `pnpm exec prettier --check .` und `pnpm run e2e`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp3-etappe6-teilen`.

## Review Focus

1. **Keine Namen über 3.4 hinaus:** Sieht die Familie eine Umfrage nur als Summe, steht im geteilten Text `✅ Dabei: 3` ohne Namen. Bei „nur Jugendleiter“ fehlt die Umfrage ganz (Task 1).
2. **Fremder Text bricht das Format nicht:** Ein Titel `Bowling *neu*`, ein Ort mit `_`, ein Name mit `~` → kein offenes Sternchen, kein Unterstrich im Text. Ein Titel aus nur einem Emoji ergibt eine gültige Zeile (Task 1).
3. **Stand-Zeit in Berlin:** `2026-10-23T22:30Z` ist „Sa 00:30“, die Nacht der Zeitumstellung zählt richtig (Task 1).
4. **Abbrechen ist kein Fehler:** Schließt die Person das Teilen-Blatt, erscheint weder „Kopiert“ noch das Ersatzfeld (Task 2).
5. **Die Vorschau verrät nichts:** Jugendleiter-Thread, Entwurf, Thread eines fremden Vereins unter diesem Slug, Austausch, unbekannte ID und Unsinn-Segment liefern byte-gleiche Antworten. Ein Titel mit `"` oder `<` bricht kein Attribut auf. Unter `ng serve` und im gebauten Server kommen die Tags wirklich an (Tasks 3, 6).

## Dateistruktur

```
libs/domain/src/threads/teilen.ts            NEU: teilenText, ohneFormat
libs/domain/src/threads/vorschau.ts          NEU: vorschauTitel
apps/jufi/src/app/verein/threads/teilen.ts   NEU: teile (Web Share oder Zwischenablage)
apps/jufi/src/app/verein/threads/thread-seite.ts   Knopf "Stand teilen"
apps/jufi/src/server/verein/vorschau.ts      NEU: vorschauRouten, vorschauTags, setzeInKopf
apps/jufi/src/server/abhaengigkeiten.ts      seitenHtml
apps/jufi/src/server/app.ts                  vorschauRouten einhaengen
apps/jufi/src/server.ts                      angularApp nach oben, seitenHtml
apps/jufi/src/server/mitglieder/datenauszug.ts   antworten, nachrichten, gelesen
apps/jufi/src/server/mitglieder/zugang.ts    entferne loescht Gelesen-Staende
apps/cli/src/demo.ts                         Zeltlager, Fischerfest, Tim, MODUL-Aenderungen
apps/jufi-e2e/src/{ablauf.spec.ts,layout.spec.ts,threads.ts}
tools/pruefe-betrieb.sh                      Abschnitt Link-Vorschau
apps/jufi/src/rechtstexte/datenschutz.md, README.md, CLAUDE.md, TP3-Spec
```

---

### Task 1: Teilen-Text als Regel

**Files:**

- Create: `libs/domain/src/threads/teilen.ts`, `teilen.spec.ts`
- Modify: `libs/domain/src/threads/index.ts`

**Interfaces:**

- Consumes:
  - `ThreadAnsicht` und `UmfrageAnsicht` (`ansicht.ts`)
  - `terminZeit`, `wochentagKurz` (`module/termin/termin.ts`)
  - `berlinerTag`, `berlinerUhrzeit` (`zeit.ts`)
  - `threadSegment` (`pfad.ts`)
- Produces:
  - `ohneFormat(text: string): string`: `*` → `∗`, `_` → `ˍ`, `~` → `∼`, `` ` `` → `ˋ`
  - `teilenText(e: { ansicht: ThreadAnsicht; basisUrl: string; slug: string; jetzt: Date }): string`, Zeilen mit `\n` verbunden

Aufbau, in dieser Reihenfolge:

1. **Titelzeile:** `<Titelteil> – Stand <wochentagKurz(berlinerTag(jetzt))> <berlinerUhrzeit(jetzt)>`.
   - Titelteil: Beginnt der Titel mit `\p{Extended_Pictographic}\S*` und Leerraum, steht das Emoji vor den Sternchen (`🎳 *Bowling*`), sonst `*<Titel>*`.
   - Der Titel läuft vorher durch `ohneFormat`.
2. **Je Termin-Modul in Modulreihenfolge:** `📅 <terminZeit(termin)>`, mit `ort` zusätzlich ` · <ohneFormat(ort)>`.
3. **Je Umfrage-Modul mit `ergebnis !== null`:**
   - Teilnahme-Umfrage (`teilnahme`):
     - je Option eine Zeile; das Emoji kommt aus dem `schluessel` (`dabei` ✅, `vielleicht` 🤔, `abgesagt` ❌), der Text aus `option.text`
     - danach `❓ Offen`
     - Form bei `NAMEN`: `<Emoji> <Text> (<n>): <Namen>`, bei 0 ohne Doppelpunkt: `<Emoji> <Text> (0)`
     - Form bei `SUMME`: `<Emoji> <Text>: <n>`
   - Andere Umfrage:
     - `📊 <ohneFormat(frage)>`, dann je Option `• <ohneFormat(text)> (<n>): <Namen>` bzw. bei `SUMME` `• <Text>: <n>`
     - keine Offen-Zeile
   - Namen: `name` der `AuswertungsName`, durch `ohneFormat`, mit `, ` verbunden; ab dem elften `, …`.
4. **Link:** `👉 Antworten: <basisUrl>/<slug>/t/<threadSegment(id, titel)>`.

Info-Texte, Treffpunkt und Fristen stehen nicht im Text.

- [ ] **Step 1: Branch anlegen:** `git switch -c feature/tp3-etappe6-teilen`

- [ ] **Step 2: Tests schreiben** (`teilen.spec.ts`). Die `ThreadAnsicht` ist von Hand gebaut: Titel `🎳 Bowling`, Termin-Modul `{ startDatum: '2026-10-24', beginn: '14:00', ende: '17:00', ort: 'Bowlingcenter' }`, Teilnahme-Umfrage. `basisUrl` ist `https://test.jufi-app.de`, `slug` ist `glonntal`, `jetzt` ist `new Date('2026-10-23T16:30:00Z')`. Fälle:
  - **Ganzer Text** gleich (`toBe`) diesen Zeilen:
    1. `🎳 *Bowling* – Stand Fr 18:30`
    2. `📅 Sa 24.10. · 14:00–17:00 · Bowlingcenter`
    3. `✅ Dabei (2): Lena M., Max M.`
    4. `🤔 Vielleicht (0)`
    5. `❌ Abgesagt (1): Tim S.`
    6. `❓ Offen (1): Jonas K.`
    7. `👉 Antworten: https://test.jufi-app.de/glonntal/t/<id>-bowling`
  - **Elf Namen unter Dabei:** zehn Namen, dann `, …`; die Zahl bleibt `(11)`.
  - **`ergebnis.ansicht: 'SUMME'`:** `✅ Dabei: 2`, `❓ Offen: 1`, kein Name im Text.
  - **`ergebnis: null`:** keine Zeile der Umfrage, Termin und Link bleiben.
  - **Freie Umfrage** `Welche Pizza?` mit Optionen `Salami` (1: `Lena M.`) und `Funghi` (0):
    1. `📊 Welche Pizza?`
    2. `• Salami (1): Lena M.`
    3. `• Funghi (0)`
  - **Formatzeichen:** Titel `Bowling *neu*` ergibt Titelzeile `*Bowling ∗neu∗* – Stand Fr 18:30`. Ort `See_Ufer` ergibt die Terminzeile mit `· SeeˍUfer`. Name `Li~sa M.` ergibt `Li∼sa M.`.
  - **Titel nur `🎳`:** Titelzeile `*🎳* – Stand Fr 18:30`.
  - **Zeit:** `2026-10-23T22:30:00Z` ergibt `Stand Sa 00:30`; `2026-10-25T01:30:00Z` ergibt `Stand So 02:30` (nach der Umstellung).
  - **Gegen echte Regeln:** Mit den Fixtures aus `testhilfe.ts` erzeugt `threadAnsicht` für eine Familie bei `ergebnisse: 'SUMME'` einen Text ohne den Kurznamen eines antwortenden Kinds. Bei `ergebnisse: 'JUGENDLEITER'` fehlt jede Zeile mit `✅`.
- [ ] **Step 3: Tests scheitern:** `pnpm nx test domain --skip-nx-cache -- teilen`, Ergebnis FAIL.
- [ ] **Step 4: Umsetzen** und in `index.ts` exportieren. Die Vorlage für Titelzeile und `ohneFormat` ist `apps/entwurf/src/app/regeln/teilen.ts`; nur übernehmen, nicht importieren.
- [ ] **Step 5: Tests grün.**
- [ ] **Step 6: Commit:** `git commit -m "TP3 Etappe 6: Teilen-Text als Regel"`

---

### Task 2: Teilen auf der Thread-Seite

**Files:**

- Create: `apps/jufi/src/app/verein/threads/teilen.ts`, `teilen.spec.ts`
- Modify: `apps/jufi/src/app/verein/threads/thread-seite.ts` (+ `thread-seite.spec.ts`)

**Interfaces:**

- Consumes:
  - `teilenText` (Task 1)
  - `MeldungService` (wie `admin/einladung-anzeige.ts`)
  - Icon `teilen`
- Produces:
  - `type TeilenErgebnis = 'GETEILT' | 'KOPIERT' | 'ABGEBROCHEN' | 'FEHLER'`
  - `teile(text: string, fenster: Window): Promise<TeilenErgebnis>` (Entscheidung 3)

Thread-Seite:

- Im Kopf vor „Bearbeiten“ steht `<button type="button" class="knopf leise nur-icon" aria-label="Stand teilen">` mit `<jf-icon name="teilen" />`, nur wenn `!t.entwurf`.
- Der Klick baut den Text mit `teilenText({ ansicht: t, basisUrl: fenster.location.origin, slug: slug(), jetzt: new Date() })` und ruft `teile`.
- Das Ergebnis entscheidet:
  - `KOPIERT` → `meldung.zeige('Kopiert')`
  - `FEHLER` → unter dem Kopf ein `<textarea readonly aria-label="Text zum Teilen">` mit dem Text
  - sonst nichts

- [ ] **Step 1: Tests schreiben.** In `teilen.spec.ts` ist `fenster` eine Attrappe mit `matchMedia`, `navigator.share` und `navigator.clipboard`. Fälle:
  - Coarse und `share` vorhanden → `share({ text })` gerufen, Ergebnis `GETEILT`, `writeText` nicht gerufen.
  - Coarse, `share` wirft `new DOMException('', 'AbortError')` → `ABGEBROCHEN`, `writeText` nicht gerufen.
  - Coarse, `share` wirft `NotAllowedError` → `writeText(text)`, Ergebnis `KOPIERT`.
  - Fein (`matches: false`) mit vorhandenem `share` → nur `writeText`, Ergebnis `KOPIERT`.
  - `writeText` wirft → `FEHLER`.
  - Thread-Seite (`thread-seite.spec.ts`):
    - Knopf „Stand teilen“ vorhanden; bei `entwurf: true` nicht.
    - Klick am Rechner → `writeText` mit einem Text, der mit `🎳 *Bowling*` beginnt und auf `/t/<segment>` endet; Meldung `Kopiert`.
    - `writeText` wirft → Textfeld „Text zum Teilen“ mit dem Text.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache -- teilen thread-seite`, Ergebnis FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Danach im Browser mit `pnpm run demo` und der Demo-Sitzung prüfen:
  - 375 × 812 und 1280 × 800, hell und dunkel
  - Kopf ohne horizontales Scrollen (`scrollWidth <= clientWidth`)
  - Knopf und Titel überlappen nicht (`getBoundingClientRect`)
- [ ] **Step 5: Commit:** `git commit -m "TP3 Etappe 6: Stand teilen auf der Thread-Seite"`

---

### Task 3: Link-Vorschau

**Files:**

- Create: `libs/domain/src/threads/vorschau.ts`, `vorschau.spec.ts`, `apps/jufi/src/server/verein/vorschau.ts`, `vorschau.spec.ts`
- Modify:
  - `libs/domain/src/threads/index.ts`
  - `apps/jufi/src/server/abhaengigkeiten.ts`
  - `apps/jufi/src/server/app.ts`
  - `apps/jufi/src/server.ts`
  - `tools/pruefe-betrieb.sh`

**Interfaces:**

- Consumes:
  - `ladeVereinAusSlug` (`verein.ts`)
  - `idAusSegment` (`pfad.ts`)
  - `vereinDb`
- Produces:
  - `vorschauTitel(thread: { titel: string; veroeffentlichtAm: Date | null; rollenfilter: Rollenfilter } | null): string | null`: Titel nur bei `veroeffentlichtAm !== null` und `rollenfilter` ∈ {`JUNGFISCHER_FAMILIE`, `NUR_FAMILIE`}
  - `AppDeps.seitenHtml?: (req: express.Request) => Promise<string | null>`, Vorgabe in `mitStandardwerten`: `async () => null`
  - `vorschauTags(e: { siteName: string; titel: string; bild: string }): string` liefert die Tags aus Entscheidung 7, je eine Zeile, maskiert
  - `setzeInKopf(html: string, tags: string): string` setzt vor das erste `</head>` ein; ohne `</head>` bleibt `html` unverändert
  - `vorschauRouten(deps: VolleAppDeps): Router` (`caseSensitive: true`): `GET /:slug/t/:segment`

Ablauf der Route:

1. `ladeVereinAusSlug` liefert null → `next()`.
2. Thread über `vereinDb` laden, nur `titel`, `veroeffentlichtAm`, `rollenfilter`. Ohne gültige ID (`idAusSegment` null) gilt der Thread als nicht gefunden.
3. `seitenHtml(req)` liefert null → `next()`.
4. Sonst antwortet die Route mit:
   - Status 200
   - `Content-Type: text/html; charset=utf-8`
   - `Cache-Control: no-store`
   - Inhalt `setzeInKopf(html, vorschauTags(...))`, mit `titel = vorschauTitel(thread) ?? verein.anzeigename` und `bild = <umgebung.basisUrl>/<slug>/icon-512.png`
5. Fehler gehen an `next(error)`.

- [ ] **Step 1: Tests schreiben.**
  - Domäne: `vorschauTitel`
    - veröffentlicht mit `JUNGFISCHER_FAMILIE` bzw. `NUR_FAMILIE` → Titel
    - `NUR_JUGENDLEITER`, `JUGENDLEITER_JUGENDSPRECHER`, Entwurf, `null` → `null`
  - Server (`vorschau.spec.ts`): Testdatenbank, `seitenHtml: async () => '<!doctype html><html><head><title>JuFi App</title></head><body><jf-root></jf-root></body></html>'`, Anfragen ohne Cookie.
    - Veröffentlichter Familien-Thread `🎳 Bowling`: 200, `cache-control: no-store`, Inhalt enthält `<meta property="og:title" content="🎳 Bowling" />` und `<meta property="og:image" content="<basisUrl>/<slug>/icon-512.png" />`, `<jf-root>` bleibt.
    - Gleiche Antwort (`res.text` mit `toBe`) für alle diese Fälle, jeweils mit `og:title` gleich dem Anzeigenamen:
      - `NUR_JUGENDLEITER`-Thread
      - Entwurf mit Familien-Zielgruppe
      - Austausch
      - unbekannte cuid
      - Segment `---`
      - Thread-ID aus Verein B unter dem Slug von A
    - Titel `Tom & "Jerry" <b>` → `content="Tom &amp; &quot;Jerry&quot; &lt;b&gt;"`.
    - Unbekannter Slug und gesperrter Verein → 404 aus dem Express-Standard (die Route reicht weiter), kein `og:` im Inhalt.
    - `seitenHtml` liefert null → 404, kein `og:`.
    - `/<slug>/t/<id>?reiter=verlauf` → wie ohne Query.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test domain --skip-nx-cache -- vorschau` und `pnpm nx run jufi:test-server --skip-nx-cache -- vorschau`, Ergebnis FAIL.
- [ ] **Step 3: Umsetzen.**
  - In `createApp` `app.use(vorschauRouten(deps))` direkt nach `pwaRouten`.
  - In `server.ts`:
    - `angularApp` vor `const { app, betrieb } = …` ziehen; Kommentar erklären, warum (die Abhängigkeit braucht ihn).
    - `createApp({ …, seitenHtml: async (req) => { const antwort = await angularApp.handle(req); return antwort ? antwort.text() : null; } })`
  - In `tools/pruefe-betrieb.sh` einen neuen Abschnitt „8. Link-Vorschau“ im Stil der vorhandenen. `$URL/$SLUG/t/vorschaupruefung` muss liefern:
    - Status 200
    - Kopf `cache-control: no-store`
    - Inhalt mit `property="og:image" content="$URL/$SLUG/icon-512.png"`
- [ ] **Step 4: Tests grün.** Danach lokal gegen `ng serve`: `pnpm run dev`, `pnpm run demo`, dann `curl -s http://localhost:4200/demo/t/<bowling-segment> | grep og:`. Erwartet sind die Tags mit `🎳 Bowling`; für das Austausch-Segment `og:title` gleich „Jungfischer Demo“. Die Ausgabe in den Task-Bericht.
- [ ] **Step 5: Commit:** `git commit -m "TP3 Etappe 6: Link-Vorschau mit Open Graph"`

---

### Task 4: Datenauszug und Entfernen

**Files:**

- Modify: `apps/jufi/src/server/mitglieder/datenauszug.ts` (+ `datenauszug.spec.ts`), `apps/jufi/src/server/mitglieder/zugang.ts` (+ Spec, in der `entferne` geprüft wird)

**Interfaces:**

Neue Felder im Interface `Datenauszug`, jeweils nach Zeit aufsteigend sortiert:

```ts
antworten: { thread: string; frage: string; optionen: string[]; fuer: string; von: string; abgegebenAm: string }[];
nachrichten: { thread: string; zeit: string; text: string | null }[];
gelesen: { thread: string; zeit: string }[];
```

Werte:

- `antworten`:
  - Zeilen mit `fuerId` ∈ {Person, Kinder aus `bezuege` mit `erwachsenerId === person.id`} (Entscheidung 8)
  - `optionen`: Texte nach `position`
  - `fuer`/`von`: `'ich'` oder `vollerName`
- `nachrichten`: `art: 'NACHRICHT'`, `autorId` = Person; `text` ist `null`, wenn `geloeschtAm` gesetzt ist.
- `gelesen`: `GelesenStand` der Person, `zeit` = `gelesenAm`.
- Jede Abfrage nennt ihre Spalten über `select` (Muster der Datei).

`entferne(tx, personId, jetzt)` löscht zusätzlich `tx.gelesenStand.deleteMany({ where: { personId } })`. Antworten und Nachrichten bleiben samt Text (Spec 9.2).

- [ ] **Step 1: Tests schreiben.**
  - Datenauszug der Mutter mit zwei Kindern:
    - eigene Antwort auf eine Erwachsenen-Umfrage mit `fuer: 'ich', von: 'ich'`
    - Antwort für Kind A von der Mutter: `fuer` ist der volle Name von A, `von: 'ich'`
    - Antwort von Kind B selbst: `von` ist der volle Name von B
    - Antwort eines fremden Kinds fehlt
    - `thread`, `frage` und `optionen` (Mehrfachauswahl in Positionsreihenfolge) stimmen
  - Datenauszug der Leitung, die für ein fremdes Kind nachgetragen hat: Die Antwort fehlt.
  - Nachrichten:
    - eigene sichtbare Nachricht mit Text
    - eigene gelöschte mit `text: null`
    - fremde Nachricht und Systemeintrag fehlen
  - `gelesen` enthält den Thread-Titel und `gelesenAm` als ISO.
  - Keine `id` und kein `clientId` im JSON (`JSON.stringify` enthält weder die cuid der Antwort noch die `clientId`).
  - `entferne`:
    - danach `gelesenStand.count({ where: { personId } }) === 0`
    - Antwort und Nachricht der Person bestehen weiter, die Nachricht mit unverändertem Text
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- datenauszug zugang`, Ergebnis FAIL.
- [ ] **Step 3: Umsetzen.** Den Kommentar über `datenauszugRouten` ergänzen, was jetzt darin steht und warum nachgetragene Antworten für andere fehlen.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP3 Etappe 6: Datenauszug mit Antworten, Nachrichten und Gelesen; Entfernen loescht Gelesen-Staende"`

---

### Task 5: Demo mit Bowling, Zeltlager und Archiv

**Files:**

- Modify: `apps/cli/src/demo.ts` (+ `demo.spec.ts`)

**Interfaces:**

- Produces: `demoEinspielen` liefert in `threads` in dieser Reihenfolge Wichtige Infos, Bowling, Zeltlager, Fischerfest, Austausch. Die Ausgabe von `pnpm run demo` nennt alle fünf Adressen.

Inhalt (Spec 10.4, Entscheidung 9):

- **Tim Schmid:** Jungfischer, 11 Jahre, ohne Familie und ohne Einwilligung, Untergruppe „Jüngere“.
- **`Zeltlager <J>`** mit `J` = Berliner Jahr von `jetzt` plus 1:
  - `modus: 'CHAT'`, `JUNGFISCHER_FAMILIE`, `alleUntergruppen: false`, Untergruppe „Ältere“
  - Info-Text
  - Termin `<J>-08-02` bis `<J>-08-08`, Ort `Zeltplatz am See`
  - Umfrage `Welche Pizza am Ankunftsabend?`: `einheit: 'PERSON'`, `teilnahme: false`, `mehrfach: false`, `ergebnisse: 'ALLE'`, ohne Frist, Optionen `Margherita`, `Salami`, `Funghi`; die Schlüssel vergibt die Demo wie der Editor für freie Optionen (siehe `entwurf.ts`)
  - Antworten: Lena `Salami` für sich, Thomas `Margherita` für sich
  - zwei Nachrichten im Verlauf, von Lena und Thomas
- **`🎣 Fischerfest`:**
  - `KOMMENTARE`, `JUNGFISCHER_FAMILIE`, `archivModus: 'AUTOMATISCH'`
  - Info-Text
  - Termin `tagPlus(heute, -14)`, 10:00–16:00, Ort `Vereinsweiher`
- **Änderungen:** Jeder Thread schreibt neben `THREAD` je Modul eine `MODUL`-Änderung im selben Stand. Antworten und Nachrichten bekommen eigene Stände (`ANTWORT` mit `objektId` der Antwortzeile wie die Route, `VERLAUF`). Die `THREAD`-Änderung des Austauschs bekommt `urheberId: null`.

- [ ] **Step 1: Tests schreiben** (`demo.spec.ts`):
  - Fünf Threads in der genannten Reihenfolge; das Zeltlager trägt das Jahr nach `jetzt`.
  - Das Zeltlager sieht nur, wer zur Untergruppe „Ältere“ gehört: `siehtThread` für Max falsch, für Lena wahr (über `ladeThreadUmfeld` und `ladeThread`).
  - `istArchiviert` für das Fischerfest wahr, für Bowling falsch.
  - `aenderung` enthält für jeden Thread eine `MODUL` je Modul. Die Stände sind lückenlos `1..aenderungsstand` (jede Zahl kommt vor), jeder Stand gehört zu genau einem Thread.
  - Die `THREAD`-Änderung des Austauschs hat `urheberId: null`.
  - Zweites Einspielen geht weiterhin (bestehender Test bleibt grün).
- [ ] **Step 2: Tests scheitern:** `pnpm nx test cli --skip-nx-cache -- demo`, Ergebnis FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** `pnpm run demo` lokal ausführen; die fünf Adressen stehen in der Ausgabe.
- [ ] **Step 5: Commit:** `git commit -m "TP3 Etappe 6: Demo mit Zeltlager, Fischerfest und Tim"`

---

### Task 6: Ende-zu-Ende

**Files:**

- Modify: `apps/jufi-e2e/src/ablauf.spec.ts`, `layout.spec.ts`, `threads.ts`

**Interfaces:**

- Produces (`threads.ts`):
  - `legeKindAn(slug: string, erwachsenerId: string, vorname: string, nachname: string): Promise<string>`: Jungfischer mit Beziehung `MUTTER` und `erziehungsberechtigt: true`, geschrieben in einer Transaktion über `mitAenderung` und `vermerkeUmfeld` wie die Routen; liefert die ID
  - `beendeFrist(slug: string, threadId: string, jetzt: Date): Promise<void>`: setzt die `frist` aller Umfragen des Threads auf `jetzt − 60 s`, über `mitAenderung` mit einer `MODUL`-Änderung je Umfrage

Ergänzungen in `ablauf.spec.ts`, ohne die Reihenfolge der bestehenden Schritte zu ändern:

1. **Zweites Kind:** Vor „Mutter sieht Bowling auf Start …“ legt `legeKindAn(SLUG, maraId, 'Mats', 'Muster')` Mats an.
   - Start der Mutter zeigt unter „Braucht deine Antwort“ je eine Zeile für Mia und für Mats.
2. **Antwort für zwei Kinder** (Rahmen 13): Im Schritt „Mutter antwortet für Mia …“ antwortet die Mutter zusätzlich für Mats mit „Abgesagt“.
   - Beide Zeilen zeigen „von dir eingetragen“.
   - Start zeigt danach keine Zeile mehr unter „Braucht deine Antwort“.
   - Bestehende Zählungen (`Dabei (n)`) bleiben unverändert.
3. **Teilen:** Neuer Test „Leitung teilt den Stand“ nach „Leitung trägt für Mia nach“.
   - Kontext mit `permissions: ['clipboard-read', 'clipboard-write']`, 1280 × 800.
   - Bowling öffnen, „Stand teilen“ klicken; die Meldung „Kopiert“ erscheint.
   - Die Zwischenablage (`navigator.clipboard.readText()`):
     - beginnt mit `🎳 *Bowling* – Stand `
     - enthält `🤔 Vielleicht (1): Mia M.` und `❌ Abgesagt (1): Mats M.`
     - endet mit `👉 Antworten: <baseURL>/${SLUG}/t/${bowling}`
4. **Frist vorbei** (1.1 Schritt 10): Neuer Test danach.
   - `beendeFrist(SLUG, bowlingId, new Date())`.
   - Die Mutter lädt Bowling neu: In den Zeilen von Mia und Mats gibt es keinen Antwortknopf mehr, die Karte nennt die abgelaufene Frist (der Text, den `umfrage-modul.ts` dafür zeigt).
   - Die Leitung sieht in der Antworten-Übersicht weiter „Eintragen für Mia M.“ und trägt für Mats „Dabei“ ein.
5. **Link-Vorschau:** Neuer Test mit `request.newContext({ baseURL })` ohne Sitzung.
   - `GET /${SLUG}/t/${bowling}` enthält `property="og:title" content="🎳 Bowling"`.
   - `GET /${SLUG}/t/${austausch}` und `GET /${SLUG}/t/unbekannt` sind byte-gleich und enthalten den Anzeigenamen des Vereins als `og:title`.

`layout.spec.ts`: Kopf der Thread-Seite für die Leitung (Teilen und Bearbeiten) bei 375 × 812 und 1280 × 800, hell und dunkel:

- kein horizontales Scrollen
- Titel, Teilen-Knopf und Bearbeiten-Knopf schneiden sich nicht (`getBoundingClientRect`)

- [ ] **Step 1: Hilfen und Tests schreiben** wie oben.
- [ ] **Step 2: Laufen:** `pnpm run e2e` grün. Einen Fehlschlag erst mit dem Trace lesen und die Ursache benennen, bevor etwas geändert wird.
- [ ] **Step 3: Commit:** `git commit -m "TP3 Etappe 6: Ende-zu-Ende fuer zwei Kinder, Teilen, Fristende und Link-Vorschau"`

---

### Task 7: Datenschutzerklärung, Spec und Doku

**Files:**

- Modify:
  - `apps/jufi/src/rechtstexte/datenschutz.md`
  - `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md` (2.6, 7.1, 7.2, 9.1, 10.4)
  - `README.md`
  - `CLAUDE.md`

- [ ] **Step 1: Datenschutzerklärung** (Spec 9.3), in Ton und Gliederung der vorhandenen Abschnitte:
  - **„Welche Daten verarbeitet werden“** bekommt den Block **„Threads“** mit:
    - Inhalten der Threads und Module
    - Antworten (für wen, von wem, wann)
    - Nachrichten im Verlauf
    - Gelesen-Stand je Person und Thread
  - **„Wer im Verein was sieht“:**
    - Namen in Threads als Vorname und Initiale (3.10)
    - Ergebnisse je nach Einstellung des Threads (3.4)
    - „eingetragen von“ nur für Jugendleiter
  - **Neuer Abschnitt „Teilen, Kalender und Karten“:**
    - Teilen nach WhatsApp nur durch eigenes Antippen
    - Google-Kalender-Weg und Karten-Link übertragen erst nach dem Antippen Titel, Zeit und Ort an Google bzw. den Kartenanbieter
    - Link-Vorschau zeigt den Titel nur bei veröffentlichten Familien-Threads, sonst den Vereinsnamen
  - **„Cookies und lokale Speicherung“:** Die Live-Verbindung (WebSocket) nutzt das Sitzungscookie und überträgt keine zusätzlichen Daten.
  - **„Speicherdauer und Löschung“:**
    - Änderungsprotokoll (`Aenderung`) 90 Tage
    - beim Entfernen einer Person werden Gelesen-Stände gelöscht
    - Antworten und Nachrichten bleiben mit „ehemaliges Mitglied“ (9.2)
    - der Vorbehalt der rechtlichen Prüfung im vorhandenen Platzhalter-Vermerk, damit `tools/pruefe-texte.sh` ihn findet
  - **„Ihre Rechte“:** Der Datenauszug nennt jetzt auch Antworten, Nachrichten und Gelesen-Stände.
- [ ] **Step 2: Spec.**
  - Entscheidungen 1–9 an ihre Stellen, jeweils mit verworfener Alternative:
    - 7.1: Text im Client, `location.origin`, Zeiger-Regel, kein Teilen bei Entwurf
    - 7.2: `seitenHtml`, Weiterreichen bei unbekanntem Verein, Tags
    - 9.1: welche Antworten
    - 10.4: Zeltlager-Jahr, Fischerfest, Tim
  - In 10.4 den Absatz „Teilweise vorgezogen“ als erledigt kennzeichnen.
  - Den unvollständigen Satz in 2.6 zu `POST /personen` ohne `sperreVereinszeile` am Code (`personen.ts`) prüfen und zu Ende schreiben.
- [ ] **Step 3: README.**
  - Unter „App entwickeln“ ein Absatz „Link-Vorschau lokal prüfen“ mit dem `curl` aus Task 3.
  - Unter „Betrieb prüfen“ den neuen Abschnitt 8 des Skripts nennen.
- [ ] **Step 4: CLAUDE.md.** Eine Zeile unter „Stand“:

  > TP3 Etappe 6 ist da: Teilen (Text aus `teilenText` in `@jufi/domain`, am Handy Web Share, am Rechner Kopieren), Link-Vorschau unter `/<slug>/t/…` (Open Graph über `seitenHtml`, Titel nur bei veröffentlichten Familien-Threads), Datenauszug mit Antworten, Nachrichten und Gelesen-Ständen, Demo mit Zeltlager und Fischerfest. Teilprojekt 3 ist damit abgeschlossen.

  Unter „Was nachweislich stolpert“:

  > **Link-Vorschau** hängt an `angularApp.handle`: Wer `angularApp` in `server.ts` verschiebt oder den Render-Modus ändert, prüft die Tags mit `curl` (README).

- [ ] **Step 5:** `pnpm exec prettier --check .` grün, `tools/pruefe-texte.sh` zeigt die erwarteten Platzhalter (Ausgabe in den Bericht).
- [ ] **Step 6: Commit:** `git commit -m "TP3 Etappe 6: Datenschutzerklaerung, Spec und Doku nachgezogen"`
