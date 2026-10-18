# JuFi TP2 Etappe 5 — Oberflächen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die schlichten Seiten aus Etappe 2 bis 4 bekommen ihre beiden Hüllen (Mitglieder am Handy mit Start und Mehr, Verwaltung am Desktop mit Seitenleiste). Dazu kommen Vereinseinstellungen mit Logo, PWA-Manifest und Icons je Verein, die Plattformseite mit Impressum und Datenschutz, „Meine Daten herunterladen“ und ein Ende-zu-Ende-Test mit Playwright, der auch die Layouts misst.

**Architecture:** Ein `VereinKontext` liest den Verein aus dem ersten Pfadteil und setzt an einer einzigen Stelle Farbe, Titel und Manifest-Link. Darunter hängen zwei Eltern-Routen mit Hülle, `MitgliederHuelle` und `VerwaltungsHuelle`, und die vorhandenen Seiten werden ihre Kinder. Logo und Icons verarbeitet der Server mit `sharp`. Manifest, Icons und Logo sind öffentlich, alles andere läuft wie bisher über `/<slug>/api/v1` und `vereinDb`.

**Tech Stack:** Nx 23, pnpm 10, Angular 22 (zoneless, Signale, OnPush, inline Vorlagen), Express/`@angular/ssr`, Prisma 7, Postgres 17, Vitest 4. Neu dazu kommen `sharp` (Logo und Icons), `marked` (Rechtstexte) und `@playwright/test` (Ende-zu-Ende).

**Spec:** `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md`, Abschnitte 2.3/2.4 (Plattformseite, URLs, `weiter`), 3.2 (`VereinLogo`), 5.2 (Ansprechpartner), 6 (Oberflächen), 7.3 (Notfall-Link-Hinweis), 8.5 (Größengrenzen), 8.6 (Rechtstexte), 9 (Playwright, gemessene Layouts). Die Rahmen-Spec liegt unter `docs/superpowers/specs/2026-10-11-jufi-rahmen-design.md`, die Vorlagen der Hüllen unter `apps/entwurf/src/app/mitglieder/huelle.ts`, `mehr.ts` und `verwaltung/huelle.ts`, `einstellungen.ts`.

## Entscheidungen, die die Spec nachziehen

Der Plan trifft diese Entscheidungen, Task 17 trägt sie in die Spec ein.

1. **Playwright gehört zu Etappe 5** (Entscheidung des Eigentümers vom 18.10.2026). Es kommt der Ende-zu-Ende-Ablauf aus Spec 9 dazu, außerdem die Layout-Messungen bei 375 × 812 und 1280 × 800, jeweils hell und dunkel, als automatischer Test. Der Test läuft über `pnpm run e2e` und nicht in `pnpm test`: Er braucht einen Produktionsbau und dauert Minuten.
2. **Der Hinweis auf Notfall-Links steht 30 Tage** (Entscheidung des Eigentümers). Gezeigt werden alle `NOTFALL_LINK`-Einträge des Vereins aus den letzten 30 Tagen, die neuesten zuerst. Es gibt keine Quittung und kein neues Feld. Gelesen wird ausnahmsweise mit dem schlichten `PrismaClient`, denn `AdminProtokoll` ist eine Plattformtabelle, die `vereinDb` nicht erreicht. Die Abfrage ist eng gefasst: nur `vereinId` aus dem Slug, nur diese Aktion, nur `zeitpunkt` und `betroffenePersonId`.
3. **Der Manifest-Link wird zur Laufzeit in den `<head>` gesetzt**, zusammen mit `apple-touch-icon` und `theme-color`. Das übernimmt `VereinKontext`. Verworfen: der Server schreibt den Link in `index.html`. Die App rendert nur im Client (`app.routes.server.ts`), und `AngularNodeAppEngine` liefert für jeden Pfad dieselbe Datei aus. Chrome wertet einen nachträglich gesetzten Manifest-Link aus, und iOS liest ihn erst beim „Zum Home-Bildschirm“.
4. **Manifest, Icons und Logo sind ohne Anmeldung abrufbar.** Browser laden das Manifest ohne Cookies, und die Anmeldeseite soll das Logo zeigen. Anzeigename und Farbe gibt `GET /verein` schon heute ohne Anmeldung preis. Ein gesperrter oder unbekannter Verein bleibt 404.
5. **Das Logo wird neu kodiert.** Das Format bestimmt der Inhalt (`sharp(...).metadata()`), nicht der `Content-Type`. Gespeichert wird das Bild mit höchstens 1024 px an der längsten Seite, gedreht nach EXIF und ohne Metadaten. Ein Handyfoto trägt sonst womöglich den GPS-Ort. Die Eingabe ist auf 1 MB und 25 Megapixel begrenzt (`limitInputPixels`), damit ein kleines Bild mit riesigen Maßen den Speicher nicht sprengt.
6. **Ohne Logo zeigt das Icon Initialen** (`initialen(anzeigename)`) auf `vereinsfarben(farbe).hell.akzent` in `aufAkzent`. Die Schrift ist DejaVu Sans Bold, im Image über `apk add font-dejavu`. Verworfen: eine Schriftdatei im Repo. Lokal liefert macOS eine Schrift, im Image fehlte sie trotzdem, und der Fehler bliebe unsichtbar. Etappe 6 prüft das Icon auf dem Server.
7. **„In der Verwaltung warten“ erscheint auf Start nur mit dem Recht `MITGLIEDER`.** Betreuer sehen in ihrer Sicht keine Warnhinweise (`einsichtIn` → `LESEN`) und können nichts davon erledigen.
8. **„Meine Jungfischer“ liegt unter `/<slug>/meine-jungfischer`** (Spec 2.4) statt `/<slug>/jungfischer`. Es gibt keine Weiterleitung, weil echte Nutzer den alten Pfad nie gesehen haben.
9. **„Meine Daten herunterladen“ ist ein schlichter Link** (`<a href=".../ich/daten" download>`) auf einen GET-Endpunkt mit `Content-Disposition: attachment`. Das Sitzungscookie geht mit, weil Pfad und Ursprung passen. Verworfen: Laden per `HttpClient` und Blob, das wäre mehr Code ohne Gewinn.
10. **Impressum und Datenschutz** liegen als Markdown unter `apps/jufi/src/rechtstexte/`. Sie werden mit dem Text-Loader des Builds eingebunden und im Browser mit `marked` gerendert, nachgeladen nur mit ihrer Route. Die Gliederung steht, den Inhalt liefert der Eigentümer (Spec 8.6).
11. **`weiter` nach der Anmeldung** (Spec 2.4) prüft `sichererWeiterPfad` in `libs/domain`. Erlaubt ist nur ein Pfad, der nach dem Normalisieren unter `/<slug>/` liegt und nicht wieder auf `anmelden`, `einladung` oder `zugang-verloren` zeigt, alles andere führt zum Start des Vereins.

## Global Constraints

- Code-Kommentare, Commit-Nachrichten und Oberfläche sind deutsch. Commit-Nachrichten sind ASCII (Umlaute umschrieben) und enden auf `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Einrückung mit Tabs; Ausnahmen YAML, `schema.prisma`, `package.json`, Markdown.
- Kommentare erklären das Warum und nennen die verworfene Alternative.
- Vereinsdaten nur über `vereinDb`. Einzige Ausnahme ist Entscheidung 2.
- Regeln sind reine Funktionen ohne Angular-Abhängigkeit, mit `jetzt: Date` als Parameter, nie `new Date()` im Regelcode.
- Was eine Person nicht sehen darf, ist für sie „nicht gefunden“ (404). Unangemeldet bleibt es 401 (`brauchtMitglied`).
- Jede neue Route in `vereinsApi` braucht einen Fall in `apps/jufi/src/server/mandanten.spec.ts` (`FAELLE`), sonst scheitert der erste Test dort.
- Angular: Vorlagen und Stile inline, `@if`/`@for`/`@switch`, Signale, `OnPush`. **Keine Backticks in Kommentaren innerhalb von `template:`/`styles:`.** Ein Wirt ohne eigenen Stil braucht `:host { display: block }`.
- Gestaltung nur über die vorhandenen Tokens (`--a1`…`--a5`, `--akzent`, `--karte`, `--linie`, `--tippflaeche`, `--sicher-unten` …). Tippflächen sind am Handy mindestens 44 px hoch.
- Größengrenzen: JSON höchstens 100 KB (unverändert), Logo höchstens 1 MB (Spec 8.5).
- Rechte (Enum `Recht`): `MITGLIEDER`, `THREADS_ERSTELLEN`, `ALLE_THREADS`, `DOKUMENTE`, `ANTWORTEN_DETAIL`, `JUGENDLEITER_RECHTE`, `EINSTELLUNGEN`. Jugendleiter ist, wer mindestens eines davon hat.
- Nach jeder Task muss `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache` grün sein. Vor dem Abschluss kommen `pnpm exec prettier --check .` und `pnpm run e2e` dazu. Nichts pushen.
- Im Browser wird nur mit erfundenen Daten geprüft.

## Review Focus

Diese Eingaben und Zustände legt die Spec nahe, aber keine Task-Spezifikation deckt sie allein ab. Jeder hat seinen Test in der genannten Task.

1. **Umleitung nach außen über `weiter`**: `//boese.example`, `/\boese.example`, `https://boese.example/demo/`, `/demo/../admin`, `/demox/profil`, ein fremder Slug und `javascript:` landen alle auf `/<slug>/`, nie woanders (Tasks 1, 2).
2. **Logo mit falschem oder feindlichem Inhalt**: Etwa `Content-Type: image/png` mit Text, SVG oder GIF im Body, mehr als 1 MB, 10 000 × 10 000 Pixel in wenigen KB, ein JPEG mit GPS-EXIF. Erwartet wird 415 oder 413, das alte Logo bleibt unverändert, und ein gespeichertes Bild trägt keine Metadaten mehr (Tasks 4, 6).
3. **Datenauszug ohne Geheimnisse**: Die JSON-Antwort enthält weder `passwortHash`, `totpGeheimnis`, `tokenHash`, `publicKey` noch `credentialId`, über andere Personen nur Name und Beziehung, und ohne Sitzung kommt 401 (Task 8).
4. **Icons nach einer Logo-Änderung**: Kein veraltetes Icon aus dem Cache (`Cache-Control: no-cache` plus ETag, Logo-URL mit `?v=`). Ein Verein ohne Logo bekommt ein Initialen-Icon, ein gesperrter Verein 404 (Task 5).
5. **Wechsel zwischen Vereinen und zur Plattform**: Farbe, Titel, Manifest-Link und `theme-color` des vorigen Vereins verschwinden auf `/`, `/impressum`, `/admin` und bei einem unbekannten Verein (Task 3).

