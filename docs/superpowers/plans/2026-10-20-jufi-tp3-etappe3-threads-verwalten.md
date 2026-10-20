# JuFi TP3 Etappe 3 — Threads verwalten — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jugendleiter legen in der Verwaltung Threads mit Info-Text, Termin und Umfrage an, sehen sie live im Handyrahmen, speichern Entwürfe, veröffentlichen, bearbeiten, pinnen an, archivieren, löschen und tragen in der Antworten-Übersicht telefonische Zu- und Absagen nach.

**Architecture:** Was ein Entwurf ist, ob er gültig ist und was sich gegenüber dem gespeicherten Thread ändert, entscheiden reine Funktionen in `libs/domain` (`entwurfAus`, `entwurfFehler`, `vergleicheEntwurf`). Der Server lädt, ruft sie **unter der Sperre** in `mitAenderung` und schreibt. Die Verwaltung bekommt den Punkt „Threads“ mit Liste, Editor (Formular links, Vorschau rechts) und Antworten-Übersicht. Die Vorschau nutzt die Modul-Bauteile der Thread-Seite mit einer Ansicht, die aus dem Entwurf entsteht.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (Signale, OnPush, inline), Express 4, Prisma 7, Postgres 17, Vitest 4, Playwright, `marked` 18 (vorhanden).

**Spec:** `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md` — Abschnitte 1.4 (Etappe 3), 2.1–2.4, 3.5–3.7, 3.11, 3.12, 3.14, 4.1–4.4, 6.2 (Kopf, „Wiederherstellen“), 6.6, 8. Eingabe außerdem: Memory „TP3-Rückstand nach Etappe 2“ (Punkte für Etappe 3).

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 14 trägt sie in die TP3-Spec ein.

1. **Lesende Routen der Verwaltung.** Die Spec nennt nur Schreibrouten und `GET /threads/:id/antworten`. Der Editor braucht den Thread aber in bearbeitbarer Form (Untergruppen-IDs, Options-Schlüssel, Frist als ISO, Sperren durch Antworten), und die Liste der Verwaltung braucht alle Threads samt Entwürfen, bevor es in Etappe 4 `GET /threads` gibt. Dafür: `GET /verwaltung/threads` (Liste, Untergruppen, `darfErstellen`) und `GET /threads/:id/bearbeitung` (`ThreadBearbeitung`). Verworfen: `GET /threads/:id` erweitern — die Ansicht ist die eines Mitglieds, und Schlüssel und Sperren gehören nicht in jede Mitgliederantwort.
2. **Verlorene Änderungen verhindert eine Version.** `Thread.bearbeitetStand` ist der Stand des letzten `POST`/`PUT`; `PUT` schickt ihn als `version` mit, ein anderer Wert ergibt 409 `VERALTET`. Verworfen: `geaendertAm` — `mitAenderung` setzt bei jeder Antwort `letzteAktivitaet*`, `@updatedAt` zöge mit, und jede Antwort machte den offenen Editor veraltet. Verworfen: keine Prüfung — zwei Geräte desselben Jugendleiters überschrieben sich still.
3. **Alles, was „angenommen oder nicht“ lautet, wird unter der Sperre entschieden.** `PUT`, Veröffentlichen, Archiv, Anpinnen und Löschen laden den Thread **in** der Arbeit von `mitAenderung` (die Vereinszeile ist dann gesperrt) und prüfen dort Version, 3.14 und die Löschbarkeit. Ebenso prüfen ab jetzt `POST /threads/:id/verlauf` und `PUT /umfragen/…/antworten` Schreibsperre, Gefragtsein und Frist dort noch einmal (Gesamtreview Etappe 2, M5): Der Editor kann Modus, Zielgruppe, Archiv und Frist zwischen Prüfung und Schreiben ändern.
4. **Anpinnen und Archivieren sind keine Aktivität.** Neue Änderungsart `LISTE`; sie steht wie `SICHTBARKEIT` und `GELOESCHT` in `OHNE_AKTIVITAET`. Verworfen: `THREAD` — jedes Anpinnen schöbe den Thread nach oben und hieße bei allen „Aushang geändert“. Etappe 4 lässt `LISTE` beim „Neu“-Kennzeichen außen vor (`istNeu` bekommt die Änderungen ohne diese Art).
5. **Änderungsarten der Schreibrouten.** `POST /threads`: `THREAD` und je Modul `MODUL`. `PUT`: `THREAD`; je angelegtem, geändertem oder gelöschtem Modul `MODUL`; `SICHTBARKEIT`, wenn sich Rollenfilter oder Untergruppen eines veröffentlichten Threads ändern; je Systemeintrag `VERLAUF`. Veröffentlichen: `THREAD`, `SICHTBARKEIT`, `VERLAUF` (Systemeintrag `VEROEFFENTLICHT`). Archiv und Anpinnen: `LISTE`. Löschen: `GELOESCHT`.
6. **Systemeinträge nur bei veröffentlichten Threads**, je `PUT` höchstens: ein `MODUS_GEAENDERT`; je bestehendem Termin-Modul mit geändertem `startDatum`, `endDatum`, `beginn` oder `ende` ein `TERMIN_GEAENDERT` mit dem **vollständigen** neuen `TerminDaten` (alle Felder, `null` ausgeschrieben); je bestehender Umfrage mit geänderter Frist ein `FRIST_GEAENDERT`. Neue oder entfernte Module erzeugen keinen. Verworfen: Einträge im Entwurf — niemand außer den Jugendleitern sieht ihn, und nach dem Veröffentlichen stünde eine Liste von Änderungen vor dem ersten Satz.
7. **Fehlerformen der Verwaltung.** Ungültiger Entwurf → 400 `{ fehler: <Satz>, feld }` mit dem **ersten** Fehler (der Client prüft vorher mit derselben Funktion und zeigt alle). Konflikte → 409 mit `code` und `feld`: `BEANTWORTET` (3.14 und Entfernen einer beantworteten Umfrage), `DOPPELTE_TEILNAHME`, `VERALTET`, `AUSTAUSCH` (Zielgruppe, Module, Archiv oder Löschen am Austausch), `NICHT_LOESCHBAR`, `KEINE_ZIELGRUPPE` (Veröffentlichen ohne Zielgruppe). Wer den Thread nicht bearbeiten darf: 404 wie bei Unsichtbarem.
8. **Feste Grenzen, die die Spec offen lässt:** Modultitel 80, Ort und Treffpunkt je 200 Zeichen (dazu CHECKs). Eine Umfrage ohne Teilnahme hat 2–20 Optionen mit verschiedenen Texten. Ein Info-Text hat mindestens ein Zeichen. Ein Datum muss ein Kalendertag sein (`2026-02-30` nicht). Eine Frist in der Vergangenheit ist erlaubt (Nachtragen nach einem Telefonat).
9. **Löschbar heißt: keine Antwort und keine nicht gelöschte Nachricht.** Eine gelöschte Nachricht hat keinen Text mehr; zählte sie, machte ein zurückgezogener Kommentar einen Thread für immer unlöschbar. Antworten zählen auch ohne Option, weil die Datenbank sie beim Löschen ohnehin verweigerte.
10. **„Stand teilen“ in der Antworten-Übersicht folgt mit Etappe 6** (Teilen-Text, Spec 7.1). Verworfen: einen vorläufigen Text bauen, den Etappe 6 ersetzt.
11. **Neue Optionen bekommen ihren Schlüssel vom Server:** `o` und acht Zeichen aus `[a-z0-9]` (Zufall aus `crypto`). Bestehende behalten ihren. Verworfen: den Schlüssel aus dem Text ableiten — ein Umbenennen vor dem ersten Speichern ergäbe zwei Schreibweisen für dieselbe Option.

## Global Constraints

