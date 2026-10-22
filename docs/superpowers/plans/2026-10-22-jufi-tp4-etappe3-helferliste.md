# JuFi TP4 Etappe 3 — Helfer- und Mitbringliste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Threads bekommen das Modul „Helferliste“: Positionen mit Anzahl („Kuchen 0/4“), in die sich Gefragte für sich und ihre Kinder eintragen, mit Notiz („Marmorkuchen“), und wieder austragen. Alle Leser sehen Füllstand und Namen. Eine volle Position nimmt niemanden mehr an. Nach der Frist und im Archiv trägt nur noch nach, wer den Thread bearbeiten darf. Die Antworten-Übersicht der Verwaltung zeigt die Helferliste mit Nachtragen. Offene Helferlisten mit Frist stehen unter „Braucht deine Antwort“ (Spec 1.4 Etappe 3, Abschnitte 5 und 8; Rahmen 5.2).

**Architecture:**

- Reine Regeln in `libs/domain`:
  - `threads/antworten.ts`: `gefragte`, `antwortZeilen` und `darfAntworten` nehmen statt `UmfrageDaten` den schmalen Typ `AntwortRegel` (Spec 8). Umfrage und Helferliste fragen dieselbe Logik.
  - `module/helfer/helfer.ts`: Plätze, Notiz, Eintrags- und Austragsrecht, Sperren und Konflikte im Editor, Ansicht.
  - `threads/{entwurf,vergleich,ansicht,start,verwaltung}.ts`: der neue Typ in Entwurf, Vergleich, Ansicht, „Braucht deine Antwort“, „Neu“ und Antworten-Übersicht.
- Module folgen TP3:
  - Kopfzeile `ThreadModul` mit `ModulTyp.HELFER`, dazu die 1:1-Tabelle `HelferModul` und die Tabellen `HelferPosition` und `HelferEintrag`.
  - Positionen werden über `POST/PUT /threads` gespeichert, wie Umfrage-Optionen.
  - Einträge laufen nur über `PUT/DELETE /helfer/:positionId/eintraege/:fuerId`, gebaut nach dem Muster der Umfrage-Antwort.
- Client:
  - `jf-helfer-modul` auf der Thread-Seite setzt die Ansicht aus der Antwort ein, wie die Umfrage.
  - `jf-helfer-felder` im Editor.
  - Die Antworten-Übersicht bekommt einen Helferlisten-Teil mit Nachtragen.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (Signale, OnPush, inline), Express 4, Prisma 7, Postgres 17, Vitest 4, Playwright. Keine neuen Pakete.

**Spec:** `docs/superpowers/specs/2026-10-21-jufi-tp4-module-medien-design.md`, Abschnitte 1.4, 5, 8, 9.1–9.3, 10, 13.1. Dazu TP3-Spec 2.2 (Schlüssel), 2.3 (clientId, NoAction), 3.2/3.3 (Einheit, Antwortrecht), 3.7 (Archiv), 3.9 („Neu“), 3.14 (Änderungen nach Antworten), 4.2 (Schreibpfad) und Rahmen 5.2 („Braucht deine Antwort“).

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 9 trägt sie in die TP4-Spec ein. Die mit ⚑ hat der Eigentümer noch nicht bestätigt; sie stehen in der Übergabe.

1. ⚑ **Jeder Eintrag belegt einen Platz und wird gezeigt, auch wenn die Person nicht mehr gefragt ist.**
   - Gilt für Entfernte („ehemaliges Mitglied“, Spec 12.2) und für Personen, die die Zielgruppe verlassen haben.
   - Füllstand, `VOLL` und die Editor-Prüfung „Anzahl nicht unter den Eingetragenen“ zählen damit dieselben Zeilen, nämlich die der Datenbank.
   - Verworfen: wie bei Umfragen ausblenden. Ein ausgeblendeter Eintrag gäbe seinen Platz frei; käme die Person zurück, wäre die Position überbucht. Der Kuchen kommt ja trotzdem.
2. **Austragen eines Eintrags, dessen Person nicht mehr gefragt ist, darf nur, wer den Thread bearbeiten darf** (`darfAustragen`). Für alle anderen ergibt das 404, wie jede Zeile, die sie nicht haben.
3. **Archiv:** Wer den Thread nicht bearbeiten darf, bekommt im Archiv 409 mit dem vorhandenen `ARCHIVIERT` (Spec 8: „nur noch Leitung“).
   - Geprüft wird nach 404 und Entwurf, vor der Frist.
   - `darfAntworten` der Umfrage bleibt unverändert. Ihr fehlt die Archivprüfung bisher; das ist eine offene Frage an den Eigentümer, kein Teil dieser Etappe.
4. ⚑ **`DELETE` nimmt keine `clientId` und ist idempotent.** Ein fehlender Eintrag ergibt 200 mit der frischen Ansicht und schreibt nichts.
   - Spec 8 verlangt eine `clientId` „je Eintragungs-Route“. Nach dem Löschen gibt es aber keine Zeile mehr, an der sie hängen könnte; die Wiederholung erkennt der Server am fehlenden Eintrag.
   - Verworfen: eine eigene Tabelle für gelöschte clientIds.
5. **Ein Eintrag ist ein Upsert je `(positionId, fuerId)`.**
   - Eine geänderte Notiz überschreibt `notiz`, `vonId` und `clientId`. `eingetragenAm` bleibt, die Reihenfolge in der Position ist die der Anmeldung.
   - Wie bei der Umfrage-Antwort erkennt der Server eine Wiederholung nur, solange niemand die Zeile seither geändert hat.
6. **Die Änderung hat die Art `ANTWORT` mit `objektId` = Modul-ID** (Spec 8). Die Umfrage schreibt dort weiter die Antwort-ID.
7. **„Neu“:** In einem Thread mit Helferliste sieht jeder Leser Einträge (Spec 5.2: keine Ergebnis-Einstellung). Deshalb ist `antwortenSichtbar` dort für Nicht-Entfernte immer `true`.
8. **„Braucht deine Antwort“** (Rahmen 5.2) nennt eine Helferliste je eigener Zeile ohne einen einzigen Eintrag im Modul. Das gilt nur, wenn
   - die Liste eine Frist hat, die noch läuft,
   - und mindestens eine Position einen freien Platz hat.
     ⚑ Verworfen: auch ohne Frist. Familien, die nicht helfen können, würden sonst ohne Ende gemahnt.
9. **Die Einheit lässt sich nach dem ersten Eintrag nicht mehr ändern** (409, analog TP3 3.14). Sonst stünden Einträge von Personen da, die nach der neuen Einheit gar nicht gefragt wären.
10. **Eine Friständerung schreibt `FRIST_GEAENDERT`** wie bei der Umfrage. `frage` ist dabei der Modultitel, ohne Titel `Helferliste`.
11. **„eingetragen von“ sieht nur, wen es angeht.**
    - Unter einem Eintrag steht es, wenn der Betrachter für diese Zeile antworten darf oder den Thread bearbeiten darf. Der Satz kommt aus `eingetragenVon` (namen.ts).
    - Fremde Leser sehen nur Name und Notiz.