## Dateistruktur

```
libs/domain/src/weiter.ts                          sichererWeiterPfad
libs/domain/src/verein.ts                          + initialen, pruefeKontakt
apps/jufi/src/server/verein/logo.ts                verarbeiteLogo, initialenIcon (sharp)
apps/jufi/src/server/verein/pwa.ts                 Router /:slug: manifest.webmanifest, icon-192.png, icon-512.png
apps/jufi/src/server/verein/einstellungen.ts       Routen: Einstellungen, Logo
apps/jufi/src/server/mitglieder/start.ts           Routen: Ansprechpartner, Verwaltungshinweise
apps/jufi/src/server/mitglieder/datenauszug.ts     Route: Meine Daten
apps/jufi/src/app/verein/verein-kontext.ts         Verein der URL, Farbe, Titel, Kopf-Links
apps/jufi/src/app/verein/mitglieder-huelle.ts      Kopf, untere Leiste (Start, Mehr)
apps/jufi/src/app/verein/start.ts                  Start (ersetzt seiten/verein-start.ts)
apps/jufi/src/app/verein/mehr.ts                   Mehr
apps/jufi/src/app/verein/verwaltung/huelle.ts      Seitenleiste, Admin-Hinweis
apps/jufi/src/app/verein/verwaltung/einstellungen.ts
apps/jufi/src/app/seiten/rechtstext.ts             Impressum, Datenschutz
apps/jufi/src/rechtstexte/{impressum,datenschutz}.md
apps/jufi-e2e/                                     Playwright: Aufbau, Ablauf, Layout
```

---

### Task 1: Reine Regeln für `weiter`, Initialen und Kontakt

**Files:**

- Create: `libs/domain/src/weiter.ts`, Test `libs/domain/src/weiter.spec.ts`
- Modify: `libs/domain/src/verein.ts`, `libs/domain/src/index.ts`, Test `libs/domain/src/verein.spec.ts`

**Interfaces:**

- Produces: `sichererWeiterPfad(slug: string, weiter: string | null | undefined): string` gibt `weiter` zurück, wenn es erlaubt ist, sonst `/${slug}/`.
- Produces: `initialen(anzeigename: string): string` liefert ein oder zwei Großbuchstaben (Grapheme).
- Produces: `KONTAKT_MAX = 500` und `pruefeKontakt(s: string): boolean`. Der Text ist nach `trim` höchstens 500 Zeichen lang, leer ist erlaubt (und wird beim Speichern zu `null`).

- [ ] **Step 1: Tests schreiben.**
  - `sichererWeiterPfad('demo', x)` liefert `x` für `/demo/`, `/demo/profil`, `/demo/verwaltung/personen/abc?x=1#y`.
  - Es liefert `/demo/` für `null`, `''`, `/demo` ohne Schrägstrich (der Start heißt `/demo/`), `//boese.example`, `/\boese.example`, `https://boese.example/demo/`, `javascript:alert(1)`, `/demo/../admin`, `/demo/%2e%2e/admin`, `/demox/profil`, `/anderer/profil`, `/demo/anmelden`, `/demo/anmelden?weiter=/demo/`, `/demo/einladung`, `/demo/zugang-verloren` und eine Zeichenkette mit 501 Zeichen.
  - `initialen`: `'Jungfischer Glonntal'` → `'JG'`, `'jungfischer demo'` → `'JD'`, `'Ötztaler Fischer'` → `'ÖF'`, `'Petershausen'` → `'P'`, `'Fischer-Jugend Nord'` → `'FJ'`, `'  '` → `'?'`, `'1889 Verein'` → `'1V'`.
  - `pruefeKontakt`: `''` ist wahr, 500 Zeichen sind wahr, 501 falsch.
- [ ] **Step 2:** `pnpm nx run domain:test --skip-nx-cache` — Expected: FAIL (Funktionen fehlen).
- [ ] **Step 3: Implementieren.** `sichererWeiterPfad` prüft zuerst Länge (≤ 500), Anfang `/` und dass das zweite Zeichen weder `/` noch `\` ist. Danach normalisiert es mit `new URL(weiter, 'http://jufi.invalid')`, verlangt denselben Ursprung und einen `pathname`, der mit `/${slug}/` beginnt (nach `decodeURIComponent`-freiem Vergleich, `URL` löst `..` und `%2e%2e` selbst auf), und schließt die drei Anmeldepfade aus. Zurück kommt `pathname + search + hash` der normalisierten URL. Kommentar: `URL` statt eigener Zerlegung, weil Browser genau so auflösen. Verworfen: eine Positivliste der Seiten, die mit jeder neuen Seite wachsen müsste. `initialen` zerlegt an Leerraum und Bindestrich und nimmt per `Intl.Segmenter` das erste Graphem der ersten zwei Wörter, `toLocaleUpperCase('de')`.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Domain: sichererWeiterPfad, initialen, pruefeKontakt`

---

### Task 2: Wächter und Anmeldung führen über `weiter` zurück

**Files:**

- Modify: `apps/jufi/src/app/verein/mitglied-waechter.ts`, `apps/jufi/src/app/verein/anmelden.ts`
- Test: `apps/jufi/src/app/verein/anmelden.spec.ts`, `apps/jufi/src/app/seiten/verein-start.spec.ts` (bzw. ab Task 9 `verein/start.spec.ts`)

**Interfaces:**

- Consumes: `sichererWeiterPfad` (Task 1).
- Produces: Bei 401 leitet `mitgliedAngemeldet` auf `/<slug>/anmelden?weiter=<state.url, encodiert>` um. `AnmeldenComponent` navigiert nach jedem erfolgreichen Abschluss (Passwort, TOTP, Passkey) zu `sichererWeiterPfad(slug, queryParam weiter)`.

