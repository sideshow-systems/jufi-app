# JuFi TP3 Etappe 2 — Threads lesen und antworten — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mitglieder öffnen einen Thread unter `/<slug>/t/<id>-<titel>`, lesen Info-Text, Termin und Umfrage, antworten für sich und ihre Kinder, schreiben und löschen Nachrichten im Verlauf und tragen Termine in ihren Kalender ein; der Gelesen-Stand wird gespeichert.

**Architecture:** Was ein Betrachter von einem Thread sieht, baut eine reine Funktion in `libs/domain` (`threadAnsicht`, `verlaufAnsicht`); der Server lädt nur, ruft sie und schreibt über `mitAenderung`. Server und Client teilen sich die Antworttypen über `@jufi/domain`. Die Thread-Seite ist eine neue Kindroute der Mitglieder-Hülle mit Bauteilen je Modul und dem Verlauf. Eine Thread-Liste gibt es erst in Etappe 4; bis dahin führen die Demo (gibt Links aus) und der Ende-zu-Ende-Test direkt in Threads.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (Signale, OnPush, inline), Express 4, Prisma 7, Postgres 17, Vitest 4, Playwright, `marked` 18 (vorhanden).

**Spec:** `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md` — Abschnitte 1.4 (Etappe 2), 2.4, 2.5, 3, 4, 6.2–6.4, 6.8, 11 (letzter Absatz). Dazu `2026-10-12-jufi-familie-jugendsprecher-kalender-design.md` 3.3/3.4 (Kalendereintrag) und TP2 9 (Mandanten-Test).

## Entscheidungen, die die Spec nachziehen

Der Plan trifft sie; Task 13 trägt sie in die TP3-Spec ein.

1. **Gelesen-Stand ohne `mitAenderung`.** `PUT /threads/:id/gelesen` ist die einzige schreibende Route ohne Änderungsstand: Liefe sie über `mitAenderung`, schöbe jedes Öffnen den Thread in der Liste nach oben und machte ihn für alle anderen „neu“. Der Client schickt den `stand` aus `GET /threads/:id` mit; der Server speichert `max(alt, min(bis, aktueller Stand))`. So markiert ein Öffnen nie etwas als gelesen, das der Client nicht geladen hat, und ein langsames Gerät setzt den Stand nicht zurück. Der Server liest den Vereinsstand **vor** den Thread-Daten (READ COMMITTED: was danach geladen wird, ist mindestens so neu).
2. **Wiederholungen über `clientId` werden unter der Sperre erkannt.** Die Arbeit in `mitAenderung` sucht die `clientId` erneut; ist sie schon da, wirft sie `Wiederholung` und rollt damit auch den Stand zurück. Außen liefert die Route das vorhandene Ergebnis (200 statt 201). Gehört die `clientId` einer anderen Person, einem anderen Thread oder einer anderen Antwortzeile: 409 `CLIENT_ID_VERGEBEN`, ohne etwas preiszugeben.
3. **Statuscodes der Etappe** (Spec 4.4 konkretisiert): unsichtbar, unbekannt oder nicht gefragt → 404; Entwurf → 409 `ENTWURF`; Modus „Nur Aushang“ → 409 `NUR_AUSHANG`; archiviert → 409 `ARCHIVIERT`; Frist → 410 `FRIST_ABGELAUFEN`; leere, unbekannte, doppelte oder bei `mehrfach = false` mehrere Optionen → 400 mit `feld: 'optionen'`; leere oder zu lange Nachricht → 400 mit `feld: 'text'`; Rate-Limit → 429 mit `wartenSekunden`.
4. **Thread-Adressen kennen zwei ID-Formen.** `cuid` (vom Code) und `gen_random_uuid()` (Austausch aus der Migration, enthält Bindestriche). `idAusSegment` erkennt erst die UUID-Form, sonst alles bis zum ersten Bindestrich.
5. **Die Ansicht ist eine reine Funktion in `libs/domain`.** Antwortzeilen, Antwortrechte, Ergebnisse, Schreibrecht und Zähler entscheiden sich in `threadAnsicht`; ihre Typen nutzt auch der Client. Verworfen: Typen im Client nachschreiben (Muster `mitglieder-api.ts`) — bei einer Antwort dieser Größe laufen die beiden Seiten auseinander.
6. **Systemsätze entstehen beim Lesen** aus `systemArt` und `systemDaten` (CHECK `verlauf_system`). Die Formen von `systemDaten` legt Etappe 2 fest, Etappe 3 schreibt sie: `VEROEFFENTLICHT` `{}`; `TERMIN_GEAENDERT` `{ termin: TerminDaten }`; `FRIST_GEAENDERT` `{ frage: string; frist: string | null }` (ISO); `MODUS_GEAENDERT` `{ modus: ThreadModus }`. Unlesbare Daten ergeben „… hat den Thread geändert“.
7. **Fristtext:** „bis Do 18:00“, wenn die Frist in den nächsten sechs Berliner Kalendertagen liegt, sonst „bis Do 29.10. 18:00“; ab `jetzt >= frist` „Frist abgelaufen“. Im Systemsatz immer die volle Form „Do 22.10. 18:00“, weil der Satz stehen bleibt.
8. **Demo schon jetzt mit Threads** (Spec 10.4 teilweise vorgezogen): „Wichtige Infos“, „Bowling“ im Ausgangszustand und zwei Nachrichten im Austausch; `pnpm run demo` gibt die Thread-Adressen aus. Ohne das hätte der Eigentümer vor Etappe 4 nichts abzunehmen. „Zeltlager 2027“ und der archivierte Thread folgen in Etappe 6.
9. **Das Löschen einer Nachricht meldet die Art `VERLAUF`** und zählt damit als Aktivität. Verworfen: `GELOESCHT` — die Art bedeutet „Objekt weg“, die Zeile bleibt aber stehen.

## Global Constraints