12. **Die Thread-Suche findet keine Positionstexte**, wie sie keine Umfrage-Fragen findet (liste.ts, Spec 4.1).
13. **Die Verwaltungsliste verlinkt die Antworten-Übersicht auch bei einer Helferliste.** `VerwaltungThread.hatUmfrage` heißt dafür `hatAntwortModul`; der Editor-Link folgt.
14. **Demo:** Bowling bekommt eine Helferliste („Fahrer“ 2, „Snacks“ 3, Frist in 5 Tagen) mit einem Eintrag von Sandra mit Notiz. Damit gibt es etwas zur lokalen Abnahme. Das Zeltlager mit allen Modulen bleibt in Etappe 6.

**Nicht in dieser Etappe:**

- Teilen-Zeile „🙋 Kuchen 1/4 · …“, Datenauszug der Einträge, Demo-Zeltlager und Ende-zu-Ende-Zeltlager (Etappe 6, Spec 11–13).
- Fahrgemeinschaft und Kosten (Etappen 4 und 5).
- Archivprüfung der Umfrage-Antwort (Entscheidung 3).
- Aus dem Etappe-2-Rückstand bleibt alles offen, auch die Last durch `ladeThreads`. Er liegt in Medien und Fotos und berührt die Helferliste nicht.

## Global Constraints

- Code-Kommentare und Oberfläche sind deutsch. Commit-Nachrichten deutsch in ASCII (Umlaute umschrieben), mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Einrückung mit Tabs. Ausnahmen: YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative. **In `template:`/`styles:` keine Backticks in Kommentaren.**
- Angular: Vorlagen und Stile inline, `@if`/`@for`/`@switch`, Signale, `ChangeDetectionStrategy.OnPush`, Präfix `jf-`, Tokens aus `styles.css`.
- Regeln sind reine Funktionen; in `libs/domain` nie `new Date()` ohne Argument.
- Vereinsdaten nur über `vereinDb`. Was die Person nicht sehen oder nicht tun darf: 404. Ohne Sitzung: 401.
- Schreibpfad nach TP3 4.2, in dieser Reihenfolge:
  1. Rate-Limit (`antwortenFenster`, 60 je Minute je Person, vorhanden);
  2. 400;
  3. 404;
  4. Wiederholung über `clientId`;
  5. 409/410;
  6. `mitAenderung` mit Neuprüfung unter der Sperre;
  7. nach dem Commit `deps.bus`;
  8. Antwort `{ modul, stand }`.
- Grenzen (in `GRENZEN`, `entwurf.ts`):
  - `positionen: 30`, `positionText: 80`, `anzahl: 99`, `notiz: 80`.
  - Länge in Codepunkten (`laenge`), nach `trim`.
  - Dieselben Zahlen stehen als CHECKs im Schema.
- Texte (wörtlich):
  - Modultyp in „Modul hinzufügen“ und Ersatztitel: `Helferliste`
  - Editor:
    - `Bitte mindestens eine Position.`
    - `Höchstens 30 Positionen.`
    - `Bitte jede Position ausfüllen.`
    - `Jede Position nur einmal.` (ohne Groß-/Kleinschreibung, wie Optionen)
    - `Die Anzahl muss zwischen 1 und 99 liegen.`
    - Zu lang: `hoechstens(80)`
  - Konflikte (409, `konflikt: true`):
    - `Für „<Text>“ hat sich schon jemand eingetragen.` (Position entfernt)
    - `Für „<Text>“ sind schon <n> eingetragen.` (Anzahl darunter)
    - `Die Einheit lässt sich nach den ersten Einträgen nicht mehr ändern.`
    - `Die Helferliste „<Titel oder Helferliste>“ hat schon Einträge und lässt sich nicht entfernen.`
  - Route:
    - `VOLL`: `{ fehler: 'Hier sind schon alle Plätze vergeben.', code: 'VOLL' }`
    - Notiz zu lang oder mit Steuer-/Formatzeichen (`\p{Cc}`, `\p{Cf}`): 400 `ungueltigesFeld('notiz')`
  - Thread-Seite:
    - Füllstand `1/4`, bei voller Position zusätzlich `voll`
    - leere Position `Noch niemand eingetragen.`
    - Eintrag `<absenderName> – <Notiz>` (Halbgeviertstrich mit Leerzeichen; ohne Notiz nur der Name)
    - Knöpfe: `Eintragen`, `Austragen`, `Notiz ändern`; für Kinder `<Vorname> eintragen`, `<Vorname> austragen`
    - Feld `Notiz (optional)` mit Platzhalter `z. B. Marmorkuchen`
- Im Browser und in Tests nur erfundene Daten.
- Nach jeder Task grün: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache`.
- Vor dem Abschluss: `pnpm exec prettier --check .` und `pnpm run e2e`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp4-etappe3-helfer`.

## Review Focus

1. **Letzter Platz, zwei Tipps gleichzeitig:** Eine Position hat 3 von 4 Plätzen belegt, und zwei Familien tragen sich im selben Moment ein. Genau eine bekommt 200, die andere 409 `VOLL`, und die Position zeigt `4/4`, nicht `5/4` (Task 5).
2. **Notiz ändern bei voller Position:** Wer schon eingetragen ist, ändert seine Notiz in einer vollen Position mit 200. Das belegt keinen zweiten Platz (Tasks 1, 5).
3. **Thread, Modul oder Position mit Einträgen löschen:** Der Editor lehnt das Entfernen mit 409 und Text ab, statt mit einer 404 aus einem Fremdschlüsselfehler zu enden. Das Löschen des ganzen Threads ist gesperrt (`darfLoeschen: false`, 409 `NICHT_LOESCHBAR`). Die Vereinslöschung geht trotz Einträgen durch (Tasks 2, 3, 4).
4. **Frist und Archiv:** Eine Familie trägt sich in der Fristsekunde aus und bekommt 410. Im Archiv bekommt sie 409 `ARCHIVIERT`. Die Leitung trägt in beiden Fällen nach (Tasks 1, 5).
5. **Wiederholte Anfrage:** Dieselbe `clientId` ein zweites Mal ergibt 200 mit derselben Ansicht und keine zweite Änderung, auch nach der Frist. Ein wiederholtes `DELETE` ergibt 200 ohne Änderung (Task 5).

## Dateistruktur

```
libs/domain/src/module/helfer/helfer.ts (+ spec)          NEU: Plätze, Notiz, Rechte, Sperre, Konflikte, Ansicht
libs/domain/src/threads/{typen,antworten,ansicht,entwurf,vergleich,start,verwaltung,teilen}.ts
libs/domain/src/index.ts
prisma/schema.prisma, prisma/migrations/<stamp>_helfer/migration.sql
libs/db/src/lib/verein-db.ts, libs/db/src/{schema,verein-db}.spec.ts
apps/jufi/src/server/threads/helfer.ts (+ spec)            NEU: PUT/DELETE /helfer/:positionId/eintraege/:fuerId
apps/jufi/src/server/threads/{schreiben,laden,lesen,bearbeitung,verwalten,routen,test-threads}.ts
apps/jufi/src/server/mandanten.spec.ts
apps/jufi/src/app/verein/threads/helfer-modul.ts (+ spec)  NEU: jf-helfer-modul
apps/jufi/src/app/verein/threads/{thread-api,thread-seite}.ts
apps/jufi/src/app/verein/verwaltung/threads/helfer-felder.ts (+ spec)  NEU: jf-helfer-felder
apps/jufi/src/app/verein/verwaltung/threads/{editor,vorschau,antworten,liste}.ts
apps/cli/src/demo.ts, apps/jufi-e2e/src/{ablauf,layout}.spec.ts, README.md, CLAUDE.md
```

