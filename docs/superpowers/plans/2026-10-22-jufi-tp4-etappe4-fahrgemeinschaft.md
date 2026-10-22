# JuFi TP4 Etappe 4 — Fahrgemeinschaft — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Threads bekommen das Modul „Fahrgemeinschaft“ mit Hin- und/oder Rückfahrt. Erwachsene bieten ein Auto an (Plätze, Abfahrt, Ort, Notiz). Bezugspersonen setzen ihre Kinder hinein oder auf „kommt selbst“, Jungfischer mit Zugang sich selbst. „Braucht noch Mitfahrt“ zeigt die betrachteten Kinder ohne Platz. Die Leitung setzt Kinder um, ändert Plätze und löscht Autos. Wird ein Auto mit Kindern zurückgezogen, steht das im Verlauf. Die Antworten-Übersicht zeigt die Fahrgemeinschaft zum Umsetzen (Spec 1.4 Etappe 4, Abschnitte 6 und 8; Rahmen 6.4.1).

**Architecture:**

- Reine Regeln in `libs/domain`:
  - `module/fahrt/fahrt.ts`: betrachtete Kinder, „Braucht noch Mitfahrt“, Rechte (anbieten, ändern, einsetzen, herausnehmen), Platzprüfung, Formprüfung des Autos, Sperre und Konflikte im Editor, Ansicht.
  - `threads/{typen,entwurf,vergleich,ansicht,start,verwaltung,verlauf,teilen}.ts`: der neue Typ in Entwurf, Vergleich, Ansicht, „Neu“, Antworten-Übersicht und der Systemsatz `AUTO_ZURUECKGEZOGEN`.
- Module folgen TP3 und Etappe 3:
  - Kopfzeile `ThreadModul` mit `ModulTyp.FAHRT`, dazu die 1:1-Tabelle `FahrtModul` und die Tabellen `Auto` und `Mitfahrt`.
  - Die Richtungen werden über `POST/PUT /threads` gespeichert.
  - Autos laufen über `POST /fahrten/:modulId/autos`, `PUT` und `DELETE /autos/:id`; Mitfahrten über `PUT` und `DELETE /fahrten/:modulId/:richtung/:kindId`. Gebaut nach dem Muster von `server/threads/helfer.ts`.
- Client:
  - `jf-fahrt-modul` auf der Thread-Seite setzt die Ansicht aus der Antwort ein, wie die Helferliste.
  - `jf-fahrt-felder` im Editor.
  - Die Antworten-Übersicht zeigt `jf-fahrt-modul` mit der Ansicht der Leitung.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (Signale, OnPush, inline), Express 4, Prisma 7, Postgres 17, Vitest 4, Playwright. Keine neuen Pakete.

**Spec:** `docs/superpowers/specs/2026-10-21-jufi-tp4-module-medien-design.md`, Abschnitte 1.4, 6, 8, 9.1–9.3, 10, 13.1, 13.2. Dazu TP3-Spec 2.3 (clientId, NoAction), 3.3 (Antwortrecht), 3.7 (Archiv), 3.9 („Neu“), 3.10 (Namen), 4.2 (Schreibpfad) und Rahmen 6.4.1.

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 10 trägt sie in die TP4-Spec ein. Die mit ⚑ hat der Eigentümer noch nicht bestätigt; sie stehen in der Übergabe.

1. **Ein Auto trägt eine `clientId`** (Spec 6.1 nennt sie nicht, Spec 8 verlangt sie „je Eintragungs-Route“). `POST /fahrten/:modulId/autos` erkennt so die Wiederholung. Ohne sie bekäme eine wiederholte Anfrage 409 `AUTO_SCHON_DA`, weil das Auto aus der ersten schon steht.
2. **`PUT /autos/:id` nimmt keine `clientId`.** Es setzt Werte; eine Wiederholung setzt dieselben. Ändert sich nichts, antwortet die Route 200 und schreibt nichts.
3. **`DELETE /autos/:id` eines unbekannten Autos ergibt 404.** Nach dem Löschen gibt es keine Zeile mehr, die ein wiederholtes Zurückziehen von einem fremden Auto unterschiede. Der Client behandelt 404 wie bei der Helferliste: Satz am Modul und still neu laden.
4. **Der Systemeintrag `AUTO_ZURUECKGEZOGEN` entsteht nur, wenn Kinder im Auto saßen.** Er speichert `{ fahrerId, richtung, kindIds }`; die Namen entstehen beim Lesen (wie alle Systemsätze, `verlauf.ts`). `systemSatz` bekommt dafür das `Umfeld` als vierten Parameter. Verworfen: die Namen speichern, denn dann stünde ein später entferntes Kind weiter mit Namen im Verlauf.
5. **Eine Mitfahrt ist ein Upsert je `(modulId, richtung, kindId)`.**
   - Wechselt `autoId`, werden `autoId`, `vonId`, `clientId` und `eingetragenAm` (= jetzt) überschrieben; die Reihenfolge im Auto ist die des Einsteigens.
   - Bleibt `autoId` gleich, antwortet die Route 200 und schreibt nichts.
6. **`DELETE /fahrten/:modulId/:richtung/:kindId` nimmt keine `clientId` und ist idempotent**, wie das Austragen aus der Helferliste (Spec 8). Ohne Mitfahrt: 200 mit frischer Ansicht, ohne Schreiben.
7. **Nicht betrachtete Kinder** (ohne „Dabei“ bei einer Teilnahme-Umfrage) ergeben beim Einsetzen 409 `{ fehler: 'Mitfahren kann nur, wer zugesagt hat.', code: 'NICHT_DABEI' }`. Das gilt für Autos und für „kommt selbst“, auch für die Leitung (Spec 6.2: „ein Vielleicht reserviert keinen Platz“). Herausnehmen geht immer.
8. **Ein Auto bietet jede Person nur für sich selbst an.** Die Leitung legt keine Autos für andere an. Verworfen: Autos im Namen anderer, denn wer fährt, soll das selbst zusagen.
9. **Höchstens eine Fahrgemeinschaft je Thread** über `@@unique([vereinId, threadId])` an `FahrtModul`. Spec 6.1 nennt einen Partial-Unique-Index, aber jede Zeile von `FahrtModul` ist eine Fahrgemeinschaft; eine Bedingung gibt es nicht. Der Editor meldet `Es gibt schon eine Fahrgemeinschaft.`, und „Modul hinzufügen“ bietet keine zweite an.
10. **Editor:**
    - Eine Richtung mit Autos oder Mitfahrten lässt sich nicht abschalten (409 `Für die Hinfahrt gibt es schon Autos oder Mitfahrten.` bzw. `Rückfahrt`).
    - Eine Fahrgemeinschaft mit Autos oder Mitfahrten lässt sich nicht entfernen (409 `Die Fahrgemeinschaft hat schon Einträge und lässt sich nicht entfernen.`).
11. **„Neu“:** Alle Leser sehen die Fahrgemeinschaft. Deshalb ist `antwortenSichtbar` mit Fahrgemeinschaft für Nicht-Entfernte immer `true`, wie bei der Helferliste.
12. **Änderungsart:** Autos und Mitfahrten schreiben `ANTWORT` mit `objektId` = Modul-ID (Spec 8). Der Systemeintrag schreibt zusätzlich `VERLAUF` mit der ID des Eintrags.
13. ⚑ **Das Entfernen einer Person (Spec 12.2) bleibt in Etappe 6**, wie in 1.4. Bis dahin bleibt das Auto einer entfernten Person stehen; Fahrer und Kinder heißen „ehemaliges Mitglied“, und die Leitung kann das Auto löschen.
14. ⚑ **Die Fahrgemeinschaft ist in jedem Rollenfilter erlaubt.** Die Spec schränkt nur Kosten ein. In einem Thread ohne Jungfischer bleibt „Braucht noch Mitfahrt“ leer.
15. **Vorbelegung des Abfahrtstags:** Die Ansicht liefert je Richtung `vorschlagTag`: hin das Startdatum, rück den letzten Tag (`letzterTag`) des ersten Termins in Modulreihenfolge, ohne Termin `null`. Nur der Tag, keine Uhrzeit (Spec 6.2).
16. **Reihenfolge:** Autos nach `angelegtAm`, dann `id`; Mitfahrer nach `eingetragenAm`; „Braucht noch Mitfahrt“ und „Kommt selbst“ nach `kurzname` (`localeCompare` mit `'de'`).
17. **Antworten-Übersicht:** Sie zeigt die Fahrgemeinschaft als `jf-fahrt-modul` mit der Ansicht der Leitung (`AntwortenUebersicht.fahrt`). Verworfen: eine eigene Tabelle. Umsetzen braucht dieselben Bedienelemente wie auf der Thread-Seite.
18. **Demo:** Bowling bekommt eine Fahrgemeinschaft (hin und rück). Sandra bietet die Hinfahrt an (3 Plätze, `Vereinsheim`, 15:30) und setzt Lena hinein. Ein Kind mit Zusage steht unter „Braucht noch Mitfahrt“. Das Zeltlager bleibt in Etappe 6.

**Nicht in dieser Etappe:**