- [ ] **Step 1: Tests schreiben.** Ein Test öffnet `/demo/profil` ohne Sitzung (401 auf `/ich`) und erwartet danach die URL `/demo/anmelden?weiter=%2Fdemo%2Fprofil`. Zwei Tests melden sich unter `/demo/anmelden?weiter=%2Fdemo%2Fprofil` an, einmal per Passwort, einmal mit TOTP-Schritt, und landen auf `/demo/profil`. Ein Test meldet sich unter `/demo/anmelden?weiter=%2F%2Fboese.example` an und landet auf `/demo/`.
- [ ] **Step 2:** `pnpm nx run jufi:test --skip-nx-cache` — Expected: die neuen Fälle FAIL.
- [ ] **Step 3: Implementieren.** Im Wächter `router.createUrlTree([pfad, 'anmelden'], { queryParams: { weiter: state.url } })`, `state` ist das zweite Argument von `CanActivateFn`. In `anmelden.ts` liest ein gemeinsamer Abschluss den Parameter, und die drei Erfolgswege rufen ihn.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Anmeldung: weiter fuehrt zur aufgerufenen Seite zurueck`

---

### Task 3: `VereinKontext` — ein Ort für Farbe, Titel und Kopf-Links

**Files:**

- Create: `apps/jufi/src/app/verein/verein-kontext.ts`, Test `verein-kontext.spec.ts`
- Modify: `apps/jufi/src/app/app.ts` (Kontext beim Start injizieren), `apps/jufi/src/app/verein/verein-kopf.ts` (liest aus dem Kontext statt selbst zu laden), `apps/jufi/src/app/daten/verein-api.ts` (`OeffentlicherVerein` um `logoStand: string | null` ergänzen)
- Modify: `apps/jufi/src/server/verein.ts` (`GET /verein` liefert zusätzlich `logoStand` = `VereinLogo.geaendertAm` als ISO-Text oder `null`, gelesen mit `findUnique` und `select: { geaendertAm: true }`, ohne die Bytes) mit Test in `apps/jufi/src/server/verein.spec.ts` oder der vorhandenen Datei, die `GET /verein` prüft

**Interfaces:**

- Produces:
  ```ts
  @Injectable({ providedIn: 'root' })
  export class VereinKontext {
  	/** Slug aus dem ersten Pfadteil, null auf Plattform- und Admin-Seiten. */
  	readonly slug: Signal<string | null>;
  	/** undefined = laedt, 'nicht-gefunden', oder der Verein. */
  	readonly verein: Signal<OeffentlicherVerein | 'nicht-gefunden' | undefined>;
  	readonly ladefehler: Signal<boolean>;
  	/** Nach Aenderungen in den Vereinseinstellungen. */
  	neuLaden(): void;
  	/** URL des Logos mit ?v=logoStand, null ohne Logo. */
  	readonly logoUrl: Signal<string | null>;
  }
  ```
- Kopf-Links, solange ein Verein geladen ist: `<link rel="manifest" href="/<slug>/manifest.webmanifest">`, `<link rel="apple-touch-icon" href="/<slug>/icon-192.png?v=…">` und `<meta name="theme-color" content="<hell.akzent>">`. Jedes Element trägt `data-jufi-verein`, damit es sich gezielt entfernen lässt.

- [ ] **Step 1: Tests schreiben.**
  - Bei `/demo/profil` (nach `GET /ich`) und `GET /verein` sind `--akzent-hell`, `document.title === 'Jungfischer Demo'`, der Manifest-Link, `apple-touch-icon` und `theme-color` gesetzt.
  - `/demo` → `/anderer` lädt neu, und der Manifest-Link zeigt auf `/anderer/…`.
  - `/demo` → `/` sowie `/demo` → `/admin/anmelden` und `/demo` → `/gibtsnicht` (404 von `GET /verein`) entfernen alle Elemente mit `data-jufi-verein`, die Farbe ist leer und der Titel `JuFi App`.
  - `/demo/profil` → `/demo/mehr` schickt keine zweite Anfrage an `/verein`.
  - `neuLaden()` schickt genau eine neue Anfrage.
- [ ] **Step 2:** `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Der Slug kommt aus `Router.events` (`NavigationEnd`), erster Pfadteil, nur wenn `pruefeSlug(teil).ok`. Reservierte Namen wie `admin` fallen damit von selbst heraus. Laden per `rxResource` über `VereinApi.lade`, und ein `effect` mit `onCleanup` setzt und entfernt Farbe, Titel und Kopf-Elemente (Muster aus dem heutigen `VereinStartComponent`). Kommentar: Kontext am Router statt in jeder Seite, verworfen sind Setzen und Aufräumen je Bauteil. Die Reihenfolge von Zerstören und Anlegen beim Seitenwechsel ließ sonst die Farbe des vorigen Vereins stehen. `VereinKopfComponent` behält seine Eingaben, liest den Verein aber aus dem Kontext.
- [ ] **Step 4:** Test erneut, dazu `pnpm nx run jufi:test-server --skip-nx-cache` — Expected: PASS.
- [ ] **Step 5: Commit** `VereinKontext: Farbe, Titel und Kopf-Links an einer Stelle`

---

### Task 4: Logo verarbeiten und Initialen-Icon erzeugen

**Files:**

- Create: `apps/jufi/src/server/verein/logo.ts`, Test `logo.spec.ts` (Testbilder werden im Test mit `sharp` erzeugt, keine Binärdateien im Repo)
- Modify: `package.json` (`sharp` als Abhängigkeit), `apps/jufi/project.json` (`sharp` in `externalDependencies`), `Dockerfile` (Runtime: `apk add --no-cache tini curl font-dejavu fontconfig`, sowie `sharp` in den Runtime-Abhängigkeiten wie `@node-rs/argon2`)

**Interfaces:**

- Produces:
  ```ts
  export const LOGO_MAX_BYTES = 1024 * 1024;
  export const LOGO_MAX_PIXEL = 25_000_000;
  export type LogoErgebnis =
  	| { ok: true; bild: Buffer; mimeType: 'image/png' | 'image/jpeg'; icon192: Buffer; icon512: Buffer }
  	| { ok: false; grund: 'format' | 'zu-gross' };
  export async function verarbeiteLogo(eingabe: Buffer): Promise<LogoErgebnis>;
  export async function initialenIcon(anzeigename: string, farbe: string, groesse: 192 | 512): Promise<Buffer>;
  ```
- Icons sind quadratische PNGs mit `fit: 'contain'` auf weißem Grund. `initialenIcon` zeichnet `initialen(anzeigename)` mittig auf `vereinsfarben(farbe).hell.akzent` in `aufAkzent` (`vereinsfarben` aus `apps/jufi/src/app/gestaltung/farben.ts`, das ohne Importe auskommt).

- [ ] **Step 1: Tests schreiben.**
  - Ein PNG 800 × 400 mit Alphakanal ergibt `ok`, `mimeType: 'image/png'` und Icons mit 192 × 192 bzw. 512 × 512 (`sharp(icon).metadata()`).
  - Ein JPEG 3000 × 2000 mit EXIF-Orientierung 6 und GPS-Tag ergibt `bild` mit längster Seite 1024, Hochformat (gedreht) und ohne `exif` in den Metadaten.
  - GIF, SVG, WebP, Text und ein abgeschnittenes PNG ergeben `{ ok: false, grund: 'format' }`.
  - 1 MB + 1 Byte ergibt `zu-gross`, ohne dass `sharp` aufgerufen wird.
  - Ein PNG mit 10 000 × 10 000 Pixeln (einfarbig, wenige KB) ergibt `zu-gross`.
  - `initialenIcon('Jungfischer Demo', '#1d4ed8', 192)` ist ein PNG 192 × 192, dessen Eckpixel die Akzentfarbe trägt und dessen Mitte davon abweicht (Schrift gezeichnet).
- [ ] **Step 2:** `pnpm nx run jufi:test-server --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** `sharp(eingabe, { limitInputPixels: LOGO_MAX_PIXEL, failOn: 'error' })`. Das Format kommt aus `metadata().format` (`png` oder `jpeg`), `.rotate()`, `.resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })` und neu kodiert im selben Format (JPEG `quality: 85`). Ohne `withMetadata` lässt `sharp` die Metadaten weg, ein Kommentar sagt das. Einen Pixel-Überlauf meldet `sharp` als Fehler mit „pixel limit“, daraus wird `zu-gross`. Jeder andere Fehler wird `format`. Das Initialen-Icon entsteht aus einem SVG mit `<rect>` und `<text font-family="DejaVu Sans" font-weight="bold">` (XML-Sonderzeichen in den Initialen escapen), danach `sharp(Buffer.from(svg)).png()`.
- [ ] **Step 4:** Test erneut — Expected: PASS. Außerdem einmal `pnpm run image:app` und darin `docker run --rm jufi:local node -e "require('sharp')"` — Expected: kein Fehler. Die Plattformpakete `@img/sharp-linuxmusl-*` installiert pnpm im Image selbst. Fehlen sie, gehört `sharp` in `pnpm.onlyBuiltDependencies` bzw. die Architektur in `supportedArchitectures` (`package.json`), mit Kommentar.
- [ ] **Step 5: Commit** `Logo: neu kodieren ohne Metadaten, Icons und Initialen-Icon mit sharp`

---

### Task 5: PWA-Manifest, Icons und öffentliches Logo

**Files:**

- Create: `apps/jufi/src/server/verein/pwa.ts`, Test `pwa.spec.ts`
- Modify: `apps/jufi/src/server/app.ts` (Router unter `/:slug` nach der Vereins-API einhängen), `apps/jufi/src/server/verein.ts` (`GET /verein/logo` in `vereinsApi`), `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: `vereinAusSlug`, `initialenIcon` (Task 4), `vereinsfarben`, `FLAECHEN`.
- Produces: `pwaRouten(deps: VolleAppDeps): Router` mit drei Routen, alle hinter `vereinAusSlug`, ohne Sitzung:
  - `GET /manifest.webmanifest` → `Content-Type: application/manifest+json`, `{ id: '/<slug>/', name: anzeigename, short_name: anzeigename, lang: 'de', start_url: '/<slug>/', scope: '/<slug>/', display: 'standalone', background_color: FLAECHEN.hell.seite, theme_color: vereinsfarben(farbe).hell.akzent, icons: [{ src: '/<slug>/icon-192.png?v=<stand>', sizes: '192x192', type: 'image/png' }, { …512… }] }`. `stand` ist `logoStand` oder, ohne Logo, ein kurzer Hash aus Anzeigename und Farbe, damit eine neue Farbe ein neues Icon bekommt.
  - `GET /icon-192.png`, `GET /icon-512.png` → PNG aus `VereinLogo` oder `initialenIcon`, mit `Cache-Control: no-cache`.
  - In `vereinsApi`: `GET /verein/logo` → Bytes mit `mimeType`, `Cache-Control: no-cache`, 404 ohne Logo.