---

### Task 1: Regeln für Gefragte, Plätze und Einträge

**Files:**

- Create: `libs/domain/src/module/helfer/helfer.ts`, `helfer.spec.ts`
- Modify: `libs/domain/src/threads/typen.ts`, `antworten.ts`, `ansicht.ts` (`threadDatenAus`), `start.ts`, `entwurf.ts` (nur `GRENZEN`), `index.ts` und deren Specs. Alle Stellen, die `ThreadDaten` bauen (Specs in `libs/domain`, `apps/jufi/src/server`), bekommen `helfer: []`.

**Interfaces:**

- Produces (`typen.ts`):
  - `interface AntwortRegel { einheit: AntwortEinheit; frist: Date | null }`
  - `interface HelferEintragDaten { fuerId: string; vonId: string; notiz: string | null; eingetragenAm: Date }`
  - `interface HelferPositionDaten { id: string; schluessel: string; text: string; anzahl: number; eintraege: readonly HelferEintragDaten[] }`, Einträge nach `eingetragenAm` aufsteigend
  - `interface HelferDaten extends AntwortRegel { modulId: string; positionen: readonly HelferPositionDaten[] }`, Positionen in ihrer Reihenfolge
  - `ThreadDaten.helfer: readonly HelferDaten[]`
- Produces (`antworten.ts`, nur Typen ändern sich):
  - `gefragte(regel: Pick<AntwortRegel, 'einheit'>, kopf, umfeld)`
  - `antwortZeilen(betrachter, regel: Pick<AntwortRegel, 'einheit'>, kopf, umfeld)`
  - `darfAntworten(person, fuerId, regel: AntwortRegel, kopf, umfeld, jetzt)`
- Produces (`module/helfer/helfer.ts`):
  - `type EintragErlaubnis = AntwortErlaubnis | 'ARCHIVIERT'`
  - `darfEintragen(person: ThreadPerson, fuerId: string, helfer: AntwortRegel, daten: { kopf: ThreadKopf; termine: readonly TerminDaten[] }, umfeld: Umfeld, jetzt: Date): EintragErlaubnis`
    - Erst `darfAntworten`; `NICHT_GEFUNDEN` und `ENTWURF` gehen unverändert durch.
    - Sonst gilt: Darf die Person den Thread nicht bearbeiten und `istArchiviert(kopf, termine, jetzt)`, dann `ARCHIVIERT`.
    - Sonst das Ergebnis von `darfAntworten`.
  - `darfAustragen(person, eintrag: { fuerId: string }, helfer: AntwortRegel, daten, umfeld, jetzt): EintragErlaubnis`
    - Darf die Person bearbeiten, sieht sie den Thread und ist er veröffentlicht, dann `ERLAUBT`, auch wenn `fuerId` nicht mehr gefragt ist (Entscheidung 2).
    - Sonst `darfEintragen`.
  - `hatPlatzFuer(position: HelferPositionDaten, fuerId: string): boolean`. `true`, wenn `fuerId` schon eingetragen ist (Notiz ändern) oder `eintraege.length < anzahl`.
  - `pruefeNotiz(roh: unknown): { ok: true; notiz: string | null } | { ok: false }`
    - `undefined`, `null` und Leeres nach `trim` ergeben `null`.
    - Kein String, mehr als 80 Codepunkte, `\p{Cc}` oder `\p{Cf}` ergibt `{ ok: false }`.
- Produces (`start.ts`):
  - `siehtErgebnisse(ich, kopf, daten: Pick<ThreadDaten, 'umfragen' | 'helfer'>): boolean`. Mit `helfer.length > 0` und `!ich.entferntAm` ist es `true` (Entscheidung 7).
  - `neuEingabeFuer(ich, t, daten: Pick<ThreadDaten, 'umfragen' | 'helfer'>, zugangSeit)`. Die Aufrufer in `liste.ts` (domain) und im Server geben `daten` statt `daten.umfragen`.
  - `brauchtAntwort` nimmt Helferlisten nach Entscheidung 8 auf, mit demselben `OffenerPunkt` und derselben Sortierung.
- `GRENZEN` bekommt `positionen: 30`, `positionText: 80`, `anzahl: 99`, `notiz: 80`.

- [ ] **Step 1: Branch anlegen:** `git switch -c feature/tp4-etappe3-helfer`
- [ ] **Step 2: Tests schreiben** (`helfer.spec.ts`, `start.spec.ts`; Personen und Umfeld aus den vorhandenen Testhilfen der Domain):
  - `hatPlatzFuer` (Spec 13.1 „Helfer-Plätze“):
    - 3 von 4 → `true`;
    - 4 von 4 für eine Neue → `false`;
    - 4 von 4 für eine schon Eingetragene → `true` (Review Focus 2);
    - Anzahl 1, leer → `true`.
  - `pruefeNotiz`: `'  Marmorkuchen '` → `'Marmorkuchen'`; `''` und `undefined` → `null`; 81 × `'a'` → `{ ok: false }`; 80 × `'ä'` → ok; `'a‮b'` → `{ ok: false }`; `42` → `{ ok: false }`.
  - `darfEintragen` (Einheit `ERWACHSENER`, Frist morgen, Bowling-artiger Kopf):
    - Mutter für sich → `ERLAUBT`.
    - Mutter für ihr Kind bei `ERWACHSENER` → `NICHT_GEFUNDEN`; bei `JUNGFISCHER` → `ERLAUBT`.
    - Entwurf → `ENTWURF`.
    - `jetzt` = Frist → `FRIST_ABGELAUFEN`; Leitung dann → `ERLAUBT`.
    - Archiviert (`archivModus: 'ARCHIVIERT'`) → `ARCHIVIERT`; Leitung → `ERLAUBT`.
    - Jemand, der den Thread nicht sieht → `NICHT_GEFUNDEN`, auch im Archiv.
  - `darfAustragen`:
    - Leitung für eine entfernte Person → `ERLAUBT`.
    - Mutter für eine entfernte Person → `NICHT_GEFUNDEN`.
    - Leitung im Entwurf → `ENTWURF`.
  - `brauchtAntwort`:
    - Helferliste mit Frist, Mutter ohne Eintrag → ein Punkt mit `modulId` der Liste.
    - Mit Eintrag in einer Position → kein Punkt.
    - Ohne Frist → kein Punkt.
    - Frist vorbei → kein Punkt.
    - Alle Positionen voll → kein Punkt.
    - Bei `JUNGFISCHER` eine Zeile je Kind (`vorname` des Kindes).
  - `siehtErgebnisse`: Thread nur mit Helferliste → `true`; mit `entferntAm` → `false`; ohne Helferliste und mit Umfrage `ergebnisse: 'JUGENDLEITER'` als Familie → `false` (wie bisher).