- Teilen-Zeilen „🚗 Hin: …“, Datenauszug der Autos und Mitfahrten, Entfernen einer Person mit Auto, Demo-Zeltlager und Ende-zu-Ende-Zeltlager (Etappe 6, Spec 11–13).
- Push bei zurückgezogenem Auto (Teilprojekt 5).
- Kosten (Etappe 5).
- Rückstand aus Etappe 3: Die Eigentümerfragen (gesperrtes „Entfernen“, Archivprüfung der Umfrage) bleiben offen. Aus dem Etappe-3-Review kommt nur `modulVon` mit (Task 4).

## Global Constraints

- Code-Kommentare und Oberfläche sind deutsch. Commit-Nachrichten deutsch in ASCII (Umlaute umschrieben), mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Einrückung mit Tabs. Ausnahmen: YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative. **In `template:`/`styles:` keine Backticks in Kommentaren.**
- Angular: Vorlagen und Stile inline, `@if`/`@for`/`@switch`, Signale, `ChangeDetectionStrategy.OnPush`, Präfix `jf-`, Tokens aus `styles.css`.
- Regeln sind reine Funktionen; in `libs/domain` nie `new Date()` ohne Argument.
- Vereinsdaten nur über `vereinDb`. Was die Person nicht sehen oder nicht tun darf: 404. Ohne Sitzung: 401.
- „Leitung“ heißt hier: darf den Thread bearbeiten (`darfBearbeiten`, wie bei der Helferliste).
- Schreibpfad nach TP3 4.2 und Spec 8, in dieser Reihenfolge:
  1. Rate-Limit (`antwortenFenster`, vorhanden);
  2. 400;
  3. 404;
  4. Wiederholung über `clientId`;
  5. 409 (`ENTWURF`, `ARCHIVIERT`, `NICHT_DABEI`, `VOLL`, `AUTO_SCHON_DA`, `PLAETZE`);
  6. `mitAenderung` mit Neuprüfung unter der Sperre;
  7. nach dem Commit `deps.bus`;
  8. Antwort `{ modul: FahrtModulAnsicht, stand }`.
- Die Fahrgemeinschaft hat keine Frist; 410 gibt es hier nicht.
- Grenzen (in `GRENZEN`, `entwurf.ts`): `plaetze: 8`, `autosJeRichtung: 30`, `autoText: 200` (Ort und Notiz). Länge in Codepunkten (`laenge`), nach `trim`. Dieselben Zahlen stehen als CHECKs im Schema.
- Texte (wörtlich):
  - Modultyp in „Modul hinzufügen“ und Ersatztitel: `Fahrgemeinschaft`
  - Richtungen: `Hinfahrt`, `Rückfahrt`; Umschalter `Hin` / `Rück`
  - Editor:
    - `Bitte mindestens eine Richtung.`
    - `Es gibt schon eine Fahrgemeinschaft.` (`konflikt: true`, wie bei der Teilnahme)
  - Konflikte (409, `konflikt: true`):
    - `Für die Hinfahrt gibt es schon Autos oder Mitfahrten.` / `Für die Rückfahrt gibt es schon Autos oder Mitfahrten.`
    - `Die Fahrgemeinschaft hat schon Einträge und lässt sich nicht entfernen.`
  - Routen:
    - `VOLL` am Auto: `{ fehler: 'In diesem Auto ist kein Platz mehr frei.', code: 'VOLL' }`
    - `VOLL` bei 30 Autos: `{ fehler: 'Für diese Fahrt gibt es schon 30 Autos.', code: 'VOLL' }`
    - `{ fehler: 'Du bietest für diese Fahrt schon ein Auto an.', code: 'AUTO_SCHON_DA' }`
    - `{ fehler: 'Es fahren schon <n> Kinder mit.', code: 'PLAETZE' }` (bei 1: `Es fährt schon 1 Kind mit.`)
    - `{ fehler: 'Mitfahren kann nur, wer zugesagt hat.', code: 'NICHT_DABEI' }`
    - Form: 400 `ungueltigesFeld('plaetze' | 'abfahrtTag' | 'abfahrtZeit' | 'ort' | 'notiz' | 'autoId' | 'clientId')`. Ort und Notiz mit Steuer-/Formatzeichen (`\p{Cc}`, `\p{Cf}`) sind ungültig.
  - Systemsatz: `Auto von <kurzname Fahrer> (Hinfahrt) zurückgezogen – <Kurznamen mit undListe> brauchen wieder eine Mitfahrt.`; bei einem Kind `braucht wieder eine Mitfahrt.` Der Fahrer steht mit `kurzname`, nicht mit `absenderName`: Dessen Klammer („Mutter von …“) stünde neben „(Hinfahrt)“. Unbekannte Personen heißen `EHEMALIGES_MITGLIED`.
  - Thread-Seite:
    - Karte: Fahrer (`absenderName`), Abfahrt (`tagKurz(abfahrtTag)` und Zeit, wie vorhanden), Ort, Notiz, `<n> frei` bzw. `voll`, Mitfahrer als Kurznamen; ein nicht betrachtetes Kind mit dem Zusatz `nicht mehr dabei`.
    - Abschnitte `Braucht noch Mitfahrt` (leer: `Alle haben eine Mitfahrt.`) und `Kommt selbst`.
    - Knöpfe: `Auto anbieten`, `Auto ändern`, `Auto zurückziehen`, `Einsteigen` (am Auto, für Kinder `<Vorname> einsteigen`), `Kommt selbst` (für Kinder `<Vorname> kommt selbst`), `Herausnehmen`, für die Leitung `Umsetzen`.
    - Formular `Auto anbieten`: `Plätze für Kinder` (1–8), `Abfahrt am`, `Uhrzeit`, `Treffpunkt` (Feld `ort`), `Notiz (optional)`, Knöpfe `Anbieten` bzw. `Speichern` und `Abbrechen`.
    - Rückfrage beim Zurückziehen mit Kindern (`jf-bestaetigung`): `Lena M. und Max M. brauchen dann wieder eine Mitfahrt.`
- Im Browser und in Tests nur erfundene Daten.
- Nach jeder Task grün: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache`. Unter Last `jufi:test-server` mit `-- --maxWorkers=3`; scheitert Nx am Projektgraphen, mit `NX_DAEMON=false NX_ISOLATE_PLUGINS=false`.
- Client-Tests filtern mit `--include=<glob>`, nicht mit Positionsargumenten.
- Vor dem Abschluss: `pnpm exec prettier --check .` und `pnpm run e2e`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp4-etappe4-fahrt`.

## Review Focus

1. **Letzter Platz, zwei Familien gleichzeitig:** Ein Auto hat 2 von 3 Plätzen belegt, zwei Familien setzen im selben Moment ihr Kind hinein. Genau eine bekommt 200, die andere 409 `VOLL`, und die Karte zeigt `voll`, nicht 4 Mitfahrer (Task 6).
2. **Auto zurückziehen mit Kindern:** Die Mitfahrten verschwinden, die Kinder stehen wieder unter „Braucht noch Mitfahrt“, und im Verlauf steht genau ein Satz mit ihren Namen. Ohne Kinder entsteht kein Satz. Ein zweites `DELETE` ergibt 404, keinen zweiten Satz (Tasks 2, 5).
3. **Absage nach dem Einsteigen:** Das Kind bleibt im Auto, belegt seinen Platz und zeigt `nicht mehr dabei`. Erneutes Einsetzen ergibt 409 `NICHT_DABEI`, Herausnehmen geht (Tasks 1, 6).
4. **Löschen und Abschalten mit Einträgen:** Plätze unter die Zahl der Mitfahrer, eine Richtung mit Autos abschalten, die Fahrgemeinschaft entfernen: jeweils 409 mit Text, nie ein Fremdschlüsselfehler. Der Thread ist gesperrt (`NICHT_LOESCHBAR`), die Vereinslöschung geht durch (Tasks 2, 3, 4, 5).
5. **Wiederholte Anfrage:** Dieselbe `clientId` beim Anbieten und beim Einsetzen ergibt 200 ohne zweite Änderung. Ein Umsetzen in dasselbe Auto und ein zweites `DELETE` einer Mitfahrt ergeben 200 ohne Schreiben (Tasks 5, 6).

## Dateistruktur

```
libs/domain/src/module/fahrt/fahrt.ts (+ spec)            NEU: betrachtete Kinder, Rechte, Plätze, Form, Sperre, Konflikte, Ansicht
libs/domain/src/threads/{typen,ansicht,entwurf,vergleich,start,verwaltung,verlauf,teilen}.ts
libs/domain/src/index.ts
prisma/schema.prisma, prisma/migrations/<stamp>_fahrt/migration.sql
libs/db/src/lib/verein-db.ts, libs/db/src/{schema,verein-db}.spec.ts
apps/jufi/src/server/threads/autos.ts (+ spec)             NEU: POST /fahrten/:modulId/autos, PUT/DELETE /autos/:id
apps/jufi/src/server/threads/mitfahrten.ts (+ spec)        NEU: PUT/DELETE /fahrten/:modulId/:richtung/:kindId
apps/jufi/src/server/threads/{schreiben,laden,lesen,bearbeitung,verlauf,routen,fehler,test-threads}.ts
apps/jufi/src/server/mandanten.spec.ts
apps/jufi/src/app/verein/threads/fahrt-modul.ts (+ spec)   NEU: jf-fahrt-modul
apps/jufi/src/app/verein/threads/{thread-api,thread-seite}.ts
apps/jufi/src/app/verein/verwaltung/threads/fahrt-felder.ts (+ spec)  NEU: jf-fahrt-felder
apps/jufi/src/app/verein/verwaltung/threads/{editor,vorschau,antworten}.ts
apps/cli/src/demo.ts, apps/jufi-e2e/src/{ablauf,layout}.spec.ts, README.md, CLAUDE.md
```