- Code-Kommentare und Oberfläche deutsch; Commit-Nachrichten deutsch in ASCII (Umlaute umschrieben), Ende `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Antwort-Texte der API (`fehler`) mit Umlauten.
- Einrückung Tabs; Ausnahmen YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative. **In `template:`/`styles:` keine Backticks in Kommentaren.**
- Angular: Vorlagen und Stile inline, `@if`/`@for`, Signale (keine Reactive Forms), `changeDetection: ChangeDetectionStrategy.OnPush`, Selektor-Präfix `jf-`, Tokens und Klassen aus `styles.css` (`.knopf`, `.feld`, `.haken`), Tippflächen mindestens 44 px; jeder Fehlerpfad ruft `beiAbgelaufenerSitzung`.
- Regeln sind reine Funktionen mit `jetzt: Date`; nie `new Date()` ohne Argument in `libs/domain`. Server nimmt `deps.jetzt()`. Zeitzone der Anzeige immer `Europe/Berlin` über die Domain-Funktionen.
- Vereinsdaten nur über `vereinDb`; jede schreibende Thread-Route über `mitAenderung` als erste schreibende Anweisung; keine `isolationLevel`.
- Jede neue Vereins-Route: `brauchtMitglied` als erster Handler, `asynchron(...)`, ein Fall in `mandanten.spec.ts`. Unsichtbares, Unbekanntes und Fehlendes Recht ist 404 `{ fehler: 'nicht gefunden' }`, byte-gleich, nie 403.
- Feste Werte: Titel 1–120, Info-Text 1–10 000, Frage und Optionstext 1–200, Modultitel bis 80, Ort und Treffpunkt bis 200, höchstens 20 Module und 20 Optionen (Spec 4.3, Entscheidung 8). Texte: `JUNGFISCHER_FAMILIE` „Jungfischer + Familie“, `NUR_FAMILIE` „Nur Familie“, `NUR_JUGENDLEITER` „Nur Jugendleiter“, `JUGENDLEITER_JUGENDSPRECHER` „Jugendleiter + Jugendsprecher“; Einheiten „Pro Jungfischer“, „Pro Erwachsenem“, „Pro Person“; Ergebnisse „Für alle“, „Nur als Summe“, „Nur Jugendleiter“; Modus-Texte aus `MODUS_TEXT`; „Entwurf“, „Archiviert“, „Keine Zielgruppe mehr“, „Nicht gefunden oder keine Berechtigung“.
- Im Browser und in Tests nur erfundene Daten.
- Nach jeder Task: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache` grün. Nach einer Schemaänderung `pnpm run db:generate`. Vor dem Abschluss `pnpm exec prettier --check .` und `pnpm run e2e`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp3-etappe3-threads-verwalten`.

## Review Focus

1. **Gleichzeitige Antwort während des Bearbeitens:** Sandra antwortet, während Thomas im Editor die Option „Vielleicht“ entfernt oder die Umfrage löscht → 409 `BEANTWORTET` am Feld, nichts geschrieben, kein Stand verbraucht; nie 404 oder 500 aus einem P2003 (Tasks 3, 6).
2. **Rechte an den Rändern:** Jugendleiter mit nur „Threads erstellen“ öffnet den Thread eines anderen → 404 im Editor, Liste nur lesbar; Betreuer (nur „Antworten im Detail“) sieht die Antworten-Übersicht ohne „Eintragen“; am Austausch ändert „Alle Threads bearbeiten“ nur Titel, Modus und Anpinnen (Tasks 5, 6, 7).
3. **Ungültiges direkt an die API:** `2026-02-30`, Ende vor Beginn, 21 Module, 10 001 Zeichen, eine Untergruppe aus einem fremden Verein, eine Modul-ID eines anderen Threads → 400 mit `feld`, nichts geschrieben, kein Stand (Tasks 2, 3, 6).
4. **Leere Antwort sperrt das Entfernen:** Eine Umfrage, deren einzige Antwort keine Option hat, lässt sich nicht entfernen (409, nicht P2003 → 404), und der Thread ist nicht löschbar (Tasks 3, 7).
5. **Ungespeichertes im Editor:** Zurück-Navigation oder Schließen fragt nach; scheitert beim „Veröffentlichen“ das Speichern, wird nichts veröffentlicht, und die Eingaben bleiben stehen (Task 11).

## Dateistruktur

```
prisma/schema.prisma, prisma/migrations/<neu>_threads_verwalten   LISTE, bearbeitetStand, CHECKs
libs/db/src/lib/aenderung.ts                OHNE_AKTIVITAET + LISTE
libs/domain/src/zeit.ts                     + istKalendertag (aus threads/verlauf.ts verschoben)
libs/domain/src/module/termin/termin.ts     terminFehler prueft den Kalendertag
libs/domain/src/threads/entwurf.ts          ThreadEntwurf, GRENZEN, Texte, entwurfAus, entwurfFehler, neuesModul, entwurfAusThread
libs/domain/src/threads/vergleich.ts        vergleicheEntwurf, umfrageSperre
libs/domain/src/threads/verwaltung.ts       VerwaltungThread, ThreadBearbeitung, AntwortenUebersicht, zielgruppeText, antwortenUebersicht
libs/domain/src/threads/ansicht.ts          + darfBearbeiten, darfArchivieren
apps/jufi/src/server/threads/laden.ts       ladeThread nimmt auch eine Transaktion
apps/jufi/src/server/threads/bearbeitung.ts ladeBearbeitung
apps/jufi/src/server/threads/verwaltung.ts  GET /verwaltung/threads, GET /threads/:id/bearbeitung, GET /threads/:id/antworten
apps/jufi/src/server/threads/schreiben.ts   POST /threads, PUT /threads/:id
apps/jufi/src/server/threads/verwalten.ts   POST veroeffentlichen, PUT archiv, PUT angepinnt, DELETE /threads/:id
apps/jufi/src/server/threads/verlauf.ts, antworten.ts   Pruefungen unter der Sperre
apps/jufi/src/app/verein/verwaltung/huelle.ts           Punkt Threads
apps/jufi/src/app/verein/verwaltung/threads/threads-api.ts   VerwaltungThreadsApi
apps/jufi/src/app/verein/verwaltung/threads/liste.ts         Liste
apps/jufi/src/app/verein/verwaltung/threads/editor.ts        Seite: Laden, Speichern, Veroeffentlichen, Loeschen
apps/jufi/src/app/verein/verwaltung/threads/modul-felder.ts  Felder je Modultyp
apps/jufi/src/app/verein/verwaltung/threads/knopfleiste.ts   B, I, Liste, Link (formatiere)
apps/jufi/src/app/verein/verwaltung/threads/vorschau.ts      Handyrahmen (vorschauModule)
apps/jufi/src/app/verein/verwaltung/threads/ungespeichert.ts CanDeactivate
apps/jufi/src/app/verein/verwaltung/threads/antworten.ts     Antworten-Uebersicht mit Nachtragen
apps/jufi/src/app/verein/threads/thread-seite.ts             Bearbeiten, Wiederherstellen
apps/jufi/src/app/app.routes.ts
apps/jufi-e2e/src/ablauf.spec.ts, layout.spec.ts, threads.ts
```

---

### Task 1: Schema, Kalendertag, Änderungsart `LISTE`

**Files:**

- Modify: `prisma/schema.prisma`; Create: Migration `prisma/migrations/<zeit>_threads_verwalten/migration.sql`
- Modify: `libs/db/src/lib/aenderung.ts` (+ `libs/db/src/aenderung.spec.ts`, `schema.spec.ts`), `libs/domain/src/zeit.ts` (+ Spec), `libs/domain/src/threads/verlauf.ts`, `libs/domain/src/module/termin/termin.ts` (+ Spec)

**Interfaces:**

- Produces: `AenderungArt` um `LISTE`; `Thread.bearbeitetStand Int @default(0)`; `istKalendertag(tag: string): boolean` in `zeit.ts` (aus `verlauf.ts` verschoben, dort importiert); `terminFehler` meldet ungültige Tage.

- [ ] **Step 1: Branch anlegen** — `git switch -c feature/tp3-etappe3-threads-verwalten`
- [ ] **Step 2: Tests schreiben**
  - `zeit.spec.ts`: `istKalendertag('2026-02-28')` true, `('2028-02-29')` true, `('2026-02-29')`, `('2026-02-30')`, `('2026-13-01')`, `('2026-1-01')`, `('')` false.
  - `termin.spec.ts`: `terminFehler({ …, startDatum: '2026-02-30' })` → `'Bitte ein gültiges Datum.'`; ebenso für ein ungültiges `endDatum`; diese Prüfung kommt vor allen anderen.
  - `aenderung.spec.ts` (libs/db, gegen die Testdatenbank): eine Arbeit mit `art: 'LISTE'` lässt `letzteAktivitaetAm` und `letzteAktivitaetStand` des Threads unverändert, schreibt aber die `Aenderung`.
  - `libs/db/src/schema.spec.ts`: Modultitel mit 81 Zeichen, Ort und Treffpunkt mit 201 Zeichen werden abgewiesen; 80 bzw. 200 gehen.
- [ ] **Step 3: Tests scheitern** — `pnpm nx run-many -t test -p domain db --skip-nx-cache`, FAIL.
- [ ] **Step 4: Umsetzen.** Migration mit `prisma migrate dev --create-only`, dann von Hand ergänzen: `ALTER TYPE "AenderungArt" ADD VALUE 'LISTE'`, Spalte `bearbeitetStand`, CHECKs `modul_titel` (`titel IS NULL OR char_length(titel) BETWEEN 1 AND 80`), `termin_ort`, `termin_treffpunkt` (je `IS NULL OR char_length(...) BETWEEN 1 AND 200`). `pnpm run db:generate`.
- [ ] **Step 5: Tests grün** — PASS.
- [ ] **Step 6: Commit** — `git commit -m "TP3 Etappe 3: Aenderungsart LISTE, Bearbeitungsstand, Kalendertag und Grenzen"`

---

### Task 2: Der Entwurf als Wert

**Files:**

- Create: `libs/domain/src/threads/entwurf.ts`, `entwurf.spec.ts`; Modify: `libs/domain/src/threads/index.ts`

**Interfaces:**

- Consumes: `TerminDaten`, `terminFehler`, `einheitenFuer`, `teilnahmeOptionen`, `neueUmfrageVorlage`, `berlinerTag`, `tagPlus`, `ModulDaten`, `ThreadKopf` (vorhanden).
- Produces:

```ts
export const GRENZEN: {
	titel: 120;
	module: 20;
	optionen: 20;
	infoText: 10_000;
	frage: 200;
	optionText: 200;
	modulTitel: 80;
	ort: 200;
	treffpunkt: 200;
};
export const ROLLENFILTER_TEXT: Readonly<Record<Rollenfilter, string>>;
export const EINHEIT_TEXT: Readonly<Record<AntwortEinheit, string>>;
export const ERGEBNIS_TEXT: Readonly<Record<ErgebnisSicht, string>>;
export interface OptionEntwurf {
	schluessel: string | null;
	text: string;
}
export type TerminEntwurf = Omit<TerminDaten, 'modulId'>;
export type ModulEntwurf =
	| { typ: 'INFO'; id: string | null; titel: string | null; text: string }
	| { typ: 'TERMIN'; id: string | null; titel: string | null; termin: TerminEntwurf }
	| {
			typ: 'UMFRAGE';
			id: string | null;
			titel: string | null;
			frage: string;
			einheit: AntwortEinheit;
			mehrfach: boolean;
			teilnahme: boolean;
			vielleicht: boolean;
			frist: string | null;
			ergebnisse: ErgebnisSicht;
			optionen: OptionEntwurf[];
	  };