- [ ] **Step 3: Tests scheitern:** `pnpm nx test domain --skip-nx-cache`, FAIL.
- [ ] **Step 4: Umsetzen**, über `index.ts` exportieren. Der Kommentar an `darfEintragen` nennt Entscheidung 3 samt der offenen Umfrage-Frage. Der Kommentar an `hatPlatzFuer` nennt Entscheidung 1.
- [ ] **Step 5: Tests grün**, dazu `pnpm nx run-many -t typecheck` (neues Pflichtfeld `helfer`).
- [ ] **Step 6: Commit:** `git commit -m "TP4 Etappe 3: Regeln fuer Helfer-Plaetze, Eintragen und Braucht deine Antwort"`

---

### Task 2: Entwurf, Vergleich, Ansicht und Übersicht der Helferliste

**Files:**

- Modify: `libs/domain/src/module/helfer/helfer.ts`, `libs/domain/src/threads/entwurf.ts`, `vergleich.ts`, `ansicht.ts`, `verwaltung.ts`, `teilen.ts`, `index.ts` und Specs

**Interfaces:**

- Consumes: Task 1
- Produces:
  - `ModulEntwurf` bekommt `{ typ: 'HELFER'; id: string | null; titel: string | null; einheit: AntwortEinheit; frist: string | null; positionen: PositionEntwurf[] }` mit `PositionEntwurf = { schluessel: string | null; text: string; anzahl: number }`. `MODULTYPEN` bekommt `'HELFER'`.
  - `neuesModul('HELFER', …)`:
    - Einheit `ERWACHSENER`, wenn `einheitenFuer(rollenfilter)` sie enthält, sonst deren erste;
    - `frist: null`;
    - `positionen: [{ schluessel: null, text: '', anzahl: 1 }]`.
  - `ModulDaten` bekommt `{ typ: 'HELFER'; id: string; titel: string | null; helfer: HelferDaten }`. `threadDatenAus` füllt `helfer`.
  - `HelferSperre = { eingetragen: boolean; belegt: Record<string, number> }` (Schlüssel → Zahl der Einträge) und `helferSperre(h: HelferDaten): HelferSperre`
  - `HelferKonflikt = { feld: 'positionen'; schluessel: string; art: 'ENTFERNT' | 'ANZAHL'; belegt: number } | { feld: 'einheit' }`
  - `pruefeHelferAenderung(alt: HelferDaten, neu: { einheit: AntwortEinheit; positionen: readonly PositionEntwurf[] }): HelferKonflikt[]`
  - `ModulPlan.positionenLoeschen: string[]`, Schlüssel unbelegter Positionen, die der Entwurf nicht mehr hat
  - `HelferEintragAnsicht = { fuerId: string; name: string; notiz: string | null; eingetragenVon: string | null }`
  - `HelferModulAnsicht`:
    ```
    { typ: 'HELFER'; id: string; titel: string | null; einheit: AntwortEinheit;
      frist: string | null; fristAbgelaufen: boolean;
      positionen: { id: string; text: string; anzahl: number; belegt: number; eintraege: HelferEintragAnsicht[] }[];
      zeilen: { fuerId: string; vorname: string; selbst: boolean; darfEintragen: boolean }[] }
    ```
  - `helferAnsicht(ich: ThreadPerson, modul: Extract<ModulDaten, { typ: 'HELFER' }>, daten: ThreadDaten, umfeld: Umfeld, jetzt: Date): HelferModulAnsicht`
  - `ModulAnsicht` schließt `HELFER` aus `ModulDaten` aus und nimmt `HelferModulAnsicht` auf.
  - `ThreadBearbeitung.helferSperren: Record<string, HelferSperre>`
  - `HelferUebersicht`:
    ```
    { modulId: string; titel: string | null; frist: string | null; fristAbgelaufen: boolean;
      positionen: { id: string; text: string; anzahl: number; belegt: number;
        eintraege: { fuerId: string; name: string; notiz: string | null; eingetragenVon: string | null }[] }[];
      gefragte: { fuerId: string; name: string }[];
      ohneEintrag: number }
    ```
  - `AntwortenUebersicht.helfer: HelferUebersicht[]`
  - `VerwaltungThread.hatUmfrage` wird `hatAntwortModul` (Entscheidung 13).

Regeln im Einzelnen:

- `modulFehler` für `HELFER`:
  - Titel wie bei den anderen Typen.
  - Einheit aus `einheitenFuer(rollenfilter)`, sonst Feldfehler `module.<i>.einheit`, wie bei der Umfrage.
  - Frist wie bei der Umfrage.
  - Positionen am Feld `module.<i>.positionen`, mit den Texten aus den Global Constraints, in dieser Reihenfolge:
    1. Zahl;
    2. leer;
    3. Länge;
    4. doppelt;
    5. `anzahl` ganzzahlig 1–99.
  - Ein unbekanntes Feld oder ein fremder Schlüssel ist wie bei Optionen ein 400 aus `vergleicheEntwurf`.
- `vergleicheBestehendes` für `HELFER`:
  - `geaendert`, wenn Titel, Einheit, Frist, Texte, Anzahlen, Reihenfolge oder die Menge der Positionen abweichen.
  - Eine geänderte Frist schreibt `FRIST_GEAENDERT` mit `{ frage: titel ?? 'Helferliste', frist }` (Entscheidung 10).
  - Konflikte kommen aus `pruefeHelferAenderung`, der erste wird gemeldet:
    - `ENTFERNT` und `ANZAHL` an `module.<i>.positionen`;
    - `einheit` an `module.<i>.einheit`.
- Beim Entfernen eines Moduls ergibt eine Helferliste mit `helferSperre().eingetragen` einen Konflikt am Feld `module`.
- `helferAnsicht`:
  - `zeilen` aus `antwortZeilen(ich, helfer, kopf, umfeld)`; `darfEintragen` ist `darfEintragen(…) === 'ERLAUBT'`.
  - `name` ist `absenderName(fuerId, umfeld)`.
  - `eingetragenVon` folgt Entscheidung 11: `eingetragenVon(vonId, fuerId, ich.id, umfeld)`, wenn `fuerId` unter den eigenen Zeilen steht oder `darfBearbeiten` gilt; sonst `null`.
- `antwortenUebersicht`:
  - `gefragte` aus `gefragte(helfer, kopf, umfeld)` mit `kurzname`.
  - In den Einträgen ist `name` der `kurzname` bzw. `EHEMALIGES_MITGLIED`, `eingetragenVon` der Kurzname der Eintragenden, wenn sie nicht `fuerId` ist (wie `UebersichtZeile`).
  - `ohneEintrag` zählt Gefragte ohne einen Eintrag im Modul.
- `teilenText` ergibt für `HELFER` vorerst keine Zeile (Etappe 6).