---

### Task 1: Regeln für betrachtete Kinder, Rechte und Plätze

**Files:**

- Create: `libs/domain/src/module/fahrt/fahrt.ts`, `fahrt.spec.ts`
- Modify: `libs/domain/src/threads/typen.ts`, `ansicht.ts` (`threadDatenAus`), `start.ts` (`siehtErgebnisse`), `entwurf.ts` (nur `GRENZEN`), `index.ts` und deren Specs. Alle Stellen, die `ThreadDaten` bauen (Specs in `libs/domain`, `apps/jufi/src/server`), bekommen `fahrt: null`.

**Interfaces:**

- Produces (`typen.ts`):
  - `type Richtung = 'HIN' | 'RUECK'`
  - `interface AutoDaten { id: string; fahrerId: string; richtung: Richtung; plaetze: number; abfahrtTag: string | null; abfahrtZeit: string | null; ort: string | null; notiz: string | null; angelegtAm: Date }`
  - `interface MitfahrtDaten { richtung: Richtung; kindId: string; autoId: string | null; vonId: string; eingetragenAm: Date }` (`autoId: null` heißt „kommt selbst“)
  - `interface FahrtDaten { modulId: string; titel: string | null; hin: boolean; rueck: boolean; autos: readonly AutoDaten[]; mitfahrten: readonly MitfahrtDaten[] }`, Autos nach Entscheidung 16, Mitfahrten nach `eingetragenAm`
  - `ThreadDaten.fahrt: FahrtDaten | null`
- Produces (`module/fahrt/fahrt.ts`):
  - `type FahrtErlaubnis = 'ERLAUBT' | 'NICHT_GEFUNDEN' | 'ENTWURF' | 'ARCHIVIERT' | 'NICHT_DABEI'`
  - `type FahrtKontext = { kopf: ThreadKopf; termine: readonly TerminDaten[]; umfragen: readonly UmfrageDaten[] }` (was die Regeln aus `ThreadDaten` brauchen)
  - `betrachteteKinder(kopf: ThreadKopf, daten: Pick<ThreadDaten, 'umfragen'>, umfeld: Umfeld): ThreadPerson[]`
    - `kinderImThread(kopf, umfeld)`, gefiltert mit `dabeiKinder` (`null` heißt: alle).
  - `brauchtMitfahrt(fahrt: FahrtDaten, richtung: Richtung, betrachtete: readonly ThreadPerson[]): ThreadPerson[]`
    - Betrachtete ohne Mitfahrt in dieser Richtung, nach `kurzname`.
  - Alle Rechte prüfen in dieser Reihenfolge: Thread sichtbar (`siehtThread` wie in `darfAntworten`), sonst `NICHT_GEFUNDEN`; nicht veröffentlicht → `ENTWURF`; archiviert (`istArchiviert(kopf, termine, jetzt)`) und keine Leitung → `ARCHIVIERT`; dann das eigene Recht.
  - `darfAnbieten(person: ThreadPerson, daten: FahrtKontext, umfeld: Umfeld, jetzt: Date): FahrtErlaubnis`. Eigenes Recht: `person.art === 'ERWACHSENER'`, sonst `NICHT_GEFUNDEN`.
  - `darfAutoAendern(person, auto: Pick<AutoDaten, 'fahrerId'>, daten, umfeld, jetzt): FahrtErlaubnis`. Eigenes Recht: Fahrer oder Leitung. Gilt auch fürs Zurückziehen.
  - `darfEinsetzen(person, kindId: string, daten: FahrtKontext, umfeld, jetzt): FahrtErlaubnis`
    - Eigenes Recht: Leitung, oder `darfAntworten(person, kindId, { einheit: 'JUNGFISCHER', frist: null }, kopf, umfeld, jetzt) === 'ERLAUBT'`. Sonst `NICHT_GEFUNDEN`.
    - Ist `kindId` kein Kind des Threads (`kinderImThread`), `NICHT_GEFUNDEN`; ist es nicht betrachtet, `NICHT_DABEI` (Entscheidung 7).
  - `darfHerausnehmen(person, mitfahrt: Pick<MitfahrtDaten, 'kindId' | 'autoId'>, fahrt: FahrtDaten, daten, umfeld, jetzt): FahrtErlaubnis`
    - Eigenes Recht: Leitung; der Fahrer des Autos, in dem das Kind sitzt; oder das Antwortrecht für `kindId` wie oben, ohne Betrachtet-Prüfung (Spec 6.2).
  - `hatPlatzIn(auto: AutoDaten, fahrt: FahrtDaten, kindId: string): boolean`. `true`, wenn das Kind schon darin sitzt oder weniger Mitfahrten als `plaetze` auf das Auto zeigen.
  - `type AutoEingabe = { plaetze: number; abfahrtTag: string | null; abfahrtZeit: string | null; ort: string | null; notiz: string | null }`
  - `pruefeAuto(roh: unknown): { ok: true; auto: AutoEingabe } | { ok: false; feld: keyof AutoEingabe }`
    - `plaetze`: ganze Zahl 1–8.
    - `abfahrtTag`: `istKalendertag` oder `null`.
    - `abfahrtZeit`: `HH:MM` (wie `UHRZEIT` in `termin.ts`) oder `null`.
    - `ort`, `notiz`: nach `trim` leer → `null`; über 200 Codepunkte, `\p{Cc}` oder `\p{Cf}` → ungültig.
    - Fehlende Felder gelten als `null`, fehlende `plaetze` als ungültig.
- `GRENZEN` bekommt `plaetze: 8`, `autosJeRichtung: 30`, `autoText: 200`.
- `siehtErgebnisse` ist mit `fahrt !== null` und `!ich.entferntAm` `true` (Entscheidung 11); der `Pick` nimmt `'fahrt'` dazu.

- [ ] **Step 1: Branch anlegen:** `git switch -c feature/tp4-etappe4-fahrt`
- [ ] **Step 2: Tests schreiben** (`fahrt.spec.ts`, `start.spec.ts`; Personen und Umfeld aus den Testhilfen der Domain, Thread mit Rollenfilter `JUNGFISCHER_FAMILIE`):
  - `betrachteteKinder`:
    - ohne Teilnahme-Umfrage → alle Kinder des Threads;
    - mit Teilnahme: Lena `dabei`, Max `vielleicht`, Mia ohne Antwort → nur Lena (Spec 13.1 `brauchtMitfahrt`).
  - `brauchtMitfahrt`: Lena im Auto, Max auf „kommt selbst“, Mia ohne Mitfahrt → `[Mia]`; in der anderen Richtung alle drei, nach Kurzname.
  - `hatPlatzIn`: 2 von 3 → `true`; 3 von 3 für ein neues Kind → `false`; 3 von 3 für ein Kind darin → `true`; „kommt selbst“-Mitfahrten zählen nicht.
  - `pruefeAuto`:
    - `{ plaetze: 3, abfahrtTag: '2026-10-23', abfahrtZeit: '15:30', ort: ' Vereinsheim ', notiz: '' }` → ok mit `ort: 'Vereinsheim'`, `notiz: null`;
    - `plaetze` 0, 9, 2.5, `'3'` → `feld: 'plaetze'`;
    - `abfahrtTag: '2026-02-30'` → `abfahrtTag`; `abfahrtZeit: '24:00'` → `abfahrtZeit`;
    - `ort` mit 201 Zeichen → `ort`; 200 × `'ä'` → ok; `notiz: 'a‮b'` → `notiz`.
  - `darfAnbieten`: Mutter → `ERLAUBT`; Jungfischer → `NICHT_GEFUNDEN`; Entwurf → `ENTWURF`; archiviert → `ARCHIVIERT`, Leitung dann `ERLAUBT`; wer den Thread nicht sieht → `NICHT_GEFUNDEN`, auch im Archiv.
  - `darfAutoAendern`: Fahrerin → `ERLAUBT`; andere Mutter → `NICHT_GEFUNDEN`; Leitung → `ERLAUBT`; Fahrerin im Archiv → `ARCHIVIERT`.
  - `darfEinsetzen`:
    - Mutter für Lena (dabei) → `ERLAUBT`; für Max (vielleicht) → `NICHT_DABEI` (Review Focus 3);
    - Mutter für ein fremdes Kind → `NICHT_GEFUNDEN`;
    - Jungfischer mit Zugang für sich → `ERLAUBT`, für ein anderes Kind → `NICHT_GEFUNDEN`;
    - Leitung für jedes betrachtete Kind → `ERLAUBT`, für Max → `NICHT_DABEI`;
    - eine erwachsene Person als `kindId` → `NICHT_GEFUNDEN`.
  - `darfHerausnehmen`:
    - Mutter für Max, der nach der Absage noch im Auto sitzt → `ERLAUBT` (Review Focus 3);
    - Fahrerin für ein fremdes Kind in ihrem Auto → `ERLAUBT`, in einem anderen Auto → `NICHT_GEFUNDEN`;
    - Leitung → `ERLAUBT`.
  - `siehtErgebnisse`: Thread nur mit Fahrgemeinschaft → `true`; mit `entferntAm` → `false`.
  - `start.ts`: Ein Thread nur mit Fahrgemeinschaft und einem Kind ohne Mitfahrt steht nicht unter „Braucht deine Antwort“ (Spec 6.2).