export interface ThreadEntwurf {
	titel: string;
	modus: ThreadModus;
	rollenfilter: Rollenfilter;
	alleUntergruppen: boolean;
	untergruppenIds: string[];
	module: ModulEntwurf[];
}
export interface Feldfehler {
	feld: string;
	text: string;
	konflikt?: true;
}
export function entwurfAus(koerper: unknown): { entwurf: ThreadEntwurf } | { fehler: Feldfehler };
export function entwurfFehler(e: ThreadEntwurf, untergruppenIds: ReadonlySet<string>): Feldfehler[];
export function neuesModul(
	typ: 'INFO' | 'TERMIN' | 'UMFRAGE',
	vorhandene: readonly ModulEntwurf[],
	jetzt: Date,
): ModulEntwurf;
export function entwurfAusThread(kopf: ThreadKopf, module: readonly ModulDaten[]): ThreadEntwurf;
```

Feldnamen: `titel`, `zielgruppe`, `modus`, `module`, `module.<i>.<feld>` mit `<feld>` aus `titel`, `text`, `termin`, `ort`, `treffpunkt`, `frage`, `einheit`, `optionen`, `teilnahme`, `frist`. `entwurfAus` prüft nur die Form (Typen, Enum-Werte, Arrays, ISO-Frist lesbar), schneidet Leerraum an den Enden ab und macht aus `''` bei optionalen Feldern `null`; Fehler dort heißen `'Ungültige Anfrage'` mit dem Feld. `entwurfFehler` prüft die Bedeutung und liefert alle Fehler in Formularreihenfolge. Bei einer Teilnahme-Umfrage ersetzt `entwurfAus` die Optionen durch `teilnahmeOptionen(vielleicht)` mit `schluessel` gesetzt.

- [ ] **Step 1: Tests schreiben** (`entwurf.spec.ts`, Bowling-Entwurf aus Spec 1.1 als Grundlage, `JETZT` aus `testhilfe.ts`):
  - Ein gültiger Bowling-Entwurf ergibt `[]`.
  - Titel `''` → `{ feld: 'titel', text: 'Bitte einen Titel eingeben.' }`; 121 Zeichen → `'Höchstens 120 Zeichen.'`.
  - `alleUntergruppen: false` ohne IDs → `{ feld: 'zielgruppe', text: 'Bitte mindestens eine Untergruppe wählen.' }`; eine ID außerhalb der Menge → `{ feld: 'zielgruppe', text: 'Diese Untergruppe gibt es nicht mehr.' }`.
  - 21 Module → `{ feld: 'module', text: 'Höchstens 20 Module.' }`.
  - Info-Text leer → `module.0.text` „Bitte einen Text eingeben.“; 10 001 Zeichen → „Höchstens 10 000 Zeichen.“
  - Termin `startDatum: '2026-02-30'` → `{ feld: 'module.1.termin', text: 'Bitte ein gültiges Datum.' }`; Ende vor Beginn → der Text aus `terminFehler`; Ort mit 201 Zeichen → `module.1.ort`.
  - Umfrage mit `einheit: 'JUNGFISCHER'` bei `rollenfilter: 'NUR_FAMILIE'` → `{ feld: 'module.2.einheit', text: 'Diese Einheit fragt bei dieser Zielgruppe niemanden.' }`.
  - Umfrage ohne Teilnahme mit einer Option → `module.2.optionen` „Bitte mindestens zwei Antworten.“; mit „Ja“ und „ ja “ → „Jede Antwort nur einmal.“; 21 Optionen → „Höchstens 20 Antworten.“
  - Zwei Teilnahme-Umfragen → `{ feld: 'module.3.teilnahme', text: 'Es gibt schon eine Teilnahme-Umfrage.', konflikt: true }` an der zweiten.
  - `entwurfAus(null)`, `entwurfAus({ titel: 3 })`, ein unbekannter Modus, `module: {}` und eine Frist `'morgen'` → `{ fehler: { feld, text: 'Ungültige Anfrage' } }` mit dem passenden Feld; `'  Bowling  '` wird zu `'Bowling'`; ein Ort `''` wird `null`; bei `teilnahme: true, vielleicht: false` stehen genau `dabei` und `abgesagt` in den Optionen.
  - `neuesModul('UMFRAGE', [], JETZT)` ist die Teilnahme-Vorlage „Kommst du mit?“ (`neueUmfrageVorlage`); gibt es schon eine Teilnahme-Umfrage, kommt `teilnahme: false`, `frage: ''`, Optionen „Ja“ und „Nein“ ohne Schlüssel. `neuesModul('TERMIN', [], JETZT)` liegt sieben Berliner Tage nach `JETZT`, 18:00–20:00, ohne Ort. `neuesModul('INFO', …)` hat `text: ''`.
  - `entwurfAusThread` aus einem mit `threadDatenAus` gebauten Bowling ergibt einen Entwurf, für den `entwurfFehler` `[]` liefert; die Frist steht als ISO, die Optionen tragen ihren Schlüssel.
- [ ] **Step 2: Tests scheitern** — `pnpm nx test domain --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.** Zeichen in Code-Points zählen (`[...s].length`), wie die CHECKs.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 3: Thread-Entwurf mit Form- und Inhaltspruefung"`