- Code-Kommentare und Oberfläche deutsch; Commit-Nachrichten deutsch in ASCII (Umlaute umschrieben), Ende `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Antwort-Texte der API (`fehler`) mit Umlauten.
- Einrückung Tabs; Ausnahmen YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative. **In `template:`/`styles:` keine Backticks in Kommentaren.**
- Angular: Vorlagen und Stile inline, `@if`/`@for`, Signale, `changeDetection: ChangeDetectionStrategy.OnPush`, Selektor-Präfix `jf-`, Tokens aus `styles.css`, Tippflächen mindestens 44 px.
- Regeln sind reine Funktionen mit `jetzt: Date`; nie `new Date()` ohne Argument in `libs/domain`. Server nimmt `deps.jetzt()`. Zeitzone der Anzeige immer `Europe/Berlin` über die Domain-Funktionen, nie die des Browsers.
- Vereinsdaten nur über `vereinDb`; jede schreibende Thread-Route außer `gelesen` über `mitAenderung` als erste schreibende Anweisung; keine `isolationLevel`.
- Jede neue Vereins-Route: `brauchtMitglied` als erster Handler, `asynchron(...)`, ein Fall in `mandanten.spec.ts`. Unsichtbares ist 404, nie 403; die Antwort für „unsichtbar“ und „unbekannt“ ist byte-gleich.
- Feste Werte: Nachricht 1–2000 Zeichen (gezählt in Code-Points wie `char_length`), gespeichert ohne Leerraum an den Enden; Verlauf-Seite 50 Einträge; höchstens 30 Nachrichten und 60 Antworten pro Minute und Person; `clientId` passt auf `^[A-Za-z0-9-]{1,100}$`; Kalender-UID `<modulId>@jufi-app.de`; „Nicht gefunden oder keine Berechtigung“; „Frist abgelaufen“; „Nachricht gelöscht“; „Von einem Jugendleiter entfernt“; Teilnahme-Pillen „✓ Dabei“, „? Vielleicht“, „✗ Abgesagt“; Modus-Texte `AUSHANG` „Nur Aushang“, `KOMMENTARE` „Aushang + Kommentare“, `CHAT` „Offener Chat“.
- Im Browser und in Tests nur erfundene Daten.
- Nach jeder Task: `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache` grün. Vor dem Abschluss `pnpm exec prettier --check .` und `pnpm run e2e`. Nichts pushen.
- Gearbeitet wird auf dem Branch `feature/tp3-etappe2-threads-lesen`.

## Review Focus

1. **Fremde und unsichtbare IDs** in jeder neuen Route (Thread, Modul, Eintrag, `fuerId`, `vor`): immer 404 mit derselben Antwort, keine Änderung, kein verbrauchter Stand (Tasks 5–7, Mandanten-Test).
2. **Doppelt geschickte Anfrage** (Doppeltipp, Outbox): genau eine Nachricht beziehungsweise Antwort, kein zusätzlicher Stand; eine fremde `clientId` verrät nichts (Tasks 6, 7).
3. **Fristsekunde und Nachtragen:** Um 18:00:00 bekommt Sandra 410, Thomas trägt weiter nach; ein Kind im Entwurf hat keine Antwortknöpfe (Tasks 2, 7, 9).
4. **Fremder Text als HTML:** `<script>`, `<img onerror>`, `javascript:`-Links, Bilder und Überschriften im Info-Text oder in einer Nachricht erscheinen als Text (Tasks 1, 9, 10).
5. **Austausch:** Seine UUID-Adresse öffnet sich für Jugendleiter und Jugendsprecher; die Familie bekommt „Nicht gefunden oder keine Berechtigung“ (Tasks 1, 5, 12).

## Dateistruktur

```
libs/domain/src/threads/pfad.ts            threadSegment, idAusSegment
libs/domain/src/threads/verlauf.ts         MODUS_TEXT, systemSatz, linkTeile, VerlaufAnsicht, verlaufAnsicht
libs/domain/src/threads/rechte.ts          + schreibSperre (darfSchreiben darauf umgestellt)
libs/domain/src/threads/ansicht.ts         ModulDaten, threadDatenAus, ThreadAnsicht, UmfrageAnsicht, threadAnsicht, umfrageAnsicht
libs/domain/src/module/umfrage/umfrage.ts  + fristText, fristZeitpunkt
libs/domain/src/module/termin/kalender.ts  KalenderEintrag, kalenderEintrag, alsIcs, googleKalenderLink
apps/jufi/src/server/fehler.ts             loggt nur Name und Code
apps/jufi/src/server/abhaengigkeiten.ts    + nachrichtenFenster, antwortenFenster
apps/jufi/src/server/threads/fenster.ts    Fensterzaehler
apps/jufi/src/server/threads/fehler.ts     ThreadAbbruch, Wiederholung, Antwortkoerper, antworteThreadFehler
apps/jufi/src/server/threads/laden.ts      ladeThreadUmfeld, ladeThread, ladeVereinsstand, modulOrt
apps/jufi/src/server/threads/test-threads.ts   legeThreadAn und Familien-Helfer fuer Server-Tests
apps/jufi/src/server/threads/lesen.ts      GET /threads/:id, PUT /threads/:id/gelesen
apps/jufi/src/server/threads/verlauf.ts    GET/POST /threads/:id/verlauf, DELETE /verlauf/:eintragId
apps/jufi/src/server/threads/antworten.ts  PUT /umfragen/:modulId/antworten/:fuerId
apps/jufi/src/server/threads/routen.ts     threadRouten (haengt die drei Dateien ein)
apps/jufi/src/server/verein.ts, mandanten.spec.ts
apps/jufi/src/app/verein/threads/thread-api.ts       ThreadApi
apps/jufi/src/app/verein/threads/thread-seite.ts     Seite, Kopf, Reiter, Deep Link
apps/jufi/src/app/verein/threads/info-text.ts        infoHtml (Markdown-Teilmenge)
apps/jufi/src/app/verein/threads/info-modul.ts, termin-modul.ts, umfrage-modul.ts, verlauf.ts
apps/jufi/src/app/gestaltung/herunterladen.ts        Datei im Browser speichern
apps/jufi/src/app/chunk-fehler.ts                    Router-Fehlerhandler fuer fehlende Lazy-Chunks
apps/jufi/src/app/app.routes.ts, app.config.ts
apps/cli/src/demo.ts, apps/cli/src/main.ts (Ausgabe der Links)
apps/jufi-e2e/src/ablauf.spec.ts, layout.spec.ts, threads.ts (Datenaufbau)
```

---

### Task 1: Adressen, Systemsätze, Links im Text

**Files:**

- Create: `libs/domain/src/threads/pfad.ts`, `libs/domain/src/threads/verlauf.ts` und je `.spec.ts`
- Modify: `libs/domain/src/module/umfrage/umfrage.ts` (+ Spec), `libs/domain/src/threads/index.ts`

**Interfaces:**

- Produces:
  - `threadSegment(id: string, titel: string): string` — `id` + `-` + Titel-Slug; Slug: Kleinbuchstaben, ä→ae, ö→oe, ü→ue, ß→ss, alles andere außer `a-z0-9` → `-`, Bindestriche zusammengefasst und an den Rändern entfernt, höchstens 40 Zeichen (nicht auf einem Bindestrich endend); leerer Slug → nur die `id`.
  - `idAusSegment(segment: string): string | null`
  - `MODUS_TEXT: Readonly<Record<ThreadModus, string>>`
  - `systemSatz(art: 'VEROEFFENTLICHT' | 'TERMIN_GEAENDERT' | 'FRIST_GEAENDERT' | 'MODUS_GEAENDERT', daten: unknown, handelnd: string): string`
  - `type TextTeil = { art: 'text'; text: string } | { art: 'link'; text: string; href: string }`; `linkTeile(text: string): TextTeil[]`
  - `fristText(frist: Date, jetzt: Date): string`, `fristZeitpunkt(frist: Date): string` (in `umfrage.ts`)

- [ ] **Step 1: Branch anlegen**

```bash
git switch -c feature/tp3-etappe2-threads-lesen
```

- [ ] **Step 2: Tests schreiben**

`pfad.spec.ts`:

- `threadSegment('ck1', '🎳 Bowling')` → `'ck1-bowling'`; `('ck1', 'Größe & Übermut!')` → `'ck1-groesse-uebermut'`; `('ck1', '🎳')` → `'ck1'`; ein Titel aus 120 `a` ergibt einen Slug von 40 Zeichen.
- `idAusSegment('clx9abc-bowling')` → `'clx9abc'`; `('clx9abc')` → `'clx9abc'`; `('3f2c9a1e-8b7d-4c6e-9f00-1234567890ab-jugendsprecher-austausch')` → `'3f2c9a1e-8b7d-4c6e-9f00-1234567890ab'`; `('3f2c9a1e-8b7d-4c6e-9f00-1234567890ab')` → dieselbe UUID; `('')`, `('-bowling')`, `('ABC')` (Großbuchstaben) → `null`.
- Rundreise: `idAusSegment(threadSegment(id, titel)) === id` für eine cuid und eine UUID mit dem Titel „Jugendsprecher-Austausch“.

`verlauf.spec.ts`:

- `systemSatz('VEROEFFENTLICHT', {}, 'Thomas K.')` → `'Thomas K. hat den Thread veröffentlicht'`.
- `systemSatz('TERMIN_GEAENDERT', { termin: { modulId: 'm', startDatum: '2026-10-24', endDatum: null, beginn: null, ende: null, ort: null, treffpunkt: null } }, 'Thomas K.')` → `'Thomas K. hat den Termin auf ' + terminZeit(termin) + ' verschoben'` (dieselbe Zeitangabe wie auf der Karte).
- `systemSatz('FRIST_GEAENDERT', { frage: 'Kommst du mit?', frist: '2026-10-22T16:00:00.000Z' }, 'Thomas K.')` → `'Thomas K. hat die Frist für „Kommst du mit?“ auf Do 22.10. 18:00 gesetzt'`; mit `frist: null` → `'Thomas K. hat die Frist für „Kommst du mit?“ aufgehoben'`.
- `systemSatz('MODUS_GEAENDERT', { modus: 'AUSHANG' }, 'Thomas K.')` → `'Thomas K. hat den Modus auf „Nur Aushang“ gestellt'`.
- Unlesbare Daten (`null`, `{ termin: 3 }`, `{ modus: 'X' }`) → `'Thomas K. hat den Thread geändert'`.
- `linkTeile('Treffpunkt: https://example.org/karte. Danke')` → `[text 'Treffpunkt: ', link 'https://example.org/karte', text '. Danke']` (abschließende `.,;:!?)` gehören nicht zum Link); `http://` ebenso; `javascript:alert(1)`, `www.example.org` und `mailto:` bleiben Text; Text ohne Link → ein Textteil; leerer Text → `[]`.

