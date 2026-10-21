# JuFi TP3 Etappe 4 — Start, Liste, Kalender — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mitglieder finden Threads ohne Direktlink: Die untere Leiste hat „Start · Threads · Termine · Mehr“ mit Neu-Punkt, Start zeigt „Braucht deine Antwort“, „Als Nächstes“ und „Neu seit deinem letzten Besuch“, die Thread-Liste hat Suche, Abschnitte und Archiv, die Termine-Seite einen Monatskalender. Danach ist die App ohne Live-Aktualisierung benutzbar (Spec 1.4).

**Architecture:** Was eine Person in Liste und Start sieht, bauen reine Funktionen in `libs/domain` (`threadListe`, `startAnsicht`, `monatsRaster`), so wie `threadAnsicht` die Thread-Seite baut. Der Server lädt die Threads mit `ladeThreads`, dazu nur die **Kandidaten** für „neu“ (Änderungen und Nachrichten über dem Gelesen-Stand) und ruft die Funktionen. Der Client bekommt zwei Seiten, drei Blöcke auf Start und einen Dienst, der die Liste für Seite und Neu-Punkt einmal lädt.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (Signale, OnPush, inline), Express 4, Prisma 7, Postgres 17, Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md` — Abschnitte 1.4 (Etappe 4), 2.6, 3.1, 3.7–3.9, 3.13, 4.1 (`GET /threads`, `GET /start`, `GET /termine`), 6.1, 6.2 (Zurück-Pfeil, Start-Reiter), 6.5, 6.7, 10.2, 10.3. Rahmen 5.2 (Start), 5.4 (Pfade `/<slug>/threads`, `/<slug>/termine`). Eingabe außerdem: Memory „TP3-Rückstand“ (`istNeu` ohne `LISTE`, Leistenhöhe als Token, M6).

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 11 trägt sie in die TP3-Spec ein.

1. **Liste und Start werden in der Domäne gebaut.** `threadListe(eingabe)` und `startAnsicht(eingabe)` bekommen geladene Threads, Gelesen-Stände und Kandidaten und liefern die fertige Antwort; die Antworttypen (`ThreadListe`, `ThreadZeile`, `StartAnsicht`) stehen in `@jufi/domain`, Zeiten darin als ISO-Zeichenketten. Verworfen: im Server zusammensetzen — die Neu-Regel und die Sichtbarkeit stünden dann neben `threadAnsicht` ein zweites Mal.
2. **Für „neu“ lädt der Server nur Kandidaten.** Je Thread die Änderungen mit `stand > gelesenBis` (ohne Gelesen-Zeile: `angelegtAm >= zugangSeit`) und für Start die Nachrichten mit `stand > verlaufGelesenBis` (ohne Zeile ebenso nach Zugang), in **einer** Abfrage je Tabelle mit einer `OR`-Bedingung je Thread. Ob eine Änderung fremd ist und welche Art zählt, entscheidet die Domäne. Verworfen: `urheberId: { not: ich }` in der Abfrage — `NULL <> x` ist in SQL nicht wahr, Systemänderungen ohne Urheber fielen still heraus, und die Regel stünde an zwei Stellen. Verworfen: alle Änderungen laden — sie wachsen bis zum Aufräumen nach 90 Tagen (2.6) mit jeder Antwort.
3. **`istNeu` lässt `LISTE` aus** (2.6, Rückstand): `NeuEingabe.aenderungen` bekommt `art`, die Domäne filtert. Verworfen: die Server-Abfrage filtern lassen — die Regel gehört zu `istNeu` und muss ohne Datenbank testbar sein.
4. **Archivierte Threads sind nie neu,** auch nicht für den Punkt an „Threads“. Im Archiv kann nur noch nachgetragen werden (3.7); der Punkt zeigte sonst auf einen Thread im eingeklappten Archiv, den niemand findet. Verworfen: Archiv mitzählen.
5. **Kurzangabe:** „Neuer Thread“, wenn es keine Gelesen-Zeile gibt und der Thread ab dem Zugang von jemand anderem veröffentlicht wurde; sonst `neuKurzangabe` mit den ungelesenen Nachrichten (`ungeleseneNachrichten`) und „Neue Antworten“, wenn unter den fremden Kandidaten eine `ANTWORT` ist. „Neu seit deinem letzten Besuch“ ordnet nach letzter Aktivität, neueste zuerst, höchstens fünf.
6. **Was Start und Termine zeigen.** Alle drei Start-Blöcke kennen nur veröffentlichte, sichtbare Threads; „Braucht deine Antwort“ und „Als Nächstes“ ohne archivierte. Die Termine-Seite zeigt auch archivierte (ein vergangener Monat soll seine Termine behalten), aber keine Entwürfe. Die Thread-Liste zeigt Jugendleitern Entwürfe mit „· Entwurf“ (6.5). Verworfen: Entwürfe im Kalender der Jugendleiter — Start und Kalender zeigen, was stattfindet; Geplantes steht in der Verwaltung.
7. **`GET /threads?suche=&archiv=1`.** Ohne `archiv=1` liefert die Route die nicht archivierten Threads und nur die **Zahl** der archivierten (`{ threads, archiv }`), mit `archiv=1` beide. Der Client lädt das Archiv beim Aufklappen und schickt bei einer Suche immer `archiv=1` mit, damit ein archivierter Thread über die Suche zu finden ist (1.1, Schritt 11). Reihenfolge: letzte Aktivität absteigend, dann ID; die Abschnitte bildet der Client. Verworfen: das Archiv immer mitliefern — es wächst über die Jahre und wird eingeklappt kaum gelesen.
8. **Suche im Speicher statt `ILIKE`.** `passtZuSuche` vergleicht Titel, Info-Texte und Orte nach `normalize('NFC')` und `toLocaleLowerCase('de')`; `suche` wird getrimmt, leer heißt keine Suche, mehr als 100 Zeichen sind 400 mit `feld: 'suche'`. Verworfen: `ILIKE` (4.1 wörtlich) — `%`, `_` und `\` in der Eingabe müssten maskiert werden, und ob „ä“ „Ä“ findet, hinge an der Collation der Datenbank; die Threads sind für die Liste ohnehin geladen. Verworfen: Volltextsuche — Wortstämme helfen bei Namen und Orten nicht.
9. **Pfade und Zurück.** `/<slug>/threads` (`?suche=` in der Adresse) und `/<slug>/termine` (`?monat=JJJJ-MM`), beide in der Mitglieder-Hülle. Der Monat steht in der Adresse, damit „Zurück“ aus einem Thread in denselben Monat führt. Der Zurück-Pfeil der Thread-Seite führt ab jetzt zur Thread-Liste (6.2 nachziehen). Verworfen: Browser-Zurück — ein geteilter Link hat keine Seite davor.
10. **Ein Chat-Thread öffnet auf der Übersicht** — Entscheidung des Eigentümers vom 21.10.2026; das „vorläufig“ und die offene Frage in 6.2 entfallen.
11. **Der Punkt an „Threads“ lädt mit der Liste.** Ein Dienst der Hülle (`ThreadUebersicht`) lädt `GET /threads` beim Öffnen und nach jeder Navigation innerhalb der Hülle; die Thread-Liste nutzt dieselbe Ressource für ihren Grundzustand (ohne Suche, Archiv zu). Bis Etappe 5 ist das die einzige Aktualisierung. Verworfen: eine eigene Route für den Punkt — sie rechnete dasselbe wie die Liste. Verworfen: den Punkt nur von der zuletzt geladenen Seite setzen — wer direkt in einen Thread springt, sähe nie einen.
12. **`GET /termine?monat=JJJJ-MM`** antwortet `{ termine: TerminEintrag[] }` (`termineImMonat`); ein fehlender oder ungültiger Monat (`^\d{4}-(0[1-9]|1[0-2])$`) ist 400 mit `feld: 'monat'`. Das Raster hat immer 6 × 7 Felder ab Montag. Verworfen: so viele Wochen wie nötig — die Liste darunter spränge beim Blättern um eine Zeile.
13. **`GET /start`** ist neu (es gab bisher nur `/ansprechpartner`), liefert die drei Blöcke in einer Antwort, und die Startseite zeigt sie als einen Abschnitt mit einem eigenen Fehlerzustand. Verworfen: drei Routen — jede lüde dieselben Threads.

**Nicht in dieser Etappe** (bleibt im Rückstand): `GET /threads/:id` lädt ohne Gelesen-Zeile alle Nachrichten und `PUT gelesen` den ganzen Thread (M6); Sichtbarkeitsänderungen aus TP2 schreiben keine `Aenderung` (Etappe 5, Sync).

## Global Constraints

- Code-Kommentare und Oberfläche deutsch; Commit-Nachrichten deutsch in ASCII (Umlaute umschrieben), Ende `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Antwort-Texte der API (`fehler`) mit Umlauten.
- Einrückung Tabs; Ausnahmen YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative. **In `template:`/`styles:` keine Backticks in Kommentaren.**
- Angular: Vorlagen und Stile inline, `@if`/`@for`, Signale, `rxResource`, `changeDetection: ChangeDetectionStrategy.OnPush`, Selektor-Präfix `jf-`, Tokens und Klassen aus `styles.css`, Tippflächen mindestens `var(--tippflaeche)`; jeder Fehlerpfad ruft `beiAbgelaufenerSitzung`.
- Regeln sind reine Funktionen mit `jetzt: Date`; nie `new Date()` ohne Argument in `libs/domain`. Server nimmt `deps.jetzt()`. Tage und Uhrzeiten immer Berlin über die Domain-Funktionen (`berlinerTag`, `terminZeit`, `fristText`).
- Vereinsdaten nur über `vereinDb`. Lesende Routen schreiben nichts (kein `mitAenderung`, kein Gelesen-Stand).
- Jede neue Vereins-Route: `brauchtMitglied` als erster Handler, `asynchron(...)`, ein Fall in `mandanten.spec.ts`. Unsichtbares ist 404 `{ fehler: 'nicht gefunden' }` beziehungsweise taucht in Listen nicht auf; nie 403.
- Texte: Leiste „Start“, „Threads“, „Termine“, „Mehr“; Abschnitte „Angepinnt“, „Aktiv“, „Archiv · N“; „· Entwurf“; Blöcke „Braucht deine Antwort“, „Als Nächstes“, „Neu seit deinem letzten Besuch“; Zeile „Lena: Bowling noch offen · bis Do 18:00“ bzw. „Bowling noch offen · bis Do 18:00“ (ohne Frist ohne „· …“); Kurzangaben aus `neuKurzangabe`; Suchfeld-Beschriftung „Threads durchsuchen“; leer „Noch keine Threads.“, „Keine Treffer.“, „Keine Termine in diesem Monat.“; Knöpfe „Voriger Monat“, „Nächster Monat“ (als `aria-label`); Fehler „Nicht gefunden oder keine Berechtigung“, „Keine Verbindung – nochmal versuchen“.
- Im Browser und in Tests nur erfundene Daten.
- Nach jeder Task: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache` grün. Vor dem Abschluss `pnpm exec prettier --check .` und `pnpm run e2e`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp3-etappe4-start-liste-kalender`.