- [ ] **Step 3: Tests scheitern:** `pnpm nx test domain --skip-nx-cache`, FAIL.
- [ ] **Step 4: Umsetzen**, über `index.ts` exportieren. Der Kommentar an `darfEinsetzen` nennt Entscheidung 7, der an `darfHerausnehmen` Spec 6.2 („Abgesagt, aber im Auto“).
- [ ] **Step 5: Tests grün**, dazu `pnpm nx run-many -t typecheck` (neues Pflichtfeld `fahrt`).
- [ ] **Step 6: Commit:** `git commit -m "TP4 Etappe 4: Regeln fuer Fahrgemeinschaft, Rechte und Plaetze"`

---

### Task 2: Entwurf, Vergleich, Ansicht, Übersicht und Systemsatz

**Files:**

- Modify: `libs/domain/src/module/fahrt/fahrt.ts`, `libs/domain/src/threads/entwurf.ts`, `vergleich.ts`, `ansicht.ts`, `verwaltung.ts`, `verlauf.ts`, `teilen.ts`, `index.ts` und Specs

**Interfaces:**

- Consumes: Task 1
- Produces:
  - `ModulEntwurf` bekommt `{ typ: 'FAHRT'; id: string | null; titel: string | null; hin: boolean; rueck: boolean }`. `MODULTYPEN` bekommt `'FAHRT'`.
  - `neuesModul('FAHRT', …)` → `hin: true`, `rueck: true`, `titel: null`.
  - `ModulDaten` bekommt `{ typ: 'FAHRT'; id: string; titel: string | null; fahrt: FahrtDaten }`. `threadDatenAus` füllt `fahrt`.
  - `FahrtSperre = { eingetragen: boolean; HIN: boolean; RUECK: boolean }` (je Richtung: Autos oder Mitfahrten vorhanden) und `fahrtSperre(f: FahrtDaten): FahrtSperre`
  - `FahrtKonflikt = { richtung: Richtung }` und `pruefeFahrtAenderung(alt: FahrtDaten, neu: { hin: boolean; rueck: boolean }): FahrtKonflikt[]`
  - `FahrtModulAnsicht`:
    ```
    { typ: 'FAHRT'; id: string; titel: string | null; leitung: boolean;
      richtungen: {
        richtung: Richtung; vorschlagTag: string | null; darfAnbieten: boolean;
        autos: { id: string; fahrerId: string; fahrer: string; eigenes: boolean; darfAendern: boolean;
          plaetze: number; frei: number; abfahrtTag: string | null; abfahrtZeit: string | null;
          ort: string | null; notiz: string | null;
          mitfahrer: FahrtKind[] }[];
        brauchtMitfahrt: { kindId: string; name: string }[];
        kommtSelbst: FahrtKind[] }[];
      kinder: { kindId: string; vorname: string; selbst: boolean }[] }
    ```
    mit `FahrtKind = { kindId: string; name: string; nichtMehrDabei: boolean; darfHerausnehmen: boolean }`
  - `fahrtAnsicht(ich: ThreadPerson, modul: Extract<ModulDaten, { typ: 'FAHRT' }>, daten: ThreadDaten, umfeld: Umfeld, jetzt: Date): FahrtModulAnsicht`
  - `ModulAnsicht` schließt `FAHRT` aus `ModulDaten` aus und nimmt `FahrtModulAnsicht` auf.
  - `ThreadBearbeitung.fahrtSperre: FahrtSperre | null`
  - `AntwortenUebersicht.fahrt: FahrtModulAnsicht | null`; `hatAntwortModul` ist auch mit Fahrgemeinschaft `true`.
  - `SystemArt` bekommt `'AUTO_ZURUECKGEZOGEN'`; `systemSatz(art, daten, handelnd, umfeld: Umfeld)`.

Regeln im Einzelnen:

- `modulFehler` für `FAHRT`: Titel wie bei den anderen Typen; `!hin && !rueck` → `Bitte mindestens eine Richtung.` am Feld `module.<i>.hin`; eine zweite Fahrgemeinschaft → `Es gibt schon eine Fahrgemeinschaft.` am Feld `module.<i>.typ`, `konflikt: true` (Muster `teilnahmeSchonDa`).
- `neuesModul` bietet `FAHRT` an, solange keine da ist. Der Editor blendet den Typ sonst aus (Task 8); `neuesModul` mit vorhandener Fahrgemeinschaft wirft nicht, das Speichern scheitert dann an `modulFehler`.
- `vergleicheBestehendes` für `FAHRT`:
  - `geaendert`, wenn Titel, `hin` oder `rueck` abweichen.
  - Konflikte aus `pruefeFahrtAenderung`, der erste wird gemeldet, am Feld `module.<i>.hin` bzw. `.rueck`.
- Beim Entfernen eines Moduls ergibt eine Fahrgemeinschaft mit `fahrtSperre().eingetragen` einen Konflikt am Feld `module`.
- `fahrtAnsicht`:
  - Je eingeschalteter Richtung ein Eintrag in `richtungen`, `HIN` vor `RUECK`.
  - `fahrer` ist `absenderName(fahrerId, umfeld)`; Kinder heißen `kurzname` bzw. `EHEMALIGES_MITGLIED`.
  - `frei = max(0, plaetze − Mitfahrer)`.
  - `nichtMehrDabei`: nicht unter `betrachteteKinder`.
  - `darfAnbieten`: `darfAnbieten(…) === 'ERLAUBT'` und noch kein eigenes Auto in dieser Richtung.
  - `darfAendern`, `darfHerausnehmen`: die Regeln aus Task 1 `=== 'ERLAUBT'`.
  - `kinder`: `antwortZeilen(ich, { einheit: 'JUNGFISCHER' }, kopf, umfeld)`, geschnitten mit den betrachteten Kindern; für die Leitung bleibt die Liste ebenso klein (sie setzt über `Umsetzen` um).
  - `vorschlagTag` nach Entscheidung 15.
- `antwortenUebersicht.fahrt`: `fahrtAnsicht` für die anfragende Person, wenn der Thread eine Fahrgemeinschaft hat, sonst `null`.
- `systemSatz('AUTO_ZURUECKGEZOGEN', { fahrerId, richtung, kindIds }, _, umfeld)` nach den Global Constraints; unlesbare Daten ergeben den allgemeinen Satz (wie bisher).
- `teilenText` ergibt für `FAHRT` vorerst keine Zeile (Etappe 6).

- [ ] **Step 1: Tests schreiben** (Spec 13.1 `fahrtAnsicht` und „Editor-Prüfungen der neuen Module“):
  - `entwurfAus`: Fahrgemeinschaft hin und rück → ok; beide aus → `Bitte mindestens eine Richtung.`; zwei Fahrgemeinschaften → `Es gibt schon eine Fahrgemeinschaft.` mit `konflikt: true`.
  - `vergleicheEntwurf` mit Sandras Auto auf der Hinfahrt:
    - Rückfahrt abschalten → kein Konflikt, `geaendert`.
    - Hinfahrt abschalten → 409 `Für die Hinfahrt gibt es schon Autos oder Mitfahrten.`
    - Nur eine Mitfahrt „kommt selbst“ auf der Rückfahrt, Rückfahrt abschalten → 409 mit `Rückfahrt`.
    - Modul entfernen → 409 `Die Fahrgemeinschaft hat schon Einträge und lässt sich nicht entfernen.`
    - Modul ohne Einträge entfernen → ok.
  - `threadAnsicht`:
    - Sandras Auto (3 Plätze, Lena darin) → `fahrer: 'Sandra M. (Mutter von Lena und Max)'`, `frei: 2`, `mitfahrer[0].name: 'Lena M.'`.
    - Max sagt danach ab → `nichtMehrDabei: true`, `frei` bleibt (Review Focus 3).
    - `brauchtMitfahrt` zeigt Mia; Max auf „kommt selbst“ steht unter `kommtSelbst`.
    - Sandra sieht `eigenes: true`, `darfAendern: true` und auf der Hinfahrt `darfAnbieten: false`; Thomas (Leitung) `darfAendern: true`; eine andere Mutter `darfAendern: false`.
    - Thread mit Termin `2026-10-23` bis `2026-10-25` → `vorschlagTag` hin `2026-10-23`, rück `2026-10-25`; ohne Termin `null`.
    - Mutter mit Lena (dabei) und Max (vielleicht) → `kinder` nur Lena.
  - `systemSatz`: `{ fahrerId: sandra, richtung: 'HIN', kindIds: [lena, max] }` → `Auto von Sandra M. (Hinfahrt) zurückgezogen – Lena M. und Max M. brauchen wieder eine Mitfahrt.`; ein Kind → `… – Lena M. braucht wieder eine Mitfahrt.`; kaputte Daten → allgemeiner Satz.
  - `antwortenUebersicht`: mit Fahrgemeinschaft `fahrt` gesetzt, ohne `null`.
  - `verwaltungThread`: nur Fahrgemeinschaft → `hatAntwortModul: true`.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test domain --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.** Jede Weiche über `typ` bekommt `FAHRT` ausdrücklich (erschöpfender `switch` mit `never`).
