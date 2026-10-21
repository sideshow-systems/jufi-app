# JuFi TP3 Etappe 5 — Live — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Was andere schreiben, erscheint ohne Neuladen: Nachrichten im Verlauf, Antworten und Änderungen auf der Thread-Seite, Neu-Punkt, Liste, Start und Kalender. Wer einen Thread nicht mehr sehen darf, sieht „Nicht gefunden oder keine Berechtigung“. Nach einem Verbindungsabbruch gleicht der Client über `GET /sync` ab (Spec 1.4, Abschnitt 5).

**Architecture:** Jede schreibende Route meldet nach dem Commit ein Ereignis an einen **Bus im Prozess**. Der **Hub** hält die WebSockets je Verein und entscheidet je Socket mit einer reinen Funktion der Domäne (`signaleFuer`), ob und welches Signal die Person bekommt; Nachrichten gehen mit fertiger `VerlaufAnsicht`, alles andere lädt der Client per REST nach. `GET /sync?seit=` beantwortet eine zweite reine Funktion (`syncAntwort`). Auch TP2-Routen, die das Umfeld ändern (Personen, Familie, Untergruppen, Rechte, Zugang), schreiben jetzt eine `Aenderung` ohne Thread; ein Sync über eine solche heißt „alles neu laden“. Im Client hält ein Dienst `Echtzeit` den Socket, und die Seiten laden auf passende Ereignisse gezielt nach.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (Signale, OnPush, inline, `rxResource`), Express 4, Prisma 7, Postgres 17, `ws` 8 (neu), Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md` — Abschnitte 1.4 (Etappe 5), 2.6, 3.1, 3.9, 3.10, 4.1 (`GET /sync`), 4.2 (Schritt 3), 4.4, 5.1–5.3, 6.8, 9.2, 9.4, 10.2, 10.3. Eingabe außerdem: Memory „TP3-Rückstand“ (zuerst die Last von `ladeThreads`; TP2-Routen ohne `Aenderung`; `neuLaden()` geht während einer Anfrage verloren).

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 12 trägt sie in die TP3-Spec ein.

1. **Bus statt direktem Hub-Aufruf.** Routen kennen nur `deps.bus` (`melde(ereignis)`), der Hub abonniert ihn. Zwei Ereignisse: `aenderung` (Stand, Änderungen, betroffene Verlaufseinträge) und `pruefen` (Sitzungen eines Vereins neu prüfen). Verworfen: Routen rufen den Hub — Tests der Routen bräuchten dann einen Hub, und unter `ng serve` lebt der Hub auf einem eigenen Port.
2. **Signale ohne Abo je Thread, geprüft gegen das frische Umfeld.** Der Hub lädt je Ereignis die Köpfe der betroffenen Threads (`ladeKoepfe`, eine Abfrage) und nimmt das Umfeld des Vereins aus einem Cache, den jede Umfeld-Änderung verwirft. `SICHTBARKEIT` und `GELOESCHT` gehen an **alle** Sockets des Vereins, ohne Prüfung: Wer einen Thread gerade verloren hat, bestünde die Prüfung gegen den neuen Kopf nicht mehr, und ein gelöschter hat keinen. Kosten: Eine Familie erfährt die zufällige ID eines Threads, der seine Zielgruppe geändert hat oder gelöscht wurde; das verrät `unsichtbar` in 5.2 ohnehin. Verworfen: den Kopf von vorher durch das Ereignis reichen — jede Route bräuchte ihn, und der Gewinn ist eine ID, die nichts sagt.
3. **Umfeld-Änderungen aus TP2 werden `Aenderung`en ohne Thread** (`threadId: null`, Art `SICHTBARKEIT`, `objektId` die Person bzw. Untergruppe), über `mitAenderung` direkt nach `sperreVereinszeile`. Ein Sync, der eine solche sieht, antwortet `vollstaendig: true`; live geht ein Signal mit `threadId: null` an alle Sockets des Vereins, und der Client lädt alles neu. Verworfen: je betroffenem Thread eine `SICHTBARKEIT` — welche Threads eine neue Untergruppe oder ein Recht berührt, müsste jede TP2-Route selbst ausrechnen. Verworfen: keine `Aenderung` und nur ein Live-Signal — ein Client, der in dem Moment getrennt war, erführe es nie (Rückstand „TP2-Routen schreiben keine Aenderung“).
4. **Kein Schließen bei Rechteänderung** (weicht von 5.1 ab). Der Socket hält kein Umfeld; der Hub prüft jedes Signal gegen das aktuelle, und das Signal mit `threadId: null` lässt den Client alles neu laden. Geschlossen wird nur, wenn die **Sitzung** nicht mehr gilt: Abmelden, Zugang entzogen, Person entfernt, Sitzung abgelaufen, Verein gesperrt. Dafür prüft der Hub die Sitzungen aller Sockets eines Vereins bei jedem Umfeld-Ereignis und bei `pruefen` neu (dieselbe Regel wie die Middleware, `sitzungGilt`), und bei jedem Ping die Sockets, deren gespeicherter Ablauf vorbei ist. Verworfen: jede TP2-Route nennt die Personen, deren Zugang endete — `entzieheZugangWennUngueltig` und `entferne` stecken in sieben Routen, und eine vergessene ließe einen Socket offen.
5. **Schließcodes:** 1012 beim Herunterfahren, 4401 wenn die Sitzung oder der Verein nicht mehr gilt. Beim Upgrade: 403 bei falschem `Origin` (wie `pruefeUrsprung`), 404 bei unbekanntem oder gesperrtem Verein, 401 ohne gültige Sitzung, 429 ab dem elften Socket einer Person. Verworfen: 401/404 auch für den Origin (5.1 wörtlich) — die REST-Prüfung antwortet 403, und der Unterschied verrät nichts.
6. **`GET /sync?seit=n`** liefert `SyncAntwort { stand, geaendert, unsichtbar, vollstaendig }`. `vollstaendig` ist wahr, wenn `seit` fehlt, größer als der Stand ist (Datenbank aus einer Sicherung), vor dem ältesten aufbewahrten Stand liegt (`seit < aeltester - 1`, ohne Zeilen: `seit < stand`) oder eine Änderung ohne Thread nach `seit` kommt; dann sind beide Listen leer. Ein leerer Stand (eine Transaktion ohne `Aenderung`) kann so ein unnötiges „alles neu“ auslösen, nie ein verpasstes. Verworfen: den Aufräum-Stand im Verein speichern — eine Spalte für ein gelegentlich überflüssiges Neuladen.
7. **Der erste Sync nach dem Start der Hülle hat kein `seit`** und lädt darum einmal alles neu (5.2 wörtlich). Kosten: Liste und Start werden beim Öffnen der App zweimal geladen. Verworfen: den ersten Stand ungeprüft zu übernehmen — eine Änderung zwischen dem Laden der Seite und dem Verbinden fehlte bis zur nächsten Navigation.
8. **Gelesen bei Live-Nachrichten.** Die Thread-Seite führt `bekannterStand`: der Stand der zuletzt geladenen Ansicht, erhöht um den Stand einer Live-Nachricht dieses Threads, solange keine stille Aktualisierung aussteht (jede andere Änderung des Threads löst eine aus). Der Verlauf meldet `verlauf` bis `bekannterStand`, sobald dieser steigt und das Dokument sichtbar ist; die Übersicht meldet wie bisher den Stand der geladenen Ansicht, jetzt nur bei sichtbarem Dokument. So meldet die Seite nie etwas, das sie nicht hat (3.9). Verworfen: bis zum Stand der Nachricht melden, ohne auf ausstehende Aktualisierungen zu achten — eine Modul-Änderung desselben Augenblicks gälte als gelesen, bevor sie geladen ist.
9. **Die Hülle lädt die Liste bei Navigation nur noch ohne Verbindung neu.** Mit Verbindung kommen Änderungen als Signale (Rückstand: „lädt bei jeder Pfad-Navigation“). Der Punkt nach dem Lesen bleibt: `PUT gelesen` schreibt keine `Aenderung`, also kommt dafür kein Signal, und die Thread-Seite ruft weiter `ThreadUebersicht.neuLaden()`.
10. **Neuladen wird vorgemerkt** (`nachlader`): Kommt ein Anlass, während die Ressource lädt, lädt sie danach genau einmal neu; Anlässe binnen 250 ms werden zusammengefasst. Verworfen: `reload()` direkt — es ist während einer Anfrage wirkungslos, und ein Signal ginge verloren (Rückstand M2).
11. **`ladeThreads` wird leichter:** `ladeThreads(db, { threadIds?, mitAntworten? })`; Antworten werden nach `umfrageId` gruppiert statt je Umfrage gefiltert. Liste und Termine laden ohne Antworten, Start lädt sie nur für die aktiven Threads. Verworfen: eigene schmale Abfragen je Route — die Abbildung der Module stünde dreimal.
12. **Lokal:** Unter `ng serve` lauscht der Hub auf `JUFI_WS_DEV_PORT` (Vorgabe 4201), und `apps/jufi/proxy.conf.json` leitet `^/[^/]+/ws$` mit `ws: true` dorthin. Lädt Vite `server.ts` neu, schließt der neue Hub den alten (Griff auf `globalThis`), sonst hinge der alte am alten Bus. Im Betrieb hängt sich der Hub an den `http.Server` aus `app.listen`.
13. **Aufräumen** von `Aenderung` älter als 90 Tage: beim Start und alle 24 Stunden im App-Prozess (`setInterval(...).unref()`), plattformweit über den schlichten `PrismaClient`. SIGTERM wartet darauf und auf das Schließen der Sockets.

**Nicht in dieser Etappe** (bleibt im Rückstand): ANTWORT genau je Umfrage (`objektId` → Umfrage) für „neu“; „Aushang geändert“ nach einer gelöschten fremden Nachricht; M6 (`GET /threads/:id` ohne Gelesen-Zeile lädt alle Nachrichten); Volljährigkeit über die Uhr löst kein Signal aus (die nächste Prüfung gilt mit dem neuen Tag).

## Global Constraints

- Code-Kommentare und Oberfläche deutsch; Commit-Nachrichten deutsch in ASCII (Umlaute umschrieben), Ende `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Antwort-Texte der API (`fehler`) mit Umlauten.
- Einrückung Tabs; Ausnahmen YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative. **In `template:`/`styles:` keine Backticks in Kommentaren.**
- Angular: Vorlagen und Stile inline, `@if`/`@for`, Signale, `changeDetection: ChangeDetectionStrategy.OnPush`, Selektor-Präfix `jf-`, Tokens aus `styles.css`; jeder Fehlerpfad ruft `beiAbgelaufenerSitzung`. Alles mit `WebSocket`, `document` oder Zeitgebern nur im Browser (`isPlatformBrowser`), die App rendert auch auf dem Server.
- Regeln sind reine Funktionen mit `jetzt: Date`; nie `new Date()` ohne Argument in `libs/domain`. Server nimmt `deps.jetzt()`.
- Vereinsdaten nur über `vereinDb`; der schlichte `PrismaClient` nur für das Aufräumen und die Vereinsprüfung beim Upgrade (Plattform-Operationen).
- Was die Person nicht sieht, ist 404 bzw. kommt nicht als Signal; nie 403 für Vereinsdaten. Fehler werden nur mit Name und Code geloggt (4.4), nie mit Inhalt.
- `server.ts` läuft auch beim Bau: Hub, Port und Aufräumen nur in `betriebsApp()` (CLAUDE.md).
- Werte: Ping 30 000 ms; höchstens 10 Sockets je Person; Backoff 1 s, verdoppelt, höchstens 30 s, ±20 % Zufall; Entprellen 250 ms; Aufräumen nach 90 Tagen, Takt 24 h; Pfad `/<slug>/ws` (das Cookie hat den Pfad `/<slug>/`).
- Texte: Kopf „Nicht verbunden – Inhalte evtl. veraltet“; Thread weg „Nicht gefunden oder keine Berechtigung“.
- Im Browser und in Tests nur erfundene Daten.
- Nach jeder Task: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache` grün. Vor dem Abschluss `pnpm exec prettier --check .` und `pnpm run e2e`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp3-etappe5-live`.