---

### Task 3: Vergleich mit dem gespeicherten Thread

**Files:**

- Create: `libs/domain/src/threads/vergleich.ts`, `vergleich.spec.ts`; Modify: `index.ts`

**Interfaces:**

- Consumes: `pruefeUmfrageAenderung`, `ModulDaten`, `ThreadKopf`, `ThreadEntwurf`, `SystemArt` (vorhanden bzw. Task 2).
- Produces:

```ts
export interface UmfrageSperre {
	beantwortet: boolean;
	schluessel: string[];
	mehrfachGenutzt: boolean;
}
export function umfrageSperre(u: UmfrageDaten): UmfrageSperre;
export interface ModulPlan {
	id: string;
	position: number;
	neu: ModulEntwurf;
	geaendert: boolean;
	optionenLoeschen: string[];
}
export interface EntwurfVergleich {
	fehler: Feldfehler | null; // 400: unbekannte Modul-ID, Typwechsel
	konflikt: Feldfehler | null; // 409 BEANTWORTET
	loeschen: string[]; // Modul-IDs
	behalten: ModulPlan[];
	anlegen: { position: number; neu: ModulEntwurf }[];
	kopfGeaendert: boolean;
	sichtbarkeitGeaendert: boolean;
	system: { art: SystemArt; daten: Record<string, unknown> }[];
}
export function vergleicheEntwurf(
	alt: { kopf: ThreadKopf; module: readonly ModulDaten[] },
	neu: ThreadEntwurf,
): EntwurfVergleich;
```

`position` ist der Index im neuen Entwurf. `beantwortet` zählt jede Antwortzeile, auch ohne Option (die Datenbank sperrt sonst mit P2003). `system` folgt Entscheidung 6 und ist unabhängig vom Veröffentlichungsstand (der Server filtert).

- [ ] **Step 1: Tests schreiben** (`vergleich.spec.ts`, Bowling aus `testhilfe.ts` mit Antworten):
  - Unveränderter Entwurf (`entwurfAusThread`) → nichts zu löschen, nichts anzulegen, alle `geaendert: false`, `kopfGeaendert: false`, `system: []`.
  - Umsortieren von zwei Modulen → beide `geaendert: true` mit neuer `position`, kein Systemeintrag.
  - Modul-ID, die der Thread nicht hat → `fehler: { feld: 'module.0', text: 'Ungültige Anfrage' }`; dieselbe ID mit anderem `typ` → ebenso.
  - Umfrage mit einer leeren Antwort (ohne Option) aus dem Entwurf entfernt → `konflikt: { feld: 'module', text: 'Die Umfrage „Kommst du mit?“ hat schon Antworten und lässt sich nicht entfernen.' }`.
  - Option „Vielleicht“ entfernt, auf die jemand geantwortet hat → `konflikt` mit `feld: 'module.2.optionen'` und dem Text „Auf „Vielleicht“ hat schon jemand geantwortet.“; Einheit geändert → `module.2.einheit` „Die Einheit lässt sich nach den ersten Antworten nicht mehr ändern.“; Teilnahme-Schalter → `module.2.teilnahme` entsprechend; „mehrfach“ abgeschaltet bei einer Antwort mit zwei Optionen → `module.2.mehrfach`.
  - Unbeantwortete Option entfernt → `optionenLoeschen: ['<schluessel>']`, kein Konflikt.
  - Termin auf den nächsten Tag verschoben → genau ein `{ art: 'TERMIN_GEAENDERT', daten: { termin: { modulId, startDatum, endDatum: null, beginn, ende, ort, treffpunkt } } }`; nur der Ort geändert → kein Systemeintrag, aber `geaendert: true`.
  - Frist geändert → `{ art: 'FRIST_GEAENDERT', daten: { frage: 'Kommst du mit?', frist: '<ISO>' } }`; Frist entfernt → `frist: null`.
  - Modus geändert → `{ art: 'MODUS_GEAENDERT', daten: { modus: 'AUSHANG' } }` und `kopfGeaendert: true`.
  - Untergruppen oder Rollenfilter geändert → `sichtbarkeitGeaendert: true`; Titel geändert → nur `kopfGeaendert`.
  - Jede erzeugte `daten` ergibt mit `systemSatz` keinen Rückfallsatz „… hat den Thread geändert“.
  - `umfrageSperre`: ohne Antworten `{ beantwortet: false, schluessel: [], mehrfachGenutzt: false }`; mit einer leeren und einer Antwort auf zwei Optionen `{ beantwortet: true, schluessel: [beide], mehrfachGenutzt: true }`.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Die Konfliktprüfung je Umfrage über `pruefeUmfrageAenderung`; ihre Konflikte in die Feldform übersetzen.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 3: Vergleich von Entwurf und gespeichertem Thread"`

---

### Task 4: Verwaltungsansichten als Werte

**Files:**

- Create: `libs/domain/src/threads/verwaltung.ts`, `verwaltung.spec.ts`; Modify: `ansicht.ts` (+ Spec), `index.ts`

**Interfaces:**

- Consumes: `darfBearbeiten`, `darfArchivieren`, `darfLoeschen`, `istArchiviert`, `gefragte`, `kurzname`, `eingetragenVon`, `nachVorname`, `naechsteTermine`, `terminZeit`, `threadSegment`, `entwurfAusThread`, `umfrageSperre`, `ROLLENFILTER_TEXT`.
- Produces:

```ts
export function zielgruppeText(
	k: Pick<ThreadKopf, 'rollenfilter' | 'alleUntergruppen' | 'untergruppenIds'>,
	namen: ReadonlyMap<string, string>,
): string;
export interface VerwaltungThread {
	id: string;
	segment: string;
	titel: string;
	art: ThreadArt;
	entwurf: boolean;
	archiviert: boolean;
	angepinnt: boolean;
	zielgruppe: string;
	keineZielgruppe: boolean;
	naechsterTermin: string | null;
	darfBearbeiten: boolean;
	hatUmfrage: boolean;
}
export interface VerwaltungListe {
	threads: VerwaltungThread[];
	untergruppen: { id: string; name: string }[];
	darfErstellen: boolean;
}
export interface ThreadBearbeitung {
	id: string;
	segment: string;
	art: ThreadArt;
	version: number;
	veroeffentlicht: boolean;
	angepinnt: boolean;
	archiviert: boolean;
	darfLoeschen: boolean;
	darfArchivieren: boolean;
	entwurf: ThreadEntwurf;
	sperren: Record<string, UmfrageSperre>;
	untergruppen: { id: string; name: string }[];
}
export interface UebersichtZeile {
	fuerId: string;
	name: string;
	optionIds: string[];
	eingetragenVon: string | null;
}
export interface UmfrageUebersicht {
	modulId: string;
	frage: string;
	frist: string | null;
	fristAbgelaufen: boolean;
	mehrfach: boolean;
	teilnahme: boolean;
	optionen: { id: string; schluessel: string; text: string }[];
	zeilen: UebersichtZeile[];
	offen: number;
}
export interface AntwortenUebersicht {
	threadId: string;
	segment: string;
	titel: string;
	darfNachtragen: boolean;
	umfragen: UmfrageUebersicht[];
}
export function antwortenUebersicht(
	ich: ThreadPerson,
	daten: ThreadDaten,
	umfeld: Umfeld,
	jetzt: Date,
): AntwortenUebersicht | null;
```

