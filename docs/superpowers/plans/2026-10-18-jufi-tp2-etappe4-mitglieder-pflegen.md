# JuFi TP2 Etappe 4 — Mitglieder pflegen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jugendleiter legen Personen an, verknüpfen Familien, pflegen Untergruppen, Jugendsprecher und Rechte und entfernen Mitglieder; Erziehungsberechtigte erteilen und widerrufen die Einwilligung (Art. 8 DSGVO) und steuern den Zugang ihrer Kinder.

**Architecture:** Alle Regeln (Rechte, Sichtbarkeit, Volljährigkeit, Einwilligung, Warnhinweise) sind reine Funktionen in `libs/domain`; die Endpunkte unter `/<slug>/api/v1` rufen sie und schreiben ausschließlich über `vereinDb`. Jede Entscheidung „angenommen oder nicht" beginnt mit `sperreVereinszeile`. Die Oberfläche bleibt schlicht (Seiten ohne Hülle, die Hüllen baut Etappe 5) und blendet nur zusätzlich aus, was der Server ohnehin verweigert.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (zoneless, Signale, OnPush, inline Vorlagen), Express/`@angular/ssr`, Prisma 7, Postgres 17, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md` — Abschnitt 3 (Datenmodell), 4.1, 4.2 (Einwilligung), 4.6 (Zugang entziehen), 5 (Mitglieder pflegen), 6.2/6.3 (nur „Meine Jungfischer" und die Verwaltungsseiten, schlicht). Rahmen-Spec: `docs/superpowers/specs/2026-10-11-jufi-rahmen-design.md`.

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 18 trägt sie in die Spec ein.