- [ ] **Step 4: Tests grün**, dazu `pnpm nx run-many -t typecheck`.
  - Weichen in Server und Client, die `FAHRT` noch nicht kennen, bekommen einen Zweig, der nichts tut bzw. nichts zeigt; das Speichern einer Fahrgemeinschaft ergibt bis Task 4 400 an `module.N.typ` (wie in Etappe 3). Tasks 4, 7 und 8 füllen die Zweige.
  - Aufrufer von `systemSatz` geben das Umfeld weiter.
  - Kein `// TODO`, kein `as`, das den Fehler verdeckt.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 4: Entwurf, Vergleich, Ansicht und Systemsatz der Fahrgemeinschaft"`

---

### Task 3: Datenmodell und Migration

**Files:**

- Modify: `prisma/schema.prisma`, `libs/db/src/lib/verein-db.ts`, `libs/db/src/schema.spec.ts`, `libs/db/src/verein-db.spec.ts`
- Create: `prisma/migrations/<stamp>_fahrt/migration.sql` (`pnpm prisma migrate dev --create-only --name fahrt`, dann von Hand)

**Interfaces:**

- Produces (Prisma):
  - `ModulTyp` bekommt `FAHRT`, `SystemArt` bekommt `AUTO_ZURUECKGEZOGEN`, neues Enum `Richtung { HIN RUECK }`.
  - `FahrtModul (id, vereinId, threadId, hin Boolean @default(true), rueck Boolean @default(true))`
    - nach dem Muster `UmfrageModul` (Relation über `[vereinId, id, threadId]` auf `ThreadModul` mit `Cascade`);
    - `@@unique([vereinId, threadId])` (Entscheidung 9), `@@unique([vereinId, id])`.
  - `Auto (id, vereinId, modulId, fahrerId, richtung Richtung, plaetze Int, abfahrtTag DateTime? @db.Date, abfahrtZeit String?, ort String?, notiz String?, angelegtAm DateTime, clientId String)`
    - Modul mit `NoAction` (Spec 8), `fahrer` mit `NoAction`;
    - `@@unique([modulId, fahrerId, richtung])`, `@@unique([vereinId, clientId])`;
    - `@@unique([vereinId, modulId, richtung, id])` als Ziel des Fremdschlüssels von `Mitfahrt`.
  - `Mitfahrt (id, vereinId, modulId, richtung Richtung, kindId, autoId String?, vonId, eingetragenAm DateTime, clientId String)`
    - Modul, `kind`, `von` mit `NoAction`;
    - `auto` über `[vereinId, modulId, richtung, autoId]` auf `Auto` mit `NoAction` (Spec 6.1: Auto, Modul und Richtung passen zusammen; `autoId = null` prüft Postgres nicht, MATCH SIMPLE);
    - `@@unique([modulId, richtung, kindId])`, `@@unique([vereinId, clientId])`.
  - Back-Relationen an `Verein` und `Person`; alle drei Modelle in `VEREINS_MODELLE`.
- CHECKs von Hand, nach dem Muster der Helfer-Migration:
  - `fahrt_richtung`: `hin OR rueck`
  - `auto_plaetze`: `plaetze BETWEEN 1 AND 8`
  - `auto_zeit`: `"abfahrtZeit" IS NULL OR "abfahrtZeit" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`
  - `auto_ort`, `auto_notiz`: `IS NULL OR char_length(…) BETWEEN 1 AND 200`
- Neue Enum-Werte per `ALTER TYPE … ADD VALUE`; in derselben Migration nutzt sie kein Ausdruck.
- Der Kommentar an `Mitfahrt.auto` sagt, warum `NoAction` statt `Cascade`: Das Zurückziehen löscht die Mitfahrten ausdrücklich und schreibt den Systemeintrag (Task 5); eine Kaskade nähme die Kinder still mit.

- [ ] **Step 1: Tests schreiben** (`schema.spec.ts`, Testdatenbank):
  - CHECKs: `plaetze` 0 und 9, `abfahrtZeit` `'24:00'`, `ort` `''` und 201 Zeichen, `FahrtModul` mit `hin = rueck = false` werden abgelehnt.
  - Zweites Auto desselben Fahrers in derselben Richtung → P2002; in der anderen Richtung → ok.
  - Zweite Mitfahrt desselben Kindes in derselben Richtung → P2002.
  - Mitfahrt mit `autoId` eines Autos der anderen Richtung → P2003.
  - Mitfahrt mit `autoId = null` → ok.
  - Zweites `FahrtModul` im selben Thread → P2002.
  - `ThreadModul` einer Fahrgemeinschaft ohne Einträge löschen → `FahrtModul` weg; mit Auto → P2003; mit Mitfahrt „kommt selbst“ → P2003; ebenso das Löschen des Threads (Review Focus 4).
  - Auto mit Mitfahrt löschen → P2003.
  - Den Verein mit Autos und Mitfahrten löschen → gelingt (Review Focus 4).
  - `verein-db.spec.ts` kennt die drei Modelle.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test db --skip-nx-cache -- schema verein-db`, FAIL.
- [ ] **Step 3: Umsetzen**, `pnpm run db:generate`. Scheitert die Vereinslöschung an der Reihenfolge der Kaskaden, gilt die Lösung von `HelferEintrag` (gleiches Muster).
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 4: Datenmodell der Fahrgemeinschaft"`

---

### Task 4: Fahrgemeinschaft speichern, laden und schützen

**Files:**

- Modify: `apps/jufi/src/server/threads/schreiben.ts` (`schreibeModul`), `laden.ts` (`ladeThreads`, `modulVon`, `modulOrt`), `lesen.ts`, `bearbeitung.ts` (`loeschZaehler`, `ladeBearbeitung`), `verlauf.ts` (Umfeld an `systemSatz`), `test-threads.ts` und Specs

**Interfaces:**

- Consumes: Tasks 1–3
- Produces:
  - `modulOrt` kennt `FAHRT`.
  - **`modulVon` wird ein erschöpfender `switch (m.typ)` mit `never`** (Etappe-3-Review M7): Heute fällt alles Unbekannte in den Umfrage-Zweig und verschwindet still. Mit `KOSTEN` in Etappe 5 passiert genau das, wenn ein Zweig fehlt.
  - `ladeThreads` lädt die Fahrgemeinschaft (Richtungen) immer. Autos und Mitfahrten kommen nur bei `mitAntworten` (Reihenfolge nach Entscheidung 16), sonst sind sie leer, wie bei Helfer-Einträgen. `abfahrtTag` als `toISOString().slice(0, 10)` (wie Termine).
  - `schreibeModul` legt `FahrtModul` an und ändert `hin`/`rueck`.
  - `loeschZaehler` zählt Autos und Mitfahrten zu `antworten`.
  - `ThreadBearbeitung.fahrtSperre`
  - `test-threads.ts`: `TestModul` bekommt `{ typ: 'FAHRT'; hin?: boolean; rueck?: boolean }`. Dazu kommen `bieteAutoTest(db, modulId, fahrerId, richtung, plaetze, felder?)` → Auto-ID und `setzeEinTest(db, modulId, richtung, kindId, autoId | null, vonId)`, die direkt schreiben.

- [ ] **Step 1: Tests schreiben** (Testdatenbank):
  - `POST /threads` mit Fahrgemeinschaft (nur hin) → 201. `GET /threads/:id` zeigt `richtungen` mit genau `HIN`, ohne Autos.
  - `PUT /threads/:id`:
    - Rückfahrt einschalten → Änderung `MODUL`, `richtungen` mit beiden;
    - Hinfahrt mit Auto abschalten → 409 mit Text;
    - zweite Fahrgemeinschaft → 400/409 am Feld (wie die Teilnahme).
  - Bearbeitung eines Threads mit Auto → `darfLoeschen: false`, `fahrtSperre` = `{ eingetragen: true, HIN: true, RUECK: false }`.
  - `DELETE /threads/:id` mit Mitfahrt „kommt selbst“ → 409 `NICHT_LOESCHBAR` (Review Focus 4).
  - `GET /threads` (Liste) bleibt ohne Autos; „Neu“ zählt eine Mitfahrt für einen Leser ohne Ergebnis-Recht (Entscheidung 11).
  - Verlauf mit einem `AUTO_ZURUECKGEZOGEN`-Eintrag (direkt geschrieben) zeigt den Satz mit Namen.
  - `modulVon`: ein Test, der für jeden Wert von `ModulTyp` aus dem Prisma-Enum einen Thread mit genau diesem Modul lädt und das Modul zurückbekommt (wächst mit jedem neuen Typ mit).
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- --maxWorkers=3 threads`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 4: Fahrgemeinschaft speichern, laden und vor dem Loeschen schuetzen"`

