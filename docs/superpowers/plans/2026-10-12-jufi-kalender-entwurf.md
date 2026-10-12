# Termine und Kalender im Entwurf — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Termine im klickbaren Entwurf bekommen Enddatum und optionale Uhrzeiten und lassen sich per Knopf in den Kalender des Telefons oder in Google Kalender eintragen; der Testmodus fragt das ab.

**Architecture:** Neue reine Regeln in `regeln/terminzeit.ts` (Form, Ende, Anzeige, Prüfung) und `regeln/kalender.ts` (Kalendereintrag, .ics, Google-Link). Alle bisherigen Lesestellen von `beginn`/`ende` gehen über diese Regeln. Ein neues Bauteil `jf-kalender-knopf` im Termin-Modul erzeugt die Datei im Browser bzw. öffnet den Link und meldet ein Testereignis.

**Tech Stack:** Angular 22 (zoneless, Signale, OnPush, Inline-Vorlagen), Vitest + jsdom, Nx 23, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-jufi-familie-jugendsprecher-kalender-design.md`, Abschnitte 3 und 4 (nur diese). Rahmen: `docs/superpowers/specs/2026-10-11-jufi-rahmen-design.md` 6.4.3.

## Global Constraints

- Arbeit auf Branch `feat/kalender-entwurf`, nicht auf `main`. Kein Push, kein Deploy ohne ausdrückliches Wort des Eigentümers.
- Alle Pfade unten relativ zu `apps/entwurf/src/app/`, außer wo anders angegeben.
- Einrückung Tabs; Kommentare deutsch und erklären warum, verworfene Alternativen mit Grund; keine Backticks in Kommentaren innerhalb von `template:`/`styles:`.
- Commit-Nachrichten deutsch in ASCII (Umlaute umschrieben), Schluss: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Regeln sind reine Funktionen ohne Angular; wo sie Zeit brauchen, bekommen sie `jetzt: Date`. Nie `new Date()` ohne Argument im Regelcode.
- Inline-Vorlagen, `@if`/`@for`, Signale, `changeDetection: OnPush`.
- Oberflächentexte wörtlich: „In Kalender eintragen", „Kalender des Telefons", „Google Kalender", „ganztägig", Aufgabe „Trag das Zeltlager in deinen Kalender ein."
- Zeitzone der Termine: Europe/Berlin. Kalendereinträge enthalten **keine Personennamen**.
- Nur erfundene Daten.
- Tests: `pnpm nx test entwurf --watch=false --include='**/<datei>.spec.ts'` (mehrere Dateien: `--include` mehrfach, keine Klammer-Globs); ganze Suite `pnpm nx test entwurf --watch=false --skip-nx-cache`; Typprüfung `pnpm nx typecheck entwurf --skip-nx-cache`; vor jedem Commit am Ende `pnpm exec prettier --check .` (im Repo-Wurzelverzeichnis).

## Review Focus

1. **„bis" gleich „von"**: gilt als eintägig — Anzeige „Sa 17.10. · 14:00–17:00", Kalendereintrag nicht mehrtägig (Task 1, Task 4).
2. **Termin über eine Monatsgrenze** (Fr 30.10. – So 01.11.): erscheint im Monatskalender im Oktober und im November, die Tage beider Monate sind markiert (Task 2).
3. **Beginn 23:30 ohne Ende, eintägig**: Kalenderende ist 00:30 am Folgetag, kein „24:30" (Task 4).
4. **Zeitumstellung**: 25.10.2026 12:00 Berliner Zeit wird `20261025T110000Z`, 17.10.2026 14:00 wird `20261017T120000Z`, unabhängig von der Zeitzone des Browsers (Task 4).
5. **Sonderzeichen**: Komma, Semikolon, Backslash, Zeilenumbruch, Umlaute und Emoji in Titel, Ort, Treffpunkt werden in der .ics maskiert und beim Falten nicht mitten im Zeichen getrennt; „&" im Titel zerreißt den Google-Link nicht (Task 4).

---

### Task 1: Neue Terminform und Anzeige

Mechanischer Umbau: Typ ändern, alle Lesestellen auf die neuen Regeln umstellen, bestehende Tests anpassen. Verhalten von Archiv, „Als Nächstes" und Monatsliste bleibt in diesem Task gleich (das ändert Task 2).

**Files:**

- Create: `regeln/terminzeit.ts`, `regeln/terminzeit.spec.ts`
- Modify: `daten/typen.ts` (TerminModul, `version: 2`), `daten/speicher.ts` (Schlüssel `jufi-entwurf:v2`, Prüfung `d.version === 2`), `daten/beispieldaten.ts` (alle Termine, `version: 2`), `regeln/termine.ts`, `regeln/fahrt-kosten.ts:38`, `mitglieder/start.ts`, `mitglieder/termine.ts`, `verwaltung/ansichten.ts`, `verwaltung/editor.ts` (nur `neuesModul`, `kurz`, die drei bestehenden Felder, `datumSetzen`), `module/termin.ts`, `testmodus/aufgaben.ts` (`treffen`)
- Test: bestehende Specs, die `beginn`/`ende` verwenden: `daten/beispieldaten.spec.ts`, `daten/speicher.spec.ts`, `regeln/termine.spec.ts`, `regeln/teilen.spec.ts`, `mitglieder/termine.spec.ts`, `testmodus/pruefung.spec.ts`

**Interfaces:**

- Produces (`daten/typen.ts`):
  ```ts
  export interface TerminModul {
  	id: Id;
  	typ: 'termin';
  	titel?: string;
  	von: string; // JJJJ-MM-TT
  	bis?: string; // JJJJ-MM-TT, nur wenn mehrtaegig
  	beginnZeit?: string; // HH:MM
  	endeZeit?: string; // HH:MM
  	ort: string;
  	treffpunkt?: string;
  }
  ```
- Produces (`regeln/terminzeit.ts`):
  - `tagPlus(tag: string, tage: number): string` — Kalenderrechnung auf `JJJJ-MM-TT` (über `Date.UTC`, damit keine Zeitzone hineinspielt).
  - `letzterTag(m: TerminModul): string` — `bis` wenn gesetzt und ≠ `von`, sonst `von`.
  - `istMehrtaegig(m: TerminModul): boolean` — `letzterTag(m) !== m.von`.
  - `beginnIso(m: TerminModul): string` — `${von}T${beginnZeit ?? '00:00'}`; Sortier- und Startzeitpunkt (ganztägige zuerst).
  - `endeIso(m: TerminModul): string` — `${letzterTag}T${endeZeit}`, ohne Endezeit der Folgetag des letzten Tages `T00:00` (Ende des Tages).
  - `terminZeit(m: TerminModul): string` — Anzeige nach Spec 3.1, Datum `Wt TT.MM.` (Wochentag zwei Buchstaben), Trenner `·` zwischen Datum und Zeit eintägig, `–` zwischen Anfang und Ende mehrtägig, `–` ohne Leerzeichen zwischen zwei Uhrzeiten.

- [ ] **Step 1: Branch anlegen**

  Run: `git switch -c feat/kalender-entwurf`

- [ ] **Step 2: Failing tests in `regeln/terminzeit.spec.ts`**

  ```ts
  const t = (x: Partial<TerminModul>): TerminModul => ({ id: 'm', typ: 'termin', von: '2026-10-17', ort: 'X', ...x });
  it('zeigt die vier Formen der Spec 3.1', () => {
  	expect(terminZeit(t({}))).toBe('Sa 17.10. · ganztägig');
  	expect(terminZeit(t({ beginnZeit: '14:00', endeZeit: '17:00' }))).toBe('Sa 17.10. · 14:00–17:00');
  	expect(terminZeit(t({ beginnZeit: '14:00' }))).toBe('Sa 17.10. · 14:00');
  	expect(terminZeit(t({ von: '2026-10-23', bis: '2026-10-25' }))).toBe('Fr 23.10. – So 25.10.');
  	expect(terminZeit(t({ von: '2026-10-23', bis: '2026-10-25', beginnZeit: '17:00', endeZeit: '12:00' }))).toBe(
  		'Fr 23.10. 17:00 – So 25.10. 12:00',
  	);
  	expect(terminZeit(t({ von: '2026-10-23', bis: '2026-10-25', endeZeit: '12:00' }))).toBe(
  		'Fr 23.10. – So 25.10. 12:00',
  	);
  });
  it('behandelt bis gleich von als eintaegig', () => {
  	const m = t({ bis: '2026-10-17', beginnZeit: '14:00', endeZeit: '17:00' });
  	expect(terminZeit(m)).toBe('Sa 17.10. · 14:00–17:00');
  	expect(istMehrtaegig(m)).toBe(false);
  });
  it('liefert Beginn und Ende als lokale Zeitpunkte', () => {
  	expect(beginnIso(t({}))).toBe('2026-10-17T00:00');
  	expect(endeIso(t({}))).toBe('2026-10-18T00:00');
  	expect(endeIso(t({ bis: '2026-10-31', endeZeit: '12:00' }))).toBe('2026-10-31T12:00');
  	expect(tagPlus('2026-12-31', 1)).toBe('2027-01-01');
  });
  ```

- [ ] **Step 3: Run, expect FAIL** (Modul fehlt)

  Run: `pnpm nx test entwurf --watch=false --include='**/terminzeit.spec.ts'`

- [ ] **Step 4: TerminModul ändern, `regeln/terminzeit.ts` schreiben, alle Lesestellen umstellen**

  Typen und Regeln wie unter Interfaces. Dann `pnpm nx typecheck entwurf --skip-nx-cache` — jede Fehlermeldung ist eine Lesestelle:
  - Sortierung und Vergleiche (`regeln/termine.ts`, `mitglieder/termine.ts`, `verwaltung/ansichten.ts`) über `beginnIso`; `istArchiviert` über `endeIso` statt `ende ?? beginn`; `naechsteTermine` filtert vorerst weiter auf `beginnIso(m) >= jetzt`; `termineImMonat` vorerst über `m.von.startsWith(praefix)`.
  - Anzeige (Termin-Modul, Dashboard „Als Nächstes", Termine-Seite, Verwaltung Übersicht und Termine-Tabelle, Editor-`kurz`) über `terminZeit(m)`; Datumsblöcke (Tag, Monat, Wochentag) über `beginnIso(m)`. Das Termin-Modul zeigt eine Zeile mit Kalender-Icon `terminZeit(m)`; die Uhr-Zeile entfällt.
  - `fahrt-kosten.ts:38` liest Tag und Monat aus `von`.
  - `aufgaben.ts` `treffen`: `beginnIso(g)` statt `g.beginn`.
  - Editor: `neuesModul` → `{ von: tag, beginnZeit: '18:00', endeZeit: '20:00', ort: 'Vereinsheim' }`; die bestehenden Felder Datum/Beginn/Ende schreiben `von`/`beginnZeit`/`endeZeit` (leere Zeit → `undefined`); `datumSetzen` setzt nur `von` und ignoriert einen leeren Wert.
  - Beispieldaten: `r(tage, 'HH:MM')` liefert heute `JJJJ-MM-TTTHH:MM`; Termine bekommen `von: r(…).slice(0, 10)`, `beginnZeit`, `endeZeit` mit denselben Werten wie bisher.
  - `speicher.ts`: Schlüssel `jufi-entwurf:v2`, Prüfung `d.version === 2`; der Kommentar dort erklärt bereits, warum ein neuer Schlüssel neu beginnt.
  - Bestehende Specs auf die neue Form umstellen (z. B. `beispieldaten.spec.ts:71-76` prüft `von` statt `beginn.slice(0, 10)`, `pruefung.spec.ts:115` baut `{ von: '2026-12-18', beginnZeit: '18:00', … }`).

- [ ] **Step 5: Run, expect PASS**

  Run: `pnpm nx typecheck entwurf --skip-nx-cache && pnpm nx test entwurf --watch=false --skip-nx-cache`
  Expected: Typprüfung ohne Fehler, Suite vollständig grün.

- [ ] **Step 6: Commit**

  ```bash
  git add -A apps/entwurf
  git commit -m "Termine mit Enddatum und optionalen Uhrzeiten (Datenform und Anzeige)"
  ```

---

### Task 2: Mehrtägige Termine in Regeln, Kalenderansicht und Beispieldaten

**Files:**

- Modify: `regeln/termine.ts`, `mitglieder/termine.ts` (`tageMitTermin`), `daten/beispieldaten.ts`
- Test: `regeln/termine.spec.ts`, `daten/beispieldaten.spec.ts`, `mitglieder/termine.spec.ts`

**Interfaces:**

- Consumes: `beginnIso`, `endeIso`, `letzterTag`, `tagPlus` aus Task 1.
- Produces: `M.zeltlagerTermin = 'm-zelt-lager'`, `M.herbstAufbau = 'm-herbst-aufbau'` in `daten/beispieldaten.ts`; `naechsteTermine` und `termineImMonat` mit unveränderter Signatur.

- [ ] **Step 1: Failing tests**

  `regeln/termine.spec.ts` (eigener Stand mit einem Thread, den Thomas sieht; Helfer zum Ersetzen der Module im Beispielstand):

  ```ts
  it('zeigt einen laufenden mehrtaegigen Termin unter "Als Naechstes" bis zu seinem Ende', () => {
  	// Termin Fr 16.10. 17:00 bis So 18.10. 12:00
  	expect(ids(naechsteTermine(stand, P.thomas, new Date(2026, 9, 17, 10, 0), 50))).toContain('m-lauf');
  	expect(ids(naechsteTermine(stand, P.thomas, new Date(2026, 9, 18, 12, 1), 50))).not.toContain('m-lauf');
  });
  it('fuehrt einen Termin ueber die Monatsgrenze in beiden Monaten', () => {
  	// Termin Fr 30.10. bis So 01.11., ganztaegig
  	expect(ids(termineImMonat(stand, P.thomas, 2026, 9))).toContain('m-grenze');
  	expect(ids(termineImMonat(stand, P.thomas, 2026, 10))).toContain('m-grenze');
  });
  it('archiviert eine Woche nach dem letzten Tag', () => {
  	// Termin 01.10. bis 03.10., ganztaegig: Ende 04.10. 00:00
  	expect(istArchiviert(thread, new Date(2026, 9, 10, 23, 0))).toBe(false);
  	expect(istArchiviert(thread, new Date(2026, 9, 11, 0, 1))).toBe(true);
  });
  ```

  `daten/beispieldaten.spec.ts` (Bezugstag 2026-10-11):

  ```ts
  it('hat ein mehrtaegiges Zeltlager und einen ganztaegigen Aufbau', () => {
  	const zelt = termine(T.zeltlager).find((m) => m.id === M.zeltlagerTermin)!;
  	expect(zelt).toMatchObject({
  		titel: 'Zeltlager',
  		von: '2027-06-18',
  		bis: '2027-06-20',
  		beginnZeit: '17:00',
  		endeZeit: '12:00',
  	});
  	const aufbau = termine(T.herbstfest).find((m) => m.id === M.herbstAufbau)!;
  	expect(aufbau).toMatchObject({ titel: 'Aufbau', von: '2026-10-31' });
  	expect(aufbau.beginnZeit).toBeUndefined();
  });
  ```

  `mitglieder/termine.spec.ts`: Seitentest im Oktober 2026 — bei einem Termin 30.10.–01.11. sind die Zellen 30 und 31 markiert (`.tag.mit`), im November die 1.

- [ ] **Step 2: Run, expect FAIL**

  Run: `pnpm nx test entwurf --watch=false --include='**/termine.spec.ts' --include='**/beispieldaten.spec.ts'`

- [ ] **Step 3: Implement**
  - `naechsteTermine`: ein Termin zählt, solange `endeIso(m)` nicht vor `jetzt` liegt (vorher: Beginn). Kommentar mit Grund (Spec 3.2, laufendes Zeltlager).
  - `termineImMonat`: Termine, deren Zeitraum `von`…`letzterTag` den Monat berührt.
  - `tageMitTermin`: alle Tage jedes Termins, die im angezeigten Monat liegen.
  - Beispieldaten: im Zeltlager-Thread nach dem Vortreffen `{ id: M.zeltlagerTermin, typ: 'termin', titel: 'Zeltlager', von, bis, beginnZeit: '17:00', endeZeit: '12:00', ort: 'Chiemsee' }`, `von` = Freitag `naechsterWochentag(bezugstag, 5) + 7 * 35` Tage nach dem Bezugstag, `bis` zwei Tage später; im Herbstfest-Thread vor dem bestehenden Termin `{ id: M.herbstAufbau, typ: 'termin', titel: 'Aufbau', von: <Vortag des Fests>, ort: 'Vereinsgelände' }`.

- [ ] **Step 4: Run, expect PASS** — gleicher Befehl; danach ganze Suite.

  Run: `pnpm nx test entwurf --watch=false --skip-nx-cache`
  Expected: grün. Fällt eine Suchaufgabe oder ein Dashboard-Test um, weil „Als Nächstes" jetzt mehr zeigt, ist der Test auf die Spec-Regel anzupassen, nicht die Regel.

- [ ] **Step 5: Commit** — `git commit -am "Mehrtaegige Termine: Als Naechstes, Monatskalender, Archiv, Beispieldaten"`

---

### Task 3: Termin-Felder im Thread-Editor

**Files:**

- Modify: `verwaltung/editor.ts`, `regeln/terminzeit.ts`
- Test: `regeln/terminzeit.spec.ts`, `verwaltung/editor.spec.ts`

**Interfaces:**

- Produces (`regeln/terminzeit.ts`): `terminFehler(m: TerminModul): string | null` — `'Das Enddatum liegt vor dem Startdatum.'` wenn `bis < von`; `'Das Ende liegt vor dem Beginn.'` wenn eintägig, beide Zeiten gesetzt und `endeZeit < beginnZeit`; sonst `null`.

- [ ] **Step 1: Failing tests**

  `terminzeit.spec.ts`: die beiden Fehlertexte und `null` für `bis === von`, für `endeZeit` ohne `beginnZeit` und für mehrtägig `17:00`→`12:00`.

  `editor.spec.ts`, neuer `describe('Termin im Editor')` (Hilfen wie im bestehenden `Thread-Editor`-Block: Titel setzen, `knopf(…, 'Termin')`):

  ```ts
  it('legt ein mehrtaegiges Zeltlager ohne Uhrzeiten an', async () => {
  	// Felder "Startdatum" = 2026-10-23, "Enddatum (optional)" = 2026-10-25, "Beginn (optional)" und "Ende (optional)" leeren
  	// Entwurf speichern
  	expect(m).toMatchObject({ von: '2026-10-23', bis: '2026-10-25' });
  	expect(m.beginnZeit).toBeUndefined();
  	expect(m.endeZeit).toBeUndefined();
  });
  it('speichert nicht, wenn das Enddatum vor dem Startdatum liegt', async () => {
  	// Startdatum 2026-10-25, Enddatum 2026-10-23
  	expect(el.textContent).toContain('Das Enddatum liegt vor dem Startdatum.');
  	// Entwurf speichern: Anzahl Threads unveraendert
  });
  ```

- [ ] **Step 2: Run, expect FAIL**

  Run: `pnpm nx test entwurf --watch=false --include='**/terminzeit.spec.ts' --include='**/editor.spec.ts'`

- [ ] **Step 3: Implement**
  - Felder in dieser Reihenfolge und mit diesen Beschriftungen: „Startdatum" (`type="date"`), „Enddatum (optional)" (`type="date"`, leer → `bis: undefined`), „Beginn (optional)" (`type="time"`), „Ende (optional)" (`type="time"`); Zeiten leer → `undefined`.
  - Unter den Feldern `.hinweis` mit `terminFehler(m)`, wenn nicht `null` (gleiche Optik wie der Zielgruppen-Hinweis).
  - `speichern` verweigert, solange ein Termin-Modul einen Fehler hat, und zeigt den Fehlertext als Meldung.

- [ ] **Step 4: Run, expect PASS** — gleicher Befehl, dann ganze Suite.

- [ ] **Step 5: Commit** — `git commit -am "Thread-Editor: Enddatum und optionale Uhrzeiten mit Pruefung"`

---

### Task 4: Kalendereintrag, .ics und Google-Link

**Files:**

- Create: `regeln/kalender.ts`, `regeln/kalender.spec.ts`

**Interfaces:**

- Consumes: `letzterTag`, `istMehrtaegig`, `tagPlus` aus Task 1.
- Produces:

  ```ts
  export interface KalenderEintrag {
  	titel: string;
  	ort: string;
  	beschreibung: string;
  	link: string;
  	ganztaegig: boolean;
  	beginn: string; // ganztaegig JJJJ-MM-TT, sonst JJJJ-MM-TTTHH:MM (Berliner Wandzeit)
  	ende: string; // ganztaegig exklusiver Folgetag, sonst Wandzeit
  }
  export function kalenderEintrag(m: TerminModul, threadTitel: string, link: string): KalenderEintrag;
  export function berlinNachUtc(wandzeit: string): string; // 'JJJJ-MM-TTTHH:MM' -> 'JJJJMMTTTHHMMSSZ'
  export function alsIcs(e: KalenderEintrag, uid: string, jetzt: Date): string;
  export function googleLink(e: KalenderEintrag): string;
  ```

- [ ] **Step 1: Failing tests** (`kalender.spec.ts`)

  ```ts
  const L = 'https://example.test/entwurf/glonntal/t/2-bowling/m/m1';
  it('bildet die vier Regeln der Spec 3.3 ab', () => {
  	expect(
  		kalenderEintrag(t({ von: '2026-10-23', bis: '2026-10-25', endeZeit: '12:00' }), 'Zeltlager', L),
  	).toMatchObject({ ganztaegig: true, beginn: '2026-10-23', ende: '2026-10-26' });
  	expect(kalenderEintrag(t({ beginnZeit: '14:00', endeZeit: '17:00' }), 'B', L)).toMatchObject({
  		ganztaegig: false,
  		beginn: '2026-10-17T14:00',
  		ende: '2026-10-17T17:00',
  	});
  	expect(kalenderEintrag(t({ beginnZeit: '23:30' }), 'B', L)).toMatchObject({ ende: '2026-10-18T00:30' });
  	expect(kalenderEintrag(t({ von: '2026-10-23', bis: '2026-10-25', beginnZeit: '17:00' }), 'B', L)).toMatchObject({
  		ende: '2026-10-26T00:00',
  	});
  });
  it('setzt Titel aus Thread und Modul und schreibt Hinweise in die Beschreibung', () => {
  	const e = kalenderEintrag(
  		t({ titel: 'Vortreffen', beginnZeit: '17:00', treffpunkt: 'Parkplatz' }),
  		'⛺ Zeltlager 2027',
  		L,
  	);
  	expect(e.titel).toBe('⛺ Zeltlager 2027 · Vortreffen');
  	expect(e.beschreibung).toBe(`Treffpunkt: Parkplatz\nEnde offen\n${L}`);
  	expect(kalenderEintrag(t({ endeZeit: '12:00' }), 'B', L).beschreibung).toBe(`Ende 12:00\n${L}`);
  });
  it('rechnet Berliner Zeit unabhaengig von der Browser-Zeitzone nach UTC', () => {
  	expect(berlinNachUtc('2026-10-17T14:00')).toBe('20261017T120000Z');
  	expect(berlinNachUtc('2026-10-25T12:00')).toBe('20261025T110000Z');
  	expect(berlinNachUtc('2026-12-18T18:00')).toBe('20261218T170000Z');
  	expect(berlinNachUtc('2027-03-28T12:00')).toBe('20270328T100000Z');
  });
  it('schreibt eine gueltige .ics-Datei', () => {
  	const ics = alsIcs(
  		kalenderEintrag(t({ beginnZeit: '14:00', endeZeit: '17:00' }), 'Bowling', L),
  		'glonntal-m1@jufi-app.de',
  		new Date(Date.UTC(2026, 9, 11, 8, 0)),
  	);
  	expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
  	expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  	expect(ics).toContain('\r\nUID:glonntal-m1@jufi-app.de\r\n');
  	expect(ics).toContain('\r\nDTSTAMP:20261011T080000Z\r\n');
  	expect(ics).toContain('\r\nDTSTART:20261017T120000Z\r\nDTEND:20261017T150000Z\r\n');
  });
  it('schreibt ganztaegige Eintraege als Datum mit exklusivem Ende', () => {
  	const ics = alsIcs(kalenderEintrag(t({ von: '2026-10-23', bis: '2026-10-25' }), 'Z', L), 'u', new Date(0));
  	expect(ics).toContain('\r\nDTSTART;VALUE=DATE:20261023\r\nDTEND;VALUE=DATE:20261026\r\n');
  });
  it('maskiert Sonderzeichen und faltet lange Zeilen nach 75 Bytes ohne Zeichen zu zerreissen', () => {
  	const lang = 'Grillen; Kuchen, Getränke \\ 🎣 '.repeat(6);
  	const ics = alsIcs({ ...kalenderEintrag(t({}), lang, L), ort: 'A,B;C' }, 'u', new Date(0));
  	expect(ics).toContain('LOCATION:A\\,B\\;C');
  	const zeilen = ics.split('\r\n');
  	expect(zeilen.every((z) => new TextEncoder().encode(z).length <= 75)).toBe(true);
  	expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:Grillen\\; Kuchen\\, Getränke \\\\ 🎣');
  	expect(ics).not.toContain('�');
  });
  it('baut den Google-Link mit Berliner Zeitzone', () => {
  	const u = new URL(
  		googleLink(
  			kalenderEintrag(t({ beginnZeit: '14:00', endeZeit: '17:00', ort: 'Hegen & Pflegen' }), 'Bowling & Pizza', L),
  		),
  	);
  	expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
  	expect(u.searchParams.get('action')).toBe('TEMPLATE');
  	expect(u.searchParams.get('text')).toBe('Bowling & Pizza');
  	expect(u.searchParams.get('dates')).toBe('20261017T140000/20261017T170000');
  	expect(u.searchParams.get('ctz')).toBe('Europe/Berlin');
  	expect(u.searchParams.get('location')).toBe('Hegen & Pflegen');
  	expect(googleLink(kalenderEintrag(t({}), 'A', L))).toContain('dates=20261017/20261018');
  });
  ```

- [ ] **Step 2: Run, expect FAIL**

  Run: `pnpm nx test entwurf --watch=false --include='**/kalender.spec.ts'`

- [ ] **Step 3: Implement `regeln/kalender.ts`**
  - `kalenderEintrag` nach Spec 3.3; Beschreibung: Zeilen „Treffpunkt: …" (wenn gesetzt), „Ende HH:MM" (ganztägig mit Endezeit) bzw. „Ende offen" (Beginn ohne Ende, eintägig), zuletzt der Link, getrennt mit `\n`. Eine Stunde auf Wandzeit rechnen (über `Date.UTC`), damit 23:30 sauber auf den Folgetag läuft.
  - `berlinNachUtc`: Wandzeit als `Date.UTC` lesen (`ziel`), Versatz Berlins mit `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year/month/day/hour/minute/second: 'numeric' })`-`formatToParts` bestimmen, `utc = ziel - versatz(ziel)`, dann einmal mit `versatz(utc)` nachrechnen (Umstellungstage). Kommentar: warum nicht die lokale Zeitzone des Browsers.
  - `alsIcs`: `VCALENDAR` mit `VERSION:2.0`, `PRODID:-//JuFi App//Entwurf//DE`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`; ein `VEVENT` mit `UID`, `DTSTAMP` (UTC aus `jetzt`), `DTSTART`/`DTEND` (`;VALUE=DATE:JJJJMMTT` bzw. `berlinNachUtc`), `SUMMARY`, `LOCATION`, `DESCRIPTION`, `URL`. Textwerte maskieren: `\` → `\\`, `;` → `\;`, `,` → `\,`, Zeilenumbruch → `\n`. Zeilen mit CRLF, Faltung nach RFC 5545 3.1: höchstens 75 Bytes UTF-8 pro Zeile, Fortsetzung beginnt mit einem Leerzeichen, nie innerhalb eines Zeichens (über Code-Points iterieren). Datei endet mit CRLF.
  - `googleLink`: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=A/B&details=…&location=…&ctz=Europe/Berlin`; `dates` als Wandzeit `JJJJMMTTTHHMMSS` bzw. ganztägig `JJJJMMTT` (Ende exklusiv), unkodiert; übrige Werte mit `encodeURIComponent`.

- [ ] **Step 4: Run, expect PASS** — gleicher Befehl.

- [ ] **Step 5: .ics mit einem Parser gegenprüfen**

  Eine Beispieldatei aus dem Zeltlager- und dem Bowling-Termin mit einem kleinen Vitest-freien Skript ins Scratchpad schreiben (z. B. per `node` aus einem Testlauf-Abdruck) und parsen:
  `uvx --with icalendar python3 -I -c "import icalendar,sys; c=icalendar.Calendar.from_ical(open(sys.argv[1],'rb').read()); [print(e.get('summary'), e.decoded('dtstart'), e.decoded('dtend')) for e in c.walk('VEVENT')]" <datei>`
  Expected: beide Einträge mit den erwarteten Zeiten (Bowling 12:00–15:00 UTC; Zeltlager ganztägig bzw. mit Zeiten). `uvx` lädt `icalendar` von PyPI; ist das nicht möglich, im Ledger als Ruling vermerken und auf die Unit-Tests stützen.

- [ ] **Step 6: Commit** — `git add apps/entwurf/src/app/regeln/kalender*.ts && git commit -m "Kalendereintrag, ics-Datei und Google-Kalender-Link als reine Regeln"`

---

### Task 5: Knopf „In Kalender eintragen"

**Files:**

- Create: `gestaltung/herunterladen.ts`, `module/kalender-knopf.ts`, `module/kalender-knopf.spec.ts`
- Modify: `module/termin.ts` (Eingänge `thread`, `vorschau`; Knopf einbinden), `module/modul.ts` (`[thread]`, `[vorschau]` an `jf-termin`), `daten/ereignisse.ts`

**Interfaces:**

- Consumes: `kalenderEintrag`, `alsIcs`, `googleLink` (Task 4); `pfadZuThread` (`mitglieder/pfade.ts`), `threadPfad` (`regeln/teilen.ts`); `EntwurfStore.jetzt()`, `EntwurfStore.stand()`.
- Produces:
  - `daten/ereignisse.ts`: neuer Fall `{ art: 'kalenderEingetragen'; threadId: Id; modulId: Id; weg: 'ics' | 'google' }`.
  - `gestaltung/herunterladen.ts`: `herunterladen(doc: Document, dateiname: string, inhalt: string, typ: string): void` — Blob, `URL.createObjectURL`, unsichtbares `<a download>` klicken, URL nach dem Klick per `setTimeout` freigeben.
  - `module/kalender-knopf.ts`: `jf-kalender-knopf` mit `thread = input.required<Thread>()`, `modul = input.required<TerminModul>()`, `vorschau = input(false)`.

- [ ] **Step 1: Failing tests** (`module/kalender-knopf.spec.ts`, RouterTestingHarness auf den Bowling-Thread als Sandra, `URL.createObjectURL`/`revokeObjectURL` mit `vi.stubGlobal` bzw. `vi.spyOn` ersetzt)

  ```ts
  it('klappt die zwei Wege auf', async () => {
  	knopf(el, 'In Kalender eintragen').click();
  	harness.detectChanges();
  	expect(knopf(el, 'In Kalender eintragen').getAttribute('aria-expanded')).toBe('true');
  	expect(knopf(el, 'Kalender des Telefons')).toBeTruthy();
  	const g = [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Google Kalender')!;
  	expect(g.target).toBe('_blank');
  	expect(g.rel).toContain('noopener');
  	expect(g.href).toContain('calendar.google.com');
  });
  it('laedt eine ics-Datei mit Thread-Titel und App-Link und meldet das Testereignis', async () => {
  	// Spy auf TESTEREIGNISSE.next, Blob aus createObjectURL abfangen
  	knopf(el, 'In Kalender eintragen').click();
  	harness.detectChanges();
  	knopf(el, 'Kalender des Telefons').click();
  	expect(await blob.text()).toContain('SUMMARY:🎳 Bowling');
  	expect(await blob.text()).toContain(`${location.origin}/entwurf/glonntal/t/`);
  	expect(blob.type).toBe('text/calendar;charset=utf-8');
  	expect(ereignis).toEqual({ art: 'kalenderEingetragen', threadId: T.bowling, modulId: M.bowlingTermin, weg: 'ics' });
  });
  it('meldet den Google-Weg', async () => {
  	/* Klick auf den Link, preventDefault im Test */ expect(ereignis.weg).toBe('google');
  });
  it('ist in der Editor-Vorschau gesperrt', async () => {
  	/* Editor mit Termin-Modul */ expect(knopf(vorschau, 'In Kalender eintragen').disabled).toBe(true);
  });
  it('enthaelt keine Personennamen', async () => {
  	/* ics-Text */ expect(text).not.toMatch(/Sandra|Lena|Max|Thomas|Katrin/);
  });
  ```

- [ ] **Step 2: Run, expect FAIL**

  Run: `pnpm nx test entwurf --watch=false --include='**/kalender-knopf.spec.ts'`

- [ ] **Step 3: Implement**
  - Link in den Kalender: `${document.location.origin}/entwurf${pfadZuThread(stand, thread.id, modul.id)}` (wie `verwaltung/personen.ts` die Einladung baut; `DOCUMENT` injizieren).
  - UID: `${stand.verein.slug}-${modul.id}@jufi-app.de`; Dateiname: letzter Abschnitt von `threadPfad(thread, slug)` plus `.ics` (z. B. `2-bowling.ics`); Typ `text/calendar;charset=utf-8`.
  - Knopf `type="button"` mit `aria-expanded`; darunter bei offenem Zustand der Knopf „Kalender des Telefons" und der Link „Google Kalender" (`target="_blank" rel="noopener"`), beide mindestens `var(--tippflaeche)` hoch, untereinander, `max-width: 100%`. Nach einem der beiden Wege klappt die Auswahl zu.
  - Beide Wege melden `kalenderEingetragen` an `TESTEREIGNISSE`; in der Vorschau ist der Knopf `disabled` und meldet nichts.
  - Kommentar im Bauteil: warum zwei Wege statt Geräteerkennung (Spec 3.4), warum `<a>` statt `window.open` für Google (öffnet auf Android die Kalender-App über App-Links, wird von Popup-Sperren nicht erfasst).

- [ ] **Step 4: Run, expect PASS** — gleicher Befehl, dann ganze Suite.

- [ ] **Step 5: Commit** — `git add -A apps/entwurf && git commit -m "Termin-Modul: Knopf In Kalender eintragen (ics und Google Kalender)"`

---

### Task 6: Testaufgabe und Rückmeldung

**Files:**

- Modify: `testmodus/aufgaben.ts`, `testmodus/rueckmeldung.ts`
- Test: `testmodus/pruefung.spec.ts`, `testmodus/rueckmeldung.spec.ts`, `testmodus/testmodus.spec.ts`

**Interfaces:**

- Consumes: `kalenderEingetragen` (Task 5), `M.zeltlagerTermin` (Task 2).
- Produces: Aufgaben `sandra-7` und `lena-5`.

- [ ] **Step 1: Failing tests**

  `pruefung.spec.ts`: Längen `sandra` 7, `lena` 5, `thomas` 5; beide neuen Aufgaben sind erst erfüllt, wenn ein Ereignis `{ art: 'kalenderEingetragen', threadId: T.zeltlager, modulId: M.zeltlagerTermin, weg: 'google' }` vorliegt, nicht bei einem Ereignis für das Vortreffen.

  `rueckmeldung.spec.ts`:

  ```ts
  it('nennt die gewaehlten Kalender-Wege einmal in Reihenfolge', () => {
  	const z = { ...leer, ereignisse: [kal('google'), kal('ics'), kal('google')] };
  	expect(rueckmeldungText(z, 'iPhone')).toContain('📅 Kalender: Google Kalender, Kalender des Telefons');
  });
  it('laesst die Kalender-Zeile ohne Ereignis weg', () => {
  	expect(rueckmeldungText(leer, 'iPhone')).not.toContain('📅');
  });
  ```

- [ ] **Step 2: Run, expect FAIL**

  Run: `pnpm nx test entwurf --watch=false --include='**/pruefung.spec.ts' --include='**/rueckmeldung.spec.ts'`

- [ ] **Step 3: Implement**
  - In `AUFGABEN.sandra` und `AUFGABEN.lena` am Ende: `{ id: 'sandra-7' | 'lena-5', kurz: 'Zeltlager in Kalender', art: 'handlung', text: 'Trag das Zeltlager in deinen Kalender ein.', erfuellt: (_, e) => e.some((x) => x.art === 'kalenderEingetragen' && x.modulId === M.zeltlagerTermin) }`.
  - Kopfkommentar von `AUFGABEN`: 17 Aufgaben, die zwei neuen aus Spec 2026-10-12 4.4; dazu der Satz, dass der Browser nicht wissen kann, ob der Eintrag im Telefon ankam, und das die Bewertung der Testperson sagt.
  - `rueckmeldungText`: nach den Personenblöcken, vor den Seiten-Notizen, die Zeile `📅 Kalender: <Wege>` mit `ics` → „Kalender des Telefons", `google` → „Google Kalender", jeder Weg einmal in der Reihenfolge des ersten Auftretens.

- [ ] **Step 4: Run, expect PASS** — gleicher Befehl, dann ganze Suite inklusive `testmodus.spec.ts` (Schleife über `AUFGABEN.lena.length` passt sich selbst an).

- [ ] **Step 5: Commit** — `git commit -am "Testmodus: Aufgabe Zeltlager in den Kalender, Kalender-Weg in der Rueckmeldung"`

---

### Task 7: Prüfung im Browser und Abschluss

**Files:** keine neuen; Korrekturen dort, wo die Messung es verlangt.

- [ ] **Step 1: Dev-Server starten**

  `pnpm run dev:entwurf` über `preview_start` (`.claude/launch.json` mit Port 4300, falls noch nicht vorhanden), Seite `http://localhost:4300/entwurf/`. Ein Entwurf mit altem `v1`-Stand im Browser beginnt neu — das ist erwartet.

- [ ] **Step 2: Messen bei 375 × 812, hell und dunkel**

  Als Sandra den Zeltlager-Thread öffnen, „In Kalender eintragen" aufklappen. Per `javascript_tool`:
  - `document.documentElement.scrollWidth <= 375`
  - beide Wege `getBoundingClientRect().height >= 44` und rechter Rand `<= 375 - 16`
  - Termin-Modul zeigt „Fr 18.06. 17:00 – So 20.06. 12:00" (bei Bezugstag 2026-10-11; sonst das passende Datum), Herbstfest zeigt „Sa 31.10. · ganztägig".
  - Termine-Seite im Juni 2027: Tage 18, 19, 20 markiert.
  - Konsole ohne Fehler; nach Klick auf „Kalender des Telefons" kein CSP-Fehler.

- [ ] **Step 3: Verwaltung bei 1280 × 800** — Thread-Editor: vier Termin-Felder, Hinweis bei Enddatum vor Startdatum sichtbar, Termine-Tabelle zeigt die neue Anzeige.

- [ ] **Step 4: Abschluss**

  Run: `pnpm nx typecheck entwurf --skip-nx-cache && pnpm nx test entwurf --watch=false --skip-nx-cache && pnpm exec prettier --check .`
  Expected: alles grün. Danach Rückmeldung an den Eigentümer mit der Bitte, den Stand lokal auf iPhone (Safari und Home-Bildschirm-App) und Android zu prüfen. Merge, Push und Deploy nur auf sein Wort.