In `umfrage.spec.ts` (jetzt = Mo 19.10.2026 10:00 Berlin = `2026-10-19T08:00:00Z`):

- `fristText(new Date('2026-10-22T16:00:00Z'), jetzt)` → `'bis Do 18:00'`; `fristText(new Date('2026-10-29T17:00:00Z'), jetzt)` → `'bis Do 29.10. 18:00'` (nach der Zeitumstellung); Frist `2026-10-25T22:59:00Z` (So 23:59 Berlin, sechster Tag) → `'bis So 23:59'`; `jetzt` gleich der Frist → `'Frist abgelaufen'`; eine Sekunde davor → `'bis Mo 10:00'`.
- `fristZeitpunkt(new Date('2026-10-22T16:00:00Z'))` → `'Do 22.10. 18:00'`.

- [ ] **Step 3: Tests laufen lassen, sie scheitern**

Run: `pnpm nx test domain --skip-nx-cache` — Expected: FAIL (Funktionen fehlen).

- [ ] **Step 4: Umsetzen**

Wochentage und Datumsform aus `termin.ts` wiederverwenden (dort einen kleinen Helfer exportieren statt zu kopieren). `systemSatz` prüft `daten` feldweise mit `typeof`; ein Termin gilt als lesbar, wenn `terminFehler` ihn annimmt, und braucht dafür kein `modulId`. Exporte in `threads/index.ts`.

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm nx test domain --skip-nx-cache` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/domain
git commit -m "TP3 Etappe 2: Thread-Adressen, Systemsaetze, Links und Fristtext"
```

---

### Task 2: Ansicht eines Threads und des Verlaufs

**Files:**

- Create: `libs/domain/src/threads/ansicht.ts`, `libs/domain/src/threads/ansicht.spec.ts`
- Modify: `libs/domain/src/threads/rechte.ts` (+ Spec), `libs/domain/src/threads/verlauf.ts` (+ Spec), `libs/domain/src/threads/index.ts`

**Interfaces:**

- Consumes: `siehtThread`, `antwortZeilen`, `darfAntworten`, `auswertung`, `Auswertung`, `eingetragenVon`, `absenderName`, `kurzname`, `istArchiviert`, `ungeleseneNachrichten`, `darfLoeschenNachricht` (Etappe 1); `systemSatz` (Task 1).
- Produces:

```ts
// rechte.ts
export type SchreibSperre = 'NICHT_GEFUNDEN' | 'ENTWURF' | 'NUR_AUSHANG' | 'ARCHIVIERT';
export function schreibSperre(
	person: ThreadPerson,
	kopf: ThreadKopf,
	umfeld: Umfeld,
	termine: readonly TerminDaten[],
	jetzt: Date,
): SchreibSperre | null;
// darfSchreiben(...) === (schreibSperre(...) === null), Signatur unveraendert

// ansicht.ts
export type ModulDaten =
	| { typ: 'INFO'; id: string; titel: string | null; text: string }
	| { typ: 'TERMIN'; id: string; titel: string | null; termin: TerminDaten }
	| { typ: 'UMFRAGE'; id: string; titel: string | null; umfrage: UmfrageDaten };
export function threadDatenAus(kopf: ThreadKopf, module: readonly ModulDaten[]): ThreadDaten;
export interface ZeilenAnsicht {
	fuerId: string;
	vorname: string;
	selbst: boolean;
	optionIds: string[];
	eingetragenVon: string | null;
	darfAntworten: boolean;
}
export interface UmfrageAnsicht {
	typ: 'UMFRAGE';
	id: string;
	titel: string | null;
	frage: string;
	einheit: AntwortEinheit;
	mehrfach: boolean;
	teilnahme: boolean;
	frist: string | null;
	fristAbgelaufen: boolean;
	optionen: { id: string; schluessel: string; text: string }[];
	zeilen: ZeilenAnsicht[];
	ergebnis: Auswertung | null;
}
export type ModulAnsicht = Exclude<ModulDaten, { typ: 'UMFRAGE' }> | UmfrageAnsicht;
export interface ThreadAnsicht {
	id: string;
	titel: string;
	art: ThreadArt;
	modus: ThreadModus;
	rollenfilter: Rollenfilter;
	angepinnt: boolean;
	entwurf: boolean;
	archiviert: boolean;
	stand: number;
	schreibSperre: SchreibSperre | null;
	verlauf: { eintraege: number; ungelesen: number };
	module: ModulAnsicht[];
}
export interface AnsichtEingabe {
	ich: ThreadPerson;
	kopf: ThreadKopf;
	module: readonly ModulDaten[];
	umfeld: Umfeld;
	stand: number;
	verlaufEintraege: number;
	nachrichten: NachrichtenEingabe['nachrichten'];
	zugangSeit: Date;
	verlaufGelesenBis: number | null;
	jetzt: Date;
}
export function threadAnsicht(e: AnsichtEingabe): ThreadAnsicht | null; // null = sieht den Thread nicht
export function umfrageAnsicht(
	ich: ThreadPerson,
	modul: Extract<ModulDaten, { typ: 'UMFRAGE' }>,
	kopf: ThreadKopf,
	umfeld: Umfeld,
	jetzt: Date,
): UmfrageAnsicht;

// verlauf.ts
export interface VerlaufEintragDaten {
	id: string;
	art: 'NACHRICHT' | 'SYSTEM';
	autorId: string | null;
	text: string | null;
	systemArt: 'VEROEFFENTLICHT' | 'TERMIN_GEAENDERT' | 'FRIST_GEAENDERT' | 'MODUS_GEAENDERT' | null;
	systemDaten: unknown;
	stand: number;
	angelegtAm: Date;
	geloeschtAm: Date | null;
	geloeschtVonId: string | null;
}
export interface VerlaufAnsicht {
	id: string;
	art: 'NACHRICHT' | 'SYSTEM';
	text: string | null;
	absender: string | null;
	eigen: boolean;
	angelegtAm: string;
	stand: number;
	geloescht: 'SELBST' | 'MODERATION' | null;
	darfLoeschen: boolean;
}
export function verlaufAnsicht(
	ich: ThreadPerson,
	kopf: ThreadKopf,
	eintrag: VerlaufEintragDaten,
	umfeld: Umfeld,
): VerlaufAnsicht;
```

- [ ] **Step 1: Tests schreiben** (mit `bowlingUmfeld()`, `kopf()` und `JETZT` aus `testhilfe.ts`)

`rechte.spec.ts`: `schreibSperre` liefert der Reihe nach `NICHT_GEFUNDEN` (Sandra im Thread „Nur Jugendleiter“), `ENTWURF` (Thomas, `veroeffentlichtAm: null`), `NUR_AUSHANG` (Thomas, Modus `AUSHANG`), `ARCHIVIERT` (Thomas, `archivModus: 'ARCHIVIERT'`), `null` (Sandra, Bowling); eine Person, auf die mehrere Gründe zutreffen, bekommt den ersten. Die bestehenden `darfSchreiben`-Tests bleiben grün.

`ansicht.spec.ts`:

- Sandra im Bowling (Umfrage pro Jungfischer, Frist nach `JETZT`): Zeilen Lena und Max in Vornamen-Reihenfolge, `selbst: false`, beide `darfAntworten: true`; nach einer Antwort für Max von Sandra hat Max' Zeile `optionIds: ['<dabei>']` und `eingetragenVon: 'von dir eingetragen'`; eine Antwort Lenas von Lena hat `eingetragenVon: null`.
- Dieselbe Umfrage mit `frist` gleich `JETZT`: `fristAbgelaufen: true`, Sandras Zeilen `darfAntworten: false`, Thomas (darf bearbeiten, Vater von Jonas) `darfAntworten: true`.
- Entwurf (`veroeffentlichtAm: null`): Thomas sieht ihn, alle Zeilen `darfAntworten: false`, `entwurf: true`, `schreibSperre: 'ENTWURF'`; Sandra → `null`.
- `ergebnis` folgt `ergebnisse`: `'JUGENDLEITER'` → für Sandra `null`, für Bea (Antworten im Detail) `ansicht: 'NAMEN'`.
- Austausch (`art: 'JUGENDSPRECHER_AUSTAUSCH'`, `rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER'`, keine Module): Lena sieht ihn; Sandra → `null`.
- `verlauf.ungelesen`: zwei fremde Nachrichten nach `verlaufGelesenBis`, dazu eine eigene, ein Systemeintrag und eine gelöschte fremde → `2`; `verlauf.eintraege` reicht die Eingabe durch.
- Module behalten die Reihenfolge der Eingabe; `stand` wird durchgereicht; `archiviert` folgt `istArchiviert` (Termin am 10.10., `JETZT` 22.10. → `true`).
- `threadDatenAus` sammelt Termine und Umfragen in Modulreihenfolge.