## Review Focus

1. **Wer ist „fremd“:** Eine Änderung mit `urheberId = null` (Systemeintrag, Austausch aus der Migration) macht einen Thread neu, eine eigene nicht, `LISTE` nie; nach dem Öffnen (PUT gelesen) ist der Thread in Liste, Start und Punkt nicht mehr neu (Tasks 1, 4, 10).
2. **Sichtbarkeit in jeder neuen Antwort:** Sandra findet den Austausch weder in der Liste noch über die Suche „Jugendsprecher“, sieht keinen Termin und keinen offenen Punkt aus einem „Nur Jugendleiter“-Thread und keinen Entwurf; der Jugendleiter sieht den Entwurf in der Liste, aber nicht auf Start und Termine; fremder Verein 404 (Tasks 2, 4, 5).
3. **Suche mit Sonderzeichen und Groß-/Kleinschreibung:** „100%“ findet „100% Spaß“, aber nicht „1000 Spaß“; „_“ findet nur Titel mit Unterstrich; „ÜBERNACHTEN“ findet „übernachten“; nur Leerraum ist keine Suche; 101 Zeichen sind 400 (Tasks 1, 4).
4. **Monatsgrenzen und Zeitzone:** Ein Termin 30.10.–02.11. markiert in Oktober 30. und 31., im November 1. und 2.; Februar 2027 beginnt am Montag 1.2. im ersten Feld; März 2026 hat sein erstes Feld leer bis Sonntag 1.3.; `monat=2026-13`, `2026-1`, fehlend → 400; „heute“ ist um 23:30 UTC am 31.10. schon der 1.11. (Tasks 3, 5, 9).
5. **Archiv an den Rändern:** Ein archivierter Thread ist nie neu und zählt in „Archiv · N“; ein Thread mit Termin vor sieben Tagen erscheint nur mit `archiv=1`; „Als Nächstes“ zeigt einen laufenden mehrtägigen Termin bis zu seinem Ende, aber keinen aus einem manuell archivierten Thread (Tasks 1, 2, 4).

