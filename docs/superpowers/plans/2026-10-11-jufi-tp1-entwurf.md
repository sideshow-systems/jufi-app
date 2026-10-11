# JuFi Teilprojekt 1 — Klickbarer Entwurf: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein statisch ausgelieferter, durchklickbarer Entwurf der JuFi App unter `/entwurf/` mit drei Testpersonen, 15 geführten Aufgaben und Rückmeldung per WhatsApp.

**Architecture:** Nx-Workspace nach HWYD-Vorbild mit einer einzigen Angular-App `apps/entwurf` (nur Browser, kein SSR, kein Backend). Ein Store aus Signalen hält den gesamten Datenstand und speichert ihn in `localStorage`; alle fachlichen Regeln sind reine Funktionen in `regeln/`, die Bildschirme lesen nur über berechnete Signale. Ein abgetrennter Ordner `testmodus/` legt Personenwahl, Aufgaben und Rückmeldung über die App.

**Tech Stack:** pnpm 10.34.5, Nx 23.1.0, Angular ~22.0.4 (`@angular/build:application`, `@angular/build:unit-test` mit Vitest), TypeScript ~6.0.3, Vitest ^4.1.10, Prettier ^3.8.1, Lucide ^1.31.0, nginx:alpine.

**Spec:** `docs/superpowers/specs/2026-10-11-jufi-tp1-entwurf-design.md` (Rahmen: `docs/superpowers/specs/2026-10-11-jufi-rahmen-design.md`). Ausführende lesen beide.

## Global Constraints

- Code-Kommentare, Oberfläche und Commit-Nachrichten auf Deutsch; Commit-Nachrichten in ASCII (Umlaute umschrieben), mit Zeile `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Kommentare erklären **warum**; verworfene Alternativen mit Grund.
- Einrückung mit Tabs; Ausnahmen YAML, `package.json`, Markdown (siehe `.editorconfig` aus Task 1).
- Angular: Standalone-Bauteile, Signale, `changeDetection: ChangeDetectionStrategy.OnPush`, Vorlagen und Stile **inline**, `@if`/`@for`/`@switch`. **Keine Backticks in Kommentaren innerhalb von `template:`/`styles:`.**
- Routen folgen dem echten URL-Schema unter `base href="/entwurf/"`; Vereins-Slug `glonntal`.
- Vereinsfarbe Ausgangswert `#0f766e`; Kontrast Text auf Akzent und Akzent auf Fläche ≥ 4,5 (WCAG AA) in hell und dunkel.
- Tippflächen ≥ 44 × 44 px; keine waagrechte Scrollbarkeit bei 375 px Breite.
- Speicherschlüssel `jufi-entwurf:v1`.
- **„Jetzt" ist im Entwurf eingefroren:** Datum = gespeicherter Bezugstag, Uhrzeit = echte Uhrzeit. Alle Regeln bekommen `jetzt: Date` als Parameter, nie `new Date()` im Regelcode. (Auslegung von Spec 3.1: nur so bleibt der Entwurf über Wochen glaubwürdig — sonst wären nach drei Wochen Bowling archiviert und alle Fristen abgelaufen.)
- Vor jedem Commit: `pnpm exec prettier --check .` grün.
- Kein `git push`, kein Deploy ohne ausdrückliche Ansage des Eigentümers.

## Review Focus