`verlauf.spec.ts`:

- Nachricht Sandras für Thomas: `absender: 'Sandra M. (Mutter von Lena und Max)'`, `eigen: false`, `darfLoeschen: true` (Thomas darf bearbeiten); für Sandra selbst `eigen: true`, `darfLoeschen: true`; für Hans `darfLoeschen: false`.
- Gelöscht von der Autorin → `geloescht: 'SELBST'`, `text: null`, `darfLoeschen: false`; von Thomas → `'MODERATION'`.
- Systemeintrag `VEROEFFENTLICHT` von Thomas → `text: 'Thomas K. hat den Thread veröffentlicht'`, `absender: null`, `darfLoeschen: false`; Autor entfernt (nicht im Umfeld) → `'Ein ehemaliges Mitglied hat den Thread veröffentlicht'` (Satzanfang groß).
- `angelegtAm` ist ISO.

- [ ] **Step 2: Tests laufen lassen, sie scheitern** — `pnpm nx test domain --skip-nx-cache`, FAIL.

- [ ] **Step 3: Umsetzen.** `threadAnsicht` gibt `null`, wenn `siehtThread` falsch ist; `darfAntworten` der Zeile ist `darfAntworten(...) === 'ERLAUBT'`; die Antworten für `optionIds` kommen aus `umfrage.antworten` (`fuerId`), `eingetragenVon` aus der Etappe-1-Funktion. Der Name im Systemsatz ist `kurzname` des Autors oder „Ein ehemaliges Mitglied“.

- [ ] **Step 4: Tests laufen lassen** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Ansicht von Thread und Verlauf als reine Funktionen"`

---

### Task 3: Kalendereintrag

**Files:**

- Create: `libs/domain/src/module/termin/kalender.ts`, `libs/domain/src/module/termin/kalender.spec.ts`
- Modify: `libs/domain/src/index.ts`

**Interfaces:**

- Consumes: `TerminDaten`, `letzterTag`, `istMehrtaegig`, `beginnZeitpunkt`, `berlinZeitpunkt`, `tagPlus`.
- Produces:

```ts
export interface KalenderEintrag {
	titel: string;
	ort: string | null;
	beschreibung: string;
	ganztaegig: boolean;
	beginn: string;
	ende: string;
} // ganztaegig 'JJJJ-MM-TT' (Ende exklusiv), sonst UTC-ISO
export function kalenderEintrag(
	termin: TerminDaten,
	threadTitel: string,
	modulTitel: string | null,
	link: string,
): KalenderEintrag;
export function alsIcs(eintrag: KalenderEintrag, uid: string, jetzt: Date): string;
export function googleKalenderLink(eintrag: KalenderEintrag): string;
```

Vorlage: `apps/entwurf/src/app/regeln/kalender.ts` (Wegwerfcode, rechnet mit lokalen Zeichenketten; die Zeitrechnung kommt aus `libs/domain`, der Entwurfs-Vermerk „[Entwurf]“ entfällt).

- [ ] **Step 1: Tests schreiben** — die vier Zeilen der Tabelle FAM 3.3:
- ohne Beginn, 23.–25.10., Ende 12:00 → `ganztaegig`, `beginn '2026-10-23'`, `ende '2026-10-26'`, Beschreibung enthält `Ende 12:00`;
- Sa 24.10. 14:00–17:00 → `beginn '2026-10-24T12:00:00.000Z'`, `ende '2026-10-24T15:00:00.000Z'`;
- eintägig nur Beginn 14:00 → eine Stunde, Beschreibung enthält `Ende offen`;
- mehrtägig Fr 23.10. 17:00 bis So 25.10. ohne Ende → `ende` = Mo 26.10. 00:00 Berlin = `'2026-10-25T23:00:00.000Z'` (über die Zeitumstellung).
- Titel `'Zeltlager 2027 · Vortreffen'` mit Modultitel, sonst nur Thread-Titel; Beschreibung enthält `Treffpunkt: …` und den Link, keine weiteren Namen.
- `alsIcs`: Zeilen mit `\r\n`, `UID:<uid>`, `DTSTART;VALUE=DATE:20261023` beziehungsweise `DTSTART:20261024T120000Z`, `DTSTAMP` aus `jetzt`, Text mit `\,` `\;` `\\` `\n` escaped, keine Zeile länger als 75 Byte (ein Titel aus 40 `ü` wird an Code-Point-Grenzen gefaltet).
- `googleKalenderLink`: beginnt mit `https://calendar.google.com/calendar/render?action=TEMPLATE&`, enthält `ctz=Europe/Berlin`, `dates=20261024T140000/20261024T170000` (Berliner Wandzeit) bzw. `dates=20261023/20261026`, `text=` URL-kodiert.

- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Kalendereintrag, ICS und Google-Kalender-Link"`

---

### Task 4: Server-Grundgerüst

**Files:**

- Modify: `apps/jufi/src/server/fehler.ts`, `apps/jufi/src/server/fehler.spec.ts`, `apps/jufi/src/server/abhaengigkeiten.ts`
- Create: `apps/jufi/src/server/threads/fenster.ts` (+ Spec), `apps/jufi/src/server/threads/fehler.ts` (+ Spec), `apps/jufi/src/server/threads/laden.ts` (+ Spec), `apps/jufi/src/server/threads/test-threads.ts`

**Interfaces:**

- Consumes: `ladeUmfeld` (`mitglieder/verwaltung.ts`), `baueUmfeld`, `ModulDaten`, `threadDatenAus`, `VereinDb`.
- Produces:

```ts
// fenster.ts
export class Fensterzaehler {
	constructor(grenze: number, fensterMs: number, jetzt: () => number, maxSchluessel?: number /* 10_000 */);
	/** 0 = erlaubt und gezaehlt; sonst Millisekunden bis zum naechsten freien Platz. */
	pruefe(schluessel: string): number;
}
// abhaengigkeiten.ts: AppDeps + nachrichtenFenster?: Fensterzaehler; antwortenFenster?: Fensterzaehler
// Standard: new Fensterzaehler(30, 60_000, () => jetzt().getTime()) bzw. (60, 60_000, ...)

// threads/fehler.ts
export interface Antwortkoerper { fehler: string; code?: string; feld?: string }
export const NICHT_GEFUNDEN: Antwortkoerper;        // { fehler: 'nicht gefunden' }
export const ENTWURF: Antwortkoerper;               // { fehler: 'Der Thread ist noch ein Entwurf', code: 'ENTWURF' }
export const NUR_AUSHANG: Antwortkoerper;           // { fehler: 'In diesem Thread kann niemand schreiben', code: 'NUR_AUSHANG' }
export const ARCHIVIERT: Antwortkoerper;            // { fehler: 'Der Thread ist archiviert', code: 'ARCHIVIERT' }
export const FRIST_ABGELAUFEN: Antwortkoerper;      // { fehler: 'Frist abgelaufen', code: 'FRIST_ABGELAUFEN' }
export const CLIENT_ID_VERGEBEN: Antwortkoerper;    // { fehler: 'Ungültige Anfrage', code: 'CLIENT_ID_VERGEBEN' }
export class ThreadAbbruch extends Error { constructor(readonly status: number, readonly antwort: Antwortkoerper) }
export class Wiederholung<T> extends Error { constructor(readonly vorhanden: T) }
export function antworteThreadFehler(res: Response, error: unknown): void;   // ThreadAbbruch -> status; P2003/P2025 -> 404 NICHT_GEFUNDEN; sonst throw

// threads/laden.ts
export function ladeThreadUmfeld(db: VereinDb): Promise<Umfeld>;
export function ladeVereinsstand(db: VereinDb, vereinId: string): Promise<number>;
export interface GeladenerThread { kopf: ThreadKopf; module: ModulDaten[] }
export function ladeThread(db: VereinDb, threadId: string): Promise<GeladenerThread | null>;
export function modulOrt(db: VereinDb, modulId: string): Promise<{ threadId: string; typ: 'INFO' | 'TERMIN' | 'UMFRAGE' } | null>;

// threads/test-threads.ts (nur Tests)
export interface TestModul { typ: 'INFO'; text: string } | { typ: 'TERMIN'; termin: Omit<TerminDaten, 'modulId'> }
	| { typ: 'UMFRAGE'; frage?: string; einheit?: AntwortEinheit; mehrfach?: boolean; teilnahme?: boolean; vielleicht?: boolean;
		frist?: Date | null; ergebnisse?: ErgebnisSicht; optionen?: string[] }
export function legeThreadAn(prisma: PrismaClient, verein: { id: string }, jetzt: Date, daten?: { titel?: string; art?: ThreadArt;
	modus?: ThreadModus; rollenfilter?: Rollenfilter; untergruppenIds?: string[]; veroeffentlicht?: boolean; erstelltVonId?: string | null;
	archivModus?: ArchivModus; module?: TestModul[] }): Promise<{ threadId: string; modulIds: string[]; optionIds: Record<string, string> }>;
export function ordneZu(prisma: PrismaClient, verein: { id: string }, erwachsenerId: string, kindId: string, beziehung?: Beziehung): Promise<void>;
export function machJugendsprecher(prisma: PrismaClient, personId: string): Promise<void>;
export function steckeInUntergruppe(prisma: PrismaClient, verein: { id: string }, personId: string, name: string): Promise<string>;
```