## Dateistruktur

```
libs/domain/src/threads/typen.ts            + AenderungArt (Literal-Union)
libs/domain/src/threads/start.ts            istNeu mit art; StartAnsicht, startAnsicht
libs/domain/src/threads/liste.ts            NEU: ListenThread, ThreadZeile, ThreadListe, passtZuSuche, threadListe
libs/domain/src/module/termin/monat.ts      NEU: monatsRaster, markierteTage, monatAus
apps/jufi/src/server/threads/laden.ts       GeladenerThread + letzteAktivitaetAm; ladeNeuKandidaten
apps/jufi/src/server/threads/liste.ts       NEU: GET /threads, GET /start, GET /termine
apps/jufi/src/server/threads/routen.ts      listeRouten einhaengen
apps/jufi/src/server/mandanten.spec.ts      drei Faelle
apps/jufi/src/styles.css                    --leiste-hoehe
apps/jufi/src/app/verein/mitglieder-huelle.ts   vier Eintraege, Neu-Punkt
apps/jufi/src/app/verein/threads/thread-api.ts  liste, start, termine
apps/jufi/src/app/verein/threads/thread-uebersicht.ts  NEU: Dienst der Huelle
apps/jufi/src/app/verein/threads/thread-liste.ts       NEU: Seite Threads
apps/jufi/src/app/verein/threads/thread-seite.ts       Zurueck zur Liste
apps/jufi/src/app/verein/threads/verlauf.ts            Token statt 57px
apps/jufi/src/app/verein/start-bloecke.ts      NEU: drei Bloecke
apps/jufi/src/app/verein/start.ts              Bloecke oben einbinden
apps/jufi/src/app/verein/termine.ts            NEU: Seite Termine
apps/jufi/src/app/app.routes.ts                threads, termine
apps/jufi-e2e/src/ablauf.spec.ts, layout.spec.ts
```

---

### Task 1: Neu-Regel und Thread-Liste als Wert

**Files:**

- Modify: `libs/domain/src/threads/typen.ts`, `libs/domain/src/threads/start.ts` (+ `start.spec.ts`), `libs/domain/src/threads/index.ts`
- Create: `libs/domain/src/threads/liste.ts`, `libs/domain/src/threads/liste.spec.ts`

**Interfaces:**

- Produces:
  - `type AenderungArt = 'THREAD' | 'MODUL' | 'ANTWORT' | 'VERLAUF' | 'SICHTBARKEIT' | 'GELOESCHT' | 'LISTE'` (Werte wie das Prisma-Enum, Kommentar wie bei den anderen Unions in `typen.ts`).
  - `NeuEingabe.aenderungen: readonly NeuAenderung[]` mit `interface NeuAenderung { stand: number; art: AenderungArt; urheberId: string | null; angelegtAm: Date }`.
  - `interface ListenThread { kopf: ThreadKopf; module: readonly ModulDaten[]; letzteAktivitaetAm: Date; gelesenBis: number | null; aenderungen: readonly NeuAenderung[] }`
  - `interface ThreadZeile { id: string; titel: string; segment: string; angepinnt: boolean; archiviert: boolean; entwurf: boolean; naechsterTermin: string | null; neu: boolean }`
  - `interface ThreadListe { threads: ThreadZeile[]; archiv: number }`
  - `passtZuSuche(kopf: ThreadKopf, module: readonly ModulDaten[], suche: string): boolean`
  - `threadListe(e: { ich: ThreadPerson; threads: readonly ListenThread[]; umfeld: Umfeld; zugangSeit: Date; suche: string | null; mitArchiv: boolean; jetzt: Date }): ThreadListe`