## Review Focus

1. **Kein Signal über die Grenze:** Ein Socket aus Verein A bekommt nichts aus Verein B; Sandra bekommt zu einem `NUR_JUGENDLEITER`-Thread und einem Entwurf weder ein Signal noch eine Nachricht, wohl aber `SICHTBARKEIT`/`GELOESCHT` als nackte ID; ein Cookie aus Verein A am Slug von B ist 401 (Tasks 2, 7, 8).
2. **Sitzung endet, Socket endet:** Abmelden in einem Tab, Zugang entziehen, Person entfernen und Verein sperren schließen die betroffenen Sockets mit 4401; ein abgelaufenes Cookie fällt spätestens beim nächsten Ping heraus; der Client landet auf der Anmeldung mit `weiter=` (Tasks 4, 7, 10).
3. **Lücken nach Abbruch:** Getrennt während einer Nachricht und einer Zielgruppenänderung → nach dem Wiederverbinden steht die Nachricht im Verlauf, und der verlorene Thread zeigt „Nicht gefunden oder keine Berechtigung“; `seit` größer als der Stand oder vor dem Aufgeräumten → alles neu (Tasks 2, 5, 10, 11).
4. **Gelesen nur, was geladen ist:** Eine Live-Nachricht im offenen Verlauf zählt danach nicht als ungelesen; eine gleichzeitige Modul-Änderung gilt erst nach der stillen Aktualisierung als gelesen; im Hintergrund-Tab wird nichts gemeldet (Task 10).
5. **Doppelte und eigene:** Die eigene Nachricht steht nach Senden und eigenem Signal genau einmal im Verlauf; zwei Tabs derselben Person sehen beide jede Nachricht; ein Wiederholungs-POST (200) meldet kein Ereignis (Tasks 3, 10).