- [ ] **Step 1: Tests schreiben.**
  - Das Manifest des Demo-Vereins hat die Felder oben, `start_url` und `scope` sind `/demo/`.
  - Die Icons sind ohne Logo 192 bzw. 512 px groß.
  - Nach dem Anlegen eines `VereinLogo` (direkt per `vereinDb` im Test) liefert `icon-192.png` dessen `icon192`, `/verein/logo` liefert `bild` mit `Content-Type: image/jpeg`, und eine zweite Anfrage mit `If-None-Match` aus der ersten bekommt 304.
  - Ein gesperrter Verein, ein unbekannter Slug und `/ADMIN/manifest.webmanifest` ergeben 404.
  - `/demo/icon-64.png` geht weiter an den nächsten Handler (kein 500).
  - Im Mandanten-Test: `GET /verein/logo` eines gesperrten fremden Vereins ergibt 404.
- [ ] **Step 2:** `pnpm nx run jufi:test-server --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** `pwaRouten` ist ein Router (`caseSensitive: true`) mit genau drei vollen Pfaden, `router.get('/:slug/manifest.webmanifest', vereinAusSlug(deps.prisma), …)` und entsprechend für die beiden Icons. In `createApp` wird er mit `app.use(pwaRouten(deps))` nach der Vereins-API eingehängt, ohne `nichtGefunden` dahinter. **Nicht** `app.use('/:slug', vereinAusSlug, …)`: `express.static` hängt in `server.ts` erst hinter `createApp`, und `/chunk-abc.js` passte dann als Slug, scheiterte an `pruefeSlug` und bekäme 404 statt der Datei. Alle anderen Pfade unter dem Slug gehören Angular und erreichen keine Datenbank. Kommentar: Die Icons erzeugt jede Anfrage neu statt aus einem Cache, weil sie nur beim Installieren und selten danach abgerufen werden. Verworfen: Icons ohne Logo in der Datenbank ablegen, sie veralteten bei jeder Farbänderung. Ein Test ruft zusätzlich `/chunk-abc.js` an `createApp` auf und erwartet, dass die Anfrage durchgereicht wird (kein JSON-404).
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `PWA: Manifest und Icons je Verein, oeffentliches Logo`

---

### Task 6: Vereinseinstellungen und Logo-Upload (Server)

**Files:**

- Create: `apps/jufi/src/server/verein/einstellungen.ts`, Test `einstellungen.spec.ts`
- Modify: `apps/jufi/src/server/verein.ts` (Routen einhängen), `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: `brauchtMitglied`, `ladeBetrachter`/`hatRecht(…, 'EINSTELLUNGEN')`, `pruefeVereinsname`, `pruefeAnzeigename`, `pruefeFarbe`, `normalisiereFarbe`, `pruefeKontakt`, `verarbeiteLogo`.
- Produces (ohne `EINSTELLUNGEN` jeweils 404, ohne Sitzung 401):
  - `GET /einstellungen` → `{ slug, name, anzeigename, kontakt: string | null, farbe, logoStand: string | null }`
  - `PATCH /einstellungen` mit Body `{ name?, anzeigename?, kontakt?, farbe? }` → 200 mit derselben Form wie GET. Ein unbekannter Schlüssel (auch `slug`, `status`) oder ein ungültiger Wert ergibt 400 `{ fehler, feld }`. Die Texte sind `'Der Anzeigename darf höchstens 24 Zeichen haben'`, `'Bitte den offiziellen Namen angeben'`, `'Bitte eine Farbe als #rrggbb angeben'`, `'Der Kontakt darf höchstens 500 Zeichen haben'`. Ein leerer Kontakt wird `null`.
  - `PUT /einstellungen/logo` mit rohem Body und `Content-Type: image/png | image/jpeg` → 200 `{ logoStand }`. Ein anderer `Content-Type` und `format` ergeben 415 `{ fehler: 'Bitte ein PNG- oder JPEG-Bild wählen' }`, Überschreitungen von Parser oder `zu-gross` ergeben 413 `{ fehler: 'Das Bild ist zu groß (höchstens 1 MB)' }`.
  - `DELETE /einstellungen/logo` → 200 `{ logoStand: null }`, auch ohne vorhandenes Logo.

- [ ] **Step 1: Tests schreiben.**
  - Eine Leitung liest und ändert alle vier Felder, und `GET /verein` zeigt danach den neuen Anzeigenamen.
  - Ein Jugendleiter ohne `EINSTELLUNGEN` bekommt auf allen vier Routen 404.
  - `PATCH` mit `{ slug: 'neu' }` und mit `{ status: 'GESPERRT' }` ergibt 400, Slug und Status sind unverändert.
  - 25 Zeichen im Anzeigenamen, `farbe: 'blau'` und 501 Zeichen Kontakt ergeben jeweils 400 mit `feld`.
  - Upload eines PNG ergibt 200, `VereinLogo` existiert und `logoStand` ist gesetzt. Ein zweiter Upload ersetzt das Logo.
  - Upload von Text mit `Content-Type: image/png` ergibt 415, ebenso `Content-Type: image/gif`, ein vorhandenes Logo bleibt unverändert.
  - 1,1 MB ergeben 413, das vorhandene Logo bleibt.
  - `DELETE` entfernt das Logo.
  - Ein Upload ohne `Origin` ergibt 403 (`pruefeUrsprung` wie bisher). Ein Upload ohne das Recht wird abgelehnt, bevor der Body gelesen wird: Mit 1,1 MB ohne Recht kommt 404, nicht 413.
  - Mandanten-Fälle für alle vier Routen: Mit Sitzung im eigenen Verein und Slug des fremden Vereins kommt 401 oder 404, und am fremden Verein ändert sich nichts.
- [ ] **Step 2:** `pnpm nx run jufi:test-server --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Für den Upload `router.put('/einstellungen/logo', brauchtMitglied, express.raw({ type: ['image/png', 'image/jpeg'], limit: LOGO_MAX_BYTES }), handler)`. Ein leerer Body (anderer Typ) ergibt 415. Das Recht wird **vor** dem Parser geprüft, damit niemand ohne Recht 1 MB hochladen kann. Geschrieben wird mit `db.vereinLogo.upsert` und `db.verein.update`. Kommentar zur 1-MB-Grenze nur an dieser Route: Der globale JSON-Parser (100 KB) bleibt unberührt, weil `express.json` keine Bilder liest.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Vereinseinstellungen: lesen, aendern, Logo hoch- und herunternehmen`

---

### Task 7: Ansprechpartner und Hinweis auf Notfall-Links (Server)

**Files:**