- [ ] **Step 1: Branch anlegen** — `git switch -c feature/tp3-etappe4-start-liste-kalender`
- [ ] **Step 2: Tests schreiben** (Fixtures aus `testhilfe.ts`, `JETZT`)
  - `start.spec.ts`, `istNeu`: eine fremde Änderung `art: 'LISTE'` über `gelesenBis` → `false`; dieselbe mit `art: 'THREAD'` → `true`; ohne Gelesen-Stand eine fremde `LISTE`-Änderung nach dem Zugang → `false`; eine Änderung mit `urheberId: null`, `art: 'VERLAUF'` → `true`. Die bestehenden Fälle bekommen `art: 'THREAD'`.
  - `liste.spec.ts`, `passtZuSuche`: Titel „🎳 Bowling“ passt zu „bowling“ und „BOWL“; Info-Text „Wir übernachten im Zelt“ passt zu „ÜBERNACHTEN“; Ort „Bowlingcenter Glonn“ passt zu „glonn“; „100%“ passt zu Titel „100% Spaß“, nicht zu „1000 Spaß“; „_“ passt nur zu einem Titel mit Unterstrich; ein Umfrage-Text (Frage) passt **nicht** (Spec: Titel, Info-Text, Ort); NFC: „é“ als `é` passt zu Titel „Café“.
  - `liste.spec.ts`, `threadListe`:
    - Sichtbarkeit: Sandra (`bowlingUmfeld`) bekommt den Austausch und einen `NUR_JUGENDLEITER`-Thread nicht, einen Entwurf nicht; Thomas bekommt den Entwurf mit `entwurf: true`; Lena (Jugendsprecherin) bekommt den Austausch mit `angepinnt: true` (6.5).
    - Reihenfolge: nach `letzteAktivitaetAm` absteigend, gleicher Zeitpunkt nach `id`.
    - Archiv: Thread mit Termin `2026-10-10` (JETZT 22.10.) ist `archiviert`; mit `mitArchiv: false` fehlt er in `threads`, `archiv` ist 1; mit `mitArchiv: true` steht er drin, `archiv` bleibt 1.
    - Neu: fremde `THREAD`-Änderung über `gelesenBis` → `neu: true`; derselbe Thread archiviert (`archivModus: 'ARCHIVIERT'`) → `neu: false`.
    - Suche: `suche: 'bowl'` lässt nur passende Threads übrig, `archiv` zählt nur passende archivierte; `suche: '   '` wirkt wie `null`.
    - `segment` ist `threadSegment(id, titel)`, `naechsterTermin` ist `terminZeit` des nächsten laufenden oder künftigen Termins oder `null`.
- [ ] **Step 3: Tests scheitern** — `pnpm nx test domain --skip-nx-cache`, FAIL (`threadListe` fehlt, `art` unbekannt).
- [ ] **Step 4: Umsetzen.** `istNeu` filtert `art !== 'LISTE'` zusammen mit „fremd“. `passtZuSuche` vergleicht `normalize('NFC').toLocaleLowerCase('de')` beider Seiten mit `includes`; `threadListe` trimmt `suche`, filtert über `siehtThread`, nutzt `istArchiviert`, `istNeu` (nur nicht archivierte), `naechsteTermine(…, 1)`; die Termine eines Threads holt es aus den `TERMIN`-Modulen wie `threadDatenAus`. Export in `index.ts`.
- [ ] **Step 5: Tests grün** — `pnpm nx test domain --skip-nx-cache`, PASS.
- [ ] **Step 6: Commit** — `git commit -m "TP3 Etappe 4: Neu ohne LISTE, Thread-Liste und Suche als Wert"`

---

### Task 2: Startansicht als Wert

**Files:**

- Modify: `libs/domain/src/threads/start.ts`, `libs/domain/src/threads/start.spec.ts`

**Interfaces:**

- Consumes: `ListenThread`, `NeuAenderung` (Task 1); `brauchtAntwort`, `istNeu`, `ungeleseneNachrichten`, `neuKurzangabe`, `naechsteTermine`, `threadDatenAus`, `threadSegment`.
- Produces:
  - `interface StartThread extends ListenThread { verlaufGelesenBis: number | null; nachrichten: NachrichtenEingabe['nachrichten'] }`
  - `interface OffenerPunktAnsicht { threadId: string; segment: string; titel: string; modulId: string; fuerId: string; vorname: string | null; frist: string | null }` (`frist` ISO)
  - `interface NeuEintrag { threadId: string; segment: string; titel: string; angabe: string }`
  - `interface TerminZeile { threadId: string; segment: string; titel: string; termin: TerminDaten }`
  - `interface StartAnsicht { brauchtAntwort: OffenerPunktAnsicht[]; alsNaechstes: TerminZeile[]; neu: NeuEintrag[] }`
  - `startAnsicht(e: { ich: ThreadPerson; threads: readonly StartThread[]; umfeld: Umfeld; zugangSeit: Date; jetzt: Date }): StartAnsicht`
  - `const ALS_NAECHSTES = 3`, `const NEU_HOECHSTENS = 5`

- [ ] **Step 1: Tests schreiben** (`start.spec.ts`, `describe('startAnsicht')`, Bowling-Szenario aus `testhilfe.ts`)
  - Sandra, Bowling veröffentlicht mit Teilnahme-Umfrage pro Jungfischer, Frist Do: `brauchtAntwort` hat zwei Punkte mit `vorname` „Lena“ und „Max“, `frist` als ISO; nach Lenas Antwort nur „Max“.
  - Ein Entwurf mit Umfrage und Termin erscheint für Thomas in keinem Block.
  - `alsNaechstes`: vier künftige Termine → die ersten drei nach `naechsteTermine`; ein laufender mehrtägiger Termin (Start gestern, Ende morgen) steht drin; ein künftiger Termin in einem Thread mit `archivModus: 'ARCHIVIERT'` nicht.
  - `neu`: Thread ohne Gelesen-Zeile, nach dem Zugang von Thomas veröffentlicht → Angabe „Neuer Thread“; Thread mit Gelesen-Zeile und zwei fremden Nachrichten über `verlaufGelesenBis` (Modus `KOMMENTARE`) → „2 neue Kommentare“; nur eine fremde `ANTWORT`-Änderung → „Neue Antworten“; nur eine fremde `MODUL`-Änderung → „Aushang geändert“; sieben neue Threads → fünf, nach `letzteAktivitaetAm` absteigend; ein Thread, den Sandra selbst veröffentlicht hätte (`erstelltVonId`), ist ohne fremde Änderung nicht neu.