`ThreadAnsicht` bekommt `darfBearbeiten: boolean` und `darfArchivieren: boolean`. `zielgruppeText`: „Alle · Jungfischer + Familie“; bei Auswahl die Namen nach `localeCompare('de')` mit „, “ verbunden vor „ · “; ohne verbliebene Untergruppe „Keine Zielgruppe mehr“. `antwortenUebersicht` ist `null`, wenn `ich` weder `ANTWORTEN_DETAIL` hat noch bearbeiten darf, oder den Thread nicht sieht; Zeilen sind alle Gefragten in `nachVorname`-Reihenfolge mit `kurzname`, `offen` zählt Gefragte ohne Antwort mit Option.

- [ ] **Step 1: Tests schreiben**
  - `zielgruppeText` für „Alle“, für zwei Untergruppen in falscher Reihenfolge („Biber, Wölflinge · Nur Familie“), für eine Auswahl ohne bekannte Namen.
  - `antwortenUebersicht`: Thomas (Bearbeiter) bekommt `darfNachtragen: true` und Zeilen für Lena (Antwort, eingetragen von sich: `eingetragenVon: null`) und Max (`eingetragenVon: 'Sandra M.'`, weil von ≠ für), `offen` zählt Max nicht mehr; ein Betreuer mit nur `ANTWORTEN_DETAIL` bekommt die Übersicht mit `darfNachtragen: false`; Sandra bekommt `null`; eine entfernte Person mit Antwort erscheint nicht.
  - `threadAnsicht`: für Thomas `darfBearbeiten: true`, für Sandra `false`; am Austausch für einen Inhaber von `ALLE_THREADS` `darfBearbeiten: true`, `darfArchivieren: false`.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 3: Liste, Bearbeitung und Antworten-Uebersicht als Domain-Werte"`

---

### Task 5: Lesende Routen der Verwaltung

**Files:**

- Create: `apps/jufi/src/server/threads/bearbeitung.ts`, `verwaltung.ts` und je `.spec.ts`
- Modify: `laden.ts` (Typ), `lesen.ts`, `routen.ts`, `mandanten.spec.ts`

**Interfaces:**

- Consumes: Task 4; `ladeThreadUmfeld`, `ladeThread`, `ladeVereinsstand`, `NICHT_GEFUNDEN`, `test-threads.ts`, `legeMitgliedAn`.
- Produces: `ladeThread(db: VereinDb | VereinTx, threadId)`; `ladeBearbeitung(db: VereinDb | VereinTx, ich: ThreadPerson, threadId: string, umfeld: Umfeld, jetzt: Date): Promise<ThreadBearbeitung | null>` (null = nicht bearbeitbar oder unbekannt); Routen `GET /verwaltung/threads` → 200 `VerwaltungListe`, `GET /threads/:id/bearbeitung` → 200 `ThreadBearbeitung`, `GET /threads/:id/antworten` → 200 `AntwortenUebersicht`. `darfLoeschen` zählt nach Entscheidung 9.

- [ ] **Step 1: Tests schreiben** (`verwaltung.spec.ts` gegen die Testdatenbank):
  - Liste: Jugendleiter mit nur `THREADS_ERSTELLEN` sieht alle Threads samt Entwürfen und Austausch, `darfErstellen: true`, `darfBearbeiten` nur an eigenen; Leitung mit `ALLE_THREADS` überall `true`; ein Mitglied ohne Recht bekommt 404 `{ fehler: 'nicht gefunden' }`; Untergruppen alphabetisch.
  - Bearbeitung: der Ersteller bekommt `version` gleich `bearbeitetStand`, Entwurf mit Schlüsseln, `sperren` je Umfrage; ein Jugendleiter ohne Recht am Thread, eine Familie und eine unbekannte ID bekommen dieselben 404-Bytes.
  - `darfLoeschen`: `false` bei einer leeren Antwort, `false` bei einer Nachricht, `true` bei nur einer gelöschten Nachricht und Systemeinträgen.
  - Antworten-Übersicht: Betreuer 200 mit `darfNachtragen: false`, Familie 404.
  - `GET /threads/:id` liefert `darfBearbeiten`.
- [ ] **Step 2: Mandanten-Fälle** — `'GET /verwaltung/threads'` (fremder Verein: keine fremden Threads in der eigenen Liste; gesperrt 404; fremdes Cookie 401), `'GET /threads/:id/bearbeitung'` und `'GET /threads/:id/antworten'` mit `fremderThread.threadId` → 404. Der Leiter im Kontext bekommt dafür `THREADS_ERSTELLEN` und `ANTWORTEN_DETAIL` dazu.
- [ ] **Step 3: Tests scheitern** — `pnpm nx run jufi:test-server --skip-nx-cache`, FAIL.
- [ ] **Step 4: Umsetzen.** `routen.ts` hängt `verwaltungRouten` ein. Die Zählung für `darfLoeschen` in einer Abfrage je Tabelle.
- [ ] **Step 5: Tests grün** — PASS.
- [ ] **Step 6: Commit** — `git commit -m "TP3 Etappe 3: Liste, Bearbeitung und Antworten-Uebersicht fuer die Verwaltung"`

---

### Task 6: Anlegen und Ersetzen

**Files:**

- Create: `apps/jufi/src/server/threads/schreiben.ts`, `schreiben.spec.ts`; Modify: `routen.ts`, `fehler.ts`, `mandanten.spec.ts`

**Interfaces:**

- Consumes: `entwurfAus`, `entwurfFehler`, `vergleicheEntwurf`, `ladeBearbeitung`, `mitAenderung`, `ThreadAbbruch`.
- Produces: `POST /threads` mit `{ entwurf }` → 201 `ThreadBearbeitung`; `PUT /threads/:id` mit `{ version, entwurf }` → 200 `ThreadBearbeitung`. Fehlerkonstanten `VERALTET` (`{ fehler: 'Der Thread wurde inzwischen geändert. Bitte neu laden.', code: 'VERALTET' }`), `AUSTAUSCH`, `BEANTWORTET`, `DOPPELTE_TEILNAHME` in `threads/fehler.ts`; `neuerSchluessel(): string` (Entscheidung 11).

Ablauf `PUT`: Rate-Limit nicht nötig. Form (400) → Recht prüfen (404) → in `mitAenderung`: Thread neu laden, `darfBearbeiten` erneut, Version (409), Austausch (409 bei geänderter Zielgruppe oder Modulen), `entwurfFehler` mit den Untergruppen des Vereins (400 bzw. 409 bei `konflikt`), `vergleicheEntwurf` (400/409), dann schreiben: erst Optionen und Module löschen, dann ändern, dann anlegen; `bearbeitetStand = stand`; Systemeinträge nur bei veröffentlichtem Thread; Änderungen nach Entscheidung 5. `POST`: braucht `THREADS_ERSTELLEN` oder `ALLE_THREADS` (sonst 404), `art: 'NORMAL'`, `erstelltVonId` = ich, Entwurf (`veroeffentlichtAm: null`).

- [ ] **Step 1: Tests schreiben** (`schreiben.spec.ts`):
  - `POST` mit dem Bowling-Entwurf → 201, Thread als Entwurf, drei Module in Reihenfolge, Teilnahme-Optionen mit den festen Schlüsseln, `aenderungsstand` +1, Änderungen `THREAD` und dreimal `MODUL`; ohne Erstellrecht 404 und kein Stand.
  - `PUT` Titel geändert → 200, `version` neu, nur `THREAD`; mit alter `version` → 409 `VERALTET`, nichts geändert, Stand unverändert.
  - Veröffentlichter Thread: Termin verschoben → ein Verlaufseintrag `SYSTEM`/`TERMIN_GEAENDERT`, dessen `systemDaten.termin.endDatum` `null` ist (nicht fehlt); Frist geändert → `FRIST_GEAENDERT`; Modus → `MODUS_GEAENDERT`; im Entwurf dieselben Änderungen ohne Verlaufseintrag.
  - Untergruppe geändert bei veröffentlichtem Thread → zusätzlich `SICHTBARKEIT`, und `letzteAktivitaetStand` steht auf dem Stand (wegen `THREAD`).
  - Review Focus 1: eine Antwort mit „Vielleicht“ wird **nach** dem Laden der Bearbeitung und **vor** dem `PUT` abgegeben, das „Vielleicht“ entfernt → 409 `BEANTWORTET` mit `feld: 'module.2.optionen'`, keine Änderung.
  - Review Focus 4: Umfrage mit einer leeren Antwort entfernt → 409 `BEANTWORTET`, `feld: 'module'`.
  - Review Focus 3: `startDatum: '2026-02-30'`, 21 Module, 10 001 Zeichen, eine Untergruppe aus einem fremden Verein, eine Modul-ID eines anderen Threads → je 400 mit `feld`, Stand unverändert; zwei Teilnahme-Umfragen → 409 `DOPPELTE_TEILNAHME`.
  - Austausch: Titel und Modus änderbar mit `ALLE_THREADS`; ein Modul hinzufügen → 409 `AUSTAUSCH` mit `feld: 'module'`; Jugendleiter mit nur `THREADS_ERSTELLEN` → 404.
  - Neue Option bekommt einen Schlüssel auf `^o[a-z0-9]{8}$`; umbenannte bestehende Option behält ihren Schlüssel und ihre Antworten.