- Create: `apps/jufi/src/server/mitglieder/start.ts`, Test `start.spec.ts`
- Modify: `apps/jufi/src/server/verein.ts`, `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Produces:
  - `GET /ansprechpartner` (jede angemeldete Person) → `{ ansprechpartner: { id: string; vorname: string; nachname: string }[] }`. Das sind alle nicht entfernten Personen mit mindestens einem Recht, sortiert nach Nachname und Vorname (`localeCompare(…, 'de')`).
  - `GET /verwaltung/hinweise` (nur `JUGENDLEITER_RECHTE`, sonst 404) → `{ notfallLinks: { am: string; vorname: string | null; nachname: string | null }[] }`. Das sind die `AdminProtokoll`-Einträge mit `aktion: 'NOTFALL_LINK'` und `vereinId` des Slugs, deren `zeitpunkt` höchstens 30 Tage vor `deps.jetzt()` liegt, die neuesten zuerst. Die Namen kommen über `vereinDb`, für einen Grabstein oder eine fehlende Person sind sie `null`.
  - `export const NOTFALL_HINWEIS_TAGE = 30;`

- [ ] **Step 1: Tests schreiben.**
  - Ein Kind sieht die Leitung und einen Betreuer als Ansprechpartner, aber keine Mutter ohne Rechte und keinen Grabstein.
  - Die Liste ist sortiert.
  - Hinweise: Ein Notfall-Link vor 29 Tagen erscheint mit Namen, einer vor 31 Tagen nicht.
  - Ein Notfall-Link im fremden Verein erscheint nicht.
  - Für eine inzwischen entfernte Person sind die Namen `null`.
  - Ein Jugendleiter ohne `JUGENDLEITER_RECHTE` bekommt 404, ohne Sitzung kommt 401.
  - Mandanten-Fälle: `GET /ansprechpartner` mit dem Slug eines fremden Vereins ergibt 401 (die Sitzung gilt nur im eigenen). `GET /verwaltung/hinweise` zeigt nie den Notfall-Link des fremden Vereins.
- [ ] **Step 2:** `pnpm nx run jufi:test-server --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Das Protokoll liest `deps.prisma.adminProtokoll.findMany({ where: { vereinId: verein.id, aktion: 'NOTFALL_LINK', zeitpunkt: { gte } }, select: { zeitpunkt: true, betroffenePersonId: true }, orderBy: { zeitpunkt: 'desc' } })`. Der Kommentar nennt Entscheidung 2 und warum `vereinDb` hier nicht reicht.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Start: Ansprechpartner und Notfall-Link-Hinweis der letzten 30 Tage`

---

### Task 8: Meine Daten herunterladen (Server)

**Files:**

- Create: `apps/jufi/src/server/mitglieder/datenauszug.ts`, Test `datenauszug.spec.ts`
- Modify: `apps/jufi/src/server/verein.ts`, `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Produces: `GET /ich/daten` (angemeldet) → 200 `application/json; charset=utf-8` mit `Content-Disposition: attachment; filename="jufi-meine-daten-<slug>-<JJJJ-MM-TT>.json"` und `Cache-Control: no-store`:
  ```ts
  interface Datenauszug {
  	erstelltAm: string;
  	verein: { name: string; anzeigename: string };
  	person: { vorname; nachname; art; geburtsdatum: string | null; email: string | null; jugendsprecher: boolean | null; rechte: string[]; angelegtAm: string };
  	zugang: { anmeldename: string | null; passwortGesetzt: boolean; totpAktiv: boolean; angelegtAm: string; letzteAnmeldungAm: string | null } | null;
  	passkeys: { name: string; angelegtAm: string; zuletztGenutztAm: string | null }[];
  	sitzungen: { zuletztGesehen: string; ablauf: string; geraet: string | null }[];
  	familie: { vorname: string; nachname: string; beziehung: string; beziehungFreitext: string | null; erziehungsberechtigt: boolean; rolle: 'kind' | 'bezugsperson' }[];
  	untergruppen: string[];
  	einwilligungen: { kind: string; art: string; textVersion: string; erteiltAm: string; widerrufenAm: string | null; erteiltVon: string }[];
  }
  ```
  `einwilligungen` umfasst die von dieser Person erteilten und, bei Jungfischern, die für sie erteilten. `erteiltVon` ist `'ich'` oder Vor- und Nachname, `kind` ist Vor- und Nachname. Später ergänzen weitere Teilprojekte ihre Felder.

- [ ] **Step 1: Tests schreiben.**
  - Für eine Mutter mit Passkey, Passwort, zwei Sitzungen, einem Kind in einer Untergruppe und einer erteilten Einwilligung sind alle Felder befüllt, und der Header passt.
  - Für das Kind enthält `einwilligungen` die der Mutter mit `erteiltVon: 'Mara Muster'`.
  - Der serialisierte Text enthält keinen der Schlüssel `passwortHash`, `totpGeheimnis`, `tokenHash`, `publicKey`, `credentialId`, `counter` und keinen Hash-Wert aus der Datenbank (Stichprobe: `tokenHash` der Sitzung kommt im Text nicht vor).
  - Ein entferntes Familienmitglied fehlt.
  - Ohne Sitzung kommt 401.
  - Mandanten-Fall: Mit dem Slug des fremden Vereins kommt 401.
- [ ] **Step 2:** `pnpm nx run jufi:test-server --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Jedes Feld ausdrücklich über `select`, nie ganze Zeilen weiterreichen. Kommentar: Felder werden aufgebaut statt gestrichen (Muster aus Etappe 4), damit ein neues Geheimnis-Feld nie versehentlich im Auszug landet.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Profil: Meine Daten als JSON herunterladen`

---

### Task 9: Mitglieder-Hülle und neue Routen

**Files:**

- Create: `apps/jufi/src/app/verein/mitglieder-huelle.ts`, Test `mitglieder-huelle.spec.ts`
- Modify: `apps/jufi/src/app/app.routes.ts`, `apps/jufi/src/app/verein/profil.ts`, `apps/jufi/src/app/verein/jungfischer.ts` (Links „← Zur Startseite“ werden „← Mehr“, eigenes `<main>`, Rand und Höchstbreite entfallen), alle Specs mit `/jungfischer`
- Move: `apps/jufi/src/app/seiten/verein-start.ts` → `apps/jufi/src/app/verein/start.ts` (samt Spec), Abmelden wandert in Task 11 nach Mehr

**Interfaces:**

- Consumes: `VereinKontext` (Task 3), `MitgliedSitzung`, `IconComponent`.
- Produces: Routen unter `:slug`:
  ```
  { path: '', component: MitgliederHuelle, canActivate: [mitgliedAngemeldet], children: [
  	{ path: '', pathMatch: 'full', loadComponent: StartComponent },
  	{ path: 'mehr', loadComponent: MehrComponent },          // Task 11
  	{ path: 'profil', loadComponent: ProfilComponent },
  	{ path: 'meine-jungfischer', loadComponent: JungfischerComponent },
  ] }
  ```
  Die Hüllen-Route steht unter `:slug` **nach** `anmelden`, `einladung`, `zugang-verloren` und `nicht-gefunden`. Diese bleiben ohne Hülle und ohne Wächter, und eine leere Eltern-Route vor ihnen ließe den Router erst dort suchen. Die Route `verwaltung` folgt in Task 12. Die Hülle zeigt einen Kopf (Logo 32 px aus `logoUrl` oder ein Initialen-Abzeichen in der Akzentfarbe, dazu den Anzeigenamen), `<main>` mit `<router-outlet />` und `<nav class="leiste" aria-label="Hauptnavigation">` mit genau zwei Einträgen, „Start“ (Icon `start`) und „Mehr“ (Icon `mehr`, aktiv auch auf `profil` und `meine-jungfischer`).

- [ ] **Step 1: Tests schreiben.**
  - Auf `/demo` stehen zwei Links in der Leiste, und „Start“ hat `aria-current="page"`.
  - Auf `/demo/profil` und `/demo/meine-jungfischer` ist „Mehr“ aktiv.
  - Mit `logoStand` zeigt der Kopf `<img src="/demo/api/v1/verein/logo?v=…">`, ohne zeigt er das Abzeichen „JD“.
  - Lehnt `GET /verein` mit 404 ab, zeigt die Hülle `jf-nicht-gefunden` ohne Leiste.
  - Bei einem Ladefehler zeigt sie „Keine Verbindung – nochmal versuchen“ mit Knopf.
  - `/demo/jungfischer` ergibt die Nicht-gefunden-Seite.
- [ ] **Step 2:** `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Vorlage ist `apps/entwurf/src/app/mitglieder/huelle.ts` ohne Testmodus-Band (`--band-hoehe` entfällt, oben bleibt `var(--sicher-oben)`), mit `grid-template-columns: repeat(2, 1fr)`. Kommentar: zwei Einträge in TP2 (Spec 6.2), Threads, Termine und Medien kommen mit ihren Teilprojekten. Spalte höchstens 480 px, auch am Desktop.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Mitglieder-Huelle: Kopf mit Logo, untere Leiste Start und Mehr`

---

### Task 10: Start

**Files:**

- Modify: `apps/jufi/src/app/verein/start.ts`, Test `start.spec.ts`; `apps/jufi/src/app/verein/mitglieder-api.ts` (`ansprechpartner(slug)`, `verwaltungsHinweise(slug)`, `Ansprechpartner`-Typ)

**Interfaces:**

- Consumes: `GET /ansprechpartner` (Task 7), `GET /meine-jungfischer` (`KindAnsicht`, Etappe 4), `GET /personen` (`PersonListe.warnhinweise`, Etappe 4), `MitgliedSitzung.ich`, `VereinKontext`.
- Produces: Die Startseite hat diese Abschnitte, jeweils als `jf-karte` und in dieser Reihenfolge:
  1. **Begrüßung:** Logo (64 px) oder Initialen-Abzeichen, „Hallo <Vorname>“, darunter der Anzeigename.
  2. **„Deine Jungfischer“** (nur `hatKinder`): eine Karte je Kind mit Name, Untergruppen, „Jugendsprecher/in“ bei Bedarf und dem Zugangsstand (`'Eigener Zugang eingerichtet' | 'Zugang erlaubt, noch nicht eingerichtet' | 'Ohne eigenen Zugang'`). Jede Karte verlinkt nach `meine-jungfischer`.
  3. **„In der Verwaltung warten“** (nur mit `MITGLIEDER`): „1 offene Einladung“ bzw. „<n> offene Einladungen“ und „1 Person mit Hinweis“ bzw. „<m> Personen mit Hinweis“ (Zeilen mit 0 entfallen) (mit Hinweis = mindestens ein Warnhinweis außer `EINLADUNG_OFFEN`), dazu bis zu fünf Namen mit ihrem ersten Hinweistext (Texte aus `verwaltung/texte.ts`) und dem Link „Zur Verwaltung“. Ist alles erledigt, steht dort „Gerade wartet nichts.“
  4. **„Ansprechpartner“**: die Namen als Liste.