1. **Letzte Leitung mit `sperreVereinszeile` statt `Serializable`** (Spec 5.4 nennt „serialisierbare Transaktion"). Etappe 1 hat `Serializable` verworfen; die Sperre der Vereinszeile serialisiert dieselben Schreiber und ist das Muster des Projekts.
2. **Volljährigkeit rechnet sich aus dem Geburtsdatum** (`istVolljaehrig`, reine Funktion mit `jetzt`); `volljaehrigGeprueftAm` quittiert nur den Hinweis. Verworfen: ein Job, der Rechte beim Geburtstag ändert — die Regel wirkt sofort und ohne Zustand.
3. **Grabstein leert auch die E-Mail** (Spec 5.8 nennt Namen, Geburtsdatum, Rechte). Die Adresse ist personenbezogen und blockiert sonst die Eindeutigkeit je Verein.
4. **Man kann sich nicht selbst entfernen** (409 `SELBST`), auch ohne Rechte. Sonst bliebe eine Sitzung ohne Person zurück, und der Weg über „Zugang entziehen" in Meine Jungfischer existiert für Kinder bereits.
5. **Einwilligungstext Fassung 1 ist ein Platzhalter** (`EINWILLIGUNG_TEXT_VERSION = '1'`, Spec 8.6): Der Eigentümer liefert den Wortlaut vor den echten Einladungen. Die Fassung wird mit jeder Einwilligung gespeichert, ein späterer Text bekommt `'2'`.
6. **Gültige Einwilligung** = nicht widerrufen **und** der Erteiler ist zum Zeitpunkt der Prüfung noch erziehungsberechtigt (nicht entfernt, Zuordnung besteht, Kind minderjährig). Verworfen: nur „nicht widerrufen" (Etappe 3) — nach Lösen der Zuordnung gälte sonst die Einwilligung einer Person weiter, die nicht mehr einwilligen darf.
7. **Fehlt dem Betrachter das Recht, antwortet der Server 404, nicht 403** (CLAUDE.md, Rahmen-Spec 8). Gilt auch für Erwachsene mit Rechten, die ein Verwalter ohne `JUGENDLEITER_RECHTE` anspricht.

## Global Constraints

- Code-Kommentare, Commit-Nachrichten, Oberfläche deutsch; Commit-Nachrichten ASCII (Umlaute umschrieben), Ende `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Einrückung Tabs; Ausnahmen YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative.
- Vereinsdaten nur über `vereinDb`; `PrismaClient` nur für Plattform-Operationen.
- Regeln sind reine Funktionen ohne Angular-Abhängigkeit mit `jetzt: Date` als Parameter, nie `new Date()` im Regelcode.
- Was eine Person nicht sehen darf, ist für sie „nicht gefunden" (404). Unangemeldet bleibt 401 (`brauchtMitglied`).
- Jede neue Vereins-Route braucht einen Fall in `apps/jufi/src/server/mandanten.spec.ts` (`FAELLE`); der erste Test dort scheitert sonst.
- Angular: inline Vorlagen und Stile, `@if`/`@for`/`@switch`, Signale, `OnPush`; keine Backticks in Kommentaren innerhalb von `template:`/`styles:`.
- Rechte (Enum `Recht`): `MITGLIEDER`, `THREADS_ERSTELLEN`, `ALLE_THREADS`, `DOKUMENTE`, `ANTWORTEN_DETAIL`, `JUGENDLEITER_RECHTE`, `EINSTELLUNGEN`. Vorlagen: Leitung = alle; Jugendleiter = alle außer `JUGENDLEITER_RECHTE` und `EINSTELLUNGEN`; Betreuer = `ANTWORTEN_DETAIL`.
- Einladung 14 Tage, Reset 1 Stunde (Etappe 3, unverändert).
- Nach jeder Task: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache` grün. Vor dem Abschluss: `pnpm exec prettier --check .`. Nichts pushen.
- Prüfen im Browser nur mit erfundenen Daten.

## Review Focus

Eingaben und Zustände, die die Spec nahelegt, aber keine Task-Spezifikation allein abdeckt; jeder hat seinen Test in der genannten Task.

1. **Zwei Leitungen entziehen sich gleichzeitig das Recht** `JUGENDLEITER_RECHTE`: Mindestens eine behält es, die andere Anfrage bekommt 409 (Task 8).
2. **Verwalter mit `MITGLIEDER` ohne `JUGENDLEITER_RECHTE`** greift einen Erwachsenen mit Rechten an (ansehen, ändern, einladen, entfernen, Rechte setzen) oder erhöht die eigenen Rechte: überall 404 bzw. unveränderte Rechte (Tasks 4, 5, 8, 9, 10).
3. **Fremde und entfernte Personen**: Person-ID aus einem anderen Verein oder ein Grabstein ergibt auf jeder Route 404; Betreuer sehen keine E-Mail-Adressen, auch nicht in der Einzelansicht (Tasks 4, 9).
4. **Einwilligung widerrufen** während die Einladung des Kindes eingelöst wird, und der Widerruf der letzten gültigen Einwilligung: Zugang, Passkeys, Sitzungen und offene Einladungen des Kindes sind danach weg; das Einlösen scheitert mit 409 (Tasks 11, 12).
5. **Volljährig werdendes Kind**: Geburtstag genau am Stichtag, 29. Februar; ab dann steuert die Familie den Zugang nicht mehr und kann nicht mehr widerrufen (Tasks 2, 12).

## Dateistruktur

```
libs/db/src/lib/verein-db.ts                     slug und status gesperrt
libs/domain/src/rechte.ts                        Rechte, Vorlagen, Volljaehrigkeit, Familie, Einladen, Rechte aendern
libs/domain/src/personen.ts                      Sichtbarkeit, Pruefungen, Dubletten, Warnhinweise
libs/domain/src/einwilligung.ts                  Text Fassung 1, hatGueltigeEinwilligung, darfEinwilligen
apps/jufi/src/server/mitglieder/verwaltung.ts    brauchtVerwaltung, ladeBetrachter, gemeinsame Lader
apps/jufi/src/server/mitglieder/personen.ts      Routen: Personen lesen, anlegen, aendern, entfernen
apps/jufi/src/server/mitglieder/familie.ts       Routen: Familie
apps/jufi/src/server/mitglieder/untergruppen.ts  Routen: Untergruppen und Zuordnung
apps/jufi/src/server/mitglieder/rechte.ts        Route: Rechte setzen
apps/jufi/src/server/mitglieder/zugang.ts        entzieheZugang, Einladen aus der Verwaltung
apps/jufi/src/server/mitglieder/jungfischer.ts   Routen: Meine Jungfischer, Einwilligung
apps/jufi/src/app/verein/verwaltung/…            Mitglieder, Personenseite, Untergruppen, Rechte (schlicht)
apps/jufi/src/app/verein/jungfischer.ts          Meine Jungfischer (schlicht)
```

---

### Task 1: `vereinDb` sperrt `slug` und `status`

Pflicht aus dem Gesamtreview von Etappe 1.

**Files:**

- Modify: `libs/db/src/lib/verein-db.ts` (Zweig `model === 'Verein'`, `operation === 'update'`)
- Test: `libs/db/src/verein-db.spec.ts`

**Interfaces:**

- Produces: `vereinDb(...).verein.update({ data })` wirft `VereinDbFehler`, wenn `data` die Schlüssel `slug` oder `status` enthält (auch als `{ set: … }`-Objekt). Erlaubt bleiben die übrigen Felder (Anzeigename, Farbe, Kontakt, …) für Etappe 5.

- [ ] **Step 1: Tests schreiben.** `Verein.update verbietet slug`, `Verein.update verbietet status`, `Verein.update erlaubt anzeigename` (liefert den geänderten Verein); je gegen einen frisch angelegten Verein, zusätzlich: der Slug des Vereins ist nach dem abgelehnten Aufruf unverändert.
- [ ] **Step 2:** Run: `pnpm nx run db:test --skip-nx-cache` — Expected: die beiden Verbote FAIL.
- [ ] **Step 3: Implementieren.** Neben dem `id`-Verbot beide Schlüssel verbieten, Meldung wie dort. Kommentar: Slug ist die Adresse und wirkt auf Cookie-Pfade und Links, Status sperrt oder öffnet den Verein; beides ändert nur der Plattform-Admin (Etappe 2, eigener Client). Verworfen: eine Positivliste — sie müsste mit jedem Feld der Etappe 5 wachsen.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `vereinDb: slug und status des Vereins gesperrt`

---

### Task 2: Domain — Rechte, Volljährigkeit, Familie, Einladen

**Files:**

- Create: `libs/domain/src/rechte.ts`, `libs/domain/src/rechte.spec.ts`
- Modify: `libs/domain/src/index.ts` (Export)

**Interfaces:**

- Produces (alle rein):
  - `type RechtName` = die sieben Enum-Werte als Stringliteral; `const ALLE_RECHTE: readonly RechtName[]`; `const RECHTE_VORLAGEN: Record<'LEITUNG'|'JUGENDLEITER'|'BETREUER', readonly RechtName[]>`
  - `interface PersonSicht { id: string; art: 'ERWACHSENER'|'JUNGFISCHER'; rechte: readonly RechtName[]; geburtsdatum: Date | null; entferntAm: Date | null }`
  - `interface Zuordnung { erwachsenerId: string; jungfischerId: string; erziehungsberechtigt: boolean }`
  - `hatRecht(p: Pick<PersonSicht,'rechte'>, r: RechtName): boolean`, `istJugendleiter(p): boolean` (mindestens ein Recht)
  - `istVolljaehrig(p: Pick<PersonSicht,'geburtsdatum'>, jetzt: Date): boolean` — ab dem 18. Geburtstag, 0 Uhr; `null` ist nicht volljährig
  - `istErziehungsberechtigt(z: Zuordnung, kind: PersonSicht, jetzt: Date): boolean` — `z.erziehungsberechtigt` und Kind minderjährig und nicht entfernt
  - `darfFuerKindHandeln(erwachsener: PersonSicht, kind: PersonSicht, zuordnungen: readonly Zuordnung[]): boolean` — jede Zuordnung, unabhängig von `erziehungsberechtigt` und Alter
  - `darfEinladen(h: PersonSicht, ziel: PersonSicht, zuordnungen: readonly Zuordnung[], jetzt: Date): boolean` — Spec 4.1: Ziel entfernt: nein; Ziel hat Rechte: nur `JUGENDLEITER_RECHTE`; sonst `MITGLIEDER` oder (Ziel ist Jungfischer und `h` ist dessen Erziehungsberechtigter)
  - `darfRechteAendern(h: PersonSicht, ziel: PersonSicht, neueRechte: readonly RechtName[]): boolean` — nur wer `JUGENDLEITER_RECHTE` hat, und nur für Erwachsene
  - `wuerdeLetzteLeitungVerlieren(erwachsene: readonly Pick<PersonSicht,'id'|'rechte'|'entferntAm'>[], zielId: string, neueRechte: readonly RechtName[]): boolean` — wahr, wenn danach niemand Nicht-Entfernter `JUGENDLEITER_RECHTE` hat

- [ ] **Step 1: Tests schreiben** (Vitest, feste `jetzt`-Werte): `Volljährig genau am 18. Geburtstag` (Geburtsdatum 2008-03-10: `jetzt` 2026-03-09T23:59 → nein, 2026-03-10T00:00 → ja); `Geburtstag am 29. Februar` (Geburtsdatum 2008-02-29, `jetzt` 2026-02-28 → nein, 2026-03-01 → ja; Entscheidung: im Nicht-Schaltjahr gilt der 1. März, Kommentar nennt es); `Kind ohne Geburtsdatum ist nicht volljährig`; `Volljähriges Kind: Zuordnung wirkt nicht mehr als erziehungsberechtigt, aber darfFuerKindHandeln bleibt wahr`; `Entferntes Kind: nie erziehungsberechtigt`; `Vorlagen`: Leitung enthält alle sieben, Jugendleiter enthält weder `JUGENDLEITER_RECHTE` noch `EINSTELLUNGEN`, Betreuer ist genau `['ANTWORTEN_DETAIL']`; `darfEinladen`: Verwalter lädt Erwachsenen ohne Rechte ein ja; Verwalter ohne `JUGENDLEITER_RECHTE` lädt Erwachsenen mit Rechten ein nein; Leitung ja; Erziehungsberechtigte lädt eigenes Kind ein ja, fremdes Kind nein, Kind des volljährigen Kindes nein (nicht mehr erziehungsberechtigt); entferntes Ziel nein; `darfRechteAendern`: ohne `JUGENDLEITER_RECHTE` nein, Ziel Jungfischer nein; `wuerdeLetzteLeitungVerlieren`: einziger Inhaber gibt ab → wahr; zwei Inhaber, einer gibt ab → falsch; der andere Inhaber ist entfernt → wahr.
- [ ] **Step 2:** Run: `pnpm nx run domain:test --skip-nx-cache` — Expected: FAIL (Modul fehlt).
- [ ] **Step 3: Implementieren** gemäß Signaturen. `istVolljaehrig` vergleicht Kalendertage in UTC (das Geburtsdatum ist `@db.Date`); der Rechenweg steht in einem Kommentar, ebenso warum `jetzt` ein Parameter ist.
- [ ] **Step 4:** Run wie Step 2 — Expected: PASS.
- [ ] **Step 5: Commit** `Domain: Rechte, Vorlagen, Volljaehrigkeit, Familie, Einladen`

---

### Task 3: Domain — Sichtbarkeit, Prüfungen, Dubletten, Warnhinweise, Einwilligung

**Files:**

- Create: `libs/domain/src/personen.ts`, `libs/domain/src/einwilligung.ts`, je `*.spec.ts`
- Modify: `libs/domain/src/index.ts`

**Interfaces:**

- Consumes: `PersonSicht`, `Zuordnung`, `istErziehungsberechtigt`, `darfFuerKindHandeln`, `hatRecht` (Task 2).
- Produces (`personen.ts`):
  - `type Einsicht = 'VOLL' | 'LESEN' | 'NAME'` — VOLL = mit `MITGLIEDER`; LESEN = übrige Jugendleiter (keine E-Mail); NAME = Ansprechpartner-Sicht
  - `einsichtIn(betrachter: PersonSicht, person: PersonSicht, zuordnungen: readonly Zuordnung[]): Einsicht | null` — `null` = nicht sichtbar (entfernt, oder weder Jugendleiter noch selbst noch Familie). Selbst und eigene Familie: `VOLL` für die eigenen Daten, aber ohne Einladungs-/Einwilligungsstand (das entscheidet der Server nach `Einsicht`, siehe Task 6); Jugendleiter sieht der Normalbetrachter mit `NAME`
  - `darfPersonSehen(betrachter, person, zuordnungen): boolean` = `einsichtIn(...) !== null`
  - `sichtbarePersonen<T extends PersonSicht>(betrachter, personen: readonly T[], zuordnungen): { person: T; einsicht: Einsicht }[]`
  - `pruefeName(s: string): boolean` (1–60 Zeichen nach Trim), `pruefeGeburtsdatum(d: Date, jetzt: Date): boolean` (nicht in der Zukunft, nicht vor 1900)
  - `istDoppelt(a: {vorname,nachname,geburtsdatum}, b): boolean` — Name ohne Groß-/Kleinschreibung und Rand, Geburtsdatum gleich (beide `null` zählt als gleich nur bei Erwachsenen mit gleichem Namen)
  - `beziehungVorbelegung(b: 'MUTTER'|'VATER'|'GROSSMUTTER'|'GROSSVATER'|'TANTE'|'ONKEL'|'GESCHWISTER'|'PFLEGEPERSON'|'ANDERE'): boolean` — erziehungsberechtigt vorbelegt bei Mutter, Vater, Pflegeperson
  - `type Warnhinweis = { art: 'OHNE_FAMILIE' } | { art: 'EINWILLIGUNG_FEHLT' } | { art: 'EINLADUNG_OFFEN'; ablauf: Date } | { art: 'MAIL_NICHT_ZUGESTELLT' } | { art: 'VOLLJAEHRIG'; seit: Date }` und `warnhinweise(e: { person: PersonSicht; zuordnungen; hatGueltigeEinwilligung: boolean; offeneEinladungAblauf: Date | null; einladungsmailGescheitert: boolean; volljaehrigGeprueftAm: Date | null }, jetzt: Date): Warnhinweis[]` — `OHNE_FAMILIE` nur Jungfischer ohne erziehungsberechtigte Familie; `EINWILLIGUNG_FEHLT` nur Minderjährige ohne gültige Einwilligung; `VOLLJAEHRIG` nur wenn volljährig und `volljaehrigGeprueftAm` leer, `seit` = 18. Geburtstag
- Produces (`einwilligung.ts`): `const EINWILLIGUNG_TEXT_VERSION = '1'`; `const EINWILLIGUNG_TEXT: string` (Platzhalter, Kommentar verweist auf Spec 8.6); `hatGueltigeEinwilligung(kind: PersonSicht, einwilligungen: readonly { erteiltVon: string; widerrufenAm: Date | null }[], erteiler: ReadonlyMap<string, PersonSicht>, zuordnungen: readonly Zuordnung[], jetzt: Date): boolean` (Entscheidung 6); `darfEinwilligen(erwachsener: PersonSicht, kind: PersonSicht, zuordnungen, jetzt): boolean` = erziehungsberechtigt.

- [ ] **Step 1: Tests schreiben.** `einsichtIn`: Verwalter sieht alle `VOLL`; Betreuer sieht alle `LESEN`; Mutter sieht sich und ihr Kind `VOLL`, die Leitung `NAME`, fremdes Kind `null`, Großmutter (nicht erziehungsberechtigt) sieht das Kind trotzdem; Jungfischer sieht sich, seine Familie und Jugendleiter, nicht die Geschwister; Grabstein für jeden `null`. `istDoppelt`: Groß-/Kleinschreibung, Leerzeichen, anderes Datum → nein. `beziehungVorbelegung` für alle neun Werte. `warnhinweise`: je Hinweis ein Fall, dazu „Kind ohne Warnung" → `[]`. `hatGueltigeEinwilligung`: gültig; widerrufen → nein; Erteiler entfernt → nein; Zuordnung gelöst → nein; Kind inzwischen volljährig → nein (Erteiler nicht mehr erziehungsberechtigt); eine gültige reicht, wenn eine andere widerrufen ist.
- [ ] **Step 2:** Run: `pnpm nx run domain:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren** gemäß Signaturen. Der Kommentar bei `einsichtIn` nennt, warum Familie das Kind auch ohne Erziehungsberechtigung sieht (Spec 5.6: „darf weiter sehen").
- [ ] **Step 4:** Run wie Step 2 — Expected: PASS.
- [ ] **Step 5: Commit** `Domain: Sichtbarkeit, Pruefungen, Warnhinweise, Einwilligung`

---

### Task 4: Server-Gerüst der Verwaltung und Personen lesen

**Files:**

- Create: `apps/jufi/src/server/mitglieder/verwaltung.ts`, `apps/jufi/src/server/mitglieder/personen.ts`, `apps/jufi/src/server/mitglieder/personen.spec.ts`
- Modify: `apps/jufi/src/server/verein.ts` (neue Gruppe `personenRouten(router, deps)` in `vereinsApi`), `apps/jufi/src/server/mandanten.spec.ts` (Kontext um `eigenerLeiter` (Cookie, `MITGLIEDER`+`JUGENDLEITER_RECHTE`), `fremdePersonId`, Fälle für beide Routen), `apps/jufi/src/server/mitglieder/profil.ts` (`GET /ich` liefert zusätzlich `hatKinder: boolean`, falls nicht vorhanden)
- Test: `personen.spec.ts`, `mandanten.spec.ts`

**Interfaces:**

- Consumes: `einsichtIn`, `warnhinweise`, `hatGueltigeEinwilligung`, `PersonSicht`, `Zuordnung` (Tasks 2, 3); `brauchtMitglied`, `mitgliedKontext`, `vereinsKontext`, `asynchron`.
- Produces (`verwaltung.ts`):
  - `ladeUmfeld(db: VereinDb): Promise<{ personen: PersonSicht[]; zuordnungen: Zuordnung[] }>` — alle Nicht-Entfernten plus Zuordnungen des Vereins (für die Regeln; der Verein hat wenige hundert Personen)
  - `alsSicht(p: Person): PersonSicht`
  - `statt404(res: Response): void` — `res.status(404).json({ fehler: 'nicht gefunden' })` (eine Stelle für den Text)
- Produces (Routen, beide `brauchtMitglied`):
  - `GET /personen` → `{ personen: PersonListe[] }` mit `PersonListe = { id, art, vorname, nachname, geburtsdatum?, jugendsprecher, rechte (nur ab LESEN), email? (nur VOLL), untergruppen: {id,name}[], warnhinweise: Warnhinweis[] (nur VOLL und LESEN) }`. Geburtsdatum nur ab LESEN. Einwilligungs-/Einladungsstand und E-Mail nur VOLL.
  - `GET /personen/:id` → Einzelansicht gleicher Form plus `familie: { erwachsenerId, vorname, nachname, beziehung, beziehungFreitext, erziehungsberechtigt }[]` (für den Erwachsenen die Kinder statt der Familie), `einladung: { offen: boolean; ablauf: string | null; mailNichtZugestellt: boolean } | null` und `zugang: { vorhanden: boolean; letzteAnmeldungAm: string | null; erlaubt: boolean } | null` (nur VOLL). Unsichtbar, fremd, Grabstein: 404.
  - `einladungsmailGescheitert` = es gibt eine `MailWarteschlange`-Zeile mit `bezug = einladung:<id der jüngsten offenen Einladung>`, `gesendetAm` leer und `versuche >= MAIL_MAX_VERSUCHE`.

- [ ] **Step 1: Tests schreiben** (`personen.spec.ts`, echter Test-Server wie `profil.spec.ts`): `Verwalter sieht alle mit E-Mail`; `Betreuer sieht alle ohne E-Mail und ohne Warnhinweis-Einladung` (Feld `email` fehlt im JSON); `Mutter sieht Kind und Leitung, nicht das fremde Kind`; `Grabstein erscheint nirgends` (Person mit `entferntAm`); `GET /personen/:id fremde ID → 404`; `GET /personen/:id Grabstein → 404`; `Mutter ruft die Einzelansicht der Großmutter auf → 200 (Familie)` und `eines fremden Erwachsenen → 404`; `Warnhinweise: Kind ohne Familie → OHNE_FAMILIE; Einladungsmail nach MAIL_MAX_VERSUCHE Fehlschlägen → MAIL_NICHT_ZUGESTELLT`; `unangemeldet → 401`. `mandanten.spec.ts`: Fälle `'GET /personen'` (gesperrter Verein 404; Cookie aus eigen in fremd 401) und `'GET /personen/:id'` (ID aus fremd mit Cookie aus eigen → 404).
- [ ] **Step 2:** Run: `pnpm nx run jufi:test-server --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Ein Lader liest Personen, Zuordnungen, Untergruppen-Mitgliedschaften, jüngste offene Einladung je Person, Einwilligungen und Mail-Zeilen mit je einer Abfrage über `vereinDb` (nicht je Person), `einsichtIn` entscheidet je Zeile, ein Serialisierer je `Einsicht` baut die Antwort. Kommentar: Felder werden aufgebaut statt gestrichen, damit ein neues Feld nie versehentlich für Betreuer sichtbar wird.
- [ ] **Step 4:** Run wie Step 2 — Expected: PASS.
- [ ] **Step 5: Commit** `Personen lesen: Sichtbarkeit, Warnhinweise, Einzelansicht`

---

### Task 5: Personen anlegen, ändern, Jugendsprecher, Volljährigkeit belassen

**Files:**

- Modify: `apps/jufi/src/server/mitglieder/personen.ts`, `personen.spec.ts`, `mandanten.spec.ts`
- Modify: `libs/domain/src/index.ts` falls nötig

**Interfaces:**

- Consumes: `pruefeName`, `pruefeGeburtsdatum`, `istDoppelt`, `darfEinladen`-Verwandtes: `hatRecht`, `ladeUmfeld`, `statt404`, `pruefeEmail`, `normalisiereEmail` (Etappe 3).
- Produces (Routen, alle nur mit `MITGLIEDER`, sonst 404):
  - `POST /personen` Body `{ art, vorname, nachname, geburtsdatum?, email?, untergruppenIds?: string[], trotzdem?: boolean }` → 201 `{ id }`. Jungfischer: Geburtsdatum Pflicht. Erwachsene: kein Geburtsdatum, **keine Rechte** (Rechte nur über Task 8). Dublette ohne `trotzdem: true` → 409 `{ fehler, code: 'DOPPELT', person: { id, vorname, nachname } }`. Doppelte E-Mail im Verein → 409 `{ code: 'EMAIL_VERGEBEN' }` (über `P2002`, nicht über Vorabprüfung allein). 400 mit Text je ungültigem Feld.
  - `PATCH /personen/:id` Body beliebige Teilmenge von `{ vorname, nachname, geburtsdatum, email, jugendsprecher }` → 200. `jugendsprecher` nur bei Jungfischern; `email` leer = entfernen. Ist die Person Erwachsene mit Rechten und der Handelnde hat kein `JUGENDLEITER_RECHTE`: 404 (Entscheidung 7).
  - `POST /personen/:id/volljaehrig-belassen` → 200, setzt `volljaehrigGeprueftAm` auf `jetzt`; 409, wenn das Kind noch minderjährig ist.

- [ ] **Step 1: Tests schreiben:** `Jungfischer anlegen mit Untergruppen` (Mitgliedschaft entsteht); `Jungfischer ohne Geburtsdatum → 400`; `Geburtsdatum in der Zukunft → 400`; `Erwachsener mit Rechten im Body wird ignoriert bzw. 400` (Rechte bleiben leer — ein Test, der beweist, dass `POST` keinen Weg zu Rechten öffnet); `Dublette → 409 DOPPELT, mit trotzdem → 201`; `doppelte E-Mail → 409 EMAIL_VERGEBEN`; `zwei gleichzeitige Anlagen derselben E-Mail → genau eine 201` (Review-Focus-Verwandtes: P2002 statt Vorabprüfung); `Betreuer ohne MITGLIEDER → 404 auf allen drei Routen`; `PATCH Jugendsprecher setzen und löschen`; `PATCH Jugendsprecher bei Erwachsenem → 400`; `Verwalter ohne JUGENDLEITER_RECHTE ändert den Namen eines Jugendleiters → 404, Name unverändert`; `volljaehrig-belassen: Kind mit 17 → 409, mit 18 → 200 und Warnhinweis VOLLJAEHRIG verschwindet`. Mandanten-Fälle für alle drei Routen (fremde ID → 404, Daten in fremd unverändert).
- [ ] **Step 2:** Run wie Task 4, Step 2 — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Die Dublettenprüfung läuft vor dem Anlegen, die E-Mail-Eindeutigkeit entscheidet die Datenbank. Kommentar am `trotzdem`-Feld: Die Warnung ist übergehbar (Spec 5.3), weil es wirklich zwei gleichnamige Kinder geben kann.
- [ ] **Step 4:** Run wie Step 2 — Expected: PASS.
- [ ] **Step 5: Commit** `Personen anlegen und aendern, Jugendsprecher, Volljaehrigkeit belassen`

---

### Task 6: Familie verknüpfen

**Files:**

- Create: `apps/jufi/src/server/mitglieder/familie.ts`, `familie.spec.ts`
- Modify: `apps/jufi/src/server/verein.ts` (`familieRouten`), `mandanten.spec.ts`

**Interfaces:**

- Consumes: `beziehungVorbelegung`, `ladeUmfeld`, `statt404`, `hatRecht`.
- Produces (nur `MITGLIEDER`, sonst 404):
  - `PUT /personen/:jungfischerId/familie/:erwachsenerId` Body `{ beziehung, beziehungFreitext?, erziehungsberechtigt?: boolean }` → 200 `{ erziehungsberechtigt: boolean }`. Legt an oder ändert (Upsert über das Paar). Ohne `erziehungsberechtigt` gilt `beziehungVorbelegung(beziehung)`. `beziehung: 'ANDERE'` verlangt Freitext (400, wie der CHECK `bezugsperson_freitext`). Erster Pfadteil muss ein Jungfischer, zweiter ein Erwachsener sein, beide nicht entfernt: sonst 404. Ist der Erwachsene eine Person mit Rechten und der Handelnde hat kein `JUGENDLEITER_RECHTE`: 404.
  - `DELETE /personen/:jungfischerId/familie/:erwachsenerId` → 204 (auch wenn nichts da ist: idempotent). Löst die Zuordnung und damit die Erziehungsberechtigung. Hatte das Kind danach **keine gültige Einwilligung** mehr (`hatGueltigeEinwilligung`), entzieht `entzieheZugang` (Task 9) den Zugang des Kindes — deshalb liefert diese Task den Aufruf als Haken, den Task 9 füllt: `await entzieheZugangWennUngueltig(tx, kind)` mit vorläufig leerem Rumpf in `zugang.ts`.

- [ ] **Step 1: Tests schreiben:** `Mutter verknüpfen: erziehungsberechtigt vorbelegt true`; `Großmutter: vorbelegt false`; `ANDERE ohne Freitext → 400`; `zweites PUT ändert statt zu doppeln` (genau eine Zeile); `Erwachsener als Kind angegeben → 404`; `Grabstein als Familie → 404`; `Verwalter ohne JUGENDLEITER_RECHTE verknüpft einen Jugendleiter → 404`; `DELETE löst; zweites DELETE → 204`; `ohne MITGLIEDER → 404`. Mandanten: `PUT` und `DELETE` mit Personen aus fremd → 404, Zeilen in fremd unverändert.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5: Commit** `Familie verknuepfen und loesen`

---

### Task 7: Untergruppen

**Files:**

- Create: `apps/jufi/src/server/mitglieder/untergruppen.ts`, `untergruppen.spec.ts`
- Modify: `verein.ts` (`untergruppenRouten`), `mandanten.spec.ts`

**Interfaces:**

- Produces:
  - `GET /untergruppen` → `{ untergruppen: { id, name, mitglieder: number }[] }` für jeden Jugendleiter (`istJugendleiter`), sonst 404.
  - `POST /untergruppen` `{ name }` (1–40 Zeichen, eindeutig je Verein, Groß-/Kleinschreibung zählt nicht) → 201 `{ id }`; Duplikat 409 `NAME_VERGEBEN`. Nur `MITGLIEDER`.
  - `PATCH /untergruppen/:id` `{ name }`, `DELETE /untergruppen/:id` → 204; löscht nur die Gruppe und ihre Mitgliedschaften, keine Personen (Spec 5.5). Nur `MITGLIEDER`.
  - `PUT /personen/:id/untergruppen` `{ untergruppenIds: string[] }` setzt die Menge der Untergruppen eines Jungfischers (Ersetzen); fremde oder unbekannte Gruppen-ID → 404 (nichts wird geändert); Erwachsene → 404. Nur `MITGLIEDER`.

- [ ] **Step 1: Tests schreiben:** Anlegen/Umbenennen/Löschen; `Löschen lässt die Personen stehen`; `Duplikat auch mit anderer Schreibweise → 409`; `Umbenennen auf eigenen Namen ist ok`; `PUT ersetzt die Menge`; `PUT mit Gruppen-ID aus fremd → 404 und Menge unverändert`; `Betreuer liest, schreibt nicht (404)`. Mandanten-Fälle für alle fünf Routen.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Der Eindeutigkeitsfall nutzt den bestehenden Unique `(vereinId, name)` plus Vorabsuche ohne Schreibweise; Kommentar nennt, warum die Vorabsuche die Datenbank nicht ersetzt.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5: Commit** `Untergruppen anlegen, umbenennen, loeschen, zuordnen`

---

### Task 8: Rechte vergeben, letzte Leitung bleibt

**Files:**

- Create: `apps/jufi/src/server/mitglieder/rechte.ts`, `rechte.spec.ts`
- Modify: `verein.ts` (`rechteRouten`), `mandanten.spec.ts`

**Interfaces:**

- Consumes: `darfRechteAendern`, `wuerdeLetzteLeitungVerlieren`, `sperreVereinszeile`, `ladeUmfeld`.
- Produces: `PUT /personen/:id/rechte` Body `{ rechte: RechtName[] }` (Menge, Duplikate werden entfernt, unbekannte Werte → 400) → 200 `{ rechte }`. Nur wer `JUGENDLEITER_RECHTE` hat; Ziel muss ein nicht entfernter Erwachsener sein; sonst 404. Die Prüfung der letzten Leitung und der Schreibzugriff laufen in einer Transaktion, die mit `sperreVereinszeile` beginnt und die Personen **innerhalb** der Transaktion neu liest; Verletzung → 409 `{ code: 'LETZTE_LEITUNG' }`. Wer sich selbst Rechte gibt, die er nicht hat, kann das nur über `JUGENDLEITER_RECHTE`, das er dann schon hat — kein Sonderfall, aber ein Test.

- [ ] **Step 1: Tests schreiben:** `Leitung vergibt Vorlage Jugendleiter`; `Verwalter ohne JUGENDLEITER_RECHTE → 404, Rechte unverändert, auch beim Versuch, sich selbst JUGENDLEITER_RECHTE zu geben`; `einziger Inhaber gibt JUGENDLEITER_RECHTE ab → 409 LETZTE_LEITUNG`; `Inhaber entzieht sich selbst, wenn ein zweiter da ist → 200`; **`zwei Inhaber entziehen sich gleichzeitig (Promise.all) → genau einmal 200 und einmal 409, danach hat genau einer das Recht`** (Review Focus 1); `Jungfischer als Ziel → 404`; `unbekanntes Recht → 400`; `Grabstein als Ziel → 404`. Mandanten: fremde ID → 404.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Kommentar: `sperreVereinszeile` statt `Serializable` (Entscheidung 1) und warum die Personen in der Transaktion neu gelesen werden — der Vorabstand aus `ladeUmfeld` wäre zum Zeitpunkt der Sperre veraltet.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5: Commit** `Rechte vergeben: letzte Leitung bleibt unter der Vereinszeilensperre`

---

### Task 9: Zugang entziehen und Entfernen (Grabstein)

**Files:**

- Create: `apps/jufi/src/server/mitglieder/zugang.ts`, `zugang.spec.ts`
- Modify: `personen.ts` (Route `DELETE /personen/:id`), `familie.ts` (Haken aus Task 6 füllen), `mandanten.spec.ts`; eventuell Migration, falls `person_art_felder` den Grabstein eines Jungfischers ablehnt (zuerst prüfen: Geburtsdatum `NULL`, Namen `''`)

**Interfaces:**

- Produces (`zugang.ts`), jeweils `(tx: VereinDb-Transaktion, personId: string) => Promise<void>`:
  - `entzieheZugang(tx, kindId)` — Spec 4.6: `zugangErlaubt = false`; löscht `Zugang` (damit Passkeys, Sitzungen, Wiederherstellungscodes über Kaskade), offene Einladungen der Person
  - `entzieheZugangWennUngueltig(tx, kind)` — ruft `entzieheZugang`, wenn `hatGueltigeEinwilligung` falsch ist (füllt den Haken aus Task 6)
  - `entferne(tx, personId, jetzt)` — Grabstein nach Spec 5.8 und Entscheidung 3: Vorname/Nachname `''`, Geburtsdatum `null`, E-Mail `null`, Rechte `[]`, `jugendsprecher` false, `entferntAm = jetzt`; löscht Zugang (mit Kaskade), Einladungen, Zuordnungen (beide Richtungen), Untergruppen-Mitgliedschaften; Einwilligungen bleiben
- Produces (Route): `DELETE /personen/:id` → 200 `{ folgeangebot: { id, vorname, nachname }[] }` — Erwachsene, die nach dem Entfernen eines Jungfischers keine Jungfischer und keine Rechte mehr haben (Spec 5.8). Nur `MITGLIEDER`; Erwachsene mit Rechten nur mit `JUGENDLEITER_RECHTE` (sonst 404); die eigene Person → 409 `SELBST`; der letzte Inhaber von `JUGENDLEITER_RECHTE` → 409 `LETZTE_LEITUNG` (Prüfung in der Transaktion unter `sperreVereinszeile`). Ein zweites `DELETE` auf denselben Grabstein → 404.

- [ ] **Step 1: Tests schreiben:** `Entfernen eines Jungfischers leert die Zeile, löscht Zugang, Passkeys, Sitzungen, Einladungen, Zuordnungen, Mitgliedschaften und lässt Einwilligungen stehen` (alles einzeln geprüft); `Folgeangebot nennt Opa Hans, der sonst niemanden hat, aber nicht die Mutter, die ein weiteres Kind hat, und nicht einen Erwachsenen mit Rechten`; `E-Mail des Grabsteins ist frei, derselbe Erwachsene kann mit der Adresse neu angelegt werden`; `Sitzung der entfernten Person gilt nicht mehr (401)`; `sich selbst → 409 SELBST`; `Verwalter ohne JUGENDLEITER_RECHTE entfernt Jugendleiter → 404, Person unverändert`; `letzter Inhaber → 409`; `zweites DELETE → 404`; `Familie lösen ohne verbleibende gültige Einwilligung entzieht den Zugang des Kindes` (aus Task 6). Mandanten: fremde ID → 404, Zeile in fremd unverändert.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Alles in einer Transaktion mit `sperreVereinszeile` am Anfang (konkurrierende Einlösung einer Einladung der Person soll entweder vorher fertig sein oder an der Sperre warten und dann 404 sehen).
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5: Commit** `Entfernen als Grabstein, Zugang entziehen`

---

### Task 10: Einladen aus der Verwaltung

**Files:**

- Modify: `apps/jufi/src/server/mitglieder/zugang.ts`, `zugang.spec.ts`, `verein.ts`, `mandanten.spec.ts`

**Interfaces:**

- Consumes: `darfEinladen`, `hatGueltigeEinwilligung`, `erzeugeVereinsEinladung`, `einladungsLink`, `leitungsEinladungsText`, `legeMailAn`/`einladungsMail` (Etappe 3), `sperreVereinszeile`.
- Produces: `POST /personen/:id/einladung` Body `{ mail?: boolean }` → 201 `{ link, text, ablauf }`. Art `EINLADUNG`, wenn die Person noch keinen Zugang hat, sonst `RESET`. Voraussetzungen: `darfEinladen` (sonst 404); für Jungfischer zusätzlich `zugangErlaubt` und `hatGueltigeEinwilligung`, sonst 409 `{ code: 'ZUGANG_NICHT_ERLAUBT' | 'EINWILLIGUNG_FEHLT', fehler: <Grund für den Knopf> }`. `mail: true` nur mit hinterlegter E-Mail (sonst 400) und reiht die Mail in derselben Transaktion ein (`bezug: einladung:<id>`). Eine neue Einladung ersetzt offene Einladungen derselben Art der Person (nicht mehrere gültige Links nebeneinander).

- [ ] **Step 1: Tests schreiben:** `Verwalter lädt Erwachsenen ein, Link mit Token hinter #`; `zweiter Aufruf entwertet den ersten Link`; `mail: true ohne E-Mail → 400`; `mail: true legt eine Warteschlangenzeile mit bezug einladung:<id> an`; `Jungfischer ohne Einwilligung → 409 EINWILLIGUNG_FEHLT`; `Jungfischer mit zugangErlaubt=false → 409`; `Erziehungsberechtigte lädt eigenes Kind ein, fremdes → 404`; `Verwalter ohne JUGENDLEITER_RECHTE lädt Jugendleiter ein → 404`; `Grabstein → 404`; `Person mit Zugang bekommt RESET`. Mandanten-Fall.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5: Commit** `Einladen aus der Verwaltung mit Voraussetzungen`

---

### Task 11: Einwilligung beim Einlösen der Einladung

**Files:**

- Modify: `apps/jufi/src/server/mitglieder/einladung.ts`, `einladung.spec.ts`, `einloesen.spec.ts`, `mandanten.spec.ts`

**Interfaces:**

- Consumes: `hatGueltigeEinwilligung`, `darfEinwilligen`, `EINWILLIGUNG_TEXT_VERSION`, `EINWILLIGUNG_TEXT`.
- Produces:
  - `POST /einladung/pruefen` liefert zusätzlich `kinder: { id, vorname, zugangErlaubt: boolean, einwilligungVorhanden: boolean }[]` (nur wenn die Einladung einen Erwachsenen betrifft: dessen minderjährige, nicht entfernte Kinder, bei denen er erziehungsberechtigt ist) und `einwilligungsText: { version: string; text: string }`. Die bisherige Prüfung `einwilligungFehlt` beim Jungfischer nutzt jetzt `hatGueltigeEinwilligung` statt „irgendeine nicht widerrufene" (Entscheidung 6).
  - `POST /einladung/einloesen` Body erhält `einwilligungen?: { kindId: string; einwilligen: boolean; zugang: boolean }[]`. Für jeden Eintrag mit `einwilligen: true` legt der Server in derselben Transaktion eine `Einwilligung` (`art: 'DSGVO_ART8'`, `erteiltVon` = der Einlösende, `textVersion: EINWILLIGUNG_TEXT_VERSION`, `erteiltAm: jetzt`) an und setzt `zugangErlaubt` des Kindes auf `zugang`. `kindId` muss eines der Kinder aus `pruefen` sein, sonst 404 (Einlösen scheitert als Ganzes). `einwilligen: false` ändert nichts. Gilt nur für Einladungen von Erwachsenen.

- [ ] **Step 1: Tests schreiben:** `pruefen nennt die Kinder und den Text`; `pruefen: Kind einer Großmutter (nicht erziehungsberechtigt) fehlt in kinder`; `einlösen mit einwilligen: true legt Einwilligung mit textVersion '1' und erteiltVon an und setzt zugangErlaubt`; `zugang: false behält die Einwilligung, setzt zugangErlaubt=false`; `einwilligen: false legt nichts an`; `kindId eines fremden Kindes → 404, nichts eingelöst (Einladung bleibt offen)`; `Einlösen einer Kindeinladung scheitert mit 409 EINWILLIGUNG_FEHLT, wenn die Erteilerin entfernt wurde` (Entscheidung 6); **`gleichzeitig Einwilligung widerrufen (Task 12) und Kindeinladung einlösen: entweder 409, oder Einlösen vorher und der Zugang danach weg`** (der Rennfall steht in Task 12, weil dort der Widerruf entsteht; dieser Task nur der erste Fall mit `Promise.all` über zwei Einlösungen derselben Einladung: genau eine 200). Mandanten: `pruefen`/`einloesen` unverändert 404 in fremd.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Die Einwilligungen entstehen **nach** der bedingten `updateMany`-Annahme der Einladung (count 1) und gehören in dieselbe Transaktion unter `sperreVereinszeile`. Kommentar: erst Einlösen, dann Einwilligung — scheitert das Einlösen, bleibt keine Einwilligung zurück, die niemand erteilt hat.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5: Commit** `Einwilligung beim Einloesen: Kinder und Text in pruefen, Erteilen in einloesen`

---

### Task 12: Meine Jungfischer — Zugang, Link, Einwilligung

**Files:**

- Create: `apps/jufi/src/server/mitglieder/jungfischer.ts`, `jungfischer.spec.ts`
- Modify: `verein.ts` (`jungfischerRouten`), `mandanten.spec.ts`

**Interfaces:**

- Consumes: `darfFuerKindHandeln`, `darfEinwilligen`, `hatGueltigeEinwilligung`, `entzieheZugang`, `entzieheZugangWennUngueltig`, Einladen-Logik aus Task 10 (als geteilte Funktion `erzeugeEinladungFuerKind` in `zugang.ts`), `sperreVereinszeile`.
- Produces (`brauchtMitglied`; Kind muss in der Familie des Angemeldeten sein, sonst 404):
  - `GET /meine-jungfischer` → `{ kinder: { id, vorname, nachname, jugendsprecher, untergruppen: {id,name}[], familie: { vorname, nachname, beziehung, beziehungFreitext }[], zugang: { erlaubt: boolean; vorhanden: boolean; einwilligungGueltig: boolean }, ichBinErziehungsberechtigt: boolean, volljaehrig: boolean }[] }` — für jedes Kind, bei dem der Angemeldete eine Zuordnung hat (`darfFuerKindHandeln`), Entfernte ausgeschlossen. Familienmitglieder ohne Recht und ohne E-Mail (kein Weg zu fremden Adressen).
  - `POST /meine-jungfischer/:kindId/zugang` `{ erlaubt: boolean }` — nur `darfEinwilligen` (also erziehungsberechtigt und Kind minderjährig); `erlaubt: false` → `entzieheZugang`; `erlaubt: true` verlangt `hatGueltigeEinwilligung`, sonst 409 `EINWILLIGUNG_FEHLT`.
  - `POST /meine-jungfischer/:kindId/einladung` → 201 `{ link, text, ablauf }` wie Task 10, nur `darfEinwilligen`, Voraussetzungen wie dort.
  - `POST /meine-jungfischer/:kindId/einwilligung` `{ erteilen: boolean }` — nur `darfEinwilligen`. `true`: legt `Einwilligung` an (wie Task 11) wenn der Angemeldete keine gültige ungewiderrufene hat. `false`: setzt `widerrufenAm` auf allen seinen offenen Einwilligungen für das Kind und ruft `entzieheZugangWennUngueltig`. Beides unter `sperreVereinszeile`.
- Alle vier: volljähriges Kind → Schreiben ergibt 404 (Spec 5.6: „nicht mehr einwilligen und den Zugang nicht mehr steuern"); `GET` zeigt es mit `volljaehrig: true` und ohne Aktionen.

- [ ] **Step 1: Tests schreiben:** `GET zeigt nur eigene Kinder, auch das einer Großmutter (nicht erziehungsberechtigt) mit ichBinErziehungsberechtigt=false`; `Großmutter widerruft → 404`; `Mutter erteilt Einwilligung: zweiter Aufruf legt keine zweite an`; **`Widerruf der einzigen gültigen Einwilligung löscht Zugang, Passkeys, Sitzungen und offene Einladungen des Kindes (Sitzung des Kindes danach 401), zugangErlaubt=false`** (Review Focus 4); `Widerruf, wenn der Vater noch gültig eingewilligt hat: Zugang bleibt`; `erlaubt: true ohne gültige Einwilligung → 409`; **`gleichzeitig Widerruf und Einlösen der Kindeinladung (Promise.all): der Zustand danach ist entweder (Einlösung gewann, dann ist der Zugang durch den Widerruf wieder weg) oder (Widerruf gewann, Einlösen 409); nie Zugang bei widerrufener Einwilligung`**; **`Kind wird volljährig (jetzt der Test-Uhr auf den Geburtstag gesetzt): Mutter bekommt 404 auf Zugang, Einladung, Einwilligung; GET zeigt volljaehrig`** (Review Focus 5); `Kind fremder Familie → 404`; `Grabstein-Kind → 404`. Mandanten-Fälle für alle vier Routen.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Die Test-Uhr kommt über `deps.jetzt`; kein `new Date()` in den Regeln.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5: Commit** `Meine Jungfischer: Zugang, Link, Einwilligung erteilen und widerrufen`

---

### Task 13: Frontend — API und Einwilligungs-Schritt in der Einladung

**Files:**

- Modify: `apps/jufi/src/app/verein/mitglieder-api.ts` (Typen `Warnhinweis`, `PersonListe`, `PersonDetail`, `Untergruppe`, `KindAnsicht`, erweitertes `EinladungInfo` und Einlösen-Body; je Endpunkt der Tasks 4–12 eine Methode, Slug stets erster Parameter, private Helfer `holen`/`senden`), `apps/jufi/src/app/verein/einladung.ts`, `einladung.spec.ts`
- Test: `einladung.spec.ts`

**Interfaces:**

- Consumes: Endpunkte aus Task 11 und die Erweiterung von `GET /ich` (`hatKinder`).
- Produces: `MitgliederApi`-Methoden `personen(slug)`, `person(slug, id)`, `legePersonAn`, `aenderePerson`, `entfernePerson`, `volljaehrigBelassen`, `setzeFamilie`, `loeseFamilie`, `untergruppen`, `legeUntergruppeAn`, `benenneUntergruppeUm`, `loescheUntergruppe`, `setzeUntergruppen`, `setzeRechte`, `ladePersonEin`, `meineJungfischer`, `setzeKindZugang`, `kindEinladung`, `kindEinwilligung`; Typen mit denselben Feldnamen wie die Antworten. Neuer Schritt `'einwilligung'` in `einladung.ts` zwischen `begruessung` und `kennung`, **nur wenn** `info.kinder.length > 0`.

- [ ] **Step 1: Tests schreiben** (Komponententest wie die bestehenden): `ohne Kinder überspringt die Einladung den Einwilligungsschritt`; `mit Kind zeigt der Schritt den Text, ein Häkchen "Ich willige ein" je Kind und die Frage "Soll Lena einen eigenen Zugang bekommen?" vorbelegt ja`; `Weiter ohne Häkchen sendet einwilligen:false`; `Hat schon eine andere Person eingewilligt, steht das dort und der Schritt ist freiwillig` (Weiter ohne Häkchen erlaubt); `der Einlösen-Body enthält einwilligungen mit kindId, einwilligen, zugang`; `Zugang-Frage verschwindet, wenn nicht eingewilligt wird` (ohne Einwilligung kein Zugang, Text: "Die Familie handelt dann in seinem Namen").
- [ ] **Step 2:** Run: `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Beschriftung deutsch, Text aus `info.einwilligungsText`. Kein Backtick in Kommentaren innerhalb von `template:`/`styles:`.
- [ ] **Step 4:** Run — Expected: PASS; Build `pnpm nx run jufi:build --skip-nx-cache` ohne Fehler.
- [ ] **Step 5: Commit** `Frontend: Mitglieder-API und Einwilligungsschritt der Einladung`

---

### Task 14: Frontend — Meine Jungfischer

**Files:**

- Create: `apps/jufi/src/app/verein/jungfischer.ts`, `jungfischer.spec.ts`
- Modify: `apps/jufi/src/app/app.routes.ts` (`jungfischer`, Wächter `mitgliedAngemeldet`), `apps/jufi/src/app/seiten/verein-start.ts` (Link „Meine Jungfischer", nur wenn `hatKinder`)

**Interfaces:**

- Consumes: `MitgliederApi.meineJungfischer`, `setzeKindZugang`, `kindEinladung`, `kindEinwilligung`; Gestaltung `KarteComponent`.
- Produces: Seite `/<slug>/jungfischer` mit einer Karte je Kind: Name, Jugendsprecher-Hinweis („Lena ist Jugendsprecherin und nimmt am Austausch mit den Jugendleitern teil."), Untergruppen, Familie mit Beziehung, Zugangsstand. Aktionen nur bei `ichBinErziehungsberechtigt && !volljaehrig`: „Zugang erlauben/entziehen", „Neuen Link erzeugen" (zeigt Link und Text mit Kopieren), „Einwilligung geben/widerrufen" (Widerruf mit Bestätigungsfrage, die nennt, dass der Zugang des Kindes endet, wenn keine andere Einwilligung besteht). Volljähriges Kind: Hinweistext statt Aktionen.

- [ ] **Step 1: Tests schreiben:** `zeigt die Kinder mit Familie und Untergruppen`; `Großmutter sieht keine Aktionen`; `volljähriges Kind zeigt Hinweis statt Aktionen`; `Widerruf fragt erst nach, sendet erst nach Bestätigung`; `Fehler 409 EINWILLIGUNG_FEHLT erscheint als Text`; `Link-Erzeugung zeigt Link und Kopieren-Knopf`.
- [ ] **Step 2:** Run: `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** Run — Expected: PASS; Build grün.
- [ ] **Step 5: Commit** `Frontend: Meine Jungfischer`

---

### Task 15: Frontend — Verwaltung: Mitglieder und Personenseite

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/mitglieder.ts`, `personenseite.ts`, `person-neu.ts`, je `*.spec.ts`
- Modify: `app.routes.ts` (`verwaltung`, `verwaltung/neu`, `verwaltung/personen/:id`), `verein-start.ts` (Link „Verwaltung", nur Jugendleiter)

**Interfaces:**

- Consumes: `MitgliederApi`-Methoden aus Task 13. Die Oberfläche blendet Knöpfe nach den Rechten aus `GET /ich` aus (`MITGLIEDER`, `JUGENDLEITER_RECHTE`); der Server entscheidet trotzdem.
- Produces:
  - **Liste** `/<slug>/verwaltung`: Suche (Name), Filter (Jungfischer/Erwachsene, Untergruppe, „mit Warnhinweis"), Warnhinweise in deutschem Wortlaut der Spec („Ohne erziehungsberechtigte Familie", „Einwilligung fehlt", „Einladung offen, läuft am … ab", „Einladungsmail nicht zustellbar", „Volljährig seit …"); ohne E-Mail für Betreuer.
  - **Neu** `/<slug>/verwaltung/neu`: Jungfischer oder Erwachsener; bei `DOPPELT` die übergehbare Warnung mit „Trotzdem anlegen".
  - **Personenseite** `/<slug>/verwaltung/personen/:id`: Stammdaten ändern, Jugendsprecher-Häkchen, Untergruppen-Auswahl, Familie hinzufügen (vorhandenen Erwachsenen wählen oder neu anlegen; Beziehung; erziehungsberechtigt vorbelegt), Zuordnung lösen, Zugang (Einladung mit WhatsApp-Text, Kopieren, „Per Mail senden" nur mit Adresse; Status und Ablauf; bei 409 der Grund), Volljährigkeitshinweis mit „Belassen / Familie lösen / Aus der Gruppe entfernen", Entfernen mit Bestätigung und anschließender Frage zum Folgeangebot („Opa Hans hat keine Jungfischer mehr in der Gruppe – auch entfernen?").

- [ ] **Step 1: Tests schreiben:** `Liste filtert nach Suche, Art, Untergruppe und Warnhinweis`; `Betreuer sieht keine E-Mail-Spalte und keine Bearbeiten-Knöpfe`; `Dublette zeigt Warnung und Trotzdem-Knopf, der mit trotzdem:true sendet`; `Familie hinzufügen belegt erziehungsberechtigt bei Mutter vor, bei Großmutter nicht`; `Entfernen fragt nach und zeigt danach das Folgeangebot`; `Einladen-Knopf nennt den Grund bei 409 EINWILLIGUNG_FEHLT`; `Volljährigkeitshinweis bietet die drei Wege`.
- [ ] **Step 2:** Run: `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Schlicht: eine Spalte auf dem Handy, Tabelle ab 768 px; keine Hülle (Etappe 5).
- [ ] **Step 4:** Run — Expected: PASS; Build grün.
- [ ] **Step 5: Commit** `Frontend: Verwaltung der Mitglieder`

---

### Task 16: Frontend — Untergruppen, Jugendleiter & Rechte

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/untergruppen.ts`, `rechte.ts`, je `*.spec.ts`
- Modify: `app.routes.ts` (`verwaltung/untergruppen`, `verwaltung/rechte`)

**Interfaces:**

- Produces: **Untergruppen** `/<slug>/verwaltung/untergruppen`: Liste mit Anzahl, Anlegen, Umbenennen, Löschen mit Hinweis „Das Löschen entfernt keine Personen". **Rechte** `/<slug>/verwaltung/rechte`: alle Erwachsenen mit Rechten und die Möglichkeit, einer Person Rechte zu geben; Rechtetabelle mit den Vorlagen Leitung, Jugendleiter, Betreuer und danach jedem Häkchen einzeln; 409 `LETZTE_LEITUNG` mit Text „Mindestens eine Person muss Jugendleiter & Rechte verwalten dürfen."; nur mit `JUGENDLEITER_RECHTE` sichtbar.

- [ ] **Step 1: Tests schreiben:** `Vorlage Jugendleiter setzt alle Häkchen außer JUGENDLEITER_RECHTE und EINSTELLUNGEN`; `Einzelhäkchen lassen sich danach ändern`; `LETZTE_LEITUNG erscheint als Text`; `Untergruppe löschen fragt nach`; `ohne JUGENDLEITER_RECHTE zeigt die Rechteseite nur den Hinweis "Nicht gefunden"`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** Run — Expected: PASS; Build grün.
- [ ] **Step 5: Commit** `Frontend: Untergruppen und Rechte`

---

### Task 17: Anmeldung härten — Minors M1 bis M3

Aus dem Gesamtreview von Etappe 3; sie passen hier, weil Etappe 4 die Konten verwaltet, die sich anmelden.

**Files:**

- Modify: `libs/auth/src/lib/rate-limit.ts` (M1), `apps/jufi/src/server/mitglieder/anmeldung.ts` (M2), `libs/auth/src/lib/zwischenmarke.ts` und deren Aufrufer in `apps/jufi/src/server/mitglieder/anmeldung.ts` und `apps/jufi/src/server/admin/anmeldung.ts` (M3)
- Test: `libs/auth/src/lib/rate-limit.spec.ts`, `zwischenmarke.spec.ts`, `apps/jufi/src/server/mitglieder/anmeldung.spec.ts`

**Interfaces:**

- M1: Läuft `MAX_SCHLUESSEL` über, werden beim Verdrängen zuerst Schlüssel ohne aktive Sperre entfernt (älteste zuerst); gesperrte Schlüssel bleiben. Sind alle gesperrt, lehnt `reserviere` den neuen Schlüssel ab (fail-closed) statt einen Gesperrten zu löschen. Verworfen: weiter den ältesten zu entfernen — ein Angreifer löschte so mit 10 000 Fremdschlüsseln eine laufende Sperre.
- M2: Ein erfolgreicher Login setzt nur den Schlüssel `m:<vereinId>:<kennung>` zurück, **nicht** `m-ip:`; sonst setzte ein eigenes gültiges Konto den Zähler eines Angreifers derselben IP zurück.
- M3: `erzeugeZwischenmarke`/`pruefeZwischenmarke` nehmen einen `typ`-Parameter (`'m-totp'`, `'admin-totp'`) und binden ihn in die Signatur; eine Marke des einen Typs ist für den anderen ungültig.

- [ ] **Step 1: Tests schreiben:** M1: `Überlauf entfernt zuerst nicht gesperrte Schlüssel`, `eine Sperre überlebt 10 000 Fremdschlüssel`, `bei lauter Sperren wird ein neuer Schlüssel abgelehnt`. M2: `Erfolg eines Kontos lässt den m-ip-Zähler stehen` (nach Fehlversuchen derselben IP und einem Login bleibt der IP-Zähler). M3: `Marke mit anderem Typ → ungültig`, `Admin-Marke gilt nicht für Mitglieder-TOTP und umgekehrt`.
- [ ] **Step 2:** Run: `pnpm nx run-many -t test test-server -p auth jufi --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5: Commit** `Anmeldung: Rate-Limit-Ueberlauf, IP-Zaehler, Zwischenmarke mit Typ`

---

### Task 18: Demo, Spec- und Doku-Nachzug, Abschluss

**Files:**

- Modify: `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md` (Entscheidungen 1–7 in 5.4, 5.6, 5.8, 4.2, 8.6), `CLAUDE.md` (Stand: Etappe 4; Routenliste unverändert), `README.md` (kurzer Absatz), CLI-Demo `apps/cli/src/…` (Demo-Verein bekommt Untergruppen, ein Kind ohne Einwilligung, eine Familie), Memory `jufi-app-projekt.md`
- Test: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`, `pnpm exec prettier --check .`

- [ ] **Step 1: Demo erweitern** (`pnpm run demo`): Verein mit zwei Untergruppen, drei Jungfischern (einer ohne Einwilligung, einer mit 17 Jahren und 364 Tagen, einer Jugendsprecher), zwei Familien, einem Betreuer. Test der CLI-Funktion, falls dort vorhanden.
- [ ] **Step 2: Gesamtlauf:** Run: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck build --skip-nx-cache` — Expected: grün.
- [ ] **Step 3: Von Hand prüfen** (erfundene Daten, 375 × 812 und 1280 × 800, hell und dunkel, gemessen mit `getBoundingClientRect`/`scrollWidth`): Einladung mit Einwilligung, Meine Jungfischer (Widerruf), Verwaltung (Anlegen, Dublette, Familie, Untergruppen, Rechte, Entfernen mit Folgeangebot).
- [ ] **Step 4: Spec und Doku nachziehen; `pnpm exec prettier --check .`** — Expected: sauber.
- [ ] **Step 5: Commit** `Etappe 4: Demo, Spec-Nachzug, Doku`