- [ ] **Step 1: Tests schreiben**

`fehler.spec.ts`: Ein 500 mit `Object.assign(new Error('geheim: Sandra'), { name: 'PrismaClientKnownRequestError', code: 'P2010', meta: { x: 'Wert' } })` loggt genau `[GET /pfad] PrismaClientKnownRequestError P2010` — weder `geheim` noch `Wert` erscheinen in `console.error` (Spy auf alle Argumente); ein Fehler ohne `code` loggt nur den Namen.

`fenster.spec.ts` (Uhr als Variable): drei erlaubt bei Grenze 3, der vierte liefert die Restzeit bis der älteste Eintrag 60 000 ms alt ist; nach Ablauf wieder 0; Schlüssel sind getrennt; bei vollem Speicher werden zuerst abgelaufene Schlüssel verworfen, sonst liefert `pruefe` für einen neuen Schlüssel die volle Fensterlänge (fail-closed wie `AttemptTracker.platzFuer`).

`threads/fehler.spec.ts`: `antworteThreadFehler` mit `ThreadAbbruch(409, ENTWURF)` → 409 und Körper `ENTWURF`; mit `{ code: 'P2003' }` und `{ code: 'P2025' }` → 404 `NICHT_GEFUNDEN`; mit anderem Fehler wirft sie ihn weiter.

`laden.spec.ts` (gegen `jufi_test_server`, eigener Verein je Test, `legeThreadAn`):

- `ladeThread` liefert Kopf mit `untergruppenIds`, Module nach `(position, id)`, Optionen nach `(position, id)`, alle Antworten mit `optionIds`, Termin-Tage als `JJJJ-MM-TT`.
- Ein `ThreadModul` mit `typ: 'INFO'`, an dem zusätzlich (per Prisma von Hand) eine `TerminModul`-Zeile hängt, wird als `INFO` geladen; ein Modul, dessen Untertabelle fehlt, wird übersprungen.
- Thread aus einem fremden Verein → `null`; `modulOrt` für ein fremdes Modul → `null`.
- `ladeThreadUmfeld` enthält Untergruppen-Mitgliedschaften, keine Entfernten.

- [ ] **Step 2: Tests scheitern** — `pnpm nx run jufi:test-server --skip-nx-cache`, FAIL.

- [ ] **Step 3: Umsetzen.** `fehler.ts` loggt `` `[${req.method} ${req.path}] ${name}${code ? ' ' + code : ''}` `` (Spec 4.4; Kommentar nennt den Grund). `ladeThread` lädt mit einer Abfrage je Tabelle und baut die Domänentypen; `legeThreadAn` schreibt über `vereinDb` und `mitAenderung` (art `THREAD`), damit Stände in Tests stimmen; Teilnahme-Optionen mit `teilnahmeOptionen(vielleicht)`.

- [ ] **Step 4: Tests grün** — `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`, PASS.

- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Server-Grundgeruest fuer Threads, Fehlerlog ohne Inhalte"`

---

### Task 5: Thread lesen und Gelesen-Stand

**Files:**

- Create: `apps/jufi/src/server/threads/lesen.ts`, `apps/jufi/src/server/threads/routen.ts`, `apps/jufi/src/server/threads/lesen.spec.ts`
- Modify: `apps/jufi/src/server/verein.ts` (`threadRouten(router, deps)` nach `startRouten`), `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: Task 2 (`threadAnsicht`), Task 4 (Lader, Fehler).
- Produces:
  - `GET /threads/:id` → 200 `ThreadAnsicht`
  - `PUT /threads/:id/gelesen` mit `{ bereich: 'uebersicht' | 'verlauf'; bis: number }` → 204
  - `threadRouten(router: Router, deps: VolleAppDeps): void` (Tasks 6 und 7 ergänzen sie)

- [ ] **Step 1: Tests schreiben** (`lesen.spec.ts`, Muster `mitglieder/start.spec.ts`, feste Uhr)
- Sandra (Mutter von Lena und Max) liest Bowling: 200, `Object.keys` genau die der `ThreadAnsicht`, zwei Zeilen; Hans' Antwort für Max erscheint bei Sandra mit `eingetragenVon: 'eingetragen von Großvater Hans'`.
- Unbekannte ID, Thread „Nur Jugendleiter“ für Sandra, Entwurf für Sandra, Austausch für Sandra: jeweils 404 mit exakt `{ fehler: 'nicht gefunden' }`.
- Lena (Jugendsprecherin) liest den Austausch; ein Jungfischer ohne Merkmal bekommt 404.
- `stand` ist der Vereinsstand vor dem Laden; `verlauf.ungelesen` zählt eine fremde Nachricht nach dem Gelesen-Stand.
- `PUT gelesen` mit `bereich: 'verlauf', bis: stand` setzt beide Felder; danach ist `verlauf.ungelesen` 0. Ein späterer `PUT` mit kleinerem `bis` ändert nichts; `bis` größer als der Vereinsstand wird auf ihn gekürzt; `bereich: 'uebersicht'` lässt `verlaufGelesenBis` unverändert (beim ersten Mal 0).
- `PUT gelesen` ändert weder `Verein.aenderungsstand` noch `Aenderung` noch `letzteAktivitaetAm`.
- Ungültiger Körper (`bereich: 'x'`, `bis: -1`, `bis: 1.5`, fehlend) → 400; unsichtbarer Thread → 404.
- Ohne Sitzung → 401 `nicht angemeldet`.

In `mandanten.spec.ts`: `Kontext` um einen veröffentlichten Thread im Verein `fremd` erweitern (`legeThreadAn` mit Umfrage-Modul samt Option, einer Antwort und einer Nachricht — Tasks 6 und 7 brauchen sie) und Fälle für `GET /threads/:id` und `PUT /threads/:id/gelesen` nach dem Muster `PATCH /untergruppen/:id` (gesperrt 404, fremd 401, eigen 404; danach `GelesenStand`-Zahl und `aenderungsstand` von `fremd` unverändert).

- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Reihenfolge im GET: Stand lesen, dann Umfeld, Thread, Gelesen-Stand, Verlaufszahlen (`count` aller Einträge; für den Zähler nur Nachrichten mit `stand > verlaufGelesenBis`) laden; `ich = umfeld.personen.get(person.id)`; `threadAnsicht`; `null` → 404. `zugangSeit` ist `mitgliedKontext(res).zugang.angelegtAm`. Gelesen per `upsert` beim ersten Mal, sonst `updateMany` mit `gelesenBis: { lt: neu }` bzw. `verlaufGelesenBis: { lt: neu }`; ein P2002 aus zwei gleichzeitigen ersten Aufrufen wird mit einem zweiten Durchlauf aufgefangen.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Thread lesen und Gelesen-Stand"`

---

### Task 6: Verlauf lesen, schreiben, löschen

**Files:**