- [ ] **Step 1: Tests schreiben** (Spec 13.1 „Editor-Prüfungen der neuen Module“):
  - `entwurfAus`:
    - Helferliste mit zwei Positionen → ok.
    - 0 Positionen → `Bitte mindestens eine Position.`
    - 31 Positionen → `Höchstens 30 Positionen.`
    - `'  '` → `Bitte jede Position ausfüllen.`
    - 81 Zeichen → `hoechstens(80)`.
    - `Kuchen`/`kuchen` → `Jede Position nur einmal.`
    - `anzahl` 0, 100 und 1.5 → `Die Anzahl muss zwischen 1 und 99 liegen.`
    - `JUNGFISCHER` bei `NUR_FAMILIE` → Fehler an `einheit`.
  - `neuesModul('HELFER')` bei `NUR_JUGENDLEITER` → Einheit `ERWACHSENER`.
  - `vergleicheEntwurf` mit „Kuchen“ (4, zwei Einträge) und „Grill“ (2, leer):
    - „Grill“ entfernen → `positionenLoeschen: [<schluessel Grill>]`.
    - „Kuchen“ entfernen → 409 `Für „Kuchen“ hat sich schon jemand eingetragen.`
    - „Kuchen“ auf 1 → 409 `Für „Kuchen“ sind schon 2 eingetragen.`
    - „Kuchen“ umbenennen in „Torte“ und nach unten schieben → kein Konflikt, Schlüssel bleibt, `geaendert`.
    - Einheit auf `PERSON` → 409 `Die Einheit lässt sich nach den ersten Einträgen nicht mehr ändern.`
    - Modul entfernen → 409 `Die Helferliste „Mitbringen“ hat schon Einträge und lässt sich nicht entfernen.`
    - Frist gesetzt → `FRIST_GEAENDERT` mit `frage: 'Mitbringen'`.
  - `threadAnsicht`:
    - Positionen mit `belegt`.
    - Eintrag von Sandra mit Notiz → `name: 'Sandra M. (Mutter von Lena)'`, `notiz: 'Marmorkuchen'`.
    - Eintrag einer Entfernten → `name: 'ehemaliges Mitglied'`.
    - Leitung trägt für Sandra ein. Sandra sieht `eingetragenVon: 'eingetragen von Thomas K.'`, ein fremder Leser `null`.
    - Nach der Frist hat die Mutter `darfEintragen: false`, die Leitung `true`.
  - `antwortenUebersicht`: `helfer[0].ohneEintrag` und `gefragte` für Einheit `ERWACHSENER`; Leser ohne Recht → `null` (wie bisher).
  - `verwaltungThread`: nur Helferliste → `hatAntwortModul: true`.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test domain --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.** Jede Weiche über `typ` bekommt `HELFER` ausdrücklich (erschöpfender `switch` mit `never`).
- [ ] **Step 4: Tests grün**, dazu `pnpm nx run-many -t typecheck`.
  - Weichen in Server und Client, die `HELFER` noch nicht kennen, bekommen einen Zweig, der nichts tut bzw. nichts zeigt. Tasks 4, 6 und 7 füllen ihn.
  - Der Client folgt der Umbenennung `hatAntwortModul`.
  - Kein `// TODO`, kein `as`, das den Fehler verdeckt.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 3: Entwurf, Vergleich, Ansicht und Uebersicht der Helferliste"`

---

### Task 3: Datenmodell und Migration

**Files:**

- Modify: `prisma/schema.prisma`, `libs/db/src/lib/verein-db.ts`, `libs/db/src/schema.spec.ts`, `libs/db/src/verein-db.spec.ts`
- Create: `prisma/migrations/<stamp>_helfer/migration.sql` (`pnpm prisma migrate dev --create-only --name helfer`, dann von Hand)

**Interfaces:**

- Produces (Prisma):
  - `ModulTyp` bekommt `HELFER`.
  - `HelferModul (id, vereinId, einheit AntwortEinheit @default(ERWACHSENER), frist DateTime?)`
    - nach dem Muster `UmfrageModul`;
    - `id` = Modul-ID, Relation über `[vereinId, id]` auf `ThreadModul` mit `Cascade`.
  - `HelferPosition (id, vereinId, modulId, text, anzahl Int, position Int, schluessel)`
    - wie `UmfrageOption`;
    - Relation auf `HelferModul` mit `Cascade`;
    - `@@unique([modulId, schluessel])`, `@@unique([vereinId, id])`.
  - `HelferEintrag (id, vereinId, positionId, fuerId, vonId, notiz String?, eingetragenAm, clientId)`
    - wie `UmfrageAntwort`;
    - Position, `fuer` und `von` mit `NoAction`;
    - `@@unique([positionId, fuerId])`, `@@unique([vereinId, clientId])`.
  - Back-Relationen an `Verein` und `Person`.
  - Alle drei Modelle in `VEREINS_MODELLE`.
- CHECKs von Hand, nach dem Muster in `20261020152933_threads/migration.sql`:
  - `char_length(text) BETWEEN 1 AND 80`
  - `anzahl BETWEEN 1 AND 99`
  - `position >= 0`
  - `schluessel ~ '^[a-z0-9-]{1,40}$'`
  - `notiz IS NULL OR char_length(notiz) BETWEEN 1 AND 80`
- Der neue Enum-Wert per `ALTER TYPE … ADD VALUE`, wie in `…fotos_dateien`. In derselben Migration nutzt ihn kein Ausdruck.

- [ ] **Step 1: Tests schreiben** (`schema.spec.ts`, Testdatenbank):
  - CHECKs: `anzahl` 0 und 100, Text `''` und 81 Zeichen, Notiz `''` und 81 Zeichen, Schlüssel `'A'` werden abgelehnt.
  - Zweiter Eintrag derselben Person in derselben Position → P2002.
  - Gleiche `clientId` im Verein → P2002.
  - `ThreadModul` einer Helferliste ohne Einträge löschen → Positionen und `HelferModul` weg.
  - Mit Eintrag → P2003; ebenso das Löschen des Threads (Review Focus 3).
  - Den Verein mit Helfer-Einträgen löschen → gelingt (Review Focus 3, Vereinslöschung).
  - `verein-db.spec.ts` kennt die drei Modelle.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test db --skip-nx-cache -- schema verein-db`, FAIL.
- [ ] **Step 3: Umsetzen**, `pnpm run db:generate`. Scheitert die Vereinslöschung an der Reihenfolge der Kaskaden, gilt die Lösung von `UmfrageAntwort` (gleiches Muster). Sie wird nicht eigens erfunden.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 3: Datenmodell der Helferliste"`

---

### Task 4: Helferliste speichern, laden und schützen

**Files:**

- Modify: `apps/jufi/src/server/threads/schreiben.ts` (`schreibeModul`, neues `schreibePositionen`), `laden.ts` (`ladeThreads`, `modulVon`, `modulOrt`, neues `positionOrt`), `lesen.ts`, `bearbeitung.ts` (`loeschZaehler`, `ladeBearbeitung`), `liste.ts` (Aufrufe von `neuEingabeFuer`), `test-threads.ts` und Specs

**Interfaces:**

- Consumes: Tasks 1–3
- Produces:
  - `modulOrt` kennt `HELFER`.
  - `positionOrt(db: VereinDb | VereinTx, positionId: string): Promise<{ modulId: string; threadId: string } | null>`
  - `ladeThreads` lädt die Helferlisten mit Positionen (nach `position`). Einträge kommen nur bei `mitAntworten` (nach `eingetragenAm`, dann `id`), sonst sind sie leer, wie bei Umfragen.
  - `schreibePositionen(tx, modulId, positionen: readonly PositionEntwurf[], loeschen: readonly string[])`
    - nach dem Muster `schreibeOptionen`;
    - neue Positionen bekommen `neuerSchluessel()`;
    - `position` = Index;
    - `loeschen` sind Schlüssel aus `ModulPlan.positionenLoeschen`.
  - `loeschZaehler` zählt Helfer-Einträge zu `antworten`.
  - `ThreadBearbeitung.helferSperren`
  - `test-threads.ts`: `TestModul` bekommt `{ typ: 'HELFER'; einheit?; frist?; positionen: { text: string; anzahl: number }[] }`. Dazu kommt `trageEinTest(db, positionId, fuerId, vonId, notiz?)`, das Einträge direkt schreibt.