- [ ] **Step 2: Mandanten-Fälle** — `'POST /threads'` (gesperrt 404, fremdes Cookie 401, Untergruppe des fremden Vereins → 400, im fremden Verein entsteht nichts) und `'PUT /threads/:id'` mit `fremderThread.threadId` → 404, fremder Stand unverändert.
- [ ] **Step 3: Tests scheitern** — FAIL.
- [ ] **Step 4: Umsetzen.** Eine Hilfsfunktion je Schreibschritt (`loescheModule`, `schreibeModul`) im selben File; die Antwort ist `ladeBearbeitung` nach dem Commit.
- [ ] **Step 5: Tests grün** — PASS.
- [ ] **Step 6: Commit** — `git commit -m "TP3 Etappe 3: Threads anlegen und ersetzen mit Version und Systemeintraegen"`

---

### Task 7: Veröffentlichen, Archiv, Anpinnen, Löschen

**Files:**

- Create: `apps/jufi/src/server/threads/verwalten.ts`, `verwalten.spec.ts`; Modify: `routen.ts`, `fehler.ts`, `mandanten.spec.ts`

**Interfaces:**

- Consumes: `darfBearbeiten`, `darfArchivieren`, `darfLoeschen`, `istArchiviert`, `ladeBearbeitung`, `Wiederholung`.
- Produces: `POST /threads/:id/veroeffentlichen` → 200 `ThreadBearbeitung`; `PUT /threads/:id/archiv` mit `{ archiviert: boolean }` → 200 `ThreadBearbeitung`; `PUT /threads/:id/angepinnt` mit `{ angepinnt: boolean }` → 200 `ThreadBearbeitung`; `DELETE /threads/:id` → 204. Fehlerkonstanten `NICHT_LOESCHBAR` (`'Der Thread hat Antworten oder Nachrichten und lässt sich nicht löschen. Archiviere ihn stattdessen.'`), `KEINE_ZIELGRUPPE`.

Alle prüfen unter der Sperre. Veröffentlichen eines schon veröffentlichten Threads ist eine Wiederholung: 200 ohne Stand. Archivieren setzt `ARCHIVIERT`, Wiederherstellen `AKTIV_HALTEN` (Spec 3.7). Wer sieht, aber nicht bearbeiten darf: 404. Am Austausch: Archiv und Löschen 409 `AUSTAUSCH`, Anpinnen mit `ALLE_THREADS` erlaubt.

- [ ] **Step 1: Tests schreiben**
  - Veröffentlichen: setzt `veroeffentlichtAm = jetzt`, schreibt einen Verlaufseintrag `VEROEFFENTLICHT` mit `systemDaten {}` und dem Stand, Änderungen `THREAD`, `SICHTBARKEIT`, `VERLAUF`; ein zweites Mal → 200, Stand unverändert; mit `alleUntergruppen: false` und gelöschter letzter Untergruppe → 409 `KEINE_ZIELGRUPPE`.
  - Danach sieht Sandra den Thread über `GET /threads/:id`, `verlauf.eintraege` bleibt 0 (Systemeinträge zählen nicht, Etappe 2).
  - Archiv: `{ archiviert: true }` → `archiviert: true`, `archivModus: 'ARCHIVIERT'`, eine Änderung `LISTE`, `letzteAktivitaetStand` unverändert; `{ archiviert: false }` → `AKTIV_HALTEN`; Körper `{ archiviert: 'ja' }` → 400 `feld: 'archiviert'`.
  - Anpinnen analog mit `LISTE`; am Austausch mit `ALLE_THREADS` erlaubt.
  - Löschen: Entwurf ohne Antworten → 204, Thread, Module und Systemeinträge weg, eine Änderung `GELOESCHT` mit `threadId`; mit einer leeren Antwort → 409 `NICHT_LOESCHBAR`; mit nur einer gelöschten Nachricht → 204; Austausch → 409 `AUSTAUSCH`; Familie → 404.
  - Unter der Sperre: Eine Nachricht, die nach der Prüfung außerhalb, aber vor dem Löschen entsteht, verhindert das Löschen (Test: Nachricht direkt in die Datenbank schreiben, dann `DELETE` → 409).
- [ ] **Step 2: Mandanten-Fälle** für alle vier Routen mit `fremderThread.threadId` → 404, fremder Thread unverändert.
- [ ] **Step 3: Tests scheitern** — FAIL.
- [ ] **Step 4: Umsetzen.**
- [ ] **Step 5: Tests grün** — PASS.
- [ ] **Step 6: Commit** — `git commit -m "TP3 Etappe 3: Veroeffentlichen, Archiv, Anpinnen und Loeschen"`

---

### Task 8: Schreiben und Antworten prüfen unter der Sperre

**Files:**

- Modify: `apps/jufi/src/server/threads/verlauf.ts`, `antworten.ts` (+ Specs)

**Interfaces:**

- Consumes: `ladeThread(tx, …)`, `ladeThreadUmfeld`, `schreibSperre`, `darfAntworten`.
- Produces: keine neuen; die Arbeit in `mitAenderung` lädt den Thread neu und wendet die Prüfungen erneut an (Entscheidung 3). Die Prüfung vor der Transaktion bleibt (sie spart Sperre und Stand im häufigen Fall).

- [ ] **Step 1: Tests schreiben** — je Route ein Test, in dem der Thread zwischen der äußeren Prüfung und der Arbeit geändert wird. Statt eines Testhakens in `deps` ruft der Test die exportierte Arbeit (`schreibeNachricht(tx, …)` bzw. `schreibeAntwort(tx, …)`) direkt mit einem inzwischen archivierten Thread bzw. einer inzwischen abgelaufenen Frist auf und erwartet `ThreadAbbruch` mit 409 `ARCHIVIERT` bzw. 410 `FRIST_ABGELAUFEN`; ebenso eine Person, die nach einer Zielgruppenänderung nicht mehr gefragt ist → 404. Eine Wiederholung derselben `clientId` bleibt 200 (die Suche steht vor diesen Prüfungen, Spec 4.2).
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Die Arbeit als benannte, exportierte Funktion herausziehen; Reihenfolge in der Arbeit: `clientId`-Suche, dann die erneute Prüfung, dann schreiben.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 3: Nachrichten und Antworten unter der Sperre neu pruefen"`

---