- Create: `apps/jufi/src/server/threads/verlauf.ts`, `apps/jufi/src/server/threads/verlauf.spec.ts`
- Modify: `apps/jufi/src/server/threads/routen.ts`, `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: `verlaufAnsicht`, `schreibSperre` (Task 2), `mitAenderung`, `Fensterzaehler` (`deps.nachrichtenFenster`), Fehler aus Task 4, `zuVieleVersuche` (`admin/versuche.ts`).
- Produces:
  - `GET /threads/:id/verlauf?vor=<eintragId>` → `{ eintraege: VerlaufAnsicht[]; weitere: boolean }`, neueste zuerst, sortiert nach `(stand desc, id desc)`, 50 je Seite
  - `POST /threads/:id/verlauf` mit `{ text: string; clientId: string }` → 201 `{ eintrag: VerlaufAnsicht; stand: number }`, Wiederholung 200 mit derselben Form
  - `DELETE /verlauf/:eintragId` → 204

- [ ] **Step 1: Tests schreiben**
- Lesen: 120 Einträge ergeben Seiten zu 50/50/20 mit `weitere` true/true/false, lückenlos und ohne Doppelte, auch wenn mehrere Einträge denselben `stand` haben; `vor` aus einem anderen Thread oder unbekannt → 404; unsichtbarer Thread → 404.
- Schreiben: Sandra schreibt `'  Wo ist der Treffpunkt?  '` → 201, gespeichert ohne Leerraum an den Enden, `eigen: true`, `stand` = neuer Vereinsstand, eine `Aenderung` (`VERLAUF`, `objektId` = Eintrag), `letzteAktivitaetStand` gesetzt.
- Grenzen: `''`, `'   '` → 400 `feld: 'text'`; 2000 Emoji (je ein Code-Point) → 201; 2001 Zeichen → 400; `clientId` fehlt oder `'a b'` → 400 `feld: 'clientId'`.
- Sperren: Entwurf (Thomas) → 409 `ENTWURF`; `AUSHANG` → 409 `NUR_AUSHANG`; archiviert → 409 `ARCHIVIERT`; Sandra im Austausch → 404; in keinem Fall ändert sich `aenderungsstand`.
- Wiederholung: dieselbe `clientId` zweimal nacheinander → 201 dann 200, eine Zeile, Stand nur einmal erhöht; zweimal gleichzeitig (`Promise.all`) → eine Zeile, ein 201 und ein 200; die `clientId` einer fremden Nachricht → 409 `CLIENT_ID_VERGEBEN`, Körper ohne Text.
- Rate-Limit: mit einem `Fensterzaehler(2, 60_000, …)` in `createApp` ist die dritte Nachricht 429 mit `wartenSekunden`.
- Löschen: eigene Nachricht → 204, `text` null, `geloeschtVonId` = Sandra, Aenderung `VERLAUF`; zweites Löschen → 204 ohne neuen Stand; Thomas (darf bearbeiten) löscht Sandras Nachricht → `geloescht: 'MODERATION'` beim Lesen; Hans löscht Sandras Nachricht → 404, unverändert; Systemeintrag → 404; Sandra löscht ihre Nachricht im archivierten Thread → 204.

`mandanten.spec.ts`: Fälle für die drei Routen (Schreibfälle: Zeilenzahl `VerlaufEintrag` und `aenderungsstand` in `fremd` unverändert).

- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Schreiben: Fenster zuerst (Schlüssel `${verein.id}:${person.id}`), Körper prüfen, laden, `schreibSperre` → 404/409, Vorab-Suche nach `clientId` (Wiederholung ohne Transaktion), dann `db.$transaction((tx) => mitAenderung(...))` mit erneuter Suche unter der Sperre (Entscheidung 2); P2002 auf `clientId` → wie Wiederholung behandeln.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Verlauf lesen, schreiben und loeschen"`

---

### Task 7: Antworten abgeben

**Files:**

- Create: `apps/jufi/src/server/threads/antworten.ts`, `apps/jufi/src/server/threads/antworten.spec.ts`
- Modify: `apps/jufi/src/server/threads/routen.ts`, `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: `gefragte`, `darfAntworten`, `umfrageAnsicht`, `modulOrt`, `ladeThread`, `mitAenderung`, `deps.antwortenFenster`.
- Produces: `PUT /umfragen/:modulId/antworten/:fuerId` mit `{ optionIds: string[]; clientId: string }` → 200 `{ modul: UmfrageAnsicht; stand: number }` (Wiederholung ebenso 200, ohne neuen Stand)

- [ ] **Step 1: Tests schreiben**
- Sandra antwortet für Max „dabei“ → 200, `modul.zeilen` für Max mit `optionIds: [dabei]`, `eingetragenVon: 'von dir eingetragen'`; in der DB `fuerId` Max, `vonId` Sandra, `abgegebenAm` = Uhr; eine `Aenderung` `ANTWORT`.
- Lena ändert ihre Antwort von „dabei“ auf „abgesagt“: eine Zeile, Optionen ersetzt, `vonId` Lena.
- Nicht gefragt: Sandra für Jonas (fremdes Kind) → 404; für sich selbst bei „pro Jungfischer“ → 404; Modul ist Info statt Umfrage → 404; fremdes Modul → 404.
- Frist: um `frist` genau → Sandra 410 `FRIST_ABGELAUFEN`; eine Millisekunde davor → 200; Thomas (darf bearbeiten) nach der Frist für Tim → 200 und `eingetragenVon` für Tim beim Lesen durch Tims Bezugsperson `'eingetragen von Thomas K.'`.
- Entwurf → 409 `ENTWURF`.
- Optionen: `[]` → 400 `feld: 'optionen'`; eine fremde Option → 400; doppelte ID → 400; zwei Optionen bei `mehrfach: false` → 400; zwei bei `mehrfach: true` → 200; `vielleicht` gibt es bei `vielleicht: false` nicht → 400; mehr als 20 Einträge → 400. In keinem Fehlerfall ändert sich der Stand.
- Wiederholung und `CLIENT_ID_VERGEBEN` wie in Task 6 (eine `clientId` einer anderen Antwortzeile → 409).
- Gleichzeitig: Sandra und Hans antworten zur selben Zeit für Max (`Promise.all`) → beide 200, genau eine Antwortzeile, zwei aufeinanderfolgende Stände.
- Rate-Limit mit eigenem `Fensterzaehler` → 429.

`mandanten.spec.ts`: Fall für die Route; Zeilen von `UmfrageAntwort`/`UmfrageAntwortOption` und `aenderungsstand` in `fremd` unverändert.

- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Reihenfolge: Fenster, Körper (Form), `modulOrt` (nicht `UMFRAGE` → 404), `ladeThread`, `fuerId ∈ gefragte` (sonst 404), `darfAntworten` → 404/409/410, Optionen gegen die Umfrage prüfen, Transaktion mit `upsert` auf `(umfrageId, fuerId)`, `deleteMany` + `createMany` der Optionen. Danach neu laden und `umfrageAnsicht` des Betrachters liefern.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Antworten abgeben mit Frist, Nachtragen und Idempotenz"`

---

### Task 8: Client — API, Route, Thread-Seite

**Files:**

- Create: `apps/jufi/src/app/verein/threads/thread-api.ts` (+ Spec), `apps/jufi/src/app/verein/threads/thread-seite.ts` (+ Spec), `apps/jufi/src/app/chunk-fehler.ts` (+ Spec)
- Modify: `apps/jufi/src/app/app.routes.ts`, `apps/jufi/src/app/app.config.ts` (bzw. `routerFeatures`)

**Interfaces:**

- Consumes: Typen aus `@jufi/domain` (`ThreadAnsicht`, `VerlaufAnsicht`, `UmfrageAnsicht`), `idAusSegment`, `threadSegment`; Muster `mitglieder-api.ts` (`holen`, `senden`, `alsApiFehler`), `beiAbgelaufenerSitzung`.
- Produces:

```ts
@Injectable({ providedIn: 'root' })
export class ThreadApi {
	thread(slug: string, id: string): Observable<ThreadAnsicht>;
	verlauf(slug: string, id: string, vor?: string): Observable<{ eintraege: VerlaufAnsicht[]; weitere: boolean }>;
	schreibe(
		slug: string,
		id: string,
		koerper: { text: string; clientId: string },
	): Observable<{ eintrag: VerlaufAnsicht; stand: number }>;
	loescheNachricht(slug: string, eintragId: string): Observable<void>;
	gelesen(slug: string, id: string, koerper: { bereich: 'uebersicht' | 'verlauf'; bis: number }): Observable<void>;
	antworte(
		slug: string,
		modulId: string,
		fuerId: string,
		koerper: { optionIds: string[]; clientId: string },
	): Observable<{ modul: UmfrageAnsicht; stand: number }>;
}
export function istFehlenderChunk(fehler: unknown): boolean;
```