- [ ] **Step 1: Tests schreiben** (Testdatenbank):
  - `POST /threads` mit Helferliste (zwei Positionen) → 201. `GET /threads/:id` zeigt beide mit `belegt: 0` und Schlüsseln.
  - `PUT /threads/:id`:
    - umbenennen und umsortieren → Schlüssel gleich, Reihenfolge neu, Änderung `MODUL`;
    - leere Position entfernen → Zeile weg;
    - Position mit Eintrag entfernen → 409 mit Text.
  - Frist setzen im veröffentlichten Thread → Systemeintrag `FRIST_GEAENDERT` mit `frage: 'Helferliste'` (ohne Titel).
  - Bearbeitung eines Threads mit Eintrag → `darfLoeschen: false`, `helferSperren[<id>]` = `{ eingetragen: true, belegt: { <schluessel>: 1 } }`.
  - `DELETE /threads/:id` mit Eintrag → 409 `NICHT_LOESCHBAR` (Review Focus 3).
  - `GET /threads` (Liste) bleibt ohne Einträge. Start zeigt die Helferliste unter „Braucht deine Antwort“ (Frist morgen, Mutter ohne Eintrag).
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- threads`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 3: Helferliste speichern, laden und vor dem Loeschen schuetzen"`

---

### Task 5: Eintragen und Austragen

**Files:**

- Create: `apps/jufi/src/server/threads/helfer.ts`, `helfer.spec.ts`
- Modify: `apps/jufi/src/server/threads/routen.ts`, `fehler.ts` (`VOLL`), `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: Tasks 1, 2, 4; `mitAenderung`, `ladeVereinsstand`, `liesClientId`, `ungueltigesFeld`, `ThreadAbbruch`, `Wiederholung`, `antworteThreadFehler`
- Produces:
  - `helferRouten(router: Router, deps: VolleAppDeps): void`, eingehängt in `threadRouten`
  - `VOLL: Antwortkoerper` mit dem Text aus den Global Constraints

| Route                                          | Körper                                         | Erfolg                                     |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| `PUT /helfer/:positionId/eintraege/:fuerId`    | `{ notiz?: string \| null; clientId: string }` | 200 `{ modul: HelferModulAnsicht, stand }` |
| `DELETE /helfer/:positionId/eintraege/:fuerId` | keiner                                         | 200 `{ modul: HelferModulAnsicht, stand }` |

`PUT`, in dieser Reihenfolge, gebaut wie `PUT /umfragen/:modulId/antworten/:fuerId`:

1. `antwortenFenster` → 429.
2. `pruefeNotiz`, `liesClientId` → 400 `notiz` bzw. `clientId`.
3. `positionOrt`; Modul und Position laden; `darfEintragen` = `NICHT_GEFUNDEN` → 404.
4. `helferEintrag.findFirst({ where: { clientId } })`:
   - Gehört der Fund derselben Person, Position und `fuerId`, ist es eine Wiederholung: 200 mit frischer Ansicht und `ladeVereinsstand`.
   - Sonst 409 `CLIENT_ID_VERGEBEN`.
5. `ENTWURF` → 409; `ARCHIVIERT` → 409 `ARCHIVIERT`; `FRIST_ABGELAUFEN` → 410.
6. `!hatPlatzFuer` → 409 `VOLL`.
7. `mitAenderung`:
   - clientId erneut prüfen, Thread und Umfeld neu laden;
   - `darfEintragen` und `hatPlatzFuer` erneut, jeweils werfen;
   - dann Upsert nach Entscheidung 5;
   - Änderung `{ threadId, art: 'ANTWORT', objektId: modulId }`.
8. `bus.melde(...)` nach dem Commit, dann die Ansicht.
9. P2002 genau wie in `antworten.ts`: Findet sich die `clientId`, entscheidet `urteil` (200 oder 409 `CLIENT_ID_VERGEBEN`); sonst bleibt es beim ursprünglichen Fehler. Einen eigenen Zweig für `(positionId, fuerId)` gibt es nicht: Alle Schreiber laufen unter der Vereinssperre, der Upsert sieht die Zeile also immer.

`DELETE`:

1. Rate-Limit.
2. `positionOrt` und Laden.
3. Ohne Eintrag für `fuerId` gilt `darfEintragen`, sonst `darfAustragen`. `NICHT_GEFUNDEN` → 404.
4. `ENTWURF`, `ARCHIVIERT`, `FRIST_ABGELAUFEN` wie oben.
5. Kein Eintrag → 200 mit Ansicht und `ladeVereinsstand`, ohne Schreiben (Entscheidung 4).
6. Sonst `mitAenderung`:
   - neu laden, `darfAustragen` erneut;
   - ist der Eintrag unter der Sperre schon weg, `throw new Wiederholung(null)` (nichts geschrieben, 200);
   - sonst löschen, Änderung `ANTWORT`.
     Danach `bus`.

- [ ] **Step 1: Tests schreiben** (`helfer.spec.ts`, Testdatenbank, Hilfen aus `test-threads.ts` und `antworten.spec.ts`):
  - Eintragen:
    - Mutter trägt sich mit Notiz ein → 200, `belegt: 1`, Eintrag mit `notiz`.
    - Änderung `ANTWORT` mit `objektId` = Modul-ID, `bus` gemeldet.
  - Dieselbe `clientId` noch einmal → 200, keine zweite Änderung (Review Focus 5). Nach Ablauf der Frist → weiterhin 200.
  - Fremde `clientId` einer anderen Person → 409 `CLIENT_ID_VERGEBEN`.
  - Mutter ändert die Notiz in einer vollen Position (2/2, sie ist dabei) → 200, `belegt: 2` (Review Focus 2).
  - Volle Position, neue Person → 409 `{ code: 'VOLL' }`.
  - Letzter Platz: Barriere, zwei Mütter gleichzeitig (Muster aus `dokumente.spec.ts`) → genau ein 200 und ein 409 `VOLL`, danach `belegt` = `anzahl` (Review Focus 1).
  - Ablehnungen:
    - Notiz mit 81 Zeichen → 400 `feld: 'notiz'`.
    - Ohne `clientId` → 400.
    - Kind bei Einheit `ERWACHSENER` → 404.
    - Position eines Threads, den die Person nicht sieht → 404.
    - Umfrage-Modul-ID als `positionId` → 404.
    - Entwurf → 409 `ENTWURF`.
  - Frist und Archiv (Review Focus 4):
    - In der Fristsekunde: Eintragen und Austragen der Mutter → 410; Leitung trägt für die Mutter nach → 200, `eingetragenVon` in Mutters Ansicht.
    - Archiviert: Mutter → 409 `ARCHIVIERT`, Leitung → 200.
  - Austragen:
    - Eigener Eintrag → 200, `belegt` sinkt, Änderung `ANTWORT`.
    - Zweites `DELETE` → 200, keine Änderung (Review Focus 5).
    - Mutter trägt den Eintrag einer anderen Familie aus → 404.
    - Leitung trägt den Eintrag einer entfernten Person aus → 200 (Entscheidung 2).
  - Rate-Limit: 61. Anfrage einer Person in einer Minute → 429 (`antwortenFenster` mit kleiner Grenze im Test, wie in `antworten.spec.ts`).
  - Mandanten-Test: Fälle `'PUT /helfer/:positionId/eintraege/:fuerId'` und `'DELETE /helfer/:positionId/eintraege/:fuerId'` mit fremder Position → 404, fremde Einträge unverändert.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- helfer mandanten`, FAIL.