- [ ] **Step 2: Tests scheitern** — `pnpm nx test domain --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.** Nur veröffentlichte, sichtbare Threads gehen in die Blöcke; `brauchtAntwort` bekommt sie über `threadDatenAus`. `neuerThread` nach Entscheidung 5; `antworten` ist „unter den fremden, nicht-`LISTE`-Änderungen über dem Stand ist eine `ANTWORT`“ — dieselbe Auswahl wie in `istNeu`, als gemeinsame private Funktion, damit Kennzeichen und Angabe nie auseinanderlaufen.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 4: Startansicht mit Braucht deine Antwort, Als Naechstes und Neu"`

---

### Task 3: Monatsraster

**Files:**

- Create: `libs/domain/src/module/termin/monat.ts`, `libs/domain/src/module/termin/monat.spec.ts`
- Modify: `libs/domain/src/index.ts`

**Interfaces:**

- Consumes: `TerminEintrag`, `letzterTag` (`termin.ts`), `tagPlus` (`zeit.ts`).
- Produces:
  - `monatAus(text: string): { jahr: number; monat: number } | null` — nur `^\d{4}-(0[1-9]|1[0-2])$`.
  - `monatsRaster(jahr: number, monat: number): (string | null)[]` — genau 42 Felder, Montag zuerst, Tage als `'JJJJ-MM-TT'`, außerhalb des Monats `null`.
  - `markierteTage(eintraege: readonly TerminEintrag[], jahr: number, monat: number): Set<string>` — jeder Tag jedes Termins, der in diesem Monat liegt.
  - `nachbarMonat(jahr: number, monat: number, schritt: -1 | 1): { jahr: number; monat: number }`
  - `const MONATSNAMEN: readonly string[]` („Januar“ … „Dezember“).

- [ ] **Step 1: Tests schreiben**
  - `monatAus('2026-10')` → `{ jahr: 2026, monat: 10 }`; `'2026-13'`, `'2026-1'`, `'2026-00'`, `''`, `'2026-10-01'` → `null`.
  - `monatsRaster(2027, 2)[0]` ist `'2027-02-01'` (Montag), `[27]` ist `'2027-02-28'`, `[28]` ist `null`, Länge 42.
  - `monatsRaster(2026, 3)`: `[0..5]` sind `null`, `[6]` ist `'2026-03-01'` (Sonntag); `'2026-03-29'` (Zeitumstellung) steht genau einmal drin.
  - `markierteTage` mit Termin `startDatum '2026-10-30'`, `endDatum '2026-11-02'`: Oktober → `{'2026-10-30', '2026-10-31'}`, November → `{'2026-11-01', '2026-11-02'}`; eintägiger Termin ohne `endDatum` → nur sein Tag.
  - `nachbarMonat(2026, 12, 1)` → `{ jahr: 2027, monat: 1 }`, `nachbarMonat(2027, 1, -1)` → `{ jahr: 2026, monat: 12 }`.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Wochentag über `Date.UTC` (nie die Zeitzone des Prozesses), Tage über `tagPlus`. Verworfen (Kommentar): `new Date(jahr, monat, 1)` wie im Entwurf — rechnete in der lokalen Zeitzone.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 4: Monatsraster und markierte Tage"`

---

### Task 4: `GET /threads`

**Files:**

- Modify: `apps/jufi/src/server/threads/laden.ts` (+ `laden.spec.ts`), `apps/jufi/src/server/threads/routen.ts`, `apps/jufi/src/server/mandanten.spec.ts`
- Create: `apps/jufi/src/server/threads/liste.ts`, `apps/jufi/src/server/threads/liste.spec.ts`

**Interfaces:**

- Consumes: `threadListe`, `ListenThread`, `NeuAenderung` (Task 1); `ladeThreads`, `ladeThreadUmfeld`; Testhilfen aus `test-threads.ts`.
- Produces:
  - `GeladenerThread.letzteAktivitaetAm: Date`
  - `ladeNeuKandidaten(db: VereinDb, personId: string, zugangSeit: Date, threadIds: readonly string[], mitNachrichten: boolean): Promise<Map<string, { gelesenBis: number | null; verlaufGelesenBis: number | null; aenderungen: NeuAenderung[]; nachrichten: NachrichtenEingabe['nachrichten'] }>>` — je Thread-ID ein Eintrag; Gelesen-Stände in einer Abfrage, Änderungen in einer, Nachrichten (nur mit `mitNachrichten`) in einer (Entscheidung 2).
  - `listeRouten(router: Router, deps: VolleAppDeps): void` mit `GET /threads` → `ThreadListe`.