### Task 9: Client — API, Seitenleiste, Thread-Liste

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/threads/threads-api.ts`, `liste.ts` und je `.spec.ts`
- Modify: `apps/jufi/src/app/verein/verwaltung/huelle.ts` (+ Spec), `apps/jufi/src/app/app.routes.ts`

**Interfaces:**

- Consumes: Typen aus `@jufi/domain` (Task 4), `alsApiFehler`, `fehlertextNichtGefunden`, `beiAbgelaufenerSitzung`.
- Produces: `VerwaltungThreadsApi` mit `liste(slug)`, `bearbeitung(slug, id)`, `antworten(slug, id)`, `lege(slug, entwurf)`, `ersetze(slug, id, version, entwurf)`, `veroeffentliche(slug, id)`, `archiviere(slug, id, archiviert)`, `pinne(slug, id, angepinnt)`, `loesche(slug, id)`; Routen unter `verwaltung`: `threads`, `threads/neu`, `threads/:id`, `threads/:id/antworten` (je `loadComponent`); Seitenleiste Punkt `{ schluessel: 'threads', pfad: ['threads'], text: 'Threads', icon: 'threads' }` ohne `recht` (alle Jugendleiter).

Liste (`jf-verwaltung-threads`): Knopf „Neuer Thread“ nur mit `darfErstellen`; Abschnitte „Entwürfe“, „Aktiv“ (Angepinnte zuerst, Pin-Symbol), „Archiv“ (eingeklappt, Knopf „Archiv zeigen (n)“); je Zeile Titel als Link in den Editor (wenn `darfBearbeiten`) bzw. in den Thread (`/<slug>/t/<segment>`), darunter Zielgruppe und nächster Termin, „Keine Zielgruppe mehr“ als Warnung, „Antworten“-Link bei `hatUmfrage`.

- [ ] **Step 1: Tests schreiben** — API-Spec mit `HttpTestingController` (Pfade und Methoden aller neun Aufrufe, Körper von `ersetze` ist `{ version, entwurf }`); Hülle zeigt „Threads“ für einen Jugendleiter mit nur `ANTWORTEN_DETAIL`; Liste: Abschnitte, Archiv eingeklappt, „Neuer Thread“ fehlt ohne `darfErstellen`, Zeile ohne `darfBearbeiten` verlinkt in den Thread, 404 zeigt „Nicht gefunden oder keine Berechtigung“.
- [ ] **Step 2: Tests scheitern** — `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.** Seitenaufbau wie `verwaltung/mitglieder.ts`.
- [ ] **Step 4: Tests grün** — PASS; `pnpm nx build jufi` ohne Warnungen.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 3: Thread-Liste der Verwaltung"`

---