## Dateistruktur

```
libs/domain/src/threads/echtzeit.ts          NEU: EchtzeitSignal, signaleFuer, SyncAntwort, syncAntwort
libs/db/src/lib/aenderung.ts                 vermerkeUmfeld
apps/jufi/src/server/threads/laden.ts        ladeThreads(db, auswahl), ladeKoepfe, kopfAus
apps/jufi/src/server/threads/liste.ts        ohne Antworten bzw. zweistufig (Start)
apps/jufi/src/server/threads/sync.ts         NEU: GET /sync
apps/jufi/src/server/threads/aufraeumen.ts   NEU: raeumeAenderungenAuf, starteAufraeumen
apps/jufi/src/server/echtzeit/bus.ts         NEU: Bus, BusEreignis
apps/jufi/src/server/echtzeit/hub.ts         NEU: Hub (Upgrade, Sockets, Ping, Signale)
apps/jufi/src/server/mitglieder/sitzung.ts   loeseSitzungAuf, sitzungGilt herausgeloest
apps/jufi/src/server/verein.ts               ladeVereinAusSlug herausgeloest
apps/jufi/src/server/threads/{schreiben,verwalten,verlauf,antworten}.ts   bus.melde nach dem Commit
apps/jufi/src/server/mitglieder/{personen,familie,untergruppen,rechte,zugang,jungfischer,einladung,profil}.ts
apps/jufi/src/server/admin/vereine.ts        pruefen nach dem Sperren
apps/jufi/src/server/abhaengigkeiten.ts      bus
apps/jufi/src/server.ts                      Hub, Dev-Port, Aufraeumen, SIGTERM
apps/jufi/proxy.conf.json, apps/jufi/project.json, package.json, tools/runtime-package.mjs
tools/pruefe-betrieb.sh                      Upgrade-Pruefung
apps/jufi/src/app/verein/echtzeit.ts         NEU: Dienst Echtzeit
apps/jufi/src/app/verein/threads/nachladen.ts  NEU: nachlader
apps/jufi/src/app/verein/threads/thread-api.ts sync
apps/jufi/src/app/verein/mitglieder-huelle.ts  Echtzeit starten, Hinweis im Kopf
apps/jufi/src/app/verein/{start-bloecke,termine}.ts, threads/{thread-uebersicht,thread-liste,thread-seite,verlauf}.ts
apps/jufi-e2e/src/ablauf.spec.ts, layout.spec.ts
```

---

### Task 1: `ladeThreads` leichter, `ladeKoepfe`

**Files:**

- Modify: `apps/jufi/src/server/threads/laden.ts` (+ `laden.spec.ts`), `liste.ts`, alle Aufrufer von `ladeThreads`/`ladeThread`

**Interfaces:**

- Produces:
  - `ladeThreads(db: VereinDb | VereinTx, auswahl?: { threadIds?: readonly string[]; mitAntworten?: boolean }): Promise<GeladenerThread[]>` — `mitAntworten` Vorgabe `true`; ohne Antworten ist `UmfrageDaten.antworten` leer.
  - `ladeThread(db, threadId)` unverändert (mit Antworten).
  - `ladeKoepfe(db: VereinDb, threadIds: readonly string[]): Promise<Map<string, ThreadKopf>>` — eine Abfrage samt Untergruppen; unbekannte IDs fehlen in der Map.

- [ ] **Step 1: Branch anlegen** — `git switch -c feature/tp3-etappe5-live`
- [ ] **Step 2: Tests schreiben** (`laden.spec.ts`)
  - `ladeThreads(db, { mitAntworten: false })`: eine Umfrage mit zwei Antworten hat `antworten: []`, Optionen und `ergebnisse` sind da.
  - Zwei Umfragen in zwei Threads mit je einer Antwort: jede Umfrage bekommt genau ihre (Gruppierung nach `umfrageId`).
  - `ladeKoepfe(db, [a, unbekannt])`: Map mit genau `a`, Kopf gleich `ladeThread(db, a).kopf` (`toEqual`), Untergruppen sortiert.
  - `GET /start` (in `liste.spec.ts`): „Braucht deine Antwort“ stimmt weiter, wenn ein archivierter Thread eine offene Umfrage hat (der kommt nicht vor) und ein aktiver eine beantwortete (kommt nicht vor).
- [ ] **Step 3: Tests scheitern** — `pnpm nx run jufi:test-server --skip-nx-cache -- laden liste`, FAIL.
- [ ] **Step 4: Umsetzen.** Die Abbildung einer Thread-Zeile auf `ThreadKopf` als `kopfAus` herausziehen und in beiden nutzen. Antworten über eine `Map<umfrageId, AntwortDaten[]>`. `GET /threads` und `GET /termine` laden mit `mitAntworten: false`; `GET /start` lädt ohne, filtert die aktiven und lädt diese mit `{ threadIds, mitAntworten: true }` nach. Bestehende Aufrufer mit ID-Liste auf `{ threadIds }` umstellen.
- [ ] **Step 5: Tests grün**, `typecheck` grün.
- [ ] **Step 6: Commit** — `git commit -m "TP3 Etappe 5: ladeThreads ohne Antworten, ladeKoepfe"`

---

### Task 2: Signale und Sync als Wert

**Files:**

- Create: `libs/domain/src/threads/echtzeit.ts`, `echtzeit.spec.ts`
- Modify: `libs/domain/src/threads/index.ts`

**Interfaces:**

- Produces:
  - `interface EchtzeitSignal { stand: number; threadId: string | null; art: AenderungArt; objektId: string; eintrag?: VerlaufAnsicht }`
  - `interface SignalAenderung { threadId: string | null; art: AenderungArt; objektId: string }`
  - `type SignalEintrag = VerlaufEintragDaten & { threadId: string }`
  - `signaleFuer(e: { ich: ThreadPerson | undefined; umfeld: Umfeld; koepfe: ReadonlyMap<string, ThreadKopf>; stand: number; aenderungen: readonly SignalAenderung[]; eintraege: readonly SignalEintrag[] }): EchtzeitSignal[]`
  - `interface SyncAntwort { stand: number; geaendert: string[]; unsichtbar: string[]; vollstaendig: boolean }`
  - `syncAntwort(e: { ich: ThreadPerson; umfeld: Umfeld; koepfe: ReadonlyMap<string, ThreadKopf>; seit: number | null; stand: number; aeltesterStand: number | null; threadIds: readonly (string | null)[] }): SyncAntwort` — `threadIds` sind die verschiedenen `threadId` der Änderungen mit `stand > seit`.