- [ ] **Step 1: Tests schreiben** (`liste.spec.ts` gegen die Testdatenbank; Personen und Threads über `test-threads.ts`)
  - Sandra sieht Bowling, nicht den Austausch, nicht den Entwurf; Thomas sieht den Entwurf mit `entwurf: true`.
  - Neu: nach einer Antwort von Thomas ist Bowling für Sandra `neu: true`; nach `PUT /threads/:id/gelesen` mit dem Stand → `false`; danach `PUT …/angepinnt` durch Thomas → weiter `false`; eine `Aenderung` mit `urheberId: null` (direkt angelegt) → `true`.
  - Archiv: ein Thread mit Termin vor acht Tagen fehlt ohne `archiv=1`, `archiv` ist 1; mit `archiv=1` steht er drin mit `archiviert: true`, `neu: false`.
  - Suche: `?suche=100%25` findet „100% Spaß“, nicht „1000 Spaß“; `?suche=Jugendsprecher` als Sandra → `threads` leer; `suche` mit 101 Zeichen → 400 `{ fehler: 'Ungültige Anfrage', feld: 'suche' }`.
  - `laden.spec.ts`: `ladeNeuKandidaten` liefert für einen Thread mit Gelesen-Zeile nur Änderungen mit `stand > gelesenBis`, ohne Zeile nur ab `zugangSeit`, und eigene **und** urheberlose mit.
  - `mandanten.spec.ts`: `GET /threads` mit fremder Vereins-ID → 404; der Thread des anderen Vereins erscheint nicht.
- [ ] **Step 2: Tests scheitern** — `pnpm nx run jufi:test-server --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.** Reihenfolge der Route: `suche` prüfen (400), Umfeld und Threads laden, sichtbare IDs bestimmen, `ladeNeuKandidaten(…, false)` nur für sie, `threadListe` rufen. `archiv` ist genau dann gesetzt, wenn der Parameter `'1'` ist.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 4: GET /threads mit Neu, Archiv und Suche"`

---

### Task 5: `GET /start` und `GET /termine`

**Files:**

- Modify: `apps/jufi/src/server/threads/liste.ts` (+ `liste.spec.ts`), `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: `startAnsicht`, `StartThread` (Task 2); `monatAus` (Task 3); `termineImMonat`; `ladeNeuKandidaten` (Task 4).
- Produces: `GET /start` → `StartAnsicht`; `GET /termine?monat=JJJJ-MM` → `{ termine: TerminZeile[] }`.

- [ ] **Step 1: Tests schreiben**
  - `GET /start` als Sandra mit veröffentlichtem Bowling (Teilnahme pro Jungfischer, Termin in vier Tagen): zwei Punkte unter `brauchtAntwort`, Bowling unter `alsNaechstes` und unter `neu` mit „Neuer Thread“; ein „Nur Jugendleiter“-Thread mit Umfrage und Termin erscheint nirgends.
  - `GET /start` als Thomas: sein Entwurf erscheint nirgends.
  - `GET /termine?monat=JJJJ-MM` (Monat des Bowling-Termins): Bowling steht drin; ein archivierter Thread mit Termin in diesem Monat auch; ein Entwurf und ein unsichtbarer Thread nicht; `?monat=2026-13`, `?monat=2026-1` und ohne `monat` → 400 `{ fehler: 'Ungültige Anfrage', feld: 'monat' }`.
  - `mandanten.spec.ts`: beide Routen mit fremder Vereins-ID → 404.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** `GET /start` lädt die Kandidaten mit `mitNachrichten: true`, nur für sichtbare, veröffentlichte, nicht archivierte Threads. `GET /termine` prüft `monat` vor jedem Laden und baut `TerminZeile` aus veröffentlichten, sichtbaren Threads über `termineImMonat`.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 4: GET /start und GET /termine"`

---

### Task 6: Leiste, Routen, Dienst der Hülle

**Files:**

- Modify: `apps/jufi/src/styles.css`, `apps/jufi/src/app/verein/mitglieder-huelle.ts` (+ Spec), `apps/jufi/src/app/verein/threads/thread-api.ts` (+ Spec), `apps/jufi/src/app/verein/threads/thread-seite.ts` (+ Spec), `apps/jufi/src/app/verein/threads/verlauf.ts`, `apps/jufi/src/app/app.routes.ts`
- Create: `apps/jufi/src/app/verein/threads/thread-uebersicht.ts` (+ Spec); leere Komponenten `apps/jufi/src/app/verein/threads/thread-liste.ts` und `apps/jufi/src/app/verein/termine.ts` (nur Überschrift, Tasks 7 und 9 füllen sie)

**Interfaces:**

- Consumes: `ThreadListe`, `StartAnsicht`, `TerminZeile` (Tasks 1, 2).
- Produces:
  - `ThreadApi.liste(slug: string, optionen: { suche?: string; archiv?: boolean }): Observable<ThreadListe>`, `ThreadApi.start(slug): Observable<StartAnsicht>`, `ThreadApi.termine(slug, monat: string): Observable<{ termine: TerminZeile[] }>`
  - `@Injectable() class ThreadUebersicht` (in `providers` der Hülle): `slug: WritableSignal<string | null>`, `liste` (`rxResource` von `liste(slug, {})`), `neuLaden(): void`, `punkt: Signal<boolean>` (irgendeine Zeile `neu`).
  - Routen `threads` → `ThreadListeComponent` (`verein/threads/thread-liste.ts`), `termine` → `TermineComponent` (`verein/termine.ts`), beide nachgeladen, Überschriften „Threads“ und „Termine“.
  - CSS-Token `--leiste-hoehe: 57px` (56 px Fläche plus 1 px Linie).

- [ ] **Step 1: Tests schreiben**
  - `mitglieder-huelle.spec.ts`: vier Links „Start“, „Threads“, „Termine“, „Mehr“ in dieser Reihenfolge; auf `/demo/t/abc-x` ist „Threads“ aktiv; mit einer Liste, in der eine Zeile `neu` ist, trägt „Threads“ einen Punkt mit `aria-label` „neu“, ohne keinen.
  - `thread-uebersicht.spec.ts`: `neuLaden()` schickt eine zweite Anfrage; ohne Slug keine.
  - `thread-api.spec.ts`: `liste('demo', { suche: '100%', archiv: true })` ruft `/demo/api/v1/threads?suche=100%25&archiv=1`; `liste('demo', {})` ohne Abfrageteil; `termine('demo', '2026-10')` ruft `/demo/api/v1/termine?monat=2026-10`.
  - `thread-seite.spec.ts`: der Zurück-Link zeigt auf `/demo/threads` und heißt „Zurück zur Thread-Liste“.