### Task 10: Client — Formular und Module im Editor

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/threads/modul-felder.ts`, `knopfleiste.ts` und je `.spec.ts`

**Interfaces:**

- Consumes: `ModulEntwurf`, `GRENZEN`, `EINHEIT_TEXT`, `ERGEBNIS_TEXT`, `einheitenFuer`, `Feldfehler`, `berlinerTag`, `berlinerUhrzeit`, `berlinZeitpunkt`.
- Produces:
  - `formatiere(text: string, start: number, ende: number, art: 'fett' | 'kursiv' | 'liste' | 'link'): { text: string; start: number; ende: number }` — fett `**…**`, kursiv `_…_`, Liste setzt `- ` vor jede berührte Zeile, Link `[Auswahl](https://)` mit markiertem `https://`; ohne Auswahl ein Platzhalter („Text“), der danach markiert ist.
  - `jf-knopfleiste` (Inputs `textarea: HTMLTextAreaElement`; Output `geaendert: string`), Knöpfe mit `aria-label` „Fett“, „Kursiv“, „Liste“, „Link“.
  - `jf-modul-felder` (Inputs `modul: ModulEntwurf`, `index: number`, `rollenfilter: Rollenfilter`, `sperre: UmfrageSperre | null`, `fehler: Feldfehler[]`; Output `geaendert: ModulEntwurf`). Felder je Typ: Info (Überschrift, Text mit Knopfleiste, Zeichenzähler ab 9 000); Termin (Überschrift, Start-, Enddatum, Beginn, Ende, Ort, Treffpunkt); Umfrage (Überschrift, Frage, Schalter „Teilnahme-Umfrage“, bei Teilnahme „Vielleicht anbieten“, sonst Optionsliste mit „Hinzufügen“, Hoch/Runter/Entfernen je Option, „Mehrfachauswahl“; Einheit als Auswahl nur aus `einheitenFuer`; Ergebnisse; Frist als Datum und Uhrzeit in Berlin oder „ohne Frist“). Ist die Umfrage beantwortet (`sperre`), sind Einheit und Teilnahme gesperrt mit Hinweis „Gesperrt, weil schon Antworten da sind“, beantwortete Optionen lassen sich nicht entfernen, und „Mehrfachauswahl“ lässt sich bei `mehrfachGenutzt` nicht abschalten.
  - Fehler erscheinen am Feld (`<p class="fehler" role="alert">`, `aria-invalid`), zugeordnet über `module.<index>.<feld>`.

- [ ] **Step 1: Tests schreiben**
  - `formatiere('Hallo Welt', 0, 5, 'fett')` → `{ text: '**Hallo** Welt', start: 2, ende: 7 }`; `('a\nb', 0, 3, 'liste')` → `'- a\n- b'`; `('', 0, 0, 'link')` → `'[Text](https://)'` mit `https://` markiert; kursiv ohne Auswahl → `'_Text_'` mit `Text` markiert.
  - `jf-modul-felder`: Einheit „Pro Jungfischer“ fehlt bei `NUR_FAMILIE`; Frist-Eingabe `2026-10-22` und `18:00` ergibt `frist: '2026-10-22T16:00:00.000Z'`; mit Sperre ist der Schalter „Teilnahme-Umfrage“ deaktiviert und „Entfernen“ fehlt an beantworteten Optionen; ein Fehler `module.1.termin` erscheint am Termin.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Die Frist wandelt `berlinZeitpunkt(tag, uhrzeit).toISOString()`; zurück über `berlinerTag`/`berlinerUhrzeit`.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 3: Modulfelder und Knopfleiste des Editors"`

---

### Task 11: Client — Editor-Seite mit Vorschau

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/threads/editor.ts`, `vorschau.ts`, `ungespeichert.ts` und je `.spec.ts`; Modify: `app.routes.ts`

**Interfaces:**

- Consumes: Tasks 9, 10; `entwurfFehler`, `neuesModul`, `zielgruppeText`, `MODUS_TEXT`, `ROLLENFILTER_TEXT`, `InfoModul`, `TerminModul`, `UmfrageModul` (Thread-Seite), `BestaetigungComponent`.
- Produces:
  - `vorschauModule(e: ThreadEntwurf, jetzt: Date): ModulAnsicht[]` (in `vorschau.ts`): Info und Termin unverändert mit Ersatz-IDs `vorschau-<i>`, Umfrage als `UmfrageAnsicht` mit `zeilen: []`, `ergebnis: null`, Optionen mit Ersatz-IDs, `fristAbgelaufen` nach `jetzt`. So ruft die Vorschau nie die API.
  - `jf-thread-vorschau` (Inputs `entwurf`, `zielgruppe: string`, `markiert: number | null`; Output `waehle: number`): Handyrahmen 375 px breit, Kopf mit Titel und Zielgruppe, je Modul eine Karte, die markierte hervorgehoben; Tippen wählt das Modul im Formular.
  - `ungespeichertWaechter: CanDeactivateFn<{ ungespeichert(): boolean }>` mit `confirm('Ungespeicherte Änderungen verwerfen?')`; dazu `beforeunload` im Editor.
  - `jf-thread-editor` (Inputs `slug`, `id?`): Formular links (Titel, Zielgruppe mit „Alle“ und Untergruppen-Haken, Rollenfilter, Modus, „Mitglieder benachrichtigen“ deaktiviert mit „Kommt mit den Push-Nachrichten.“, Modulliste mit „Nach oben“, „Nach unten“, „Entfernen“ und „Modul hinzufügen: Info-Text · Termin · Umfrage“, darunter die Felder des gewählten Moduls), Vorschau rechts; unter 1024 px Umschalter „Bearbeiten | Vorschau“ statt nebeneinander. Knöpfe: neuer oder Entwurf „Entwurf speichern“ und „Veröffentlichen“; veröffentlicht „Speichern“; „Löschen“ nur bei `darfLoeschen` (mit `jf-bestaetigung`); bei bestehendem Thread zusätzlich „Anpinnen/Lösen“, „Archivieren/Wiederherstellen“ (bei `darfArchivieren`), „Thread ansehen“ (`/<slug>/t/<segment>`), „Antworten“ (bei einer Umfrage). Am Austausch sind Zielgruppe und Module ausgeblendet mit Hinweis „Zielgruppe und Module des Austauschs stehen fest.“
  - Speichern prüft zuerst mit `entwurfFehler` (alle Fehler am Feld, nichts wird geschickt); „Veröffentlichen“ speichert erst, dann veröffentlicht, und veröffentlicht **nicht**, wenn das Speichern scheitert; nach `POST` ersetzt die Seite die Adresse durch `threads/<id>` (`replaceUrl`). Serverfehler: `feld` an das Feld, 409 `VERALTET` als Karte mit „Neu laden“, 404 „Nicht gefunden oder keine Berechtigung“, 429 nach `fehlertext`.

- [ ] **Step 1: Tests schreiben**
  - `vorschauModule` für den Bowling-Entwurf: drei Module, Umfrage ohne Zeilen, Frist ISO.
  - Editor: neuer Thread → „Modul hinzufügen: Umfrage“ ergibt die Teilnahme-Vorlage; Hoch/Runter tauscht und die Vorschau folgt; leerer Titel → Fehler am Titel und keine Anfrage; „Veröffentlichen“ mit 400 aus `lege` → kein Aufruf von `veroeffentliche`, Eingaben bleiben; Erfolg → `lege` dann `veroeffentliche`, Adresse `threads/<id>`; 409 `VERALTET` zeigt „Neu laden“; Austausch blendet Zielgruppe und Module aus.
  - Wächter: ohne Änderung kein `confirm`, mit Änderung `confirm` und Abbruch bei `false`.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Arbeitskopie als Signal, Vergleich mit dem geladenen Stand über `JSON.stringify` für `ungespeichert()`. Vorlage für Anordnung und Bedienung: `apps/entwurf/src/app/verwaltung/editor.ts` (Wegwerfcode, nur das Aussehen).
- [ ] **Step 4: Tests grün** — PASS; `pnpm nx build jufi` ohne Warnungen.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 3: Editor mit Live-Vorschau, Entwurf und Veroeffentlichen"`

---

### Task 12: Client — Antworten-Übersicht und Thread-Seite

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/threads/antworten.ts`, `antworten.spec.ts`
- Modify: `apps/jufi/src/app/verein/threads/thread-seite.ts` (+ Spec)

**Interfaces:**

- Consumes: `VerwaltungThreadsApi.antworten`, `ThreadApi.antworte` (Nachtragen über die bestehende Route; der Server erlaubt Bearbeitern jede gefragte Person auch nach der Frist), `TEILNAHME_ZEICHEN` (heute privat in `verein/threads/umfrage-modul.ts`; exportieren).
- Produces: `jf-antworten-uebersicht` (Inputs `slug`, `id`): je Umfrage Frage, Frist, je Option die Namen mit Anzahl, „Noch offen (n)“ mit Namen, je Zeile „Eintragen“ (nur bei `darfNachtragen`), das die Optionen als Knöpfe aufklappt und mit neuer `clientId` speichert; danach lädt die Übersicht neu. Thread-Seite: im Kopf „Bearbeiten“ (Link `/<slug>/verwaltung/threads/<id>`) bei `darfBearbeiten`; beim Hinweis „Archiviert“ der Knopf „Wiederherstellen“ bei `darfArchivieren`, der `archiviere(slug, id, false)` ruft und neu lädt.

- [ ] **Step 1: Tests schreiben** — Übersicht: Namen je Option, „Noch offen (1)“, „Eintragen“ fehlt bei `darfNachtragen: false`; „Eintragen“ → „✗ Abgesagt“ ruft `antworte` mit `optionIds` von `abgesagt` und lädt neu; 410 kann für Bearbeiter nicht auftreten, 404 zeigt „Nicht gefunden oder keine Berechtigung“. Thread-Seite: „Bearbeiten“ nur bei `darfBearbeiten`; „Wiederherstellen“ nur archiviert und bei `darfArchivieren`.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 3: Antworten-Uebersicht mit Nachtragen, Bearbeiten und Wiederherstellen"`

---

### Task 13: Ende-zu-Ende und Layout

**Files:**

- Modify: `apps/jufi-e2e/src/ablauf.spec.ts`, `layout.spec.ts`, `threads.ts`

**Interfaces:**

- Consumes: Editor, Liste, Antworten-Übersicht; `ids.json`.
- Produces: `threads.ts` legt nur noch die Nachrichten im Austausch an (`fuelleAustausch(slug: string, leitungId: string, jetzt: Date): Promise<string>`, gibt das Segment zurück); Bowling entsteht in der Oberfläche. `ids.json` erhält `bowlingId` (die Thread-ID für Verwaltungspfade) neben `bowling` (Segment).

- [ ] **Step 1: Ablauf** (der Schritt vor „Mutter antwortet“ wird ersetzt): Leitung öffnet `verwaltung/threads`, „Neuer Thread“, Titel „🎳 Bowling“, fügt Info-Text (Knopf „Fett“ einmal benutzt), Termin (Ort „Bowlingcenter“) und Umfrage (Teilnahme-Vorlage, Frist in einer Woche) hinzu, „Entwurf speichern“; die Liste zeigt „Entwürfe“ mit Bowling; im Editor „Veröffentlichen“; „Thread ansehen“ liefert das Segment. Danach laufen die bestehenden Schritte der Mutter und des Kindes unverändert. Neu am Ende: Leitung öffnet „Antworten“, sieht Mia unter „Dabei“, trägt für Mia „? Vielleicht“ nach; das Kind sieht danach „eingetragen von Lea …“. Leitung archiviert den Thread im Editor, die Thread-Seite zeigt „Archiviert“ und „Wiederherstellen“; Wiederherstellen.
- [ ] **Step 2: Layout** — `SEITEN` um `verwaltung/threads`, `verwaltung/threads/neu`, `verwaltung/threads/:bowlingId`, `verwaltung/threads/:bowlingId/antworten` (Rolle `leitung`, Art `verwaltung`); `PLATZHALTER` um `:bowlingId`. Zusätzlich gemessen: bei 1280 × 800 stehen Formular und Vorschau nebeneinander (rechte Kante des Formulars ≤ linke Kante der Vorschau), bei 375 × 812 ist nur eines sichtbar und der Umschalter vorhanden; kein horizontales Scrollen.
- [ ] **Step 3: Laufen lassen** — `pnpm run e2e`, Expected: alle grün (bisher 89, jetzt mehr).
- [ ] **Step 4: Commit** — `git commit -m "TP3 Etappe 3: Ende-zu-Ende fuer Editor, Veroeffentlichen und Nachtragen"`

---

### Task 14: Spec, CLAUDE.md, Abschluss

**Files:**

- Modify: `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md`, `CLAUDE.md`

- [ ] **Step 1: Spec nachziehen** — die Entscheidungen 1–11 an ihrer Stelle eintragen (2.1 `bearbeitetStand`; 2.2 Grenzen; 2.6 Art `LISTE`; 3.6 Löschbarkeit; 4.1 die zwei neuen Routen und die Antwortformen; 4.2 Prüfungen unter der Sperre und Änderungsarten; 4.4 Codes `VERALTET`, `BEANTWORTET`, `DOPPELTE_TEILNAHME`, `AUSTAUSCH`, `NICHT_LOESCHBAR`, `KEINE_ZIELGRUPPE`; 6.6 „Stand teilen“ ab Etappe 6), jeweils mit der verworfenen Alternative.
- [ ] **Step 2: CLAUDE.md** — unter „Stand“ eine Zeile: „TP3 Etappe 3 ist da: Threads anlegen und verwalten unter `/<slug>/verwaltung/threads` (Editor mit Vorschau, Entwurf, Veröffentlichen, Archiv, Anpinnen, Löschen, Antworten-Übersicht mit Nachtragen). Was ein Entwurf ist und was sich ändert, entscheiden `entwurf.ts` und `vergleich.ts` in `@jufi/domain`.“
- [ ] **Step 3: Gesamtprüfung** — `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache`, `pnpm run e2e`, `pnpm exec prettier --check .`; alles grün.
- [ ] **Step 4: Commit** — `git commit -m "TP3 Etappe 3: Spec und CLAUDE.md nachgezogen"`