- [ ] **Step 1: Tests schreiben** (Fixtures aus `testhilfe.ts`, `bowlingUmfeld`)
  - `signaleFuer`:
    - `ich: undefined` (entfernt) → `[]`.
    - `THREAD` an einem Familien-Thread: Sandra bekommt `{ stand, threadId, art: 'THREAD', objektId }`; an einem `NUR_JUGENDLEITER`-Thread und einem Entwurf nichts; Thomas bekommt beide.
    - `SICHTBARKEIT` und `GELOESCHT` an einem Thread, dessen Kopf fehlt oder den Sandra nicht sieht: Sandra bekommt sie.
    - Änderung ohne Thread (zweimal, verschiedene `objektId`) → genau ein Signal `threadId: null`, `art: 'SICHTBARKEIT'`, `objektId` der ersten.
    - Ein `THREAD` und drei `MODUL` desselben Threads → zwei Signale (je Art eines, `objektId` der ersten).
    - `VERLAUF` mit zwei Einträgen eines sichtbaren Threads → zwei Signale mit `objektId` = Eintrags-ID und `eintrag` gleich `verlaufAnsicht(ich, kopf, eintrag, umfeld)` (Thomas' eigene Nachricht: `eigen: true` für Thomas, `false` für Sandra; Absender nach 3.10).
    - Gelöschte Nachricht als Eintrag → `eintrag.text === null`, `geloescht` gesetzt.
  - `syncAntwort`:
    - `seit: null` → `vollstaendig: true`, Listen leer, `stand` durchgereicht.
    - `seit > stand` → vollständig; `aeltesterStand: 10, seit: 8` → vollständig; `seit: 9` → nicht; ohne Zeilen (`aeltesterStand: null`) und `seit < stand` → vollständig, `seit === stand` → nicht.
    - `threadIds` mit `null` → vollständig.
    - Sichtbarer Thread → `geaendert`; `NUR_JUGENDLEITER` für Sandra und unbekannte ID (gelöscht) → `unsichtbar`; Reihenfolge wie die Eingabe.
- [ ] **Step 2: Tests scheitern** — `pnpm nx test domain --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen** mit `siehtThread` und `verlaufAnsicht`; keine eigene Sichtbarkeitsregel. Export in `index.ts`.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 5: Signale und Sync als Wert"`

---

### Task 3: Bus und Ereignisse der Thread-Routen

**Files:**

- Create: `apps/jufi/src/server/echtzeit/bus.ts`, `bus.spec.ts`
- Modify: `apps/jufi/src/server/abhaengigkeiten.ts`, `threads/schreiben.ts`, `verwalten.ts`, `verlauf.ts`, `antworten.ts` und ihre Specs

**Interfaces:**

- Consumes: `SignalAenderung`, `SignalEintrag` (Task 2); `AenderungEingabe` aus `@jufi/db`.
- Produces:
  - `type BusEreignis = { typ: 'aenderung'; vereinId: string; stand: number; aenderungen: readonly SignalAenderung[]; eintraege: readonly SignalEintrag[] } | { typ: 'pruefen'; vereinId: string }`
  - `class Bus { melde(e: BusEreignis): void; abonniere(f: (e: BusEreignis) => void): () => void }` — ein Abonnent, der wirft, hält die anderen nicht auf (Fehler nur mit Namen loggen).
  - `AppDeps.bus?: Bus`, Vorgabe `new Bus()` in `mitStandardwerten`.

- [ ] **Step 1: Tests schreiben**
  - `bus.spec.ts`: zwei Abonnenten bekommen dasselbe Ereignis; nach Abbestellen keins; ein werfender Abonnent hindert den zweiten nicht.
  - In den Route-Specs (ein Test-Bus über `deps.bus`, gesammelte Ereignisse):
    - `POST /threads/:id/verlauf` → genau ein `aenderung` mit dem Stand der Antwort, `aenderungen` wie in die DB geschrieben, `eintraege` mit dem neuen Eintrag samt `threadId`; die Wiederholung (200) → kein Ereignis; 409/410 → keins.
    - `DELETE /verlauf/:id` → ein Ereignis, der Eintrag mit `geloeschtAm`; das zweite Löschen (204) → keins.
    - `PUT /umfragen/...` → ein Ereignis mit `ANTWORT`, `eintraege: []`.
    - `POST /threads`, `PUT /threads/:id`, Veröffentlichen, Archiv, Anpinnen, `DELETE /threads/:id` → je ein Ereignis mit den Arten aus 4.2; „schon so“ (Doppelklick) → keins.
    - Das Ereignis kommt erst nach dem Commit: Im Abonnenten liest `prisma.aenderung.count({ where: { stand } })` die Zeilen schon.
- [ ] **Step 2: Tests scheitern**, FAIL.
- [ ] **Step 3: Umsetzen.** Jede Route meldet nach dem `await` ihrer Transaktion `deps.bus.melde({ typ: 'aenderung', vereinId, stand, aenderungen, eintraege })` aus der Rückgabe von `mitAenderung`; Verlauf POST/DELETE reichen ihren Eintrag als `VerlaufEintragDaten` mit. Kein Ereignis auf Wiederholungs- und Fehlerpfaden.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 5: Bus und Ereignisse der Thread-Routen"`

---

### Task 4: Umfeld-Änderungen aus TP2 und Prüfanlässe

**Files:**

- Modify: `libs/db/src/lib/aenderung.ts` (+ `libs/db/src/aenderung.spec.ts`)
- Modify: `apps/jufi/src/server/mitglieder/personen.ts`, `familie.ts`, `untergruppen.ts`, `rechte.ts`, `zugang.ts`, `jungfischer.ts`, `einladung.ts`, `profil.ts`, `apps/jufi/src/server/admin/vereine.ts` und ihre Specs

**Interfaces:**

- Consumes: `Bus`, `BusEreignis` (Task 3).
- Produces: `vermerkeUmfeld(tx: VereinTx, vereinId: string, urheberId: string | null, jetzt: Date, objektIds: readonly string[]): Promise<{ stand: number; aenderungen: readonly AenderungEingabe[] }>` — `mitAenderung` mit `{ threadId: null, art: 'SICHTBARKEIT', objektId }` je ID.

Routen mit `vermerkeUmfeld` direkt nach `sperreVereinszeile` (bei `POST /personen` und `PATCH /einstellungen` gibt es keine Sperre: dort als erste schreibende Anweisung) und `aenderung`-Ereignis nach dem Commit; `objektId` ist die geänderte Person bzw. Untergruppe:

| Datei             | Routen                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `personen.ts`     | `POST /personen`, `PATCH /personen/:id`, `POST …/volljaehrig-belassen`, `DELETE /personen/:id` |
| `familie.ts`      | `PUT` und `DELETE /personen/:jungfischerId/familie/:erwachsenerId` (`objektId` beide)          |
| `untergruppen.ts` | `POST`, `PATCH`, `DELETE /untergruppen/:id`, `PUT /personen/:id/untergruppen`                  |
| `rechte.ts`       | `PUT /personen/:id/rechte`                                                                     |
| `zugang.ts`       | `POST /personen/:id/zugang`                                                                    |
| `jungfischer.ts`  | `POST /meine-jungfischer/:kindId/zugang`, `…/einwilligung`                                     |
| `einladung.ts`    | `POST /einladung/einloesen` (die eingeladene Person)                                           |

Nur `pruefen`-Ereignis (keine `Aenderung`): `POST /abmelden`, `POST /abmelden/alle`, `POST /profil/passwort`, Admin `POST /vereine/:id/sperren` (nur bei `'geaendert'`).

- [ ] **Step 1: Tests schreiben**
  - `aenderung.spec.ts`: `vermerkeUmfeld` erhöht den Stand um eins, schreibt je ID eine Zeile mit `threadId: null`, Art `SICHTBARKEIT`, fasst keinen Thread an.
  - Je Datei mindestens eine Route: Nach dem Aufruf gibt es eine `Aenderung` ohne Thread mit der erwarteten `objektId`, und der Test-Bus hat ein `aenderung` mit demselben Stand; eine abgelehnte Anfrage (404, 400) schreibt keine und meldet keins.
  - `POST /abmelden` meldet `{ typ: 'pruefen', vereinId }`; das Sperren eines Vereins meldet es mit seiner ID, ein zweites Sperren nicht.
- [ ] **Step 2: Tests scheitern**, FAIL.
- [ ] **Step 3: Umsetzen** in der Reihenfolge der Tabelle; der Kommentar an `vermerkeUmfeld` nennt Entscheidung 3 samt verworfener Alternativen.
- [ ] **Step 4: Tests grün**, der bestehende Mandanten-Test bleibt grün.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 5: Umfeld-Aenderungen aus TP2 und Pruefanlaesse"`

---

### Task 5: `GET /sync`

**Files:**

- Create: `apps/jufi/src/server/threads/sync.ts`, `sync.spec.ts`
- Modify: `apps/jufi/src/server/threads/routen.ts`, `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: `syncAntwort`, `SyncAntwort` (Task 2); `ladeKoepfe` (Task 1); `ladeVereinsstand`, `ladeThreadUmfeld`.
- Produces: `syncRouten(router: Router, deps: VolleAppDeps): void` mit `GET /sync?seit=n` → 200 `SyncAntwort`.

- [ ] **Step 1: Tests schreiben** (`sync.spec.ts`)
  - Ohne `seit` → `vollstaendig: true`, `stand` = Vereinsstand.
  - `seit` = Stand nach einer Nachricht in Bowling → `geaendert: []`; danach eine weitere → `geaendert: [bowling]`.
  - Sandra, Thread auf `NUR_JUGENDLEITER` umgestellt → `unsichtbar: [id]`; gelöschter Thread → `unsichtbar`.
  - Nach `PUT /personen/:id/rechte` → `vollstaendig: true`.
  - `seit` größer als der Stand → vollständig; alle Zeilen bis Stand 5 gelöscht und `seit: 3` → vollständig.
  - `seit=abc`, `seit=-1`, `seit=1.5`, wiederholt → 400 `{ feld: 'seit' }`; ohne Sitzung → 401.
  - `mandanten.spec.ts`: Fall für `GET /sync` (fremder Verein 404 wie die übrigen).
- [ ] **Step 2: Tests scheitern**, FAIL.
- [ ] **Step 3: Umsetzen.** Erst `ladeVereinsstand` (4.1: der Stand vor den Daten), dann `aenderung.findMany({ where: { stand: { gt: seit } }, select: { threadId: true }, distinct: ['threadId'] })`, `aenderung.aggregate({ _min: { stand: true } })`, Umfeld und `ladeKoepfe` der Thread-IDs; die Entscheidung trifft `syncAntwort`. Rein lesend.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 5: GET /sync"`

---

### Task 6: Hub — Upgrade, Verbindungen, Schließen

**Files:**

- Create: `apps/jufi/src/server/echtzeit/hub.ts`, `hub.spec.ts`
- Modify: `apps/jufi/src/server/mitglieder/sitzung.ts`, `apps/jufi/src/server/verein.ts`, `package.json` (`ws`, `@types/ws`), `apps/jufi/project.json` (`externalDependencies`), `tools/runtime-package.mjs`

**Interfaces:**

- Consumes: `Bus` (Task 3).
- Produces:
  - `ladeVereinAusSlug(prisma: PrismaClient, slug: string): Promise<Verein | null>` — `null` bei ungültigem Slug, unbekanntem oder gesperrtem Verein; `vereinAusSlug` nutzt sie.
  - `sitzungGilt(zeile: { ablauf: Date; zugang: { person: Person } }, jetzt: Date): boolean` und `loeseSitzungAuf(db: VereinDb, cookieHeader: string | undefined, jetzt: Date): Promise<{ person: Person; zugang: Zugang; sitzungId: string; ablauf: Date } | null>`; `mitgliedAusSitzung` nutzt beide (Verlängern bleibt dort).
  - `class Hub { constructor(d: { prisma: PrismaClient; umgebung: Umgebung; jetzt: () => Date; bus: Bus; pingMs?: number }); haengeAn(server: http.Server): void; schliesseAlle(): Promise<void>; anzahl(vereinId?: string): number }` — `schliesseAlle` schließt mit 1012 und bestellt den Bus ab.

- [ ] **Step 1: Abhängigkeit** — `pnpm add ws` und `pnpm add -D @types/ws`; `ws` in `externalDependencies` und in die Liste von `tools/runtime-package.mjs` (Kopfkommentar ergänzen).
- [ ] **Step 2: Tests schreiben** (`hub.spec.ts`, Testserver aus `createApp` + `http.createServer`, Port 0, Client aus `ws` mit `Cookie`- und `Origin`-Header; Sitzungen wie in `liste.spec.ts` über `legeMitgliedAn`)
  - Gültiges Cookie, richtiger Origin, Pfad `/<slug>/ws` → offen, `anzahl(vereinId) === 1`.
  - Falscher Origin → 403; unbekannter Slug, gesperrter Verein → 404; ohne Cookie, Cookie aus Verein A an Slug B, entfernte Person, Jungfischer ohne `zugangErlaubt` → 401; anderer Pfad → Socket wird ohne Antwort zerstört.
  - Elfter Socket derselben Person → 429, die zehn bleiben offen.
  - `POST /abmelden` dieser Sitzung → Socket schließt mit 4401, ein Socket einer anderen Sitzung derselben Person bleibt; `POST /personen/:id/zugang` (entziehen) → 4401; Verein sperren → alle Sockets des Vereins 4401, die eines anderen Vereins bleiben.
  - Abgelaufene Sitzung (`jetzt` vorstellen, `pingMs: 50`) → 4401 nach dem nächsten Ping; ein Client, der nicht auf Ping antwortet, wird beendet.
  - `schliesseAlle()` → alle mit 1012.
- [ ] **Step 3: Tests scheitern**, FAIL.
- [ ] **Step 4: Umsetzen.** `WebSocketServer({ noServer: true })`; am `upgrade`-Ereignis: Pfad, Origin gegen `new URL(umgebung.basisUrl).origin`, `ladeVereinAusSlug`, `loeseSitzungAuf`, Grenze, dann `handleUpgrade`. Abgelehnt wird mit einer rohen HTTP-Antwort (`HTTP/1.1 401 Unauthorized\r\n\r\n`) und `socket.destroy()`. Je Socket gespeichert: `vereinId`, `personId`, `sitzungId`, `ablauf`. Bei `pruefen` und bei einem `aenderung` mit Änderung ohne Thread: alle Sitzungen des Vereins in einer Abfrage holen, Vereinsstatus dazu, `sitzungGilt` → ungültige mit 4401 schließen. Fehler beim Prüfen nur mit Namen loggen.
- [ ] **Step 5: Tests grün.**
- [ ] **Step 6: Commit** — `git commit -m "TP3 Etappe 5: Hub mit Upgrade, Ping und Schliessen"`

---

### Task 7: Hub — Signale verteilen

**Files:**

- Modify: `apps/jufi/src/server/echtzeit/hub.ts` (+ `hub.spec.ts`), `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: `signaleFuer` (Task 2), `ladeKoepfe` (Task 1), `ladeThreadUmfeld`, `BusEreignis` (Task 3).
- Produces: Nachrichten an den Client als JSON eines `EchtzeitSignal` je Socket-Nachricht.

- [ ] **Step 1: Tests schreiben**
  - Thomas und Sandra verbunden; Thomas schreibt im Bowling-Verlauf → beide bekommen ein `VERLAUF`-Signal mit `eintrag` (`eigen` je Person richtig, `absender` nach 3.10).
  - Nachricht in einem `NUR_JUGENDLEITER`-Thread → Thomas ja, Sandra nichts (innerhalb von 300 ms nichts empfangen).
  - Zielgruppe von Bowling auf `NUR_JUGENDLEITER` → Sandra bekommt `SICHTBARKEIT` mit der Thread-ID.
  - Sandra wird in eine Untergruppe gesteckt → beide bekommen `threadId: null`; danach gilt das neue Umfeld (Nachricht in einem Untergruppen-Thread kommt bei Sandra an).
  - `mandanten.spec.ts`: Socket aus Verein B bekommt bei einer Nachricht in Verein A nichts.
- [ ] **Step 2: Tests scheitern**, FAIL.
- [ ] **Step 3: Umsetzen.** Je `aenderung`: Gibt es Sockets im Verein? Sonst nichts laden. Umfeld aus dem Cache (`Map<vereinId, Promise<Umfeld>>`, verworfen bei Änderung ohne Thread, bevor geladen wird), `ladeKoepfe` der Thread-IDs, dann je Socket `signaleFuer` mit `umfeld.personen.get(personId)` und je Signal ein `send`. Ereignisse eines Vereins der Reihe nach (eine Promise-Kette je Verein), damit Signale in Stand-Reihenfolge ankommen.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 5: Hub verteilt Signale"`

---

### Task 8: Betrieb — Start, Dev-Port, Aufräumen, Prüfskript

**Files:**

- Create: `apps/jufi/src/server/threads/aufraeumen.ts`, `aufraeumen.spec.ts`, `apps/jufi/proxy.conf.json`
- Modify: `apps/jufi/src/server.ts`, `apps/jufi/project.json` (`serve.options.proxyConfig`), `apps/jufi/src/server/umgebung.ts` (optional `JUFI_WS_DEV_PORT`), `tools/pruefe-betrieb.sh`, `README.md`

**Interfaces:**

- Consumes: `Hub` (Task 6/7), `Bus` (Task 3).
- Produces:
  - `raeumeAenderungenAuf(prisma: PrismaClient, jetzt: Date): Promise<number>` — löscht `angelegtAm < jetzt − 90 Tage`, gibt die Zahl zurück.
  - `starteAufraeumen(e: { prisma: PrismaClient; jetzt: () => Date; intervallMs?: number }): { stoppe(): Promise<void> }` — läuft sofort und dann alle 24 h, Zeitgeber `unref()`, `stoppe` wartet auf einen laufenden Durchlauf (Muster `starteMailArbeiter`).

- [ ] **Step 1: Tests schreiben** (`aufraeumen.spec.ts`): Zeilen 91 und 89 Tage alt → nur die erste weg, Rückgabe 1; Zeilen aller Vereine betroffen; `stoppe()` während eines Durchlaufs wartet ihn ab.
- [ ] **Step 2: Tests scheitern, umsetzen, grün.**
- [ ] **Step 3: `server.ts` verdrahten.** `betriebsApp()` legt `bus` und `hub` an und gibt `{ app, hub }` zurück; der Worker-Zweig bleibt ein leeres `express()`. Nach `SELECT 1` startet das Aufräumen neben dem Mail-Arbeiter; `beende()` wartet auf `arbeiter.stoppe()`, `aufraeumen.stoppe()`, `hub.schliesseAlle()` und `nachlauf.warteAufAlle()`. Im Hauptmodul-Zweig `hub.haengeAn(app.listen(port, …))`. Sonst (ng serve) lauscht der Hub auf `JUFI_WS_DEV_PORT` (Vorgabe 4201); ein vorheriger Dev-Hub auf `globalThis` wird erst geschlossen (Entscheidung 12).
- [ ] **Step 4: Proxy.** `apps/jufi/proxy.conf.json` `{ "^/[^/]+/ws$": { "target": "http://localhost:4201", "ws": true } }`, `serve.options.proxyConfig` darauf. Prüfen: `pnpm run dev`, im Browser angemeldet die Konsole ohne WebSocket-Fehler, `new WebSocket('ws://localhost:4200/demo/ws')` öffnet.
- [ ] **Step 5: Prüfskript.** Mit `--slug`: Upgrade-Anfrage per `curl --http1.1` mit `Connection: Upgrade`, `Upgrade: websocket`, `Sec-WebSocket-Version: 13`, einem festen `Sec-WebSocket-Key` und `Origin: $APP_URL` an `$APP_URL/$SLUG/ws` ohne Cookie → `ok`, wenn der Status 401 ist (der Upgrade erreicht die App), sonst `nok` mit dem Status. Muster von `ok`/`nok`.
- [ ] **Step 6: README** — Abschnitt zur lokalen Entwicklung: WebSocket über Port 4201 und Proxy; Betrieb: Upgrade über Traefik, Prüfung in `pruefe-betrieb.sh`.
- [ ] **Step 7: Bau prüfen** — `pnpm nx build jufi` grün (keine Hub-Seiteneffekte beim Bau), Tests grün.
- [ ] **Step 8: Commit** — `git commit -m "TP3 Etappe 5: Hub im Betrieb, Dev-Proxy, Aufraeumen nach 90 Tagen"`

---

### Task 9: Client — Dienst `Echtzeit`, Nachlader, Hülle

**Files:**

- Create: `apps/jufi/src/app/verein/echtzeit.ts`, `echtzeit.spec.ts`, `apps/jufi/src/app/verein/threads/nachladen.ts`, `nachladen.spec.ts`
- Modify: `apps/jufi/src/app/verein/threads/thread-api.ts` (+ spec), `thread-uebersicht.ts` (+ spec), `mitglieder-huelle.ts` (+ spec), `apps/jufi/src/app/admin/test-hilfen.ts`

**Interfaces:**

- Consumes: `EchtzeitSignal`, `SyncAntwort` (Task 2); `GET /sync` (Task 5).
- Produces:
  - `ThreadApi.sync(slug: string, seit: number | null): Observable<SyncAntwort>`
  - `type EchtzeitEreignis = { typ: 'signal'; signal: EchtzeitSignal } | { typ: 'sync'; geaendert: readonly string[]; unsichtbar: readonly string[] } | { typ: 'alles' }`
  - `@Injectable() class Echtzeit { readonly verbunden: Signal<boolean>; readonly getrennt: Signal<boolean>; readonly vordergrund: Signal<boolean>; readonly ereignisse: Observable<EchtzeitEreignis>; starte(slug: string): void; stoppe(): void }` — `getrennt` wird wahr, wenn seit 2 s keine Verbindung besteht; `vordergrund` folgt `document.visibilityState`.
  - `betrifft(e: EchtzeitEreignis, threadId: string): boolean` — Signal dieses Threads oder mit `threadId: null`, Sync mit dem Thread in einer Liste, `alles`.
  - `nachlader(r: { isLoading: Signal<boolean>; reload(): boolean }, injector: Injector): () => void` — entprellt 250 ms, merkt während des Ladens vor.

Verhalten von `Echtzeit`:

- Öffnet `wss://` bzw. `ws://` auf `/<slug>/ws`; nach dem Öffnen `sync(stand)`. `stand` ist das Maximum aus Sync-Antworten und Signalen, anfangs `null` (Entscheidung 7).
- Sync: `vollstaendig` → `alles`; sonst bei nicht leeren Listen `sync`.
- Schließcode 1012 → neu verbinden mit Backoff. Jeder andere Abbruch (auch ein gescheiterter Upgrade) → `GET /sync`: 401 → `beiAbgelaufenerSitzung`, nicht mehr verbinden; 404 → nicht mehr verbinden; sonst Ergebnis anwenden und mit Backoff neu verbinden. Backoff 1 s, verdoppelt bis 30 s, ±20 %, nach erfolgreichem Öffnen zurück auf 1 s.
- `visibilitychange` auf sichtbar: getrennt → sofort verbinden, sonst `sync`.
- `stoppe()` (Hülle wird abgebaut) schließt ohne Neuverbinden.

- [ ] **Step 1: Tests schreiben**
  - `nachladen.spec.ts`: zwei Anlässe binnen 250 ms → ein `reload`; Anlass während `isLoading` → `reload` erst nach Ende, genau einmal.
  - `echtzeit.spec.ts` (gefälschte `WebSocket`-Klasse über einen Injection-Token `WEB_SOCKET`, `HttpTestingController`, `vi.useFakeTimers`): Öffnen → `GET /sync` ohne `seit` → `alles`; Signal mit `stand: 7` → nächstes Sync mit `seit=7`; Abbruch 1006 → Sync → 401 → Navigation zur Anmeldung, kein neuer Socket; 1012 → neuer Socket nach 0,8–1,2 s, dann 1,6–2,4 s; `getrennt` erst nach 2 s; im Server-Rendering (`PLATFORM_ID` `'server'`) kein Socket.
  - `thread-uebersicht.spec.ts`: ein Ereignis während laufender Anfrage → danach genau eine weitere Anfrage.
  - `mitglieder-huelle.spec.ts`: `getrennt()` wahr → Kopf zeigt „Nicht verbunden – Inhalte evtl. veraltet“ mit `role="status"`; verbunden → Navigation lädt die Liste nicht neu; getrennt → sie tut es.
- [ ] **Step 2: Tests scheitern**, FAIL.
- [ ] **Step 3: Umsetzen.** `Echtzeit` steht in `providers` der Hülle neben `ThreadUebersicht`, die Hülle startet ihn per `effect` mit dem Slug. `ThreadUebersicht` lädt über `nachlader` auf jedes Ereignis neu. Der Hinweis steht rechts im Kopf (`margin-left: auto`, gedämpft, kleine Schrift, darf umbrechen). `adminTestAnbieter` bekommt eine stille `Echtzeit`-Attrappe (opt-out `eigeneEchtzeit: true`), damit bestehende Specs keinen Socket öffnen.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 5: Client verbindet sich, Hinweis ohne Verbindung"`

---

### Task 10: Client — Seiten laden auf Signale nach

**Files:**

- Modify: `apps/jufi/src/app/verein/start-bloecke.ts`, `termine.ts`, `threads/thread-liste.ts`, `threads/thread-seite.ts`, `threads/verlauf.ts` (+ jeweilige Specs)

**Interfaces:**

- Consumes: `Echtzeit`, `betrifft`, `nachlader` (Task 9).
- Produces: `Verlauf.uebernimm(eintrag: VerlaufAnsicht): void` (einfügen oder nach ID ersetzen, Ordnung nach `stand`, dann `id`); `Verlauf.frischeAuf(): Promise<void>` (neueste Seite laden und nach ID einmischen, ohne die Liste zu leeren); Input `Verlauf.stand` ist jetzt `bekannterStand` der Seite.

Regeln:

- Start-Blöcke und erweiterte Thread-Liste (Suche/Archiv): jedes Ereignis → `nachlader`.
- Termine: jedes Ereignis außer Signalen der Arten `VERLAUF` und `ANTWORT`.
- Thread-Seite, nur Ereignisse, die den Thread `betrifft`:
  - `GELOESCHT`, oder der Thread steht in `unsichtbar` → „Nicht gefunden oder keine Berechtigung“ ohne Anfrage.
  - `VERLAUF` mit `eintrag`: Verlauf sichtbar → `uebernimm`, und ohne ausstehende Aktualisierung `bekannterStand = max(bekannterStand, signal.stand)`; Übersicht sichtbar → stille Aktualisierung (für den Zähler am Reiter).
  - `VERLAUF` ohne `eintrag` (Systemeintrag), `sync` mit dem Thread in `geaendert`, `alles` → stille Aktualisierung und, wenn sichtbar, `frischeAuf()`.
  - alle anderen Arten → stille Aktualisierung.
  - Stille Aktualisierung: `GET /threads/:id` ohne `zustand` und Karten zurückzusetzen; Erfolg ersetzt den Thread und setzt `bekannterStand` auf seinen `stand`; 404 → „Nicht gefunden …“; 401 → `beiAbgelaufenerSitzung`; anderer Fehler → alter Stand bleibt.
- Gelesen (Entscheidung 8): Die Übersicht meldet wie bisher, aber nur bei `echtzeit.vordergrund()`; der Verlauf meldet `verlauf` bis `stand()`, sobald dieser über dem zuletzt gemeldeten liegt und `vordergrund()` wahr ist.

- [ ] **Step 1: Tests schreiben** (Ereignisse über eine `Echtzeit`-Attrappe mit `Subject`)
  - Start-Blöcke: `signal` → nach 250 ms ein zweites `GET /start`. Termine: `VERLAUF`-Signal → kein neues `GET /termine`, `THREAD` → eins.
  - Thread-Seite:
    - Live-Nachricht im offenen Verlauf → steht einmal da (auch wenn die eigene gesendete mit derselben ID schon da ist), `PUT gelesen` mit `{ bereich: 'verlauf', bis: signal.stand }`.
    - `MODUL` und gleich danach eine Nachricht mit höherem Stand → kein `PUT gelesen` mit dem Stand der Nachricht, bevor die stille Aktualisierung zurück ist; danach eins mit deren `stand`.
    - `vordergrund` falsch → kein `PUT gelesen`; wird er wahr → genau eins.
    - `GELOESCHT` → Text „Nicht gefunden oder keine Berechtigung“, keine Anfrage; `sync` mit `unsichtbar: [id]` → dasselbe.
    - Stille Aktualisierung zeigt kein „Wird geladen“, die Karte bleibt im DOM.
    - `alles` bei offenem Verlauf → `GET /verlauf`, ein schon gezeigter Eintrag steht danach einmal da.
- [ ] **Step 2: Tests scheitern**, FAIL.
- [ ] **Step 3: Umsetzen.** Abonnements mit `takeUntilDestroyed`; die stille Aktualisierung nutzt denselben `lauf`-Zähler wie `lade`, damit eine ältere Antwort keine neuere überschreibt.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 5: Seiten laden auf Signale nach, Gelesen bei Live-Nachrichten"`

---

### Task 11: Ende-zu-Ende — Live

**Files:**

- Modify: `apps/jufi-e2e/src/ablauf.spec.ts`, `layout.spec.ts`, `messen.ts`

- [ ] **Step 1: Ablauf ergänzen** (nach „Mutter antwortet für Mia …“, zwei Kontexte gleichzeitig offen):
  - Leitung hat Bowling im Verlauf offen; Mutter schreibt „Wir kommen zu zweit“ → bei der Leitung erscheint die Nachricht ohne Neuladen (`expect(...).toBeVisible({ timeout: 5000 })`), der Zähler am Reiter Verlauf bleibt bei 0.
  - Mutter hat die Thread-Liste offen; Leitung pinnt Bowling an → in der Liste der Mutter steht Bowling unter „Angepinnt“ ohne Neuladen.
  - Leitung legt einen zweiten Familien-Thread „Zielgruppe (Test)“ an und veröffentlicht ihn; Mutter öffnet ihn; Leitung stellt die Zielgruppe auf „Nur Jugendleiter“ → bei der Mutter steht „Nicht gefunden oder keine Berechtigung“ ohne Neuladen. (Ein eigener Thread, damit Bowling für die späteren Schritte des Ablaufs sichtbar bleibt.)
  - Getrennt: Mutter-Seite mit `page.routeWebSocket(/\/ws$/, (ws) => ws.close())` → nach 2 s „Nicht verbunden – Inhalte evtl. veraltet“ im Kopf.
- [ ] **Step 2: Layout** — der Hinweis bei 375 × 812 und 1280 × 800, hell und dunkel: kein horizontales Scrollen (`scrollWidth <= clientWidth`), Hinweis überdeckt den Vereinsnamen nicht (Rechtecke schneiden sich nicht).
- [ ] **Step 3: Laufen** — `pnpm run e2e` grün.
- [ ] **Step 4: Commit** — `git commit -m "TP3 Etappe 5: Ende-zu-Ende fuer Live-Aktualisierung"`

---

### Task 12: Spec und CLAUDE.md nachziehen

**Files:**

- Modify: `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md` (2.6, 4.1, 4.2, 5.1–5.3, 9.4, 11), `CLAUDE.md`

- [ ] **Step 1: Spec.** Entscheidungen 1–13 an ihre Stellen: Bus und Ereignisse (4.2 Schritt 3); Signale an alle bei `SICHTBARKEIT`/`GELOESCHT` und Prüfung gegen frisches Umfeld (5.1); kein Schließen bei Rechteänderung, Schließcodes und Upgrade-Antworten (5.1); Änderungen ohne Thread aus TP2 (2.6, 5.2); `vollstaendig`-Regeln und erster Sync (5.2); Gelesen bei Live-Nachrichten (3.9 letzter Punkt, 5.3); Dev-Port und Proxy (5.1); Aufräumen (2.6, 9.4); `ladeThreads` (3.9). Jeweils mit verworfener Alternative.
- [ ] **Step 2: CLAUDE.md** — eine Zeile unter „Stand“: „TP3 Etappe 5 ist da: Live über `/<slug>/ws` und `GET /sync`; Schreibrouten melden nach dem Commit an `deps.bus`, TP2-Routen, die das Umfeld ändern, über `vermerkeUmfeld`. Lokal lauscht der Hub auf 4201 hinter dem Proxy von `ng serve`.“ Unter „Was nachweislich stolpert“: „**Neue Schreibroute** meldet nach dem Commit an `deps.bus`, sonst sieht niemand die Änderung live.“
- [ ] **Step 3: `pnpm exec prettier --check .`** grün.
- [ ] **Step 4: Commit** — `git commit -m "TP3 Etappe 5: Spec und CLAUDE.md nachgezogen"`