- [ ] **Step 1: Tests schreiben.**
  - Eine Mutter mit einem Kind sieht Begrüßung, die Kind-Karte mit Zugangsstand, die Ansprechpartner und keinen Verwaltungsabschnitt (keine Anfrage an `/personen`).
  - Eine Leitung mit `MITGLIEDER` sieht die Zahlen 2 und 1 aus einer Liste mit zwei offenen Einladungen und einer Person ohne Familie, außerdem den Link `/demo/verwaltung`.
  - Ein Betreuer (nur `ANTWORTEN_DETAIL`) sieht keinen Verwaltungsabschnitt.
  - Ohne Kinder gibt es keine Anfrage an `/meine-jungfischer`.
  - Scheitert `/ansprechpartner`, zeigt nur dieser Abschnitt „Keine Verbindung – nochmal versuchen“, der Rest steht.
- [ ] **Step 2:** `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Jeder Abschnitt ist eine eigene `rxResource`, damit ein Fehler nur seinen Abschnitt trifft. Das Zählen ist eine reine Funktion `wartet(personen: PersonListe[]): { offeneEinladungen: number; mitHinweis: PersonListe[] }` in derselben Datei.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Start: Begruessung, eigene Jungfischer, Verwaltung wartet, Ansprechpartner`

---

### Task 11: Mehr und Datenauszug im Profil

**Files:**

- Create: `apps/jufi/src/app/verein/mehr.ts`, Test `mehr.spec.ts`
- Modify: `apps/jufi/src/app/verein/profil.ts` (Abschnitt „Meine Daten“), Test `profil.spec.ts`

**Interfaces:**

- Consumes: `ThemaWahlComponent` (`gestaltung/thema-wahl.ts`), `MitgliederApi.abmelden`, `MitgliedSitzung.ich`.
- Produces: Mehr ist eine Liste von Zeilen (Icon, Text, Pfeil) mit mindestens `var(--tippflaeche)` Höhe: „Profil“, „Meine Jungfischer“ (nur `hatKinder`), „Verwaltung“ (nur mit mindestens einem Recht), dann eine Karte „Darstellung“ mit `<jf-thema-wahl />` und „Gilt nur auf diesem Gerät.“, dann „Impressum“ (`/impressum`), „Datenschutz“ (`/datenschutz`) und „Abmelden“ (Knopf, Fehler sichtbar wie heute auf Start). Im Profil steht ein Abschnitt „Meine Daten“ mit dem Satz „Alles, was die App über dich speichert, als Datei.“ und `<a class="knopf" [href]="'/' + slug() + '/api/v1/ich/daten'" download>Meine Daten herunterladen</a>`.

- [ ] **Step 1: Tests schreiben.**
  - Ein Kind ohne Rechte und ohne Kinder sieht Profil, Darstellung, Impressum, Datenschutz und Abmelden, aber nicht Verwaltung und nicht Meine Jungfischer.
  - Eine Leitung mit Kindern sieht beide.
  - „Abmelden“ ruft `POST /abmelden` und navigiert nach `/demo/anmelden`.
  - Scheitert das Abmelden, steht der Fehlertext in `role="alert"`.
  - Im Profil hat der Link `href="/demo/api/v1/ich/daten"` und das Attribut `download`.
- [ ] **Step 2:** `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Vorlage `apps/entwurf/src/app/mitglieder/mehr.ts`. Abmelden zieht aus `start.ts` hierher um, wo es nicht mehr gebraucht wird.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Mehr: Profil, Meine Jungfischer, Verwaltung, Darstellung, Rechtstexte, Abmelden`

---

### Task 12: Verwaltungs-Hülle mit Seitenleiste und Admin-Hinweis

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/huelle.ts`, Test `huelle.spec.ts`
- Modify: `apps/jufi/src/app/app.routes.ts`, `apps/jufi/src/app/verein/verwaltung/{mitglieder,person-neu,personenseite,untergruppen,rechte}.ts` (eigenes `<main>`, „← Zur Startseite“ und die Knopfleiste zu Untergruppen und Rechten entfallen, „← Zur Mitgliederliste“ bleibt nur auf Personenseite und Person anlegen), deren Specs, `apps/jufi/src/app/verein/mitglieder-api.ts`

**Interfaces:**

- Consumes: `GET /verwaltung/hinweise` (Task 7), `VereinKontext`, `MitgliedSitzung.ich().person.rechte`.
- Produces: Routen:
  ```
  { path: 'verwaltung', component: VerwaltungsHuelle, canActivate: [mitgliedAngemeldet], children: [
  	{ path: '', pathMatch: 'full', loadComponent: MitgliederComponent },
  	{ path: 'neu', … }, { path: 'personen/:id', … }, { path: 'untergruppen', … },
  	{ path: 'rechte', … }, { path: 'einstellungen', loadComponent: EinstellungenComponent }, // Task 13
  ] }
  ```
  `withComponentInputBinding` reicht `slug` nicht an Kinder einer Eltern-Route mit Komponente weiter. Deshalb kommt `paramsInheritanceStrategy: 'always'` über `withRouterConfig` in `app.config.ts` dazu (Kommentar: sonst bräuchte jede Seite den Slug über `ActivatedRoute.parent`).

  Die Seitenleiste enthält, jeweils nur mit dem passenden Recht: „Mitglieder“ (jedes Recht), „Untergruppen“ (`MITGLIEDER`), „Jugendleiter & Rechte“ (`JUGENDLEITER_RECHTE`), „Vereinseinstellungen“ (`EINSTELLUNGEN`), danach „Zur App“ (`/<slug>`). Darüber stehen Logo und Anzeigename mit dem Zusatz „Verwaltung“. Unter 768 px klappt die Leiste in ein Menü (Knopf mit `aria-expanded`, `aria-controls`), Vorlage `apps/entwurf/src/app/verwaltung/huelle.ts` ohne Band. Für `JUGENDLEITER_RECHTE` steht über dem Inhalt je Notfall-Link ein Hinweis mit `role="status"`: „Der Plattform-Admin hat am <TT.MM.JJJJ> einen neuen Link für <Vorname> erzeugt.“, bei `null`-Namen „… für ein ehemaliges Mitglied …“. Wer kein Recht hat, sieht `jf-nicht-gefunden` ohne Leiste.

- [ ] **Step 1: Tests schreiben.**
  - Eine Leitung (alle Rechte) sieht vier Punkte und „Zur App“.
  - Ein Betreuer sieht nur „Mitglieder“ und „Zur App“ und schickt keine Anfrage an `/verwaltung/hinweise`.
  - Eine Person ohne Rechte sieht die Nicht-gefunden-Seite.
  - Unter 768 px Breite (`matchMedia` gestubbt) ist die Navigation erst nach einem Klick auf den Menüknopf sichtbar, und `aria-expanded` wechselt.
  - Zwei Hinweise erscheinen mit Datum und Namen, einer mit `null` heißt „ein ehemaliges Mitglied“.
  - `/demo/verwaltung/personen/x` zeigt die Personenseite in der Hülle mit aktivem Punkt „Mitglieder“.
  - Die vorhandenen Verwaltungs-Specs laufen unverändert weiter, abgesehen von den entfernten Links.
- [ ] **Step 2:** `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Ein Klick auf einen Punkt schließt das Menü (`NavigationEnd`). Den Hinweis auf „Am Desktop bequemer“ aus dem Entwurf gibt es nur unter 768 px.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Verwaltungs-Huelle: Seitenleiste nach Rechten, Menue am Handy, Notfall-Link-Hinweis`

---

### Task 13: Vereinseinstellungen (Oberfläche)

**Files:**

- Create: `apps/jufi/src/app/verein/verwaltung/einstellungen.ts`, Test `einstellungen.spec.ts`
- Modify: `apps/jufi/src/app/verein/mitglieder-api.ts` (`einstellungen`, `aendereEinstellungen`, `ladeLogoHoch(slug, datei: File)`, `entferneLogo`), `apps/jufi/src/app/gestaltung/farben.ts` (`farbeAngepasst(hex): { hell: boolean; dunkel: boolean }`, wahr, wenn `vereinsfarben(hex)[modus].akzent` von der normalisierten Eingabe abweicht) mit Test in `farben.spec.ts`

**Interfaces:**

- Consumes: Task 6, `VereinKontext.neuLaden()`, `ThemaService.setzeVereinsfarbe`, `vereinsfarben`, `farbeAngepasst`.
- Produces: Die Seite besteht aus drei Karten:
  - **Verein:** Anzeigename (`maxlength=24`, Zähler „n/24“), offizieller Name, Kontakt (`textarea`, `maxlength=500`), Slug nur lesend mit „Die Adresse lässt sich nicht ändern.“, Knopf „Speichern“.
  - **Vereinsfarbe:** `input type=color` mit Hex-Anzeige und zwei Mustern „Hell“ und „Dunkel“ mit `akzent`/`aufAkzent` aus `vereinsfarben`. Bei `farbeAngepasst` steht darunter „Für gute Lesbarkeit verwendet die App im <hellen|dunklen> Modus einen angepassten Ton.“ Die Live-Vorschau wirkt sofort in der ganzen App über `ThemaService.setzeVereinsfarbe`, „Speichern“ übernimmt sie. Verlässt man die Seite ohne Speichern, gilt wieder die gespeicherte Farbe (`DestroyRef`).
  - **Logo:** aktuelles Logo (96 px) oder Initialen-Abzeichen, `input type=file accept="image/png,image/jpeg"`, „Logo entfernen“. Eine Datei über 1 MB lehnt die Seite vor dem Hochladen mit dem Servertext ab, Fehler des Servers stehen in `role="alert"`.

  Nach jedem erfolgreichen Speichern oder Hochladen kommt `VereinKontext.neuLaden()` und eine Meldung (`MeldungService`) „Gespeichert“.

- [ ] **Step 1: Tests schreiben.**
  - Die Felder sind aus `GET /einstellungen` vorbelegt.
  - „Speichern“ schickt nur geänderte Felder per `PATCH`, und danach geht genau eine Anfrage an `/verein`.
  - Eine 400 mit `feld: 'anzeigename'` zeigt den Text am Feld.
  - Eine Farbänderung setzt `--akzent-hell` sofort. Beim Verlassen ohne Speichern ist wieder die alte Farbe gesetzt.
  - `farbeAngepasst('#ffff00').hell === true` (Gelb auf Weiß erreicht AA nie). `farbeAngepasst(AUSGANGSFARBE)` ist für beide Modi `false`, wenn `vereinsfarben` die Ausgangsfarbe unverändert lässt. Andernfalls nimmt der Test die Farbe, die `vereinsfarben(x).hell.akzent` für `x = AUSGANGSFARBE` liefert, als Eingabe (ein Fixpunkt).
  - Eine Datei mit 1,5 MB erzeugt keine Anfrage und zeigt die Meldung.
  - Ein PNG schickt `PUT /einstellungen/logo` mit `Content-Type: image/png` und dem `File` als Body.
  - Eine 415 zeigt den Servertext.
  - Ohne `EINSTELLUNGEN` (404 auf `GET /einstellungen`) zeigt die Seite „Nicht gefunden oder keine Berechtigung“.
- [ ] **Step 2:** `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Vorlage `apps/entwurf/src/app/verwaltung/einstellungen.ts`. Die Darstellungswahl gehört hier nicht hin, sie liegt unter Mehr.
- [ ] **Step 4:** Test erneut — Expected: PASS.
- [ ] **Step 5: Commit** `Vereinseinstellungen: Namen, Kontakt, Farbe mit Vorschau, Logo`