---

### Task 5: Autos anbieten, ändern und zurückziehen

**Files:**

- Create: `apps/jufi/src/server/threads/autos.ts`, `autos.spec.ts`
- Modify: `apps/jufi/src/server/threads/routen.ts`, `fehler.ts` (`AUTO_VOLL`, `AUTOS_VOLL`, `AUTO_SCHON_DA`, `plaetzeBelegt(n)`), `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: Tasks 1, 2, 4; `mitAenderung`, `ladeVereinsstand`, `liesClientId`, `ungueltigesFeld`, `ThreadAbbruch`, `Wiederholung`, `antworteThreadFehler`, Muster `server/threads/helfer.ts`
- Produces: `autoRouten(router: Router, deps: VolleAppDeps): void`, eingehängt in `threadRouten`; die Fehlerkörper aus den Global Constraints.

| Route                          | Körper                                 | Erfolg                                    |
| ------------------------------ | -------------------------------------- | ----------------------------------------- |
| `POST /fahrten/:modulId/autos` | `AutoEingabe` + `richtung`, `clientId` | 201 `{ modul: FahrtModulAnsicht, stand }` |
| `PUT /autos/:id`               | `AutoEingabe`                          | 200 `{ modul, stand }`                    |
| `DELETE /autos/:id`            | keiner                                 | 200 `{ modul, stand }`                    |

`POST`, in dieser Reihenfolge:

1. `antwortenFenster` → 429.
2. `pruefeAuto`, `richtung` (`'HIN' | 'RUECK'`), `liesClientId` → 400 am Feld.
3. `modulOrt` mit Typ `FAHRT`, Thread laden; `darfAnbieten` = `NICHT_GEFUNDEN` oder Richtung nicht eingeschaltet → 404.
4. `auto.findFirst({ where: { clientId } })`: dasselbe Modul, derselbe Fahrer, dieselbe Richtung → Wiederholung, 200 mit frischer Ansicht und `ladeVereinsstand`; sonst 409 `CLIENT_ID_VERGEBEN`.
5. `ENTWURF` → 409; `ARCHIVIERT` → 409.
6. Eigenes Auto in dieser Richtung → 409 `AUTO_SCHON_DA`; 30 Autos in der Richtung → 409 `VOLL` (`Für diese Fahrt …`).
7. `mitAenderung`: neu laden, Schritte 3, 5, 6 erneut (werfen), anlegen mit `angelegtAm = jetzt`, Änderung `{ threadId, art: 'ANTWORT', objektId: modulId }`.
8. `bus` nach dem Commit; 201.
9. P2002 wie in `helfer.ts` über `urteil`.

`PUT /autos/:id`:

1. Rate-Limit, `pruefeAuto` → 400.
2. Auto laden (über `vereinDb`), Thread laden; `darfAutoAendern` = `NICHT_GEFUNDEN` → 404.
3. `ENTWURF`/`ARCHIVIERT` → 409.
4. `plaetze` unter der Zahl der Mitfahrer → 409 `PLAETZE` (Review Focus 4).
5. Nichts geändert → 200 ohne Schreiben (Entscheidung 2).
6. `mitAenderung` mit Neuprüfung, Änderung `ANTWORT`; `bus`.

`DELETE /autos/:id`:

1. Rate-Limit; Auto laden, sonst 404 (Entscheidung 3).
2. `darfAutoAendern` → 404 / 409 wie oben.
3. `mitAenderung`: neu laden (ist das Auto weg: 404); die Mitfahrten des Autos löschen, dann das Auto; Änderung `ANTWORT`. Saßen Kinder darin, einen `VerlaufEintrag` `SYSTEM` mit `systemArt: 'AUTO_ZURUECKGEZOGEN'`, `autorId` = handelnde Person, `systemDaten: { fahrerId, richtung, kindIds }` (Kinder nach `eingetragenAm`), `stand`; dazu Änderung `VERLAUF` (Entscheidungen 4, 12). Wie in `schreiben.ts`: kein Systemeintrag im Entwurf (der Entwurf hat ohnehin keine Autos).
4. `bus`; 200 mit frischer Ansicht.

- [ ] **Step 1: Tests schreiben** (`autos.spec.ts`, Testdatenbank, Hilfen aus `test-threads.ts` und `helfer.spec.ts`):
  - Anbieten: Sandra bietet hin an (3, `2026-10-23`, `15:30`, `Vereinsheim`) → 201, Karte mit `frei: 3`, Änderung `ANTWORT` mit `objektId` = Modul-ID, `bus` gemeldet.
  - Dieselbe `clientId` noch einmal → 200, keine zweite Änderung (Review Focus 5). Fremde `clientId` → 409 `CLIENT_ID_VERGEBEN`.
  - Zweites Auto in derselben Richtung mit neuer `clientId` → 409 `AUTO_SCHON_DA`; in der Rückrichtung → 201.
  - 31. Auto einer Richtung → 409 `VOLL` (30 per `bieteAutoTest` vorbereitet).
  - Ablehnungen: Jungfischer → 404; Richtung nicht eingeschaltet → 404; Umfrage-Modul-ID → 404; Thread, den die Person nicht sieht → 404; Entwurf → 409 `ENTWURF`; archiviert → 409 `ARCHIVIERT`, die Leitung bietet im Archiv an → 201; `plaetze: 9` → 400 `feld: 'plaetze'`.
  - Ändern: Sandra setzt `plaetze` 3 → 2 bei einem Mitfahrer → 200; auf 1 bei zwei Mitfahrern → 409 `{ code: 'PLAETZE', fehler: 'Es fahren schon 2 Kinder mit.' }`; unverändert → 200 ohne Änderung; andere Mutter → 404; Leitung → 200.
  - Zurückziehen mit Lena und Max darin (Review Focus 2):
    - 200; beide Mitfahrten weg, beide unter `brauchtMitfahrt`;
    - genau ein Verlaufseintrag `AUTO_ZURUECKGEZOGEN` mit `kindIds: [lena, max]`, Änderungen `ANTWORT` und `VERLAUF`;
    - zweites `DELETE` → 404, kein zweiter Eintrag.
  - Zurückziehen ohne Kinder → 200, kein Verlaufseintrag.
  - Leitung löscht Sandras Auto → 200; andere Mutter → 404.
  - Rate-Limit wie in `helfer.spec.ts`.
  - Mandanten-Test: `'POST /fahrten/:modulId/autos'`, `'PUT /autos/:id'`, `'DELETE /autos/:id'` mit fremdem Modul bzw. Auto → 404, fremde Zeilen unverändert.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- --maxWorkers=3 autos mandanten`, FAIL.
- [ ] **Step 3: Umsetzen.** Die Reihenfolge der Prüfungen steht im Kopfkommentar der Datei, mit Verweis auf `helfer.ts` statt die Begründungen zu wiederholen.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 4: Autos anbieten, aendern und zurueckziehen"`

---

### Task 6: Kinder einsetzen und herausnehmen

**Files:**