- [ ] **Step 2: Tests scheitern** — `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.** `EINTRAEGE` um `threads` (`auch: ['t']`) und `termine`; Gitter `repeat(4, 1fr)`; der Kommentar über `EINTRAEGE` nennt, dass Medien mit TP4 dazukommt. Die Hülle setzt `uebersicht.slug` aus ihrem Input und ruft `neuLaden()` bei jedem `NavigationEnd`. `.leiste a` nutzt `min-height: calc(var(--leiste-hoehe) - 1px)`, `verlauf.ts` `calc(var(--leiste-hoehe) + var(--sicher-unten))`; der Kommentar dort verweist auf das Token statt auf „57 px“.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 4: Untere Leiste mit Threads und Termine, Neu-Punkt"`

---

### Task 7: Seite „Threads“

**Files:**

- Modify: `apps/jufi/src/app/verein/threads/thread-liste.ts` (ersetzt die leere Komponente aus Task 6); Create: `thread-liste.spec.ts`

**Interfaces:**

- Consumes: `ThreadUebersicht` (Task 6), `ThreadApi.liste`, `ThreadZeile`.
- Produces: `ThreadListeComponent` (`jf-thread-liste`), Input `slug`.

- [ ] **Step 1: Tests schreiben**
  - Grundzustand aus `ThreadUebersicht.liste`: Abschnitt „Angepinnt“ mit angepinnten Zeilen, „Aktiv“ mit den übrigen in der Reihenfolge der Antwort; ein Abschnitt ohne Zeilen erscheint nicht; „Archiv · 2“ als `<details>`, zu.
  - Zeile: Titel, „· Entwurf“ nur bei `entwurf`, `naechsterTermin` falls gesetzt, Punkt mit `aria-label` „neu“ nur bei `neu`; Link auf `/demo/t/<segment>`.
  - Aufklappen von „Archiv“ ruft `liste(slug, { archiv: true })` und zeigt die archivierten Zeilen darin.
  - Eingabe „bowl“ im Suchfeld „Threads durchsuchen“: nach 300 ms eine Anfrage `liste(slug, { suche: 'bowl', archiv: true })`, Adresse `?suche=bowl` (`replaceUrl`); archivierte Treffer stehen im aufgeklappten Archiv; keine Treffer → „Keine Treffer.“; Feld leeren → Grundzustand ohne neue Anfrage.
  - Aufruf mit `?suche=zelt` füllt das Feld und sucht sofort.
  - Leere Liste → „Noch keine Threads.“; 404 → „Nicht gefunden oder keine Berechtigung“; 401 → `beiAbgelaufenerSitzung`; Netzfehler → „Keine Verbindung – nochmal versuchen“ mit Knopf.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Suchfeld `type="search"` mit sichtbarer Beschriftung; Zeilen als Links mit mindestens `var(--tippflaeche)` Höhe, Titel mit `overflow-wrap: anywhere`.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 4: Thread-Liste mit Suche und Archiv"`

---

### Task 8: Blöcke auf Start

**Files:**

- Create: `apps/jufi/src/app/verein/start-bloecke.ts`, `start-bloecke.spec.ts`
- Modify: `apps/jufi/src/app/verein/start.ts` (+ `start.spec.ts`)

**Interfaces:**

- Consumes: `ThreadApi.start`, `StartAnsicht`; `fristText`, `terminZeit`, `kartenLink`, `geraetAus` aus `@jufi/domain`.
- Produces: `StartBloeckeComponent` (`jf-start-bloecke`), Input `slug`; `start.ts` bindet es oberhalb der Begrüßung ein.

- [ ] **Step 1: Tests schreiben**
  - „Braucht deine Antwort“: Zeile „Lena: Bowling noch offen · bis Do 18:00“ (Frist Do 22.10. 18:00, `jetzt` Mo 19.10.), eigene Zeile „Bowling noch offen“ ohne Frist; Link `/demo/t/<segment>/m/<modulId>`.
  - „Als Nächstes“: je Termin `terminZeit`, Ort (falls gesetzt) und Thread-Titel; Link `/demo/t/<segment>/m/<modulId>`.
  - „Neu seit deinem letzten Besuch“: Titel und Angabe („2 neue Kommentare“), Link `/demo/t/<segment>`.
  - Ein leerer Block erscheint nicht; sind alle drei leer, steht nichts da (keine leere Karte).
  - Netzfehler → ein Fehlerblock „Keine Verbindung – nochmal versuchen“ für alle drei, Begrüßung und Jungfischer-Karten bleiben stehen; 401 → `beiAbgelaufenerSitzung`.
  - `start.spec.ts`: die Blöcke stehen vor der Begrüßung (Reihenfolge im DOM).
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Die Uhrzeit für `fristText` liest das Bauteil einmal beim Laden der Antwort (Muster der Thread-Seite); Komponente in eigener Datei, weil `start.ts` schon 13 KB hat.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 4: Start mit Braucht deine Antwort, Als Naechstes und Neu"`

---

### Task 9: Seite „Termine“

**Files:**

- Create: `apps/jufi/src/app/verein/termine.ts`, `termine.spec.ts` (ersetzt die leere Komponente aus Task 6)

**Interfaces:**