---

### Task 14: Plattformseite, Impressum und Datenschutz

**Files:**

- Modify: `apps/jufi/src/app/seiten/plattform-start.ts`, Test `plattform-start.spec.ts`
- Create: `apps/jufi/src/app/seiten/rechtstext.ts`, Test `rechtstext.spec.ts`, `apps/jufi/src/rechtstexte/impressum.md`, `apps/jufi/src/rechtstexte/datenschutz.md`, `apps/jufi/src/markdown.d.ts` (`declare module '*.md' { const text: string; export default text; }`)
- Modify: `apps/jufi/src/app/app.routes.ts` (`impressum`, `datenschutz` vor `admin`), `apps/jufi/project.json` (`"loader": { ".md": "text" }` in den Build-Optionen, gilt auch für `unit-test`), `package.json` (`marked`)

**Interfaces:**

- Produces: `RechtstextComponent` mit `input.required<'impressum' | 'datenschutz'>()` über Routen-`data` (`withComponentInputBinding` bindet `data`). Sie lädt das Markdown per dynamischem `import()` und rendert mit `marked.parse(text, { async: false })` in `[innerHTML]`. Oben steht „← JuFi App“ (`/`) bzw. „← Zurück“ (`history.back()`, wenn `history.length > 1`).
- Plattformseite: Überschrift „JuFi App“ und zwei bis drei Sätze: Die App ist für die Jugendarbeit von Vereinen gedacht, Vereine bekommen ihren Zugang über die Plattform, man meldet sich über den Einladungslink des eigenen Vereins an. Dazu Links „Zum klickbaren Entwurf“ (`/entwurf/`, normaler Link), „Impressum“ und „Datenschutz“. **Keine Liste von Vereinen.**
- Die Markdown-Gliederung hat nur Überschriften und Platzhalter in eckigen Klammern. Impressum: Anbieter, Kontakt, Verantwortlich nach § 18 Abs. 2 MStV. Datenschutz: Verantwortlicher, Welche Daten, Zweck und Rechtsgrundlage, Auftragsverarbeitung durch die Plattform, Speicherdauer, Ihre Rechte, Kontakt. Keine erfundenen Rechtsangaben.

- [ ] **Step 1: Tests schreiben.**
  - `/` zeigt drei Links und kein Element mit Vereinsnamen.
  - `/impressum` und `/datenschutz` zeigen ein `h1` aus dem Markdown.
  - Ein Wechsel `/demo` → `/impressum` entfernt die Vereinsfarbe (deckt Review Focus 5 mit ab).
- [ ] **Step 2:** `pnpm nx run jufi:test --skip-nx-cache` — Expected: FAIL.
- [ ] **Step 3: Implementieren.** Kommentar in `rechtstext.ts`: Das Markdown kommt aus dem Repo und ist vertrauenswürdig, Angulars Sanitizer läuft trotzdem. Verworfen: HTML-Dateien statt Markdown, weil der Eigentümer Markdown pflegt (Spec 2.3).
- [ ] **Step 4:** Test erneut, dazu `pnpm nx run jufi:build` — Expected: PASS, und `marked` liegt nicht im Startbündel (`initial` im Bau-Log ohne `marked`).
- [ ] **Step 5: Commit** `Plattformseite, Impressum und Datenschutz aus Markdown`

---

### Task 15: Playwright-Aufbau und Ende-zu-Ende-Ablauf

**Files:**

- Create: `apps/jufi-e2e/project.json`, `apps/jufi-e2e/playwright.config.ts`, `apps/jufi-e2e/tsconfig.json`, `apps/jufi-e2e/src/aufbau.ts` (globalSetup/-Teardown), `apps/jufi-e2e/src/hilfen.ts`, `apps/jufi-e2e/src/ablauf.spec.ts`
- Modify: `package.json` (`@playwright/test` als devDependency, Skript `"e2e": "nx run jufi-e2e:e2e"`), `.gitignore` (`apps/jufi-e2e/.zustand/`, `test-results/`, `playwright-report/`), `.prettierignore` nach Bedarf

**Interfaces:**

- Produces: Das Ziel `jufi-e2e:e2e` (`nx:run-commands`, `dependsOn: ["jufi:build", "cli:build"]`, `cache: false`) führt `playwright test -c apps/jufi-e2e/playwright.config.ts` aus. Konfiguriert sind nur Chromium und `workers: 1`, dazu zwei Projekte: `ablauf` und `layout` (Task 16) mit `dependencies: ['ablauf']`.
- Produces: `aufbau.ts`:
  1. `bereiteTestDatenbankVor('e2e')` aus `@jufi/db/testing` liefert die URL von `jufi_test_e2e`.
  2. Startet `node dist/apps/jufi/server/server.mjs` mit `PORT=4210`, `DATABASE_URL=<e2e>`, `BASIS_URL=http://localhost:4210`, je einem frisch erzeugten `SESSION_SECRET` und `TOTP_ENC_KEY` (`randomBytes(32).toString('base64')`), leeren `WEBAUTHN_*` und den SMTP-Werten für Mailpit (`localhost:1025`).
  3. Wartet auf `GET /healthz` 200 (höchstens 30 s).
  4. Ruft `node apps/cli/dist/main.js admin anlegen e2e-admin` mit derselben Umgebung auf und legt den Einrichtungslink aus der Ausgabe in `process.env.E2E_ADMIN_LINK`.
  5. Der Teardown beendet den Server.

  Die Umgebung der Kindprozesse hat Vorrang vor der `.env`, denn dotenv überschreibt nichts. Das prüft der Aufbau mit einer Abfrage von `/healthz`, die die neue Datenbank meldet, oder mit der Ausgabe des CLI.