- Create: `apps/jufi/src/server/threads/mitfahrten.ts`, `mitfahrten.spec.ts`
- Modify: `apps/jufi/src/server/threads/routen.ts`, `fehler.ts` (`NICHT_DABEI`), `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: Tasks 1, 2, 4, 5 (`AUTO_VOLL`)
- Produces: `mitfahrtRouten(router: Router, deps: VolleAppDeps): void`, eingehängt in `threadRouten`

| Route                                        | Körper                                         | Erfolg                 |
| -------------------------------------------- | ---------------------------------------------- | ---------------------- |
| `PUT /fahrten/:modulId/:richtung/:kindId`    | `{ autoId: string \| null; clientId: string }` | 200 `{ modul, stand }` |
| `DELETE /fahrten/:modulId/:richtung/:kindId` | keiner                                         | 200 `{ modul, stand }` |

`:richtung` ist `hin` oder `rueck` (klein in der Adresse), sonst 404.

`PUT`, in dieser Reihenfolge:

1. Rate-Limit.
2. `autoId` (String oder `null`), `liesClientId` → 400.
3. `modulOrt` mit Typ `FAHRT`, Thread laden; Richtung nicht eingeschaltet → 404; `darfEinsetzen` = `NICHT_GEFUNDEN` → 404; `autoId` gesetzt, aber kein Auto dieses Moduls in dieser Richtung → 404.
4. `mitfahrt.findFirst({ where: { clientId } })`: dasselbe Modul, Richtung, Kind und `autoId` → Wiederholung, 200; sonst 409 `CLIENT_ID_VERGEBEN`.
5. `ENTWURF`, `ARCHIVIERT`, `NICHT_DABEI` → 409.
6. Vorhandene Mitfahrt mit derselben `autoId` → 200 ohne Schreiben (Entscheidung 5).
7. `autoId` gesetzt und `!hatPlatzIn` → 409 `VOLL` (`In diesem Auto …`).
8. `mitAenderung`: neu laden, 3, 5, 7 erneut (werfen), Upsert nach Entscheidung 5, Änderung `ANTWORT` mit `objektId` = Modul-ID.
9. `bus`; Ansicht.
10. P2002 wie in `helfer.ts`.

`DELETE`:

1. Rate-Limit; `modulOrt`, Laden; Richtung nicht eingeschaltet → 404.
2. Ohne Mitfahrt gilt `darfEinsetzen` ohne Betrachtet-Prüfung (d. h. `NICHT_DABEI` zählt als erlaubt), mit Mitfahrt `darfHerausnehmen`. `NICHT_GEFUNDEN` → 404; `ENTWURF`, `ARCHIVIERT` → 409.
3. Keine Mitfahrt → 200 ohne Schreiben (Entscheidung 6).
4. `mitAenderung`: neu laden, `darfHerausnehmen` erneut; ist die Mitfahrt unter der Sperre schon weg, `throw new Wiederholung(null)`; sonst löschen, Änderung `ANTWORT`. Danach `bus`.

- [ ] **Step 1: Tests schreiben** (`mitfahrten.spec.ts`, Testdatenbank; Thread mit Teilnahme-Umfrage, Lena und Mia `dabei`, Max `vielleicht`):
  - Sandra setzt Lena in ihr Auto → 200, `mitfahrer` mit Lena, `frei` sinkt, Änderung `ANTWORT`, `bus`.
  - Dieselbe `clientId` noch einmal → 200 ohne zweite Änderung (Review Focus 5); fremde → 409 `CLIENT_ID_VERGEBEN`.
  - Lena noch einmal ins selbe Auto mit neuer `clientId` → 200 ohne Änderung.
  - Lena auf „kommt selbst“ (`autoId: null`) → 200, `kommtSelbst` mit Lena, Platz im Auto frei.
  - Max (`vielleicht`) → 409 `NICHT_DABEI`, auch durch die Leitung.
  - Letzter Platz: Auto mit 3 Plätzen und 2 Mitfahrern, Barriere, zwei Familien gleichzeitig (Muster aus `helfer.spec.ts`) → genau ein 200 und ein 409 `VOLL`, danach 3 Mitfahrer (Review Focus 1).
  - Absage danach (Review Focus 3): Lena sitzt im Auto, die Mutter sagt in der Teilnahme-Umfrage ab → Lena bleibt mit `nichtMehrDabei: true`; Umsetzen auf „kommt selbst“ → 409 `NICHT_DABEI`; `DELETE` durch die Mutter → 200.
  - Leitung setzt Mia in Sandras Auto (Spec 1.1 Schritt 4) → 200; Sandras nächster `GET` zeigt Mia.
  - Herausnehmen: Fahrerin nimmt ein fremdes Kind aus ihrem Auto → 200; eine andere Mutter → 404; zweites `DELETE` → 200 ohne Änderung (Review Focus 5).
  - Ablehnungen: fremdes Kind → 404; `autoId` eines Autos der anderen Richtung → 404; `:richtung` `quer` → 404; Richtung nicht eingeschaltet → 404; Entwurf → 409 `ENTWURF`; archiviert: Mutter → 409 `ARCHIVIERT`, Leitung → 200; `autoId: 42` → 400.
  - Jungfischer mit Zugang setzt sich selbst ein → 200.
  - Mandanten-Test: `'PUT /fahrten/:modulId/:richtung/:kindId'` und `'DELETE /fahrten/:modulId/:richtung/:kindId'` mit fremdem Modul → 404, fremde Mitfahrten unverändert.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- --maxWorkers=3 mitfahrten mandanten`, FAIL.
- [ ] **Step 3: Umsetzen**, mit Kopfkommentar wie in Task 5.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 4: Kinder in Autos einsetzen und herausnehmen"`

---

### Task 7: Fahrgemeinschaft auf der Thread-Seite

**Files:**

- Create: `apps/jufi/src/app/verein/threads/fahrt-modul.ts`, `fahrt-modul.spec.ts`
- Modify: `apps/jufi/src/app/verein/threads/thread-api.ts`, `thread-seite.ts` (`@switch`, `ersetzeModul`) und Specs

**Interfaces:**

- Consumes: Task 2 (`FahrtModulAnsicht`), Tasks 5 und 6 (Routen)
- Produces:
  - `ThreadApi.bieteAuto(slug, modulId, koerper: AutoEingabe & { richtung: Richtung; clientId: string })`, `aendereAuto(slug, autoId, koerper: AutoEingabe)`, `zieheAutoZurueck(slug, autoId)`, `setzeEin(slug, modulId, richtung, kindId, koerper: { autoId: string | null; clientId: string })`, `nimmHeraus(slug, modulId, richtung, kindId)`; alle `Observable<{ modul: FahrtModulAnsicht; stand: number }>`. `richtung` geht klein in die Adresse.
  - `jf-fahrt-modul`: Eingaben `modul: FahrtModulAnsicht`, `slug: string`, `vorschau: boolean = false`; Ausgaben `geaendert: FahrtModulAnsicht` und `veraltet: void`.
  - `ersetzeModul(neu: UmfrageAnsicht | HelferModulAnsicht | FahrtModulAnsicht)`

Darstellung:

- Kopf: Titel oder `Fahrgemeinschaft`. Bei zwei Richtungen ein Umschalter `Hin` / `Rück` (`role="tablist"` wie die Medien-Reiter), sonst die eine Richtung als Überschrift (`Hinfahrt` / `Rückfahrt`).
- Je Auto eine Karte nach den Global Constraints. `frei` als Text (`2 frei`, bei 0 `voll`), keine Telefonnummern.
- Je eigenem Kind (`kinder`) in der gewählten Richtung:
  - an jedem Auto mit freiem Platz `Einsteigen` bzw. `<Vorname> einsteigen`;
  - `Kommt selbst` bzw. `<Vorname> kommt selbst`, solange es nicht dort steht;
  - an seinem Eintrag `Herausnehmen`, wenn `darfHerausnehmen`.
- `Auto anbieten` bei `darfAnbieten` öffnet das Formular; `Abfahrt am` ist mit `vorschlagTag` vorbelegt. Am eigenen Auto bzw. mit `darfAendern`: `Auto ändern` (dasselbe Formular, Knopf `Speichern`) und `Auto zurückziehen`, mit Kindern über `jf-bestaetigung` mit dem Satz aus den Global Constraints.
- Für die Leitung (`leitung`) an jedem Kind in Autos, unter „Braucht noch Mitfahrt“ und unter „Kommt selbst“ `Umsetzen`: eine Auswahl der Autos dieser Richtung mit freiem Platz und `Kommt selbst`, dazu `Herausnehmen`.
- In der `vorschau` keine Knöpfe.

Verhalten:

- Eine Handlung zur Zeit, wie `helfer-modul.ts`. Jede Anfrage mit `clientId` bekommt eine neue `crypto.randomUUID()`.
- Erfolg → `geaendert` mit der Ansicht aus der Antwort; der Fokus geht danach auf die Überschrift der Richtung (`tabindex="-1"`), nach `Abbrechen` zurück auf den öffnenden Knopf. Im geöffneten Formular steht der Fokus im ersten Feld.
- 409 (`VOLL`, `NICHT_DABEI`, `ARCHIVIERT`, `AUTO_SCHON_DA`, `PLAETZE`): den Text am Modul zeigen (`role="alert"`), dann `veraltet`; `PLAETZE` steht am Feld `Plätze für Kinder` und lädt nicht neu.
- 404: wie `helfer-modul.ts`, mit Satz am Modul und `veraltet`.
- 401: `beiAbgelaufenerSitzung`.
- Formularfehler 400 stehen am Feld.

- [ ] **Step 1: Tests schreiben** (`fahrt-modul.spec.ts`, Ansicht als Eingabe, `HttpTestingController`):
  - Karte zeigt Fahrer, `Fr 23.10.` und `15:30`, `Vereinsheim`, `2 frei`, `Lena M.`; ein Kind mit `nichtMehrDabei` zeigt `nicht mehr dabei`.
  - `Braucht noch Mitfahrt` mit `Mia S.`; leer `Alle haben eine Mitfahrt.`
  - Umschalter wechselt zwischen `Hin` und `Rück`; mit nur einer Richtung kein Umschalter.
  - `Lena einsteigen` schickt `PUT …/fahrten/<modul>/hin/<lena>` mit `{ autoId, clientId }` und meldet `geaendert`.
  - `Lena kommt selbst` schickt `autoId: null`.
  - `Auto anbieten`: Formular mit vorbelegtem Tag; `Anbieten` schickt `POST …/fahrten/<modul>/autos` mit `richtung: 'HIN'`.
  - `Auto zurückziehen` mit Kindern fragt nach und schickt nach Bestätigung `DELETE …/autos/<id>`.
  - Leitung: `Umsetzen` an Mia bietet Sandras Auto (mit Platz) und `Kommt selbst` an; volle Autos fehlen.
  - 409 `VOLL` → `In diesem Auto ist kein Platz mehr frei.` und `veraltet`; 409 `PLAETZE` steht am Feld.
  - `vorschau` → keine Knöpfe.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache -- --include='**/{fahrt-modul,thread-seite,thread-api}.spec.ts'`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Die Browserprüfung macht der Controller nach Task 10 (wie in Etappe 3, Ruling R7: keine Zugangsdaten in Aufträgen an Unteragenten).
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 4: Fahrgemeinschaft auf der Thread-Seite"`