1. **`localStorage` fehlt, ist voll oder enthält kaputtes JSON / eine alte Version** → der Entwurf startet mit frischen Beispieldaten statt weiß zu bleiben. Test in Task 6.
2. **Testperson kommt nach Wochen zurück** → Termine, Fristen und Archiv verhalten sich wie am ersten Tag (eingefrorenes „Jetzt"). Test in Task 6.
3. **Deep Link auf einen Thread, den die aktuelle Person nicht sehen darf, oder auf eine unbekannte ID** (z. B. Sandra öffnet `…/t/6-fischerpruefung-2027`) → „Nicht gefunden oder keine Berechtigung", kein Absturz, kein Inhalt. Test in Task 3 (Regel) und Task 8 (Seite).
4. **Rückmeldung oder Teilen-Text mit Umlauten, Emojis, Anführungszeichen, `&`, `#`, Zeilenumbrüchen** → kommt in WhatsApp unverfälscht an. Test in Task 14 (Rückmeldung) und Task 15 (Teilen).
5. **Extreme Vereinsfarbe** (`#ffff00`, `#000000`, `#ffffff`) → Akzente bleiben in hell und dunkel lesbar (AA). Test in Task 5.

---

## Dateistruktur

```
.editorconfig  .prettierrc  .prettierignore  .gitignore
package.json  pnpm-workspace.yaml  nx.json  tsconfig.base.json  tsconfig.json
CLAUDE.md
.claude/launch.json
tools/entwurf-konfig.mjs            schreibt apps/entwurf/src/konfig.generated.ts
tools/deploy-entwurf.sh
deploy/jufi-entwurf.yml             Compose-Block (Server-Fassung, versioniert)
deploy/nginx-entwurf.conf
Dockerfile.entwurf
apps/entwurf/
	project.json  tsconfig.json  tsconfig.app.json  tsconfig.spec.json
	public/fotos/*.svg  public/logo.svg
	src/index.html  src/main.ts  src/styles.css
	src/app/
		app.ts  app.config.ts  app.routes.ts
		daten/typen.ts            alle Datentypen
		daten/zeit.ts             Bezugstag, jetzt(), relative Daten
		daten/beispieldaten.ts    erzeugeBeispieldaten(bezugstag)
		daten/speicher.ts         laden/speichern localStorage
		daten/store.ts            EntwurfStore (Signale + Aktionen)
		regeln/personen.ts        kinderVon, elternVon, istJugendleiter, darf, kannRechtEntziehen
		regeln/sichtbarkeit.ts    siehtThread, leserVon, kinderImThread
		regeln/antworten.ts       antwortZeilen, zusagen, brauchtAntwort
		regeln/fahrt-kosten.ts    mitfahrtOffen, zahlungspflichtig, kostenStatus
		regeln/termine.ts         termineVon, naechsteTermine, termineImMonat, istArchiviert, neuigkeiten
		regeln/teilen.ts          teilenText, threadPfad
		regeln/*.spec.ts
		gestaltung/farben.ts      vereinsfarben, kontrast
		gestaltung/thema.ts       ThemaService (Hell/Dunkel/System, setzt CSS-Variablen)
		gestaltung/icon.ts        Lucide-Bauteil
		gestaltung/ui.ts          kleine gemeinsame Bauteile (Karte, Pille, Abschnittstitel)
		mitglieder/               huelle.ts, start.ts, threads.ts, thread.ts, termine.ts, medien.ts, dokumente.ts, mehr.ts, nicht-gefunden.ts
		module/                   info.ts, termin.ts, umfrage.ts, helfer.ts, fahrt.ts, kosten.ts, dateien.ts, fotos.ts, verlauf.ts, modul.ts (Weiche)
		verwaltung/               huelle.ts, threads.ts, editor.ts, antworten.ts, personen.ts, einladung.ts, rechte.ts, ansichten.ts, einstellungen.ts
		testmodus/                typen.ts, aufgaben.ts, pruefung.ts, testmodus.ts (Service), einstieg.ts, band.ts, knopf.ts, bewertung.ts, rueckmeldung.ts, versand.ts
	src/konfig.generated.ts     (gitignored)
```

---

### Task 1: Workspace-Grundgerüst und leere App

**Files:**
- Create: `.editorconfig`, `.prettierrc`, `.prettierignore`, `package.json`, `pnpm-workspace.yaml`, `nx.json`, `tsconfig.base.json`, `tsconfig.json`, `CLAUDE.md`, `.claude/launch.json`, `tools/entwurf-konfig.mjs`
- Modify: `.gitignore` (enthält bereits `.superpowers/`)
- Create: `apps/entwurf/project.json`, `apps/entwurf/tsconfig.json`, `apps/entwurf/tsconfig.app.json`, `apps/entwurf/tsconfig.spec.json`, `apps/entwurf/src/index.html`, `apps/entwurf/src/main.ts`, `apps/entwurf/src/styles.css`, `apps/entwurf/src/app/app.ts`, `apps/entwurf/src/app/app.config.ts`, `apps/entwurf/src/app/app.routes.ts`
- Test: `apps/entwurf/src/app/app.spec.ts`

**Interfaces:**
- Produces: Nx-Projekt `entwurf` mit Targets `konfig`, `build`, `serve`, `test`, `typecheck`; Datei `apps/entwurf/src/konfig.generated.ts` mit `export const WHATSAPP_NUMMER: string | null`.

- [ ] **Step 1: Konfigurationsdateien anlegen**

Aus `../hwyd` übernehmen und anpassen (HWYD → JuFi, Kommentare auf dieses Projekt zuschneiden): `.editorconfig`, `.prettierrc` (unverändert), `.prettierignore` (nur `/dist`, `/coverage`, `/.nx/cache`, `/.nx/workspace-data`, `.angular`, `pnpm-lock.yaml`, `/.claude/`, `/.vscode/`), `pnpm-workspace.yaml` (Pakete `apps/*`, `libs/*`, `ignoredBuiltDependencies` wie HWYD), `nx.json` (ohne `@nx/js/typescript`-Build-Optionen für Bibliotheken; Generator-Vorgaben wie HWYD), `tsconfig.base.json` (wie HWYD, `customConditions: ["@jufi/source"]`), `tsconfig.json` (leere `references`).
`package.json`: `"name": "@jufi/source"`, `"version": "0.1.0"`, `"private": true`, `"packageManager": "pnpm@10.34.5"`, `nx.includedScripts: []`, Abhängigkeiten in den HWYD-Versionen, beschränkt auf: `@angular/{common,compiler,core,forms,platform-browser,router}`, `@angular/build`, `@angular/cli`, `@angular/compiler-cli`, `@angular-devkit/{core,schematics}`, `@schematics/angular`, `@nx/{angular,js,vitest,web}`, `nx`, `typescript`, `vitest`, `jsdom`, `prettier`, `tslib`, `rxjs`, `lucide`, `@types/node`.
Skripte: `dev:entwurf` (`nx serve entwurf`), `build:entwurf` (`nx build entwurf`), `test` (`nx run-many -t test`), `typecheck` (`nx run-many -t typecheck`), `format`, `format:check`, `image:entwurf` (`docker build -f Dockerfile.entwurf -t jufi-entwurf:local .`), `deploy:entwurf` (`bash tools/deploy-entwurf.sh`).
`.gitignore` ergänzen: `node_modules`, `dist`, `coverage`, `.nx/cache`, `.nx/workspace-data`, `.angular`, `apps/entwurf/src/konfig.generated.ts`, `.env*` außer `*.example`.

- [ ] **Step 2: `tools/entwurf-konfig.mjs` schreiben**

Liest `process.env.JUFI_ENTWURF_WHATSAPP`, entfernt alles außer Ziffern, schreibt `apps/entwurf/src/konfig.generated.ts` mit `export const WHATSAPP_NUMMER: string | null = '<ziffern>'` bzw. `null`. Kommentar im erzeugten Kopf: Datei wird erzeugt, nicht bearbeiten; Nummer ist im ausgelieferten Bündel lesbar (Spec 5.5).

- [ ] **Step 3: Projekt `apps/entwurf` anlegen**

`project.json` nach Muster `../hwyd/apps/hwyd/project.json`, aber: kein SSR, kein `server`, kein `outputMode`, kein Service Worker; `outputPath: dist/apps/entwurf`, `baseHref: "/entwurf/"`, `assets` aus `apps/entwurf/public`, `styles: ["apps/entwurf/src/styles.css"]`; Target `konfig` (`node tools/entwurf-konfig.mjs`, `cache: false`) als `dependsOn` von `build`, `serve`, `test`, `typecheck`; `serve` mit `servePath: "/entwurf/"` und Port 4300; Budgets wie HWYD. `tsconfig*.json` wie HWYD ohne `paths` und `references` auf Bibliotheken. `app.ts`: Bauteil `App` mit `<router-outlet />`. `app.routes.ts`: `''` leitet auf `glonntal` um, `glonntal` zeigt vorläufig einen Platzhalter „JuFi Entwurf".
`.claude/launch.json`: Konfiguration `entwurf`, `pnpm run dev:entwurf`, Port 4300, `url: http://localhost:4300`.
`CLAUDE.md`: Projektregeln aus Rahmen-Spec Abschnitt 14, dazu aus `../hwyd/CLAUDE.md` die Abschnitte „Sprache und Ton", „Einrückung", „Angular" und den Punkt „Vor jedem `git push`: `prettier --check`"; Hinweis, dass `apps/entwurf` Wegwerfcode ist und das Grundgerüst bleibt.

- [ ] **Step 4: Rauchtest schreiben**

`app.spec.ts`: `it('startet und zeigt den Platzhalter', …)` — `TestBed` mit `provideRouter(routes)`, `RouterTestingHarness.create('/glonntal')`, erwartet Text `JuFi Entwurf` im Wirt.

- [ ] **Step 5: Installieren und prüfen**

Run: `pnpm install && pnpm nx test entwurf --watch=false && pnpm nx build entwurf && pnpm exec prettier --check .`
Expected: Test PASS, Build erzeugt `dist/apps/entwurf/browser/index.html` mit `<base href="/entwurf/">`, Prettier ohne Befund.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Workspace-Grundgeruest und leere Entwurfs-App" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Datentypen, Zeit und Beispieldaten

**Files:**
- Create: `apps/entwurf/src/app/daten/typen.ts`, `apps/entwurf/src/app/daten/zeit.ts`, `apps/entwurf/src/app/daten/beispieldaten.ts`, `apps/entwurf/public/fotos/` (8 einfache SVG-Platzhalter: Fluss, Fisch, Gruppe …), `apps/entwurf/public/logo.svg`
- Test: `apps/entwurf/src/app/daten/beispieldaten.spec.ts`, `apps/entwurf/src/app/daten/zeit.spec.ts`

**Interfaces:**
- Produces (`typen.ts`, alle exportiert):

```ts
export type Id = string;
export type Recht = 'mitglieder' | 'threadsErstellen' | 'alleThreads' | 'dokumente' | 'antwortenDetail' | 'rechteVerwalten' | 'einstellungen';
export interface Person { id: Id; vorname: string; nachname: string; art: 'jungfischer' | 'erwachsener'; alter?: number; hatZugang: boolean; fotoEinwilligung?: boolean; rechte: Recht[]; }
export interface Elternschaft { elternteil: Id; kind: Id; }
export interface Untergruppe { id: Id; name: string; mitglieder: Id[]; }
export type Rollenfilter = 'jungfischerUndEltern' | 'nurEltern' | 'nurJugendleiter';
export interface Zielgruppe { untergruppen: 'alle' | Id[]; rollen: Rollenfilter; }
export type Modus = 'aushang' | 'kommentare' | 'chat';
export type Einheit = 'jungfischer' | 'erwachsener' | 'person';
export interface Antwort { fuer: Id; von: Id; optionen: Id[]; zeit: string; }
export interface InfoModul { id: Id; typ: 'info'; titel?: string; text: string; }
export interface TerminModul { id: Id; typ: 'termin'; titel?: string; beginn: string; ende?: string; ort: string; treffpunkt?: string; }
export interface UmfrageModul { id: Id; typ: 'umfrage'; frage: string; mehrfach: boolean; optionen: { id: Id; text: string }[]; einheit: Einheit; frist?: string; ergebnisse: 'alle' | 'summe' | 'jugendleiter'; teilnahme: boolean; antworten: Antwort[]; }
export interface HelferPlatz { id: Id; text: string; anzahl: number; eintraege: { fuer: Id; von: Id }[]; }
export interface HelferModul { id: Id; typ: 'helfer'; titel: string; einheit: Einheit; frist?: string; plaetze: HelferPlatz[]; }
export interface Auto { id: Id; fahrer: Id; richtung: 'hin' | 'rueck'; plaetze: number; abfahrt: string; ort: string; mitfahrer: Id[]; }
export interface FahrModul { id: Id; typ: 'fahrt'; autos: Auto[]; }
export type KostenStatus = 'offen' | 'gemeldet' | 'bezahlt';
export interface KostenModul { id: Id; typ: 'kosten'; titel: string; betragCent: number; hinweis: string; iban?: string; paypal?: string; status: Record<Id, Exclude<KostenStatus, 'offen'>>; }
export interface DateienModul { id: Id; typ: 'dateien'; dateien: { id: Id; name: string; groesse: string }[]; }
export interface FotosModul { id: Id; typ: 'fotos'; fotos: { id: Id; bild: string; von: Id }[]; }
export type Modul = InfoModul | TerminModul | UmfrageModul | HelferModul | FahrModul | KostenModul | DateienModul | FotosModul;
export interface VerlaufEintrag { id: Id; art: 'nachricht' | 'system'; von?: Id; text: string; zeit: string; }
export interface Thread { id: Id; nr: number; titel: string; zielgruppe: Zielgruppe; modus: Modus; angepinnt: boolean; archiviert: boolean; veroeffentlicht: boolean; erstelltVon: Id; module: Modul[]; verlauf: VerlaufEintrag[]; letzteAktivitaet: string; }
export interface Dokument { id: Id; kategorie: 'Ordnungen' | 'Merkblätter' | 'Formulare'; name: string; groesse: string; }
export interface Verein { name: string; slug: string; farbe: string; logo: string; }
export interface Datenstand { version: 1; bezugstag: string; verein: Verein; personen: Person[]; elternschaften: Elternschaft[]; untergruppen: Untergruppe[]; threads: Thread[]; dokumente: Dokument[]; letzterBesuch: Record<Id, string>; }
```

`archiviert` ist nur die **manuelle** Archivierung; die automatische berechnet `istArchiviert` (Task 4).
- Produces (`zeit.ts`): `bezugstagHeute(echt: Date): string` (ISO-Datum `YYYY-MM-DD`), `jetzt(bezugstag: string, echt: Date): Date` (Datum des Bezugstags + Uhrzeit von `echt`), `relativ(bezugstag: string, tage: number, uhrzeit: string): string` (ISO-Zeitpunkt), `naechsterWochentag(bezugstag: string, wochentag: 0..6): number` (Tage bis dahin, 1..7).
- Produces (`beispieldaten.ts`): `erzeugeBeispieldaten(bezugstag: string): Datenstand`; feste IDs als Konstanten exportiert: `P = { sandra, lena, max, thomas, jonas, katrin, michael }`, `T = { infos, bowling, herbstfest, zeltlager, hegefischen, pruefung, orga, koenigsfischen }`, `M = { bowlingUmfrage, bowlingFahrt, bowlingKosten, herbstHelfer, pizzaUmfrage, hegeFotos, gruppenstunde }`.

- [ ] **Step 1: Tests schreiben**

`zeit.spec.ts`:
- `jetzt('2026-10-11', new Date('2026-11-30T15:20:00'))` hat Datum 2026-10-11, Stunde 15, Minute 20.
- `naechsterWochentag('2026-10-11', 6)` (Sonntag → Samstag) ist `6`; `naechsterWochentag('2026-10-10', 6)` (Samstag) ist `7`.

`beispieldaten.spec.ts` (Bezugstag `'2026-10-11'`):
- Verein: Slug `glonntal`, Farbe `#0f766e`, Name `Jungfischer Glonntal`.
- Genau die Personen aus Spec 3.3 existieren; `max.hatZugang === false`, `max.fotoEinwilligung === false`, Thomas hat alle 7 Rechte, Katrin alle außer `rechteVerwalten` und `einstellungen`, Michael nur `antwortenDetail`; mindestens 12 weitere Jungfischer.
- Elternschaft Sandra→Lena, Sandra→Max, Thomas→Jonas.
- Untergruppe „Ältere" enthält weder Lena noch Max noch Jonas; „Zeltlager-Teilnehmer" enthält Lena.
- Acht Threads gemäß Spec 3.4 mit den dort genannten Zielgruppen und Modi; nur „Wichtige Infos" angepinnt; nur „Königsfischen" `archiviert: true`.
- Gruppenstunde (in „Wichtige Infos") am `2026-10-13` 18:00, Ort `Vereinsheim`.
- Bowling-Termin liegt am Samstag `2026-10-17`, Frist der Bowling-Umfrage `2026-10-14`; Antwort Lena = Ja mit `von === lena`; Max und Jonas ohne Antwort.
- Fahrgemeinschaft Bowling: Auto Familie Maier (hin, 3 Plätze, 2 belegt, Lena darunter), Auto Familie Huber hin und rück je 2 Plätze.
- Helferliste Herbstfest: Kuchen 3/5, Salat 1/4, Aufbau 2/4, Abbau 0/4.
- Termin Hegefischen liegt 5 Tage vor dem Bezugstag; Königsfischen 6 Wochen davor.
- Drei Kategorien globaler Dokumente, darunter `Jugendfischereiordnung` in `Ordnungen`.

- [ ] **Step 2: Tests laufen lassen**

Run: `pnpm nx test entwurf --watch=false`
Expected: FAIL (Module fehlen).

- [ ] **Step 3: `zeit.ts`, `typen.ts`, `beispieldaten.ts` und Platzhalter-Bilder schreiben**

Alle Datumswerte über `relativ()`; Thread-Nummern `nr` 1–8 in der Reihenfolge von Spec 3.4. Namen erfunden; Familiennamen für die Fahrgemeinschaft: Maier, Huber.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm nx test entwurf --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit** — `Datentypen, eingefrorene Zeit und Beispieldaten`

---

### Task 3: Regeln Personen und Sichtbarkeit

**Files:**
- Create: `apps/entwurf/src/app/regeln/personen.ts`, `apps/entwurf/src/app/regeln/sichtbarkeit.ts`
- Test: `apps/entwurf/src/app/regeln/personen.spec.ts`, `apps/entwurf/src/app/regeln/sichtbarkeit.spec.ts`

**Interfaces:**
- Consumes: `Datenstand`, `Person`, `Thread`, `Recht` (Task 2).
- Produces:
	- `person(stand: Datenstand, id: Id): Person | undefined`
	- `kinderVon(stand: Datenstand, id: Id): Person[]`, `elternVon(stand: Datenstand, kindId: Id): Person[]`
	- `istJugendleiter(p: Person): boolean` (mindestens ein Recht)
	- `darf(p: Person, recht: Recht): boolean`
	- `kannRechtEntziehen(stand: Datenstand, personId: Id, recht: Recht): boolean` — `false`, wenn `recht === 'rechteVerwalten'` und die Person der letzte Inhaber ist
	- `ROLLEN_VORLAGEN: Record<'leitung' | 'jugendleiter' | 'betreuer', Recht[]>` (Spec Rahmen 4.2)
	- `kinderImThread(stand: Datenstand, t: Thread): Person[]` — Jungfischer, die zur Zielgruppe gehören (Untergruppen-Filter; leer bei `nurJugendleiter`)
	- `siehtThread(stand: Datenstand, personId: Id, t: Thread): boolean`
	- `threadZuNr(stand: Datenstand, personId: Id, nr: number): Thread | undefined` — `undefined` bei unbekannter Nummer **und** bei fehlender Sichtbarkeit (eine Antwort für beide Fälle, Rahmen 8.3)

- [ ] **Step 1: Tests schreiben** (Bezugstag `'2026-10-11'`)

- `siehtThread`: Sandra sieht Bowling, Herbstfest, Zeltlager (über Lena); Sandra sieht **nicht** Fischerprüfung und Orga. Lena sieht Bowling und Zeltlager, **nicht** Herbstfest (nur Eltern), nicht Fischerprüfung. Max (ohne Zugang, trotzdem regelkonform) sieht Bowling. Thomas sieht alle acht. Ein unveröffentlichter Thread ist nur für Jugendleiter sichtbar.
- `threadZuNr(stand, P.sandra, 6)` → `undefined`; `threadZuNr(stand, P.sandra, 999)` → `undefined`; `threadZuNr(stand, P.sandra, 2)?.id === T.bowling`.
- `kinderImThread(stand, bowling)` enthält Lena, Max, Jonas; für Zeltlager nur Mitglieder von „Zeltlager-Teilnehmer"; für Orga leer.
- `kinderVon(stand, P.sandra)` → Lena, Max; `elternVon(stand, P.jonas)` → Thomas.
- `darf(thomas, 'rechteVerwalten') === true`, `darf(katrin, 'rechteVerwalten') === false`.
- `kannRechtEntziehen(stand, P.thomas, 'rechteVerwalten') === false` (einziger Inhaber); nach Hinzufügen des Rechts bei Katrin → `true`.

- [ ] **Step 2: Tests laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren** in den beiden Dateien. Sichtbarkeit nach Rahmen-Spec 6.2: Jugendleiter sehen alles; Jungfischer bei `jungfischerUndEltern`, wenn in den Untergruppen (oder `alle`); Erwachsene bei `jungfischerUndEltern`/`nurEltern`, wenn ein eigenes Kind in den Untergruppen ist.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Commit** — `Regeln: Personen, Rechte, Sichtbarkeit`

---

### Task 4: Regeln Antworten, Fahrgemeinschaft, Kosten, Termine, Teilen

**Files:**
- Create: `apps/entwurf/src/app/regeln/antworten.ts`, `apps/entwurf/src/app/regeln/fahrt-kosten.ts`, `apps/entwurf/src/app/regeln/termine.ts`, `apps/entwurf/src/app/regeln/teilen.ts`
- Test: je eine `.spec.ts` daneben

**Interfaces:**
- Consumes: Task 2 und 3.
- Produces:
	- `interface AntwortZeile { fuer: Id; label: string; antwort?: Antwort }` — `label` ist der Vorname des Kindes bzw. `'Du'`
	- `antwortZeilen(stand, personId, t: Thread, m: UmfrageModul | HelferModul): AntwortZeile[]` — `jungfischer`: eigene Zeile für Jungfischer, je Kind im Thread für Eltern (Jugendleiter ohne Kind im Thread: keine Zeile); `erwachsener`: eine Zeile `'Du'` für Erwachsene, keine für Jungfischer; `person`: eine Zeile `'Du'`. Bei `HelferModul` ist `antwort` leer; ob eingetragen, liest das Bauteil aus `plaetze`.
	- `zusagen(t: Thread): Id[] | null` — Kinder mit Option `ja` in der Umfrage mit `teilnahme: true`; `null`, wenn es keine gibt
	- `interface OffenerPunkt { threadId: Id; modulId: Id; fuer: Id; label: string; titel: string; art: 'umfrage' | 'helfer' | 'kosten'; frist?: string }`
	- `brauchtAntwort(stand, personId, jetzt: Date): OffenerPunkt[]` — sichtbare, nicht archivierte Threads; Umfragen: Zeilen ohne Antwort, Frist nicht abgelaufen; Helferlisten mit Frist: wenn die Person (bzw. Zeile) in keinem Platz steht und noch Plätze frei sind; Kosten: nur für Eltern, je zahlungspflichtigem eigenen Kind mit Status `offen`. Sortiert nach Frist, ohne Frist zuletzt.
	- `mitfahrtOffen(stand, t: Thread, m: FahrModul, richtung: 'hin' | 'rueck'): Person[]` — `kinderImThread`, gefiltert durch `zusagen` falls nicht `null`, ohne Platz in dieser Richtung
	- `freiePlaetze(a: Auto): number`
	- `zahlungspflichtig(stand, t: Thread): Id[]` — `zusagen(t) ?? kinderImThread(...).map(id)`
	- `kostenStatus(m: KostenModul, kindId: Id): KostenStatus`
	- `interface TerminEintrag { threadId: Id; nr: number; threadTitel: string; modul: TerminModul }`
	- `termineVon(stand, personId): TerminEintrag[]` (alle sichtbaren, nach `beginn` sortiert)
	- `naechsteTermine(stand, personId, jetzt: Date, anzahl: number): TerminEintrag[]` (nur `beginn ≥ jetzt`)
	- `termineImMonat(stand, personId, jahr: number, monat: number): TerminEintrag[]` (`monat` 0–11)
	- `istArchiviert(t: Thread, jetzt: Date): boolean` — manuell oder Ende (sonst Beginn) des letzten Termins + 7 Tage < `jetzt`
	- `neuigkeiten(stand, personId, seit: string): { threadId: Id; titel: string; text: string }[]` — sichtbare Threads mit `letzteAktivitaet > seit`, `text` z. B. „2 neue Kommentare" oder „Neuer Thread"
	- `threadPfad(t: Thread, slug: string): string` → `/glonntal/t/2-bowling` (Titel ohne Emoji, kleingeschrieben, Umlaute als `ae/oe/ue/ss`, Nicht-Alphanumerisches zu `-`)
	- `teilenText(stand, t: Thread, basisUrl: string, jetzt: Date): string` — Format nach Rahmen-Spec 6.7: Titelzeile fett mit „Stand <Wochentag> <HH:MM>", je Umfrage „✅ Dabei (n): Vornamen", „❌ Abgesagt (n): …", „❓ Offen (n): …", je Fahrgemeinschaft „🚗 Fahrer: Fam. <Nachname> (<frei> Platz/Plätze)", letzte Zeile „👉 Antworten: <basisUrl><threadPfad>"

- [ ] **Step 1: Tests schreiben** (Bezugstag `'2026-10-11'`, `jetzt = jetzt('2026-10-11', 10:00)`)

- `antwortZeilen` Bowling-Umfrage: für Sandra `[{label:'Lena', antwort.von === lena}, {label:'Max', antwort: undefined}]`; für Lena `[{label:'Lena'}]`; für Thomas `[{label:'Jonas'}]`; für Katrin `[]`.
- `antwortZeilen` Pizza-Umfrage (`person`) für Lena → `[{label:'Du'}]`.
- `brauchtAntwort(stand, P.sandra, jetzt)` enthält Bowling/Max (umfrage), Herbstfest/Du (helfer), Bowling-Kosten nur für Lena (Max hat noch nicht zugesagt); **nicht** Bowling/Lena-Umfrage. Für Lena: Pizza, **keine** Kosten. Mit `jetzt` nach der Bowling-Frist (2026-10-15) verschwindet Bowling/Max.
- `zusagen(bowling)` → `[lena]`; `zahlungspflichtig(bowling)` → `[lena]`; nach Antwort Max = Ja → `[lena, max]`, und `brauchtAntwort` für Sandra enthält dann Bowling-Kosten für Max. Für einen Thread ohne Teilnahme-Umfrage (Herbstfest) ist `zusagen` `null`.
- `mitfahrtOffen(bowling, hin)` → leer am Anfang (Lena sitzt; Max/Jonas haben nicht zugesagt); nach Max = Ja → `[max]`.
- `kostenStatus` wechselt `offen` → `gemeldet` → `bezahlt` bei gesetztem `status`.
- `istArchiviert(hegefischen, jetzt) === false`; `istArchiviert(hegefischen, jetzt + 3 Tage) === true`; Königsfischen manuell `true`; „Wichtige Infos" (Termin in 2 Tagen) `false`.
- `naechsteTermine(stand, P.sandra, jetzt, 3)[0]` ist die Gruppenstunde (in 2 Tagen).
- `termineImMonat(stand, P.thomas, 2026, 9)` enthält Bowling und Gruppenstunde.
- `threadPfad(bowling, 'glonntal') === '/glonntal/t/2-bowling'`; Titel „🍂 Herbstfest – Helfer" → `'/glonntal/t/3-herbstfest-helfer'`; „Königsfischen 2026" → `koenigsfischen-2026`.
- `teilenText(stand, bowling, 'https://x/entwurf', jetzt)` beginnt mit `🎳 *Bowling`, enthält `✅ Dabei (1): Lena`, `❓ Offen (`, `🚗 Fahrer: Fam. Maier (1 Platz)` und `🚗 Fahrer: Fam. Huber (2 Plätze)` und endet mit `👉 Antworten: https://x/entwurf/glonntal/t/2-bowling`.

- [ ] **Step 2: Tests laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren** in den vier Dateien.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Commit** — `Regeln: Antworten, Fahrgemeinschaft, Kosten, Termine, Teilen`

---

### Task 5: Gestaltung — Vereinsfarben, Tokens, Hell/Dunkel, Icons

**Files:**
- Create: `apps/entwurf/src/app/gestaltung/farben.ts`, `apps/entwurf/src/app/gestaltung/thema.ts`, `apps/entwurf/src/app/gestaltung/icon.ts`, `apps/entwurf/src/app/gestaltung/ui.ts`
- Modify: `apps/entwurf/src/styles.css`, `apps/entwurf/src/index.html` (`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `<meta name="color-scheme" content="light dark">`)
- Test: `apps/entwurf/src/app/gestaltung/farben.spec.ts`

**Interfaces:**
- Produces:
	- `kontrast(a: string, b: string): number` (WCAG-Kontrastverhältnis zweier Hex-Farben)
	- `interface Akzentsatz { akzent: string; akzentFlaeche: string; aufAkzent: string }`
	- `vereinsfarben(hex: string): { hell: Akzentsatz; dunkel: Akzentsatz }` — Flächen fest: hell `#eef5f4` Seite / `#ffffff` Karte, dunkel `#0e1716` Seite / `#172423` Karte; Akzent schrittweise abdunkeln (hell) bzw. aufhellen (dunkel), bis `kontrast(akzent, karte) ≥ 4.5`; `aufAkzent` ist `#ffffff` oder ein sehr dunkler Ton der Farbe, je nachdem was ≥ 4,5 erreicht; `akzentFlaeche` ist ein blasser (hell) bzw. tiefer (dunkel) Ton der Farbe.
	- `ThemaService` (`providedIn: 'root'`): Signale `wahl: 'hell' | 'dunkel' | 'system'`, `aktiv: 'hell' | 'dunkel'`; `setzeWahl(w)`; `setzeVereinsfarbe(hex)` schreibt `--akzent`, `--akzent-flaeche`, `--auf-akzent` für beide Modi als CSS-Variablen auf `document.documentElement`; setzt `data-theme` auf `<html>`; merkt die Wahl in `localStorage` unter `jufi-entwurf:thema` (in `try/catch`).
	- `IconComponent` (`<jf-icon name="…" />`), Größe `1em`, Lucide-Knoten wie `../hwyd/apps/hwyd/src/app/core/icon.ts`. Namen: `start, threads, termine, medien, mehr, teilen, zurueck, vor, schliessen, haken, kalender, ort, auto, euro, datei, foto, kopieren, glocke, plus, griff, warnung, info, nutzer, einstellungen, dokument`.
	- In `ui.ts`: `KarteComponent` (`<jf-karte>`), `PilleComponent` (`<jf-pille [art]="'ok'|'offen'|'neutral'">`), `AbschnittComponent` (`<jf-abschnitt titel="…">`, Versalien-Titel).
- `styles.css`: Tokens nach Spec 7 als Variablen auf `:root` (hell) und unter `@media (prefers-color-scheme: dark) { :root:not([data-theme='hell']) { … } }` sowie `:root[data-theme='dunkel'] { … }`; `body` mit expliziter Hintergrundfarbe; Systemschrift; `touch-action: manipulation`; Mindestgröße für `button, a` 44 px; `env(safe-area-inset-*)`-Variablen.

- [ ] **Step 1: Tests schreiben** — für `#0f766e`, `#ffff00`, `#000000`, `#ffffff`, `#e11d48`: in beiden Modi `kontrast(akzent, karte) ≥ 4.5` und `kontrast(aufAkzent, akzent) ≥ 4.5`; `kontrast('#000000', '#ffffff')` ≈ 21; `vereinsfarben('#0f766e').hell.akzent === '#0f766e'` (bereits ausreichend, unverändert).
- [ ] **Step 2: Tests laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren** (`farben.ts`, dann `thema.ts`, `icon.ts`, `ui.ts`, Stile). Abdunkeln/Aufhellen in HSL in 2-%-Schritten.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS; `pnpm nx build entwurf` ohne Warnung.
- [ ] **Step 5: Commit** — `Gestaltung: Vereinsfarben mit Kontrastpruefung, Tokens, hell und dunkel`

---

### Task 6: Store und Speicherung

**Files:**
- Create: `apps/entwurf/src/app/daten/speicher.ts`, `apps/entwurf/src/app/daten/store.ts`
- Test: `apps/entwurf/src/app/daten/speicher.spec.ts`, `apps/entwurf/src/app/daten/store.spec.ts`

**Interfaces:**
- Consumes: Task 2–4.
- Produces:
	- `interface Ablage { lesen(schluessel: string): string | null; schreiben(schluessel: string, wert: string): void }` und `browserAblage(): Ablage` (fängt Ausnahmen; fällt auf eine Speicher-Map zurück, wenn `localStorage` fehlt oder wirft)
	- `SCHLUESSEL = 'jufi-entwurf:v1'`
	- `interface Gespeichert { stand: Datenstand; testmodus: unknown }` — `testmodus` wird von Task 13 befüllt, der Store reicht es nur durch
	- `laden(ablage: Ablage, echt: Date): Gespeichert` — fehlend, unlesbar oder `stand.version !== 1` → frische `erzeugeBeispieldaten(bezugstagHeute(echt))`, `testmodus: null`
	- `speichern(ablage: Ablage, g: Gespeichert): void`
	- `EntwurfStore` (`providedIn: 'root'`, injiziert ein `ABLAGE`-Token mit Vorgabe `browserAblage()`):
		- Signale: `stand: Signal<Datenstand>`, `ich: WritableSignal<Id>` (Vorgabe `P.sandra`), `jetzt: Signal<Date>` (Bezugstag + echte Uhrzeit, minütlich aktualisiert), `testmodusDaten: WritableSignal<unknown>`
		- Aktionen (jede erzeugt einen neuen `Datenstand`, setzt `letzteAktivitaet` des Threads, speichert sofort):
			- `antworten(threadId, modulId, fuer: Id, optionen: Id[])` (`von` = `ich()`)
			- `helferEintragen(threadId, modulId, platzId, fuer: Id)` / `helferAustragen(…)` — wirft keinen Fehler bei vollem Platz, sondern gibt `false` zurück
			- `autoAnbieten(threadId, modulId, auto: Omit<Auto, 'id' | 'mitfahrer'>)`, `mitfahrerSetzen(threadId, modulId, kindId: Id, autoId: Id | null, richtung)` — entfernt das Kind aus anderen Autos derselben Richtung; gibt `false` bei vollem Auto zurück
			- `kostenSetzen(threadId, modulId, kindId, status: KostenStatus)`
			- `nachrichtSchreiben(threadId, text)`
			- `threadSpeichern(t: Thread)` (neu oder ersetzen; neue `nr` = max + 1), `threadArchivieren(threadId, archiviert: boolean)`
			- `personAnlegen(p: Omit<Person, 'id'>, kinder: Id[]): Id`, `rechteSetzen(personId, rechte: Recht[])` (respektiert `kannRechtEntziehen`), `fotoEinwilligungSetzen(kindId, wert)`
			- `vereinsfarbeSetzen(hex)`
			- `besuchMerken(personId)` setzt `letzterBesuch[personId]` auf `jetzt()`
			- `zuruecksetzen()` — neue Beispieldaten mit `bezugstagHeute(new Date())`, `testmodusDaten` auf `null`

- [ ] **Step 1: Tests schreiben**

`speicher.spec.ts`:
- leere Ablage → Beispieldaten mit Bezugstag des übergebenen Datums.
- Ablage mit `'{kaputt'` → Beispieldaten, kein Wurf.
- Ablage mit `{"stand":{"version":0}}` → Beispieldaten.
- Ablage, deren `schreiben` wirft → `speichern` wirft nicht.
- Rundreise: `speichern` dann `laden` liefert gleichen `stand.bezugstag`, auch wenn `echt` drei Wochen später liegt (eingefrorene Zeit).

`store.spec.ts` (mit Speicher-Ablage über `TestBed`-Provider):
- Als Sandra `antworten(bowling, bowlingUmfrage, max, ['ja'])` → Antwort mit `fuer: max`, `von: sandra`; danach als Lena erneut für Lena `['nein']` → genau eine Antwort für Lena (letzte gilt), `von: lena`.
- `helferEintragen` auf vollem Platz → `false`, Stand unverändert.
- `mitfahrerSetzen` für Max in Huber-hin, dann in Maier-hin → Max nur noch bei Maier; auf vollem Auto → `false`.
- `rechteSetzen(thomas, [])` lässt `rechteVerwalten` bei Thomas stehen.
- `jetzt()` hat das Datum des Bezugstags.
- Nach einer Aktion steht der neue Stand in der Ablage.

- [ ] **Step 2: Tests laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren**.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Commit** — `Store mit Signalen und robuster Speicherung`

---

### Task 7: Mitglieder-Hülle, Routing, Start und Thread-Liste

**Files:**
- Create: `apps/entwurf/src/app/mitglieder/huelle.ts`, `start.ts`, `threads.ts`, `nicht-gefunden.ts`
- Modify: `apps/entwurf/src/app/app.routes.ts`, `apps/entwurf/src/app/app.spec.ts`

**Interfaces:**
- Consumes: `EntwurfStore`, Regeln aus Task 3–4, UI aus Task 5.
- Produces: Routen
	- `''` → Umleitung `glonntal`
	- `glonntal` (Hülle `MitgliederHuelle`, Kinder): `''` Start, `threads`, `t/:nrSlug` (Task 8), `termine`, `medien`, `dokumente`, `mehr` (Task 11)
	- `glonntal/verwaltung` (Task 12)
	- `**` → `NichtGefunden`
	- Die Route `t/:nrSlug` zeigt bis Task 8 einen Platzhalter.
- Hülle: Kopf mit Vereinslogo und -name; Inhalt in einer Spalte max. 480 px, am Desktop mittig; untere Leiste mit 5 Einträgen (Icons `start, threads, termine, medien, mehr`), aktiver Eintrag in Akzentfarbe; Platz oben für das Aufgabenband (CSS-Variable `--band-hoehe`, Vorgabe `0px`, Task 13 setzt sie) und unten für den Testmodus-Knopf.
- Start (Spec 4.1, Stil wie Mockup A): Begrüßung „Hallo <Vorname>"; Abschnitt „Braucht deine Antwort · n" aus `brauchtAntwort` mit Knopf je Eintrag (Link `…/t/<nr>-<slug>/m/<modulId>`); „Als Nächstes" aus `naechsteTermine(…, 3)` mit Datumsblock; „Neu seit deinem letzten Besuch" aus `neuigkeiten`. Beim Verlassen der Startseite `besuchMerken`.
- Threads: Abschnitte „Angepinnt", „Aktiv" (nach `letzteAktivitaet` absteigend), „Archiv" (eingeklappt) — Archiv über `istArchiviert(t, jetzt())`; nur `siehtThread`.

- [ ] **Step 1: Test** in `app.spec.ts`: `RouterTestingHarness` auf `/glonntal` zeigt „Hallo Sandra" und „Max" im Abschnitt „Braucht deine Antwort"; `/glonntal/threads` listet „Bowling", aber nicht „Fischerprüfung"; `/irgendwas` zeigt „Nicht gefunden".
- [ ] **Step 2: Test laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren**.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Im Browser prüfen** — `preview_start` mit `entwurf`, Gerätemaß 375 × 812, hell und dunkel: keine waagrechte Scrollbarkeit (`document.documentElement.scrollWidth <= 375`), Leisten-Einträge ≥ 44 px hoch (`getBoundingClientRect`).
- [ ] **Step 6: Commit** — `Mitglieder-Huelle mit Start und Thread-Liste`

---

### Task 8: Thread-Seite mit Anzeige-Modulen und Verlauf

**Files:**
- Create: `apps/entwurf/src/app/mitglieder/thread.ts`, `apps/entwurf/src/app/daten/ereignisse.ts`, `apps/entwurf/src/app/module/modul.ts`, `info.ts`, `termin.ts`, `dateien.ts`, `fotos.ts`, `verlauf.ts`
- Test: `apps/entwurf/src/app/mitglieder/thread.spec.ts`

**Interfaces:**
- Consumes: Store, Regeln, `threadZuNr`, `threadPfad`, `teilenText`.
- Produces:
	- `nrAusSegment(seg: string): number | null`
	- `ThreadSeite` für Route `t/:nrSlug` und `t/:nrSlug/m/:modulId` (scrollt zum Modul und hebt es kurz hervor)
	- `ModulWeiche` (`<jf-modul [thread] [modul] [vorschau]="false">`) — `@switch` auf `modul.typ`; Typen ohne Bauteil (bis Task 9/10) zeigen den Typnamen. `vorschau: true` macht alles nur lesend (für den Editor in Task 12).
	- Ereignis-Schnittstelle für den Testmodus: `TESTEREIGNISSE` (Injection-Token, `Subject<Testereignis>`) mit `type Testereignis = { art: 'dokumentGeoeffnet'; id: Id } | { art: 'fotoGeoeffnet'; threadId: Id; fotoId: Id } | { art: 'geteilt'; threadId: Id } | { art: 'einladungErzeugt'; personId: Id }` — angelegt in `apps/entwurf/src/app/daten/ereignisse.ts`; Bauteile senden, Task 13 hört zu.
- Kopf: Zurück, Titel, Zielgruppe in Worten („Alle · Jungfischer + Eltern"), Teilen-Knopf (Icon `teilen`). Teilen: `navigator.share({ text })`, sonst `navigator.clipboard.writeText` mit Meldung „Text kopiert"; sendet `geteilt`. `basisUrl` = `location.origin + '/entwurf'`.
- Reiter „Übersicht" | „Verlauf" (Zähler = Einträge nach `letzterBesuch`); im Modus `aushang` kein Verlauf-Reiter. Reiterwahl als Query-Parameter `?reiter=verlauf`, damit Deep Links funktionieren.
- Nicht sichtbar oder unbekannt → Inhalt von `NichtGefunden` mit Text „Nicht gefunden oder keine Berechtigung".
- Module: Info (Text mit Absätzen), Termin (Datum, Uhrzeit, Ort als Link `https://www.google.com/maps/search/?api=1&query=<ort>`, Treffpunkt), Dateien (Tippen → Meldung „Im Entwurf nicht herunterladbar"), Fotos (Raster 3 Spalten, Großansicht als Überlagerung mit Schließen/Escape, sendet `fotoGeoeffnet`; Knopf „Foto hinzufügen" → Meldung „Im Entwurf nicht möglich"), Verlauf (Liste; Absender mit Zusatz „(Jugendleiter)" bzw. „(Mama/Papa von …)"; Eingabefeld nur bei `kommentare`/`chat`, unten fixiert, `nachrichtSchreiben`).

- [ ] **Step 1: Tests schreiben** — `nrAusSegment('2-bowling') === 2`, `nrAusSegment('x') === null`; Harness als Sandra auf `/glonntal/t/6-fischerpruefung-2027` zeigt „Nicht gefunden oder keine Berechtigung"; auf `/glonntal/t/2-bowling` zeigt „Übersicht" und „Verlauf"; auf `/glonntal/t/1-wichtige-infos` keinen Reiter „Verlauf".
- [ ] **Step 2: Tests laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren**.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Im Browser prüfen** — 375 × 812 hell/dunkel; Deep Link `/entwurf/glonntal/t/2-bowling?reiter=verlauf` öffnet den Verlauf; Fotogroßansicht schließt mit Escape; Eingabefeld verdeckt keine letzte Nachricht.
- [ ] **Step 6: Commit** — `Thread-Seite mit Reitern, Anzeige-Modulen, Verlauf und Teilen`

---

### Task 9: Bedienbare Module Umfrage und Helferliste

**Files:**
- Create: `apps/entwurf/src/app/module/umfrage.ts`, `apps/entwurf/src/app/module/helfer.ts`
- Modify: `apps/entwurf/src/app/module/modul.ts`
- Test: `apps/entwurf/src/app/module/umfrage.spec.ts`

**Interfaces:**
- Consumes: `antwortZeilen`, `darf`, Store-Aktionen `antworten`, `helferEintragen`, `helferAustragen`.
- Umfrage: Kopf „<Frage> · Frist <Wochentag HH:MM>"; je `AntwortZeile` eine Zeile mit Label und entweder gewählter Antwort als Pille („✓ Dabei") plus „ändern" oder Knöpfen der Optionen; wenn `von !== fuer`, darunter „von dir eingetragen" (wenn `von === ich`) bzw. „eingetragen von <Vorname>"; nach Frist nur Anzeige mit Hinweis „Frist abgelaufen". Ergebnisse: `alle` → Summen und Namen, `summe` → nur Summen, `jugendleiter` → Summen nur für Personen mit `antwortenDetail`, sonst nichts; Namen immer für `antwortenDetail`.
- Helferliste: je Platz „<Text> n/m" mit Balken; Knopf „Eintragen" (für jede Zeile aus `antwortZeilen`) bzw. „Austragen"; voller Platz → Knopf deaktiviert mit „voll".

- [ ] **Step 1: Test schreiben** — Bauteil als Sandra in Bowling: zwei Zeilen „Lena" und „Max"; bei Lena steht „✓" und kein „eingetragen von"; Klick auf „Ja" bei Max → Store enthält Antwort `fuer: max, von: sandra` und die Zeile Max zeigt „von dir eingetragen".
- [ ] **Step 2: Test laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren** beide Module, in der Weiche verdrahten.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Im Browser prüfen** — Sandra: Max zusagen → „Braucht deine Antwort" auf Start verliert Max-Bowling; Kuchen eintragen → 4/5.
- [ ] **Step 6: Commit** — `Module: Umfrage und Helferliste bedienbar`

---

### Task 10: Bedienbare Module Fahrgemeinschaft und Kosten

**Files:**
- Create: `apps/entwurf/src/app/module/fahrt.ts`, `apps/entwurf/src/app/module/kosten.ts`
- Modify: `apps/entwurf/src/app/module/modul.ts`
- Test: `apps/entwurf/src/app/module/fahrt.spec.ts`

**Interfaces:**
- Consumes: `mitfahrtOffen`, `freiePlaetze`, `zahlungspflichtig`, `kostenStatus`, `kinderVon`, `darf`; Store-Aktionen `autoAnbieten`, `mitfahrerSetzen`, `kostenSetzen`.
- Fahrgemeinschaft (Rahmen 6.4.1): Umschalter „Hinfahrt | Rückfahrt"; je Auto „Fam. <Nachname> · Abfahrt HH:MM <Ort> · n frei", Mitfahrer als Vornamen; für Eltern Knopf „<Kind> hier mitfahren lassen" je eigenem Kind ohne Platz, für Jungfischer mit Zugang „Ich fahre hier mit"; „Braucht noch Mitfahrt" als Liste; Erwachsene: „Auto anbieten" (kleines Formular: Richtung, Plätze, Abfahrt, Ort). Jugendleiter mit `alleThreads`: je Mitfahrer Menü „In anderes Auto" mit Liste der Autos. Keine Telefonnummern.
- Kosten (Rahmen 6.4.2): Betrag, Hinweis, IBAN/PayPal falls gesetzt, Kopier-Knopf mit Verwendungszweck `"<Thread-Titel ohne Emoji> <TT.MM.> – <Vorname> <Nachname>"`; Eltern: je zahlungspflichtigem eigenem Kind Status-Pille und Knopf „Habe bezahlt" (→ `gemeldet`); Personen mit `antwortenDetail`: Liste aller Zahlungspflichtigen mit Status und Knöpfen „Bestätigen" (→ `bezahlt`) bzw. „Zurücksetzen".

- [ ] **Step 1: Test schreiben** — als Thomas in Bowling-Fahrt: nach `mitfahrerSetzen` Max→Maier-hin zeigt das Maier-Auto „Max"; über „In anderes Auto" → Huber-hin zeigt Huber „Max", Maier nicht mehr. Als Sandra in Kosten nach Max-Zusage: Knopf „Habe bezahlt" bei Lena setzt `gemeldet`.
- [ ] **Step 2: Test laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren**.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Im Browser prüfen** — Kopier-Knopf legt den Verwendungszweck in die Zwischenablage; Hin/Rück-Umschalter ≥ 44 px.
- [ ] **Step 6: Commit** — `Module: Fahrgemeinschaft und Kosten bedienbar`

---

### Task 11: Termine, Medien, Dokumente, Mehr

**Files:**
- Create: `apps/entwurf/src/app/mitglieder/termine.ts`, `medien.ts`, `dokumente.ts`, `mehr.ts`
- Test: `apps/entwurf/src/app/mitglieder/termine.spec.ts`

**Interfaces:**
- Consumes: `termineImMonat`, `termineVon`, `siehtThread`, `kinderVon`, `ThemaService`, Store, `TESTEREIGNISSE`.
- Produces: `monatsRaster(jahr: number, monat: number): (number | null)[]` (Wochen ab Montag, 42 Felder) in `termine.ts`.
- Termine: Monatskalender mit Vor/Zurück, Markierung an Tagen mit Termin, heutiger Tag (= Bezugstag) umrandet; darunter Liste des Monats, Tippen → Thread.
- Medien: je sichtbarem Thread mit Foto- oder Datei-Modul ein Abschnitt; Fotos öffnen die Großansicht aus Task 8 (gemeinsames Bauteil), Dateien wie dort.
- Dokumente: nach Kategorie; Tippen → Meldung „Im Entwurf nicht herunterladbar" und Ereignis `dokumentGeoeffnet`; Schalter „Offline verfügbar" je Dokument (nur Zustand im Bauteil, mit Hinweis).
- Mehr: Profil (Name, Rolle in Worten); „Meine Kinder" mit Foto-Einwilligung (Schalter → `fotoEinwilligungSetzen`) und „Zugang für <Kind> erzeugen" (zeigt einen Beispiel-Link mit WhatsApp-Text, Ereignis `einladungErzeugt`); Benachrichtigungen: je sichtbarem Thread Glocke Alles/Nur Wichtiges/Stumm (Zustand nur im Bauteil); Darstellung Hell/Dunkel/System (`ThemaService.setzeWahl`); „Offline gespeichert" (Liste der umgeschalteten Dokumente); Installationshinweis für iOS und Android (statischer Text).

- [ ] **Step 1: Test schreiben** — `monatsRaster(2026, 9)` hat 42 Felder, Feld 0–2 `null` (1.10.2026 ist Donnerstag), Feld 3 = 1, letztes gefülltes Feld 31.
- [ ] **Step 2: Test laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren**.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Im Browser prüfen** — Umschalten Dunkel/Hell wirkt sofort und übersteht Neuladen; Kalender passt in 375 px.
- [ ] **Step 6: Commit** — `Termine, Medien, Dokumente und Mehr`

---

### Task 12: Verwaltung

**Files:**
- Create: `apps/entwurf/src/app/verwaltung/huelle.ts`, `threads.ts`, `editor.ts`, `antworten.ts`, `personen.ts`, `einladung.ts`, `rechte.ts`, `ansichten.ts`, `einstellungen.ts`
- Modify: `apps/entwurf/src/app/app.routes.ts`
- Test: `apps/entwurf/src/app/verwaltung/editor.spec.ts`

**Interfaces:**
- Consumes: Store-Aktionen `threadSpeichern`, `threadArchivieren`, `personAnlegen`, `rechteSetzen`, `vereinsfarbeSetzen`; `ROLLEN_VORLAGEN`, `kannRechtEntziehen`, `ModulWeiche` mit `vorschau`, `teilenText`, `TESTEREIGNISSE`.
- Produces: Routen unter `glonntal/verwaltung`: `''` (Übersicht), `threads`, `threads/neu`, `threads/:nr`, `threads/:nr/antworten`, `termine`, `personen`, `personen/:id`, `untergruppen`, `rechte`, `dokumente`, `einstellungen`. Zugriff nur mit `istJugendleiter(ich)`, sonst `NichtGefunden`. Exportiert `leererThread(ich: Id): Thread` aus `editor.ts`.
- Hülle: Seitenleiste nach Mockup (Spec 4.3); unter 768 px Breite wird sie zur Kopfzeile mit Menü und zeigt den Hinweis „Am Desktop bequemer".
- Threads: Tabelle (Titel, Zielgruppe, Modus, letzte Aktivität, Status aktiv/Archiv), Knöpfe „Neuer Thread", „Bearbeiten", „Antworten", „Archivieren".
- Editor: links Formular — Titel, Zielgruppe (Untergruppen-Auswahl + Rollenfilter), Modus, „Mitglieder benachrichtigen" (nur Anzeige), Modulliste mit Hoch/Runter-Knöpfen (statt Ziehen; reicht für den Entwurf) und Entfernen, „Modul hinzufügen" mit Auswahl der 8 Typen; Formular für das gewählte Modul: Info (Text), Termin (Datum, Beginn, Ende, Ort, Treffpunkt), Umfrage (Frage, Optionen Ja/Nein, Ja/Nein/Vielleicht oder eigene, Einheit, Frist, Ergebnisse, „ist Teilnahme-Umfrage"); übrige Typen mit Grundeinstellungen. Rechts Handy-Vorschau (`ModulWeiche` mit `vorschau: true` in einem 300-px-Rahmen), gewähltes Modul umrandet. Knöpfe „Entwurf speichern" (`veroeffentlicht: false`) und „Veröffentlichen".
- Antworten: je Umfrage Tabelle Kind/Person → Antwort → eingetragen von; Abschnitt „Fehlt noch"; Knopf „Stand teilen" (wie Thread-Teilen, Ereignis `geteilt`).
- Personen: Liste mit Filter Jungfischer/Erwachsene; Detail mit Eltern-Kind-Zuordnung (Anzeige); „Person anlegen" (Vorname, Nachname, Art, Kinder zuordnen) → danach „Einladungslink erzeugen": Link `https://jufi-app.de/glonntal/einladung/<zufall>` plus WhatsApp-Text, Knopf „Teilen/Kopieren", Ereignis `einladungErzeugt`; Knopf „So sieht die Einladung aus" öffnet `einladung.ts` als Überlagerung mit vier Schritten (Willkommen → Passkey einrichten, simuliert → Einwilligung für Kinder mit Häkchen → fertig).
- Rechte: je Jugendleiter Vorlage-Auswahl und 7 Häkchen; ein nicht entziehbares Häkchen ist deaktiviert mit Erklärung „Mindestens eine Person muss Rechte verwalten können".
- Ansichten (`ansichten.ts`): Untergruppen, Termine, globale Dokumente als Listen mit Beispieldaten, Knöpfe zeigen „Im Entwurf nicht möglich".
- Einstellungen: Vereinsname (nur Anzeige), Logo (Platzhalter), Farbwähler `<input type="color">` → `vereinsfarbeSetzen` und `ThemaService.setzeVereinsfarbe`; die App-Hülle ruft `setzeVereinsfarbe(stand().verein.farbe)` in einem `effect`, damit die Farbe auch nach Neuladen gilt.

- [ ] **Step 1: Test schreiben** — Editor als Thomas: Titel „🎄 Weihnachtsfeier", Termin- und Umfrage-Modul hinzufügen, „Veröffentlichen" → Store enthält veröffentlichten Thread mit `nr === 9`, Titel enthält „Weihnachtsfeier", Module `['termin', 'umfrage']`; als Sandra liefert `siehtThread` dafür `true` (Zielgruppe Vorgabe „Alle · Jungfischer + Eltern"). Harness als Sandra auf `/glonntal/verwaltung` zeigt „Nicht gefunden".
- [ ] **Step 2: Test laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren**.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Im Browser prüfen** — 1280 × 800 hell/dunkel: Editor und Vorschau nebeneinander ohne waagrechte Scrollbarkeit; Vereinsfarbe `#e11d48` färbt Mitglieder-Hülle und Verwaltung sofort um.
- [ ] **Step 6: Commit** — `Verwaltung: Thread-Editor mit Vorschau, Antworten, Personen, Rechte, Einstellungen`

---

### Task 13: Testmodus — Einstieg, Knopf, Band, Aufgaben und Prüfregeln

**Files:**
- Create: `apps/entwurf/src/app/testmodus/typen.ts`, `aufgaben.ts`, `pruefung.ts`, `testmodus.ts`, `einstieg.ts`, `band.ts`, `knopf.ts`, `bewertung.ts`
- Modify: `apps/entwurf/src/app/app.ts` (Band und Knopf einhängen), `apps/entwurf/src/app/app.routes.ts` (Route `glonntal/willkommen`)
- Test: `apps/entwurf/src/app/testmodus/pruefung.spec.ts`

**Interfaces:**
- Consumes: Store (`ich`, `stand`, `testmodusDaten`, `zuruecksetzen`), `TESTEREIGNISSE`, Regeln, `naechsteTermine`.
- Produces (`typen.ts`):

```ts
export type PersonKey = 'sandra' | 'lena' | 'thomas';
export interface Handlung { art: 'handlung'; text: string; erfuellt: (s: Datenstand, ereignisse: Testereignis[]) => boolean; }
export interface Suche { art: 'suche'; text: string; antworten: (s: Datenstand) => { richtig: string; falsch: [string, string] }; }
export type Aufgabe = (Handlung | Suche) & { id: string; kurz: string };
export interface Ergebnis { aufgabeId: string; ausgang: 'geschafft' | 'nichtWeiter' | 'uebersprungen'; dauerSek: number; smiley?: 'gut' | 'mittel' | 'schlecht'; notiz?: string; fehlversuche: number; }
export interface SeitenNotiz { pfad: string; text: string; }
export interface TestmodusStand { person: PersonKey | null; mitAufgaben: boolean; index: Record<PersonKey, number>; ergebnisse: Record<PersonKey, Ergebnis[]>; ereignisse: Testereignis[]; seitenNotizen: SeitenNotiz[]; wunsch?: string; gestartetUm?: string; }
```

- Produces (`aufgaben.ts`): `AUFGABEN: Record<PersonKey, Aufgabe[]>` — die 15 Aufgaben aus Spec 5.3 mit Texten wörtlich aus der Spec, `kurz` als Rückmeldungs-Kurztitel (z. B. „Max fürs Bowling"). Suchaufgaben: Sandra 5 richtig = `"<Wochentag> <HH:MM> · <Ort>"` der nächsten Gruppenstunde aus `naechsteTermine`, falsch = zwei Varianten mit anderem Wochentag bzw. Ort; Lena 2 richtig = `"Familie <Nachname>"` des Autos, in dem Lena hin sitzt, falsch = die zwei anderen Familiennamen aus den Beispieldaten.
- Produces (`pruefung.ts`): `istErfuellt(a: Aufgabe, s: Datenstand, e: Testereignis[]): boolean` (bei Suche immer `false` — wird über die Antwortwahl erledigt), `PERSON_ID: Record<PersonKey, Id>`.
- `TestmodusService` (`providedIn: 'root'`): Signal `zustand: Signal<TestmodusStand>`; `waehlePerson(k, mitAufgaben)` (setzt `store.ich`), `aktuelleAufgabe: Signal<Aufgabe | null>`, `nichtWeiter(notiz?)`, `ueberspringen()`, `sucheBeantworten(text): boolean`, `bewerten(smiley, notiz?)`, `seitenNotiz(pfad, text)`, `wunschSetzen(text)`, `allesZuruecksetzen()`. Nach jeder Store-Änderung bzw. jedem Ereignis prüft ein `effect` `istErfuellt`; erfüllt → Bewertungsdialog. Dauer = Sekunden seit Anzeige der Aufgabe. Zustand liegt in `store.testmodusDaten` (wird mitgespeichert).
- Einstieg (`glonntal/willkommen`, Startziel wenn `person === null`): Begrüßung (Spec 5.1), drei Personenkarten, Wahl „Mit Aufgaben" / „Frei umsehen". Thomas startet in `glonntal/verwaltung`, die anderen auf `glonntal`.
- Band (Spec 5.2): oben fixiert, Signalfarbe Violett `#6d28d9` (bewusst kein Token der App), Text „Aufgabe n von m: …", Knöpfe „Ich komme nicht weiter" und „Überspringen"; bei Suche zusätzlich „Ich hab's" → drei Antworten in zufälliger Reihenfolge; setzt `--band-hoehe`.
- Knopf: schwebend unten links über der Leiste, Violett; Menü: Person wechseln, Aufgabenliste (mit Haken), Rückmeldung senden, Rückmeldung zu dieser Seite, Entwurf zurücksetzen (mit Rückfrage).
- Bewertung: „Geschafft! Wie leicht war das?" mit 😀 😐 😟 und optionalem Feld „Was war unklar?"; „Ich komme nicht weiter" fragt optional „Wo hängst du?". Nach der letzten Aufgabe einer Person öffnet sich die Rückmeldung (Task 14).

- [ ] **Step 1: Tests schreiben** — für jede der 13 Handlungsaufgaben: `istErfuellt` ist auf frischen Beispieldaten `false` und nach der passenden Store-Aktion bzw. dem passenden Ereignis `true` (Thomas 1 über `threadSpeichern` mit Termin + Umfrage, Thomas 2 über Ereignis `geteilt` für Bowling, Thomas 4 über `personAnlegen` + Ereignis `einladungErzeugt`, Thomas 5 über `mitfahrerSetzen` Max→Huber; Lena 3 über `fotoGeoeffnet` in Hegefischen; Sandra 6 über `dokumentGeoeffnet` der Jugendfischereiordnung). Für die zwei Suchaufgaben: `richtig` bei Bezugstag `'2026-10-11'` ist `"Dienstag 18:00 · Vereinsheim"` bzw. `"Familie Maier"` (Uhrzeit und Ort der Gruppenstunde in Task 2 auf diese Werte festlegen), und `richtig` kommt in `falsch` nicht vor.
- [ ] **Step 2: Tests laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren**.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Im Browser prüfen** — Band verdeckt bei 375 × 812 weder Kopf noch ersten Inhalt (`band.bottom <= kopf.top`); Knopf verdeckt keinen Leisten-Eintrag; Personenwechsel behält Max-Zusage.
- [ ] **Step 6: Commit** — `Testmodus: Einstieg, Aufgabenband, 15 Aufgaben mit Pruefregeln`

---

### Task 14: Rückmeldung und Versand

**Files:**
- Create: `apps/entwurf/src/app/testmodus/rueckmeldung.ts` (Text und Dialog), `apps/entwurf/src/app/testmodus/versand.ts`
- Test: `apps/entwurf/src/app/testmodus/rueckmeldung.spec.ts`

**Interfaces:**
- Consumes: `TestmodusStand`, `AUFGABEN`, `WHATSAPP_NUMMER`.
- Produces:
	- `geraeteZeile(userAgent: string, dunkel: boolean): string` → z. B. `"iPhone · Safari · dunkel"`, `"Android · Chrome · hell"`, `"Mac · Firefox · hell"`, Unbekanntes als `"Gerät unbekannt"`
	- `rueckmeldungText(z: TestmodusStand, geraet: string): string` — Format exakt nach Spec 5.5: Kopf `📝 *JuFi-Entwurf – Rückmeldung*`, `Gerät: …`, je Person mit Ergebnissen `*<Name>*` und je Ergebnis `<nr> <✅|❌ nicht weiter|⏭ übersprungen> [<😀|😐|😟>] <m:ss> <kurz>[ – „<notiz>"]`, je Seitennotiz `📍 <pfad>: „<text>"`, zuletzt `💬 Sonst noch: „<wunsch>"` falls gesetzt
	- `whatsappUrl(nummer: string, text: string): string` → `https://wa.me/<nummer>?text=<encodeURIComponent(text)>`
	- `versenden(text: string): Promise<'whatsapp' | 'geteilt' | 'kopiert'>` — mit Nummer: `window.open(whatsappUrl(...), '_blank')`; ohne: `navigator.share`, sonst `clipboard.writeText`
	- Dialog: Vorschau des Texts, Feld „Was würdest du dir noch wünschen?", Knopf „An Florian schicken" → `versenden`, Erfolgsmeldung je Ergebnis

- [ ] **Step 1: Tests schreiben**
	- `rueckmeldungText` mit zwei Sandra-Ergebnissen (geschafft 😀 42 s; nichtWeiter 130 s mit Notiz) und einer Seitennotiz ergibt exakt die Zeilen `1 ✅ 😀 0:42 Max fürs Bowling`, `2 ❌ nicht weiter 2:10 Kuchen eintragen – „…"` und `📍 /glonntal/t/2-bowling: „…"`.
	- `geraeteZeile` für einen iPhone-Safari-UA mit `dunkel = true` → `"iPhone · Safari · dunkel"`.
	- Rundreise: Für einen Text mit `ä ö ü ß 🎳 „Zitat" & # ? \n` gilt `new URL(whatsappUrl('491701234567', text)).searchParams.get('text') === text`.
- [ ] **Step 2: Tests laufen lassen** — Expected: FAIL.
- [ ] **Step 3: Implementieren**; Knopf im Testmodus-Menü und die automatische Anzeige nach der letzten Aufgabe verdrahten; „Rückmeldung zu dieser Seite" nimmt `router.url` ohne `/entwurf`.
- [ ] **Step 4: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 5: Commit** — `Rueckmeldung als WhatsApp-Text mit Versand`

---

### Task 15: Teilen-Text gegen Sonderzeichen absichern

**Files:**
- Modify: `apps/entwurf/src/app/regeln/teilen.spec.ts`

**Interfaces:**
- Consumes: `teilenText` (Task 4).

- [ ] **Step 1: Test schreiben** — Thread-Titel `'🎳 Bowling & Pizza #1 „Spezial"'`, Vorname `'Zoë'`: `threadPfad` liefert `'/glonntal/t/2-bowling-pizza-1-spezial'`; `teilenText` enthält den Titel unverändert und `Zoë`; nach `encodeURIComponent`/`decodeURIComponent` identisch.
- [ ] **Step 2: Test laufen lassen** — Expected: PASS oder FAIL; bei FAIL `threadPfad` korrigieren (Diakritika über `normalize('NFD')` entfernen, `ß` → `ss`).
- [ ] **Step 3: Tests laufen lassen** — Expected: PASS.
- [ ] **Step 4: Commit** — `Teilen-Text und Pfade mit Sonderzeichen abgesichert`

---

### Task 16: Auslieferung

**Files:**
- Create: `Dockerfile.entwurf`, `deploy/nginx-entwurf.conf`, `deploy/jufi-entwurf.yml`, `deploy/env.deploy.example`, `tools/deploy-entwurf.sh`, `README.md` (ersetzen)

**Interfaces:**
- Consumes: `pnpm nx build entwurf`, `tools/entwurf-konfig.mjs`.

- [ ] **Step 1: Dateien schreiben**
	- `Dockerfile.entwurf`: `FROM nginx:alpine`, kopiert `dist/apps/entwurf/browser` nach `/usr/share/nginx/html/entwurf` und `deploy/nginx-entwurf.conf` nach `/etc/nginx/conf.d/default.conf`; `LABEL org.opencontainers.image.revision`; gebaut wird lokal nach dem Angular-Build (kein Node im Image).
	- `nginx-entwurf.conf`: `location = / { return 302 /entwurf/; }`; `location /entwurf/ { try_files $uri $uri/ /entwurf/index.html; }`; `index.html` mit `Cache-Control: no-cache`; Dateien mit Hash im Namen `max-age=31536000, immutable`; Sicherheits-Header `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`.
	- `deploy/jufi-entwurf.yml`: Dienst `jufi-entwurf`, `image: sideshowsystems/jufi-entwurf:${JUFI_ENTWURF_TAG:-latest}`, `restart: unless-stopped`, `mem_limit: 32m`, kein `ports:`, Traefik-Labels: Router `jufi-entwurf`, Regel ``Host(`jufi-app.sideshow-systems.de`)`` (der Wurzelpfad gehört bis Teilprojekt 2 ebenfalls dem Entwurf, nginx leitet auf `/entwurf/`), `entrypoints=websecure`, `tls.certresolver=letsencrypt`, Port 80, Kompression wie HWYD. Kopfkommentar: Block gehört in `/home/paperless/paperless-ngx/docker-compose.yml`; nur `docker compose up -d jufi-entwurf`, nie blankes `up -d`. Abweichung von Spec 8.3 (`PathPrefix`) begründet: bis Teilprojekt 2 gibt es unter dieser Domain nichts anderes, und die Umleitung von `/` braucht den Wurzelpfad.
	- `deploy/env.deploy.example`: `SSH_TARGET`, `SSH_KEY`, `REMOTE_DIR=/home/paperless/paperless-ngx`, `JUFI_ENTWURF_WHATSAPP=` (leer).
	- `tools/deploy-entwurf.sh` (`set -euo pipefail`, nach Muster `../hwyd/tools/deploy.sh --transfer`): Tor 1 sauberes Arbeitsverzeichnis; Tor 2 `pnpm exec prettier --check .`, `pnpm nx test entwurf --watch=false`, `pnpm nx typecheck entwurf`; Tor 3 `JUFI_ENTWURF_WHATSAPP` aus `.env.deploy` exportieren, `pnpm nx build entwurf`, `docker build -f Dockerfile.entwurf -t sideshowsystems/jufi-entwurf:<sha> -t …:latest .`; Tor 4 Rauchtest: Container lokal auf Port 8089 starten, `curl -fsS localhost:8089/entwurf/` enthält `<base href="/entwurf/">`, `curl -fsS localhost:8089/entwurf/glonntal/t/2-bowling` liefert ebenfalls `index.html`, Container entfernen; `--dry-run` endet hier; Tor 5 `docker save … | ssh … docker load`, `ssh … "cd $REMOTE_DIR && JUFI_ENTWURF_TAG=<sha> docker compose up -d jufi-entwurf"`; Tor 6 `curl -fsS https://jufi-app.sideshow-systems.de/entwurf/` antwortet 200.
	- `README.md`: Zweck, `pnpm install`, `pnpm run dev:entwurf` (http://localhost:4300/entwurf/), Tests, Deploy mit Voraussetzungen (siehe Step 3).

- [ ] **Step 2: Trockenlauf**

Run: `bash tools/deploy-entwurf.sh --dry-run`
Expected: Tore 1–4 grün, Rauchtest bestanden, keine Übertragung.

- [ ] **Step 3: Commit** — `Auslieferung des Entwurfs als nginx-Image mit Deploy-Skript`

- [ ] **Step 4: Übergabe an den Eigentümer (nicht selbst ausführen)**

Dem Eigentümer melden, was vor dem ersten echten Deploy nötig ist: DNS-Eintrag `jufi-app.sideshow-systems.de` auf den Server, Block aus `deploy/jufi-entwurf.yml` in die Server-Compose-Datei, `.env.deploy` mit seiner WhatsApp-Nummer. Deploy erst auf seine ausdrückliche Ansage.

---

### Task 17: Abnahme im Browser

**Files:**
- Modify: nur bei Befunden die betroffenen Bauteile

- [ ] **Step 1: Alle 15 Aufgaben durchspielen** — mit frischem Stand (`Entwurf zurücksetzen`): Sandra 1–6, Lena 1–4, Thomas 1–5 in dieser Reihenfolge, je in hell und dunkel mindestens einmal; jede Prüfregel muss den Bewertungsdialog auslösen, beide Suchaufgaben müssen mit der richtigen Antwort gelingen und mit einer falschen „Nicht ganz, schau nochmal" zeigen.
- [ ] **Step 2: Messen** — bei 375 × 812 auf Start, Thread Bowling (beide Reiter), Termine, Mehr: `document.documentElement.scrollWidth <= 375`; alle `button` und `a` mit `getBoundingClientRect().height >= 44`, ausgenommen Inline-Links in Fließtext; Band und Knopf überlappen keine Bedienelemente. Bei 1280 × 800 Editor und Vorschau nebeneinander.
- [ ] **Step 3: Review-Focus prüfen** — `localStorage.setItem('jufi-entwurf:v1', '{kaputt')` und neu laden → Entwurf startet; Deep Link als Sandra auf `/entwurf/glonntal/t/6-fischerpruefung-2027` → „Nicht gefunden oder keine Berechtigung"; Vereinsfarbe `#ffff00` → Knöpfe lesbar in hell und dunkel.
- [ ] **Step 4: Rückmeldung erzeugen** — Text in der Vorschau prüfen (Format Spec 5.5); tatsächlicher Versand an die echte Nummer erst nach dem Deploy durch den Eigentümer.
- [ ] **Step 5: Befunde beheben, Tests und Prettier grün, Commit** — `Abnahme Entwurf: Befunde behoben`