- [ ] **Step 3: Umsetzen.** Die Reihenfolge der Prüfungen steht im Kopfkommentar der Datei, mit Verweis auf `antworten.ts` statt die Begründungen zu wiederholen.
- [ ] **Step 4: Tests grün.**
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 3: Eintragen und Austragen in der Helferliste"`

---

### Task 6: Helferliste auf der Thread-Seite

**Files:**

- Create: `apps/jufi/src/app/verein/threads/helfer-modul.ts`, `helfer-modul.spec.ts`
- Modify: `apps/jufi/src/app/verein/threads/thread-api.ts`, `thread-seite.ts` (`@switch`, `ersetzeModul`) und Specs

**Interfaces:**

- Consumes: Task 2 (`HelferModulAnsicht`), Task 5 (Routen)
- Produces:
  - `ThreadApi.trageEin(slug: string, positionId: string, fuerId: string, koerper: { notiz: string | null; clientId: string }): Observable<{ modul: HelferModulAnsicht; stand: number }>`
  - `ThreadApi.trageAus(slug: string, positionId: string, fuerId: string): Observable<{ modul: HelferModulAnsicht; stand: number }>`
  - `jf-helfer-modul`:
    - Eingaben `modul: HelferModulAnsicht`, `slug: string`, `vorschau: boolean = false`;
    - Ausgaben `geaendert: HelferModulAnsicht` und `veraltet: void`.
  - `ersetzeModul(neu: UmfrageAnsicht | HelferModulAnsicht)`

Darstellung je Position:

- Text, Füllstand `belegt/anzahl` und ein Balken (`role="progressbar"` mit `aria-valuenow`/`aria-valuemax`). Bei voller Position steht `voll` daneben.
- Die Eingetragenen als Liste nach den Global Constraints, darunter `eingetragenVon`, falls gesetzt. Leer: `Noch niemand eingetragen.`
- Je eigener Zeile mit `darfEintragen`:
  - Ist sie eingetragen: `Austragen` und `Notiz ändern`.
  - Sonst `Eintragen`, nur wenn die Position nicht voll ist. Es öffnet unter der Position ein Formular mit `Notiz (optional)` (maxlength 80) und dem Knopf `Eintragen`.
  - Bei Kindern lauten die Knöpfe `<Vorname> eintragen` / `<Vorname> austragen`.
- Kopf: Titel (oder `Helferliste`) und `fristText` wie bei der Umfrage.
- In der `vorschau` keine Knöpfe.

Verhalten:

- Eine Handlung zur Zeit, wie `umfrage-modul.ts`. Jede Anfrage bekommt eine neue `crypto.randomUUID()`.
- Erfolg → `geaendert` mit der Ansicht aus der Antwort.
- 409 `VOLL`, 409 `ARCHIVIERT` und 410: den Text an der Position zeigen, dann `veraltet`. Die Seite lädt darauf still neu (`aktualisiereStill`).
- 404: wie `dateien-modul.ts`, mit Satz am Modul und `veraltet`.
- 401: `beiAbgelaufenerSitzung`.

- [ ] **Step 1: Tests schreiben** (`helfer-modul.spec.ts`, Ansicht als Eingabe, `HttpTestingController`):
  - „Kuchen“ 1/4 mit Sandras Eintrag zeigt `1/4` und `Sandra M. (Mutter von Lena) – Marmorkuchen`.
  - Volle Position zeigt `voll` und keinen `Eintragen`-Knopf.
  - `Eintragen` mit Notiz schickt `PUT …/helfer/<pos>/eintraege/<fuerId>` mit `{ notiz: 'Marmorkuchen', clientId: <uuid> }` und meldet `geaendert` mit der Antwort.
  - Leere Notiz → `notiz: null`.
  - Bei `JUNGFISCHER` und zwei Kindern gibt es `Lena eintragen` und `Max eintragen`.
  - `Austragen` schickt `DELETE`.
  - 409 `VOLL` → `Hier sind schon alle Plätze vergeben.` an der Position, `veraltet` gemeldet.
  - `vorschau` → keine Knöpfe.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache -- helfer-modul thread-seite`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Im Browser mit dem Demo-Verein (Bowling, nach Task 9 oder per Editor angelegt):
  - eintragen, Notiz ändern, austragen;
  - zweites Fenster als andere Person sieht es live;
  - 375 × 812 und 1280 × 800, hell und dunkel;
  - gemessen: kein waagrechter Überlauf (`scrollWidth`) bei Positionstext mit 80 Zeichen und Notiz mit 80 Zeichen.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 3: Helferliste auf der Thread-Seite"`

---