Routen als Kinder der Mitglieder-Hülle: `t/:segment` und `t/:segment/m/:modulId`, beide `loadComponent` auf `ThreadSeite` (`jf-thread-seite`) mit Inputs `slug`, `segment`, `modulId?`, `reiter?` (Query).

- [ ] **Step 1: Tests schreiben**
- `thread-api.spec.ts`: jede Methode trifft Methode und Pfad der Server-Route (Ids mit `encodeURIComponent`), `vor` als Query nur wenn gesetzt; Fehler kommen als `ApiFehler`.
- `chunk-fehler.spec.ts`: `istFehlenderChunk` erkennt `Failed to fetch dynamically imported module`, `Importing a module script failed`, `error loading dynamically imported module` (auch als `cause`), nicht andere Fehler; der Handler lädt höchstens einmal je zehn Sekunden neu (Marke in `sessionStorage`, Zugriff in `try/catch`).
- `thread-seite.spec.ts` (Muster `start.spec.ts`, `RouterTestingHarness`):
  - `/demo/t/ck1-bowling` lädt `GET /demo/api/v1/threads/ck1`, zeigt `h1` „🎳 Bowling“ und schickt danach `PUT …/gelesen` mit `{ bereich: 'uebersicht', bis: <stand> }`.
  - Eine UUID-Adresse lädt die UUID; `/demo/t/-x` lädt nichts und zeigt „Nicht gefunden oder keine Berechtigung“; 404 vom Server zeigt denselben Text; 401 führt zur Anmeldung mit `weiter=`.
  - Ein veralteter Titel im Segment wird mit `replaceUrl` auf `threadSegment(id, titel)` umgeschrieben, Modul und Reiter bleiben.
  - Reiter: „Übersicht“ und „Verlauf“ mit Zähler `verlauf.ungelesen`; bei `modus: 'AUSHANG'` und `verlauf.eintraege: 0` gibt es keinen Reiter; `?reiter=verlauf` zeigt den Verlauf.
  - `entwurf: true` zeigt „Entwurf“, `archiviert: true` zeigt „Archiviert“.
  - `/demo/t/ck1-bowling/m/m2` scrollt die Karte `modul-m2` in den Blick und hebt sie hervor.
  - Der Zurück-Link führt nach `/demo` (die Thread-Liste kommt mit Etappe 4).
- [ ] **Step 2: Tests scheitern** — `pnpm nx test jufi --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.** Seitenmuster 2 (`firstValueFrom`, veraltete Antworten bei ID-Wechsel ignorieren). Module rendert vorerst je Typ ein Platzhalter-Bauteil, das Task 9 ersetzt; der Verlauf-Reiter rendert `jf-verlauf` aus Task 10 — bis dahin eine leere Karte.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Thread-Seite mit Reitern, Deep Link und Chunk-Fehlerhandler"`

---

### Task 9: Client — Module

**Files:**

- Create: `apps/jufi/src/app/verein/threads/info-text.ts`, `info-modul.ts`, `termin-modul.ts`, `umfrage-modul.ts` (je + Spec), `apps/jufi/src/app/gestaltung/herunterladen.ts`
- Modify: `apps/jufi/src/app/verein/threads/thread-seite.ts`

**Interfaces:**

- Consumes: `terminZeit`, `kartenLink`, `geraetAus`, `kalenderEintrag`, `alsIcs`, `googleKalenderLink`, `fristText`, `TEILNAHME_OPTIONEN`; `ThreadApi.antworte`.
- Produces:
  - `infoHtml(text: string): Promise<string>` — lädt `marked` dynamisch, `new Marked({ gfm: true, breaks: true })` mit eigenem Renderer
  - `herunterladen(doc: Document, dateiname: string, inhalt: string, typ: string): void` (Vorlage `apps/entwurf/src/app/gestaltung/herunterladen.ts`)
  - `jf-info-modul` (`modul`), `jf-termin-modul` (`modul`, `thread: { id; titel }`, `slug`), `jf-umfrage-modul` (`modul`, `slug`, Output `geaendert: UmfrageAnsicht`)

- [ ] **Step 1: Tests schreiben**

`info-text.spec.ts` — Eingabe → enthaltenes HTML:

- `'**fett** und _kursiv_'` → `<strong>fett</strong>`, `<em>kursiv</em>`; `'- a\n- b'` → `<ul><li>a</li><li>b</li></ul>`; zwei Absätze → zwei `<p>`.
- `'[Karte](https://example.org)'` und `'https://example.org'` → `<a href="https://example.org" target="_blank" rel="noopener noreferrer">`; `mailto:` erlaubt.
- `'[x](javascript:alert(1))'` → kein `<a`, der Text erscheint; `'<b>x</b>'` → `&lt;b&gt;`; `'<img src=x onerror=alert(1)>'` → kein `<img`; `'![Bild](https://example.org/a.png)'` → kein `<img`, Text bleibt sichtbar; `'# Titel'` → kein `<h1`, `# Titel` als Text; ``'`code`'`` und Codeblöcke → kein `<code`, Text sichtbar; `'> Zitat'` → kein `<blockquote`.

`termin-modul.spec.ts`: zeigt `terminZeit`, Ort als Link `kartenLink(ort, geraetAus(navigator.userAgent))`, Treffpunkt; „In Kalender eintragen“ klappt „Kalender des Telefons“ und „Google Kalender“ auf; Ersteres ruft `herunterladen` mit Dateiname `<threadSegment>.ics`, Typ `text/calendar;charset=utf-8` und UID `<modulId>@jufi-app.de`; Letzteres ist ein `<a target="_blank" rel="noopener">` mit `googleKalenderLink`; der Link im Eintrag ist `location.origin + '/<slug>/t/<id>/m/<modulId>'`.

`umfrage-modul.spec.ts`:

- Teilnahme-Umfrage mit zwei Zeilen: je Zeile Knöpfe „✓ Dabei“, „? Vielleicht“, „✗ Abgesagt“ (44 px); Klick schickt sofort `PUT …/antworten/<fuerId>` mit `optionIds: [id]` und einer `clientId` (UUID); die Antwort ersetzt das Modul (`geaendert`), die Zeile zeigt die Pille und „ändern“.
- Mehrfachauswahl: Haken je Option, „Antworten“ erst mit mindestens einer Auswahl aktiv.
- Zeile mit `darfAntworten: false` und ohne Antwort → „keine Antwort“, keine Knöpfe; `selbst: true` heißt „Du“, sonst der Vorname; `eingetragenVon` steht unter der Zeile.
- Frist: `fristText` sichtbar; 410 vom Server → „Frist abgelaufen“ an der Umfrage und die Knöpfe verschwinden; 429 → `fehlertext`; Doppelklick schickt nur eine Anfrage (Knöpfe während des Sendens gesperrt).
- Ergebnis `NAMEN`: je Option „Dabei (2)“ mit „Lena M., Max M.“ und „Offen (1)“; `SUMME`: nur Zahlen; `null`: kein Ergebnisblock.

- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** `info-modul` bindet `[innerHTML]` (Angulars Sanitizer bleibt der zweite Riegel, kein `bypassSecurityTrust…`) und stylt mit `ViewEncapsulation.None` unter `jf-info-modul …` wie `rechtstext.ts`. Die Seite legt jedes Modul in eine `jf-karte` mit `id="modul-<id>"`.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Module Info-Text, Termin mit Kalender und Umfrage"`

---

### Task 10: Client — Verlauf

**Files:**

- Create: `apps/jufi/src/app/verein/threads/verlauf.ts` (+ Spec)
- Modify: `apps/jufi/src/app/verein/threads/thread-seite.ts`

**Interfaces:**

- Consumes: `ThreadApi.verlauf`, `schreibe`, `loescheNachricht`, `gelesen`; `linkTeile`; `zeitpunktBerlin` (`gestaltung/format.ts`).
- Produces: `jf-verlauf` mit Inputs `slug`, `threadId`, `stand`, `schreibSperre: SchreibSperre | null`, Output `gelesen()` (die Seite setzt danach den Zähler auf 0).