- Produces: `hilfen.ts` mit `passkeyGeraet(context: BrowserContext): Promise<void>`. Es richtet über CDP `WebAuthn.enable` und `WebAuthn.addVirtualAuthenticator({ options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })` ein, je Person ein eigener Kontext. Außerdem `TESTPASSWORT` (im Aufbau zufällig erzeugt, nie ein echtes Passwort) und `ZUSTAND = 'apps/jufi-e2e/.zustand'`.

- [ ] **Step 1: Ablauf schreiben** (`test.describe.serial`), nur erfundene Personen:
  1. **Admin:** Einrichtungslink öffnen, Passwort setzen, TOTP überspringen, „Verein anlegen“ ausfüllen (offizieller Name „Fischereiverein Musterbach e.V.“, Anzeigename „Jungfischer Musterbach“, Slug `musterbach`, Farbe `#1d4ed8`, erste Leitung „Lea Leitner“, `lea@example.test`). Den Einladungslink von der Seite lesen.
  2. **Leitung:** Link öffnen, mit Passkey annehmen. Auf Start „Hallo Lea“ prüfen und `aria-current` auf „Start“. Über Mehr zur Verwaltung, dort Jungfischerin „Mia Muster“ (Geburtsdatum `2015-05-01`) anlegen und auf ihrer Seite „Mara Muster“ als neue Familie hinzufügen (Mutter, erziehungsberechtigt). Für Mara eine Einladung erzeugen und den Link lesen. Auf Start der Leitung steht danach „1 offene Einladung“.
  3. **Mutter:** Link öffnen, für Mia einwilligen, „eigener Zugang“ ja, E-Mail bestätigen, Passwort `TESTPASSWORT`. Auf Start erscheint die Karte „Mia“. Unter Meine Jungfischer für Mia „Neuen Link erzeugen“ und den Link lesen.
  4. **Kind:** Link öffnen, Anmeldename `mia`, Passkey einrichten, Start zeigt „Hallo Mia“. Mehr → Abmelden führt zur Anmeldung, „Mit Passkey anmelden“ zurück zum Start.
  5. **Ohne Sitzung:** `/musterbach/profil` öffnen, das führt zu `anmelden?weiter=…`. Als Mutter per Passwort anmelden, das landet auf `/musterbach/profil`.
  6. Die Sitzungen von Leitung, Mutter und Kind landen als `storageState` in `ZUSTAND/<rolle>.json`, die ID von Mia in `ZUSTAND/ids.json`.
- [ ] **Step 2:** `pnpm run db:up && pnpm exec playwright install chromium && pnpm run e2e` — Expected: zuerst FAIL an der ersten Stelle, die noch fehlt, oder an Selektoren. Die Selektoren richten sich nach Rollen und Beschriftungen (`getByRole`, `getByLabel`), nicht nach CSS-Klassen.
- [ ] **Step 3: Nachziehen**, bis der Ablauf grün ist. Ein Fehler in der App wird in der App behoben und bekommt dort einen Unit- oder API-Test, nicht nur einen Umweg im E2E-Test.
- [ ] **Step 4:** `pnpm run e2e` zweimal hintereinander — Expected: beide Male PASS, die Datenbank wird jedes Mal frisch angelegt.
- [ ] **Step 5: Commit** `E2E: Playwright mit virtuellem Authenticator, Ablauf von Verein bis Kind`

---

### Task 16: Layouts gemessen

**Files:**

- Create: `apps/jufi-e2e/src/layout.spec.ts`, `apps/jufi-e2e/src/messen.ts`

**Interfaces:**

- Consumes: `ZUSTAND/*.json` aus Task 15, `kontrast` aus `apps/jufi/src/app/gestaltung/farben.ts` (in den Test importiert).
- Produces: `messen.ts`:
  - `async function keinWaagrechtesScrollen(page): Promise<void>` mit `document.documentElement.scrollWidth <= window.innerWidth`.
  - `async function tippflaechen(page, mindestens = 44): Promise<string[]>` liefert Text oder Beschriftung jedes sichtbaren `button`, `.knopf`, `nav a`, `input:not([type=checkbox]):not([type=radio])`, `select`, dessen `getBoundingClientRect().height < mindestens` ist.
  - `async function leisteVerdecktNichts(page): Promise<void>` scrollt ans Ende und prüft, dass `bottom` des letzten Kinds von `main` höchstens `top` der `.leiste` ist.
  - `async function lesbar(page): Promise<number>` liefert den Kontrast von `h1`-Farbe zu `body`-Hintergrund.

- [ ] **Step 1: Tests schreiben.** Je Kombination aus Viewport `{375×812, 1280×800}` und `colorScheme` `{light, dark}` (`test.use`) und je Seite:
  - Öffentlich: `/`, `/impressum`, `/datenschutz`, `/musterbach/anmelden`.
  - Leitung: `/musterbach/`, `/musterbach/mehr`, `/musterbach/profil`, `/musterbach/verwaltung`, `/musterbach/verwaltung/personen/<Mia>`, `/musterbach/verwaltung/untergruppen`, `/musterbach/verwaltung/rechte`, `/musterbach/verwaltung/einstellungen`.
  - Mutter: `/musterbach/`, `/musterbach/meine-jungfischer`.
  - Kind: `/musterbach/`.

  Geprüft wird je Seite:
  - kein waagrechtes Scrollen;
  - `lesbar ≥ 4.5`;
  - bei 375 und auf Mitgliederseiten keine zu kleinen Tippflächen und `leisteVerdecktNichts`;
  - auf Verwaltungsseiten bei 1280 eine sichtbare Seitenleiste mit `getBoundingClientRect().width === 248`, bei 375 ein sichtbarer Menüknopf und eine verborgene Navigation;
  - im dunklen Modus ein anderer `body`-Hintergrund als im hellen (verglichen über die beiden Läufe derselben Seite).
- [ ] **Step 2:** `pnpm run e2e` — Expected: Befunde, wo die Gestaltung noch nicht passt.
- [ ] **Step 3: Gestaltung nachziehen**, bis alles grün ist, nur über Tokens und die betroffenen Bauteile. Bleibt eine Stiländerung ohne Wirkung, zuerst das Bau-Log prüfen (CLAUDE.md).
- [ ] **Step 4:** `pnpm run e2e` — Expected: PASS.
- [ ] **Step 5: Commit** `E2E: Layouts bei 375x812 und 1280x800, hell und dunkel, gemessen`

---

### Task 17: Demo, Doku und Spec nachziehen

**Files:**

- Modify: `apps/cli/src/demo.ts` (die Leitung des Demo-Vereins bekommt `EINSTELLUNGEN` und einen Kontakttext, falls nicht vorhanden; kein Logo, damit das Initialen-Icon zu sehen ist), `README.md` (Abschnitte „Ende-zu-Ende-Test“ mit `pnpm run e2e` und einmalig `pnpm exec playwright install chromium`, „Rechtstexte“), `CLAUDE.md` (Stand: Etappe 5; `pnpm run e2e` braucht `db:up` und einen Bau), Spec `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md`

**Interfaces:**

- Spec ändern:
  - Kopfzeile auf „nachgezogen mit Etappe 5“.
  - 2.4: `meine-jungfischer`, `weiter` mit Verweis auf `sichererWeiterPfad`.
  - 3.2 `VereinLogo`: neu kodiert, höchstens 1024 px, ohne Metadaten.
  - 6.2: Start mit „In der Verwaltung warten“ nur mit `MITGLIEDER`, Datenauszug als Link.
  - 6.3: Hinweis 30 Tage, Lesen des Protokolls als benannte Ausnahme.
  - 6.4: Manifest-Link zur Laufzeit; Manifest, Icons und Logo öffentlich; Initialen-Icon mit DejaVu Sans.
  - 9: Playwright in Etappe 5, `pnpm run e2e`, nicht in `pnpm test`.
  - Je Entscheidung mit ihrer verworfenen Alternative (Liste oben).

- [ ] **Step 1:** Demo anpassen. Test in `apps/cli/src/demo.spec.ts`: Die Leitung hat `EINSTELLUNGEN`.
- [ ] **Step 2:** `pnpm nx run cli:test --skip-nx-cache` — Expected: PASS.
- [ ] **Step 3:** README, CLAUDE.md und Spec wie oben.
- [ ] **Step 4:** `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache && pnpm run e2e && pnpm exec prettier --check .` — Expected: alles grün.
- [ ] **Step 5: Von Hand prüfen** (erfundene Daten, `pnpm run demo`, `pnpm run dev`) in Chrome DevTools unter Application → Manifest: Für `/demo/` werden Name, Icons und `start_url` erkannt, und „Installieren“ wird angeboten. Danach Vereinsfarbe ändern, Logo hochladen und das Icon im Manifest prüfen.
- [ ] **Step 6: Commit** `Etappe 5: Demo, Doku, Spec-Nachzug`