### Task 7: Helferliste im Editor

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/threads/helfer-felder.ts`, `helfer-felder.spec.ts`
- Modify: `apps/jufi/src/app/verein/verwaltung/threads/editor.ts` (`TYPEN`, `@switch`, `hatUmfrage` → `hatAntwortModul`), `vorschau.ts`, `liste.ts` und Specs

**Interfaces:**

- Consumes: Task 2 (`ModulEntwurf` `HELFER`, `neuesModul`, `HelferSperre`, `einheitenFuer`, `EINHEIT_TEXT`), Task 6 (`jf-helfer-modul`)
- Produces: `jf-helfer-felder` mit
  - Eingaben `modul` (Entwurf `HELFER`), `rollenfilter: Rollenfilter`, `sperre: HelferSperre | null`, `fehler: readonly Feldfehler[]`, `index: number`;
  - Ausgabe `aendern: ModulEntwurf`.

- „Modul hinzufügen“ bekommt `{ typ: 'HELFER', text: 'Helferliste' }`.
- Felder:
  - Titel;
  - Einheit (`einheitenFuer`, `EINHEIT_TEXT`);
  - Frist wie die Umfrage in `modul-felder.ts`. Das Markup wird nicht kopiert, wenn sich ein kleines gemeinsames Teil herauslösen lässt. Sonst steht im Kommentar, warum nicht.
- Positionen, je Zeile:
  - Text (maxlength 80), Anzahl (`type="number"`, min 1, max 99), Hoch/Runter, Entfernen;
  - `Position hinzufügen` bis 30.
- Mit `sperre`:
  - Entfernen ist aus, wenn `belegt[schluessel] > 0`; der Grund steht für Screenreader dabei (`Hat schon Einträge`).
  - Die Anzahl hat `min` = `belegt`.
  - Die Einheit ist aus, wenn `eingetragen`, mit dem Konflikttext als Hinweis.
- Feldfehler aus `fehler` stehen an `module.<index>.positionen` bzw. `.einheit` (Muster `FEHLERFELDER`).
- `mitPassenderEinheit` im Editor gilt auch für `HELFER`, wenn der Rollenfilter wechselt.
- Vorschau: `jf-helfer-modul` mit `vorschau` und einer Ansicht aus dem Entwurf (alle `belegt: 0`, keine Zeilen).

- [ ] **Step 1: Tests schreiben:**
  - Hinzufügen → eine leere Position, Einheit `ERWACHSENER`.
  - Position hinzufügen, verschieben, entfernen → `aendern` mit neuer Reihenfolge, Schlüssel bleiben.
  - Mit `sperre` `{ eingetragen: true, belegt: { k1: 2 } }` → Entfernen von k1 aus, Anzahl-`min` 2, Einheit aus.
  - Serverfehler 409 an `module.0.positionen` steht an den Positionen.
  - Rollenfilter `NUR_FAMILIE` bietet `Pro Jungfischer` nicht an.
  - Vorschau zeigt die Positionen mit `0/<anzahl>`.
  - Verwaltungsliste zeigt den Link zur Antworten-Übersicht bei einem Thread nur mit Helferliste.
- [ ] **Step 2: Tests scheitern:** `pnpm nx test jufi --skip-nx-cache -- helfer-felder editor vorschau liste`, FAIL.
- [ ] **Step 3: Umsetzen.** Die Felder entstehen in der eigenen Komponente, nicht in `modul-felder.ts` (Spec 10).
- [ ] **Step 4: Tests grün.** Im Browser:
  - Thread mit Helferliste anlegen, veröffentlichen, eintragen (Task 6);
  - zurück im Editor: Entfernen der belegten Position ist aus;
  - Anzahl unter die Belegung tippen und speichern → Konflikttext am Feld;
  - 1280 × 800 und 375 × 812, hell und dunkel.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 3: Helferliste im Editor"`

---

### Task 8: Helferliste in der Antworten-Übersicht

**Files:**

- Modify: `apps/jufi/src/app/verein/verwaltung/threads/antworten.ts` (+ spec), `apps/jufi/src/server/threads/verwaltung.spec.ts`

**Interfaces:**

- Consumes: Task 2 (`AntwortenUebersicht.helfer`), Task 6 (`ThreadApi.trageEin`, `trageAus`)

- Unter den Umfragen steht je Helferliste ein Block:
  - Kopf: Titel oder `Helferliste`, Frist, `<n> ohne Eintrag`.
  - Je Position: Text, `belegt/anzahl`, die Eingetragenen mit Notiz und `eingetragen von …`.
- Mit `darfNachtragen`:
  - Je Eintrag `Austragen`.
  - Je nicht volle Position ein kleines Formular: Auswahl `Person` aus `gefragte` ohne Eintrag in dieser Position, `Notiz (optional)`, Knopf `Eintragen`.
  - Erfolg lädt die Übersicht neu, wie `trageNach` es heute tut.
  - Fehler (`VOLL` usw.) stehen am Block.

- [ ] **Step 1: Tests schreiben:**
  - Server: `GET /threads/:id/antworten` eines Threads mit Helferliste enthält `helfer` mit `gefragte`, `ohneEintrag` und Einträgen.
  - Client:
    - Block mit `1/4` und Name.
    - Nachtragen schickt `PUT` mit gewählter `fuerId` und neuer `clientId`.
    - `Austragen` schickt `DELETE`.
    - Ohne `darfNachtragen` keine Knöpfe.
- [ ] **Step 2: Tests scheitern:** `pnpm nx run jufi:test-server --skip-nx-cache -- verwaltung` und `pnpm nx test jufi --skip-nx-cache -- antworten`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün.** Im Browser 1280 × 800 und 375 × 812, hell und dunkel; als Leitung nach der Frist nachtragen.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 3: Helferliste in der Antworten-Uebersicht mit Nachtragen"`

---

### Task 9: Demo, Ende-zu-Ende und Doku

**Files:**

- Modify: `apps/cli/src/demo.ts` (+ spec), `apps/jufi-e2e/src/ablauf.spec.ts`, `apps/jufi-e2e/src/layout.spec.ts`, `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-21-jufi-tp4-module-medien-design.md`

**Demo** (Entscheidung 14):

- Bowling bekommt als letztes Modul eine Helferliste: Titel `Mitbringen und fahren`, Einheit `ERWACHSENER`, Frist in 5 Tagen, Positionen `Fahrer` (2) und `Snacks` (3).
- Sandra ist in `Snacks` eingetragen, mit Notiz `Gemüsesticks`.
- `demo.spec` zählt Module und Einträge mit.

**Ende-zu-Ende**, im seriellen Ablauf nach den Foto-Schritten:

1. Leitung fügt im Editor dem Thread des Ablaufs eine Helferliste hinzu (`Kuchen` 1, `Grill` 2) mit Frist in 3 Tagen und speichert.
2. Mutter sieht auf der Startseite die Helferliste unter „Braucht deine Antwort“. Sie trägt sich bei `Kuchen` mit Notiz `Marmorkuchen` ein; `Kuchen` zeigt `1/1` und `voll`.
3. Das Kind hat den Thread offen und sieht den Eintrag ohne Neuladen.
4. Leitung öffnet die Antworten-Übersicht und trägt die Mutter bei `Grill` nach. Die Mutter sieht dort `eingetragen von …`.
5. Leitung versucht im Editor `Kuchen` zu entfernen → Konflikttext am Feld.

`layout.spec.ts` erwartet am Thread des Ablaufs danach 6 Module statt 5 (Zeile mit `toHaveCount(5)`).

**Doku:**

- README: im Abschnitt zu den Modulen ein Absatz „Helferliste“ (Einheit, Plätze, Frist und Archiv, Nachtragen).
- CLAUDE.md:
  - Stand: Zeile „TP4 Etappe 3 ist da: Helferliste (Modul, Eintragen mit Notiz unter `/helfer/:positionId/eintraege/:fuerId`, Antworten-Übersicht mit Nachtragen); `gefragte`/`darfAntworten` nehmen `AntwortRegel`.“
  - Stolperstein: Helfer-Einträge sperren das Löschen von Position, Modul und Thread (`NoAction`). Neue Löschpfade zählen sie in `loeschZaehler`.
- TP4-Spec:
  - die Entscheidungen 1–14 an ihren Stellen (5.1, 5.2, 8, 9.1, 9.3);
  - in 9.3 `VOLL` für die Helfer-Position mit dem Text.

- [ ] **Step 1: E2E-Tests und Demo-Test schreiben.**
- [ ] **Step 2: Scheitern sehen:** `pnpm nx test cli --skip-nx-cache` und `pnpm run e2e`. Die neuen Schritte scheitern nur dort, wo noch etwas fehlt; sonst die Ursache klären.
- [ ] **Step 3: Demo und Doku umsetzen.**
- [ ] **Step 4: Alles grün:** `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`, `pnpm run e2e`, `pnpm exec prettier --check .`.
- [ ] **Step 5: Commit:** `git commit -m "TP4 Etappe 3: Demo, Ende-zu-Ende und Doku zur Helferliste"`