- [ ] **Step 1: Tests schreiben**
- Lädt die erste Seite und zeigt sie chronologisch (älteste oben); „Frühere laden“ erscheint nur bei `weitere` und hängt die nächste Seite oben an (`vor` = ID des ältesten geladenen Eintrags).
- Nach dem ersten Laden `PUT …/gelesen` mit `bereich: 'verlauf'` und dem `stand` der Seite.
- Nachricht: Absender, Zeit in Berliner Zeit, Text mit klickbaren `https:`-Links (`target="_blank" rel="noopener noreferrer"`), `<script>` im Text erscheint als Text; eigene Nachrichten rechts; Systemeintrag gedämpft; gelöscht → „Nachricht gelöscht“ bzw. „Von einem Jugendleiter entfernt“.
- „Löschen“ nur bei `darfLoeschen`, mit Rückfrage; danach zeigt der Eintrag „Nachricht gelöscht“.
- Eingabefeld nur bei `schreibSperre === null`; bei `NUR_AUSHANG` kein Eingabefeld, die Liste bleibt; Senden mit Enter und Knopf, leerer Text sperrt den Knopf; dieselbe `clientId` bei einem erneuten Versuch nach Netzfehler; der Text bleibt bei einem Fehler stehen; 409 `ARCHIVIERT` zeigt „Der Thread ist archiviert“; nach Erfolg ist das Feld leer und die Nachricht steht unten.
- [ ] **Step 2: Tests scheitern** — FAIL.
- [ ] **Step 3: Umsetzen.** Das Eingabefeld sitzt fest über der unteren Leiste (`bottom: calc(56px + var(--sicher-unten))` wie die Leiste, Vorlage `apps/entwurf/src/app/module/verlauf.ts`); ein Abstandhalter in seiner Höhe ist das letzte Element der Seite, damit `leisteVerdecktNichts` und die letzte Nachricht frei bleiben.
- [ ] **Step 4: Tests grün** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Verlauf mit Nachladen, Senden und Loeschen"`

---

### Task 11: Demo mit Threads

**Files:**

- Modify: `apps/cli/src/demo.ts`, `apps/cli/src/demo.spec.ts`, `apps/cli/src/main.ts` (Ausgabe)

**Interfaces:**

- Consumes: `austauschAnlegen`, `teilnahmeOptionen`, `threadSegment`.
- Produces: `demoEinspielen(prisma, jetzt)` liefert zusätzlich `threads: { titel: string; segment: string }[]`; `pnpm run demo` druckt je Thread `<titel>: <BASIS_URL>/demo/t/<segment>` (ohne `BASIS_URL` nur den Pfad).

Inhalt (Personen der bestehenden Demo, Ersteller Thomas Beispiel):

- „Wichtige Infos“: angepinnt, `AUSHANG`, Info-Text mit Liste und Link, Termin „Nächste Gruppenstunde“ am nächsten Freitag ab `jetzt` (Berlin) 17:00–18:30, Ort „Vereinsheim“.
- „🎳 Bowling“: `KOMMENTARE`, alle Untergruppen, `JUNGFISCHER_FAMILIE`, Info-Text, Termin am übernächsten Samstag 14:00–17:00 „Bowlingcenter“, Treffpunkt „13:30 am Vereinsheim“, Teilnahme-Umfrage „Kommst du mit?“ pro Jungfischer, Frist am Donnerstag davor 18:00 Berlin, Ergebnisse für alle; keine Antworten.
- Austausch: eine Nachricht von Jonas (Jugendsprecher), eine von Thomas.
- Stände von Hand in derselben Transaktion: je Thread und je Nachricht ein eigener Stand mit je einer `Aenderung` (`THREAD` bzw. `VERLAUF`), `letzteAktivitaet*` passend, `Verein.aenderungsstand` am Ende gleich dem größten Stand.

- [ ] **Step 1: Tests anpassen und ergänzen** — `demo.spec.ts`: drei Threads (davon ein Austausch), `aenderungsstand` gleich `max(Aenderung.stand)`, Verlaufsstände des Austauschs aufsteigend, Bowling-Frist liegt vor dem Termin und nach `BEZUGSTAG`, zweimal einspielen ergibt denselben Stand, die Rückgabe enthält die drei Segmente.
- [ ] **Step 2: Tests scheitern** — `pnpm nx test cli --skip-nx-cache`, FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Tests grün** — PASS; `pnpm run demo` druckt die Adressen.
- [ ] **Step 5: Commit** — `git commit -m "TP3 Etappe 2: Demo mit Wichtige Infos, Bowling und Austausch"`

---

### Task 12: Ende-zu-Ende und Layout

**Files:**

- Create: `apps/jufi-e2e/src/threads.ts`
- Modify: `apps/jufi-e2e/src/ablauf.spec.ts`, `apps/jufi-e2e/src/layout.spec.ts`

**Interfaces:**

- Consumes: Datenbankzugang wie in `aufbau.ts` (`@jufi/db`), `mitAenderung`, `teilnahmeOptionen`, die Sitzungen und `ids.json` des Ablaufs.
- Produces: `legeE2eThreadAn(slug: string, leitungId: string, jetzt: Date): Promise<{ bowling: string; austausch: string }>` (Thread-Segmente); `ids.json` erhält `bowling` und `austausch`.

- [ ] **Step 1: Ablauf ergänzen** (nach dem Schritt, in dem Mutter und Kind Mia angemeldet sind)
- Bowling über `legeE2eThreadAn` anlegen (wie die Demo: Info, Termin, Teilnahme-Umfrage pro Jungfischer, Frist in einer Woche).
- Mutter öffnet `/musterbach/t/<bowling>`, sieht die Zeile für Mia, tippt „✓ Dabei“, sieht „von dir eingetragen“; wechselt in den Verlauf und schreibt „Wo genau ist der Treffpunkt?“.
- Kind öffnet denselben Thread: Zeile „Du“ mit „Dabei“ und „eingetragen von Mutter <Vorname>“; der Reiter „Verlauf“ zeigt `1`.
- Mutter öffnet `/musterbach/t/<austausch>` → „Nicht gefunden oder keine Berechtigung“; Leitung öffnet ihn und sieht das Eingabefeld.
- [ ] **Step 2: Layout ergänzen** — `SEITEN` um `t/:bowling` (mutter, kind), `t/:bowling?reiter=verlauf` (mutter) und `t/:austausch?reiter=verlauf` (leitung), Art `mitglied`; zusätzlich: das Eingabefeld des Verlaufs endet über der Leiste, und die letzte Nachricht liegt nach dem Scrollen ans Ende über dem Eingabefeld (`getBoundingClientRect`).
- [ ] **Step 3: Laufen lassen** — `pnpm run e2e`, Expected: alle Tests grün (bisher 72, jetzt mehr).
- [ ] **Step 4: Commit** — `git commit -m "TP3 Etappe 2: Ende-zu-Ende fuer Antworten, Verlauf und Austausch"`

---

### Task 13: Spec, CLAUDE.md, Abschluss

**Files:**

- Modify: `docs/superpowers/specs/2026-10-20-jufi-tp3-thread-kern-design.md`, `CLAUDE.md`

- [ ] **Step 1: Spec nachziehen** — die Entscheidungen 1–9 dieses Plans an ihrer Stelle eintragen (2.4 Formen von `systemDaten`; 4.1 Körper von `gelesen`, `vor` als Eintrags-ID, Antwortformen; 4.2 Ausnahme `gelesen`, Wiederholung unter der Sperre; 4.4 Statuscodes und Codes; 6.2 ID-Formen und Zurück nach Start bis Etappe 4; 6.3 Fristtext; 10.4 Demo teilweise vorgezogen), jeweils mit der verworfenen Alternative.
- [ ] **Step 2: CLAUDE.md** — unter „Stand“ eine Zeile: „TP3 Etappe 2 ist da: Thread-Seite `/<slug>/t/<id>-<titel>` mit Modulen, Antworten und Verlauf; `pnpm run demo` gibt die Thread-Adressen aus. Antworttypen der Thread-API stehen in `@jufi/domain` (`threads/ansicht.ts`).“
- [ ] **Step 3: Gesamtprüfung** — `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache`, `pnpm run e2e`, `pnpm exec prettier --check .`; alles grün.
- [ ] **Step 4: Commit** — `git commit -m "TP3 Etappe 2: Spec und CLAUDE.md nachgezogen"`