---

### Task 8: Fahrgemeinschaft im Editor

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/threads/fahrt-felder.ts`, `fahrt-felder.spec.ts`
- Modify: `apps/jufi/src/app/verein/verwaltung/threads/editor.ts` (`TYPEN`, `@switch`), `vorschau.ts` und Specs

**Interfaces:**

- Consumes: Task 2 (`ModulEntwurf` `FAHRT`, `neuesModul`, `FahrtSperre`), Task 7 (`jf-fahrt-modul`)
- Produces: `jf-fahrt-felder` mit Eingaben `modul` (Entwurf `FAHRT`), `sperre: FahrtSperre | null`, `fehler: readonly Feldfehler[]`, `index: number`; Ausgabe `aendern: ModulEntwurf`.

- „Modul hinzufügen“ bekommt `{ typ: 'FAHRT', text: 'Fahrgemeinschaft' }`; der Eintrag fehlt, solange der Entwurf schon eine Fahrgemeinschaft hat (Entscheidung 9).
- Felder: Titel; zwei Kästchen `Hinfahrt` und `Rückfahrt`.
- Mit `sperre`: ein Kästchen mit `sperre[richtung]` ist nicht abwählbar (`disabled`), der Grund steht sichtbar daneben: `Hat schon Autos oder Mitfahrten.` Verworfen: der Grund nur für Screenreader wie in Etappe 3 (dort Eigentümerfrage B2) — ein graues Kästchen ohne Satz lässt Sehende raten.
- Feldfehler aus `fehler` an `module.<index>.hin`, `.rueck` und `.typ` (Muster `FEHLERFELDER`).
- Vorschau: `jf-fahrt-modul` mit `vorschau` und einer Ansicht aus dem Entwurf (Richtungen ohne Autos, `brauchtMitfahrt` leer, keine Kinder).

- [ ] **Step 1: Tests schreiben:**
  - Hinzufügen → beide Richtungen an; danach fehlt `Fahrgemeinschaft` in „Modul hinzufügen“.
  - Beide Kästchen ab → Fehler `Bitte mindestens eine Richtung.` aus dem Server steht am Feld.
  - Mit `sperre` `{ eingetragen: true, HIN: true, RUECK: false }` → `Hinfahrt` gesperrt mit Satz, `Rückfahrt` frei.
  - Serverfehler 409 an `module.0.hin` steht am Kästchen.
  - Vorschau zeigt die Richtungen ohne Knöpfe.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache -- --include='**/verwaltung/threads/{fahrt-felder,editor,vorschau}.spec.ts'`, FAIL.
- [ ] **Step 3: Umsetzen.** Die Felder entstehen in der eigenen Komponente, nicht in `modul-felder.ts` (Spec 10).
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 4: Fahrgemeinschaft im Editor"`

---

### Task 9: Fahrgemeinschaft in der Antworten-Übersicht

**Files:**

- Modify: `apps/jufi/src/app/verein/verwaltung/threads/antworten.ts` (+ spec), `apps/jufi/src/server/threads/verwaltung.spec.ts`

**Interfaces:**

- Consumes: Task 2 (`AntwortenUebersicht.fahrt`), Task 7 (`jf-fahrt-modul`)

- Unter den Helferlisten steht bei `fahrt` ein Block mit der Überschrift (Titel oder `Fahrgemeinschaft`) und `jf-fahrt-modul` mit der Ansicht aus der Übersicht (Entscheidung 17).
- `geaendert` setzt die Ansicht im Block ein; `veraltet` lädt die Übersicht neu, wie `trageNach` es heute tut.

- [ ] **Step 1: Tests schreiben:**
  - Server: `GET /threads/:id/antworten` eines Threads mit Fahrgemeinschaft enthält `fahrt` mit `leitung: true` und den Autos.
  - Client: Block mit Überschrift und Karte; `geaendert` ersetzt die Ansicht; `veraltet` lädt neu; ohne `fahrt` kein Block.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- --maxWorkers=3 verwaltung` und `pnpm nx test jufi --skip-nx-cache -- --include='**/verwaltung/threads/antworten.spec.ts'`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 4: Fahrgemeinschaft in der Antworten-Uebersicht"`

---

### Task 10: Demo, Ende-zu-Ende und Doku

**Files:**

- Modify: `apps/cli/src/demo.ts` (+ spec), `apps/jufi-e2e/src/ablauf.spec.ts`, `apps/jufi-e2e/src/layout.spec.ts`, `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-21-jufi-tp4-module-medien-design.md`

**Demo** (Entscheidung 18):

- Bowling bekommt nach der Helferliste eine Fahrgemeinschaft, hin und rück.
- Sandra bietet die Hinfahrt an: 3 Plätze, Abfahrtstag = Bowling-Termin, `15:30`, `Vereinsheim`; Lena sitzt darin. Hat Lena in der Teilnahme-Umfrage nicht `dabei`, sagt die Demo für sie zu (sonst zeigte die Karte sie als „nicht mehr dabei“).
- Ein anderes Kind mit Zusage hat keine Mitfahrt und steht unter „Braucht noch Mitfahrt“. Hat die Demo keins, sagt eines zu.
- `demo.spec` zählt Module, Autos und Mitfahrten mit.

**Ende-zu-Ende**, im seriellen Ablauf nach den Helferlisten-Schritten (Spec 1.1 Schritt 4, verkleinert):

1. Leitung fügt im Editor dem Bowling des Ablaufs eine Fahrgemeinschaft (nur hin) hinzu und speichert.
2. Mutter bietet ein Auto an (2 Plätze, `Vereinsheim`, `15:30`) und setzt ihr Kind hinein; die Karte zeigt `1 frei`.
3. Das Kind hat den Thread offen und sieht sich im Auto ohne Neuladen.
4. Leitung setzt ein zweites Kind aus „Braucht noch Mitfahrt“ in das Auto; die Mutter sieht es ohne Neuladen, die Karte zeigt `voll`.
5. Mutter zieht das Auto zurück; beide Kinder stehen wieder unter „Braucht noch Mitfahrt“, im Verlauf steht der Satz `Auto von … zurückgezogen – … brauchen wieder eine Mitfahrt.`

Die Kinder sind Mia und Mats aus dem Ablauf. Unter „Braucht noch Mitfahrt“ stehen nur Kinder mit `dabei`; sagt eines bis dahin nicht zu, sagt der Schritt vorher für es zu.

`layout.spec.ts` (~463) zählt die Module von Bowling im Editor: danach 7 statt 6, der Kommentar dort nennt die Fahrgemeinschaft.

**Doku:**

- README: im Abschnitt zu den Modulen ein Absatz „Fahrgemeinschaft“ (Richtungen, Autos, kommt selbst, Braucht noch Mitfahrt, Umsetzen, Zurückziehen mit Verlaufssatz).
- CLAUDE.md:
  - Stand: Zeile „TP4 Etappe 4 ist da: Fahrgemeinschaft (Autos unter `/fahrten/:modulId/autos` und `/autos/:id`, Mitfahrten unter `/fahrten/:modulId/:richtung/:kindId`, Umsetzen durch die Leitung, Systemsatz `AUTO_ZURUECKGEZOGEN`).“
  - Stolperstein: „Autos und Mitfahrten sperren das Löschen von Modul und Thread (`NoAction`, `loeschZaehler`). Ein Auto zurückziehen löscht seine Mitfahrten ausdrücklich in der Route, nie per Kaskade, damit der Verlaufssatz entsteht.“
- TP4-Spec:
  - die Entscheidungen 1–18 an ihren Stellen (6.1, 6.2, 6.3, 8, 9.1, 9.3);
  - in 9.3 `VOLL` am Auto, `AUTO_SCHON_DA`, `PLAETZE` und `NICHT_DABEI` mit ihren Texten;
  - in 6.3 die Signatur `fahrtAnsicht(ich, modul, daten, umfeld, jetzt)` statt der vorläufigen.

- [ ] **Step 1: E2E-Tests und Demo-Test schreiben.**
- [ ] **Step 2: Scheitern sehen:** `pnpm nx test cli --skip-nx-cache` und `pnpm run e2e`. Die neuen Schritte scheitern nur dort, wo noch etwas fehlt; sonst die Ursache klären.
- [ ] **Step 3: Demo und Doku umsetzen.**
- [ ] **Step 4: Alles grün:** `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`, `pnpm run e2e`, `pnpm exec prettier --check .`.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 4: Demo, Ende-zu-Ende und Doku zur Fahrgemeinschaft"`