- Consumes: `ThreadApi.termine`, `TerminZeile`; `monatAus`, `monatsRaster`, `markierteTage`, `nachbarMonat`, `MONATSNAMEN`, `berlinerTag`, `terminZeit`, `wochentagKurz`.
- Produces: `TermineComponent` (`jf-termine`), Inputs `slug` und `monat` (Query-Parameter, optional).

- [ ] **Step 1: Tests schreiben**
  - Ohne `monat`: der Berliner Monat von „jetzt“ (Uhr im Test auf `2026-10-31T23:30:00Z` → November 2026), Überschrift „November 2026“, Anfrage `termine('demo', '2026-11')`.
  - Raster: sieben Spaltenköpfe „Mo“ … „So“, 42 Felder; ein Termin 30.10.–02.11. markiert im November die Felder 1 und 2; „heute“ trägt `aria-current="date"`.
  - „Voriger Monat“ navigiert mit `?monat=2026-10` (`replaceUrl: false`, damit Zurück den Monat wiederfindet); `?monat=2026-10` lädt Oktober.
  - Liste darunter: je Termin `terminZeit`, Ort, Thread-Titel, Link `/demo/t/<segment>/m/<modulId>`; leer → „Keine Termine in diesem Monat.“
  - Ungültiges `?monat=xyz` → aktueller Monat, keine Anfrage mit `xyz`.
  - Fehlerpfade wie in Task 7.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Das Raster ist eine schlichte `<table>` mit `<th scope="col">`; Felder sind nicht klickbar (Spec 6.5: Tippen auf einen Termin führt in den Thread, das tut die Liste). Breite ohne horizontales Scrollen bei 375 px.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 4: Termine-Seite mit Monatskalender"`

---

### Task 10: Ende-zu-Ende und Layout

**Files:**

- Modify: `apps/jufi-e2e/src/ablauf.spec.ts`, `apps/jufi-e2e/src/layout.spec.ts`

**Interfaces:**

- Consumes: alle Seiten; `ids.json` (`bowling`, `bowlingId`).

- [ ] **Step 1: Ablauf** (nach dem Veröffentlichen durch die Leitung, vor der Antwort der Mutter): Mutter öffnet Start, sieht unter „Braucht deine Antwort“ eine Zeile mit „Bowling noch offen“ und unter „Neu seit deinem letzten Besuch“ „Neuer Thread“; die Leiste zeigt an „Threads“ den Punkt; „Threads“ zeigt Bowling mit Punkt; Bowling öffnen, Zurück-Pfeil → Liste, Bowling ohne Punkt; „Termine“ im Monat des Bowling-Termins zeigt Bowling. Nach dem Archivieren durch die Leitung (bestehender Schritt): Leitung sieht Bowling nicht unter „Aktiv“, aber unter „Archiv · 1“; Suche „bowl“ findet ihn; nach „Wiederherstellen“ ist er wieder unter „Aktiv“. Der Menütest erwartet vier Leisteneinträge.
- [ ] **Step 2: Layout** — `SEITEN` um `threads` und `termine` (Rollen `mutter` und `kind`, Art `mitglied`) und um die Startseite mit Blöcken (vorhanden, jetzt mit Inhalt). Zusätzlich gemessen bei 375 × 812, hell und dunkel: die vier Leisteneinträge sind je mindestens 44 px hoch und liegen nebeneinander innerhalb von 375 px; das Monatsraster hat `scrollWidth <= clientWidth`; der Neu-Punkt überdeckt das Icon nicht (Rechtecke schneiden sich nicht mit dem Text).
- [ ] **Step 3: Laufen lassen** — `pnpm run e2e`, Expected: alle grün (bisher 112, jetzt mehr).
- [ ] **Step 4: Commit** — `git commit -m "TP3 Etappe 4: Ende-zu-Ende fuer Start, Liste und Termine"`

---

### Task 11: Spec, CLAUDE.md, Abschluss

**Files:**

- Modify: `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md`, `CLAUDE.md`

- [ ] **Step 1: Spec nachziehen** — die Entscheidungen 1–13 an ihrer Stelle eintragen, jeweils mit der verworfenen Alternative: 2.6 und 3.9 (`istNeu` mit Art, Kandidaten, Archiv nie neu, Kurzangabe), 4.1 (Antwortformen von `GET /threads`, `GET /start`, `GET /termine`, `archiv=1`, Suche im Speicher statt `ILIKE`, Grenzen 100 Zeichen und Monatsformat), 6.1 (Punkt über die Liste, Blöcke in einem Abschnitt), 6.2 (Zurück zur Thread-Liste; Übersicht als Entscheidung des Eigentümers vom 21.10.2026, „vorläufig“ und offene Frage streichen; Satz zu Z. 451 „bis Etappe 4“ anpassen), 6.5 (Pfade, Abschnitte, Monat in der Adresse, Raster 6 × 7, Entwürfe nicht im Kalender), 4.1 Z. 337 („solange es `GET /threads` noch nicht gibt“ → die Verwaltung behält ihre eigene Liste, weil sie Untergruppen und `darfErstellen` braucht).
- [ ] **Step 2: CLAUDE.md** — unter „Stand“ eine Zeile: „TP3 Etappe 4 ist da: untere Leiste Start · Threads · Termine · Mehr, Start mit „Braucht deine Antwort“, „Als Nächstes“ und „Neu“, Thread-Liste unter `/<slug>/threads` (Suche, Archiv), Kalender unter `/<slug>/termine`. Was Liste und Start zeigen, entscheiden `liste.ts` und `start.ts` in `@jufi/domain`.“
- [ ] **Step 3: Gesamtprüfung** — `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache`, `pnpm run e2e`, `pnpm exec prettier --check .`; alles grün.
- [ ] **Step 4: Commit** — `git commit -m "TP3 Etappe 4: Spec und CLAUDE.md nachgezogen"`
