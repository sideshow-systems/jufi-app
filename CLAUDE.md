# JuFi App — was in diesem Projekt gilt

Die **Begründungen** stehen in den Spezifikationen unter `docs/superpowers/specs/`; hier steht nur, was beim Arbeiten sofort schiefgeht, wenn man es nicht weiß. Vorlage für Stack und Stil ist `../hwyd`.

## Stand

- `apps/entwurf` ist der klickbare Entwurf (Teilprojekt 1) und **Wegwerfcode**. Erhalten bleiben das Workspace-Grundgerüst, die Gestaltung und die Erkenntnisse aus den Rückmeldungen.
- Lokal: `pnpm run dev:entwurf` → http://localhost:4300/entwurf/
- `apps/jufi` ist die **echte App** (Teilprojekt 2). Lokal: `pnpm run dev` → http://localhost:4200/ (Demo-Verein: `pnpm run demo`, dann `/demo`).
- Etappe 3 ist da: Mitglieder nehmen Einladungen an und melden sich unter `/<slug>/anmelden` an (Passkey, Passwort, TOTP, „Passwort vergessen?"). Mails fängt lokal Mailpit ab (http://localhost:8025, braucht `pnpm run db:up`).
- Etappe 4 ist da: Mitglieder pflegen (Personen, Familie, Untergruppen, Rechte, Einwilligung, „Meine Jungfischer"). Der Demo-Verein (`pnpm run demo`) bringt dafür Untergruppen, Familien, ein Kind ohne Einwilligung und eines, das morgen volljährig wird.
- Etappe 5 ist da: Oberflächen, PWA-Manifest, Rechtstexte (nur Platzhalter, README „Rechtstexte“) und Ende-zu-Ende-Test. `pnpm run e2e` braucht `pnpm run db:up`, baut selbst, läuft nicht in `pnpm test`; einmalig `pnpm exec playwright install chromium`, Port 4210 muss frei sein.
- Etappe 6 ist da: Sicherung (täglich 03:40, restic), Restore-Probe, Rückfall, echter Mailversand per Schalter, App auf test.jufi-app.de. Offen bis zur Einladung der Jugendleiter: Rechtstexte und Einwilligungstext (`tools/pruefe-texte.sh`).
- TP3 Etappe 1 ist da: Datenmodell für Threads und Regeln in `libs/domain/src/threads` und `module/`; jeder Verein hat seinen Jugendsprecher-Austausch. Schreibende Thread-Routen laufen über `mitAenderung` (`@jufi/db`).
- TP3 Etappe 2 ist da: Thread-Seite `/<slug>/t/<id>-<titel>` mit Modulen, Antworten und Verlauf; `pnpm run demo` gibt die Thread-Adressen aus. Antworttypen der Thread-API stehen in `@jufi/domain` (`threads/ansicht.ts`, `threads/verlauf.ts`).
- TP3 Etappe 3 ist da: Threads anlegen und verwalten unter `/<slug>/verwaltung/threads` (Editor mit Vorschau, Entwurf, Veröffentlichen, Archiv, Anpinnen, Löschen, Antworten-Übersicht mit Nachtragen). Was ein Entwurf ist und was sich ändert, entscheiden `entwurf.ts` und `vergleich.ts` in `@jufi/domain`.
- Deployment der echten App: `pnpm run deploy:app` nach https://test.jufi-app.de (`app-test` leitet nur noch um; README, „Deployment der echten App“). Erster Admin dort: `docker compose exec jufi node apps/cli/dist/main.js admin anlegen <name>`; Mails per `ssh -L 8025:127.0.0.1:8025`.
- Ersten Admin lokal anlegen: `pnpm run cli admin anlegen <name>` gibt den Einrichtungslink aus (braucht `BASIS_URL` in der `.env`).
- Nach dem Klonen und nach jeder Schemaänderung `pnpm run db:generate` — der Prisma-Client liegt nicht im Repo.
- Tests brauchen laufendes Postgres: erst `pnpm run db:up`. Jedes Projekt hat seine Testdatenbank `jufi_test_<projekt>`.
- Vereinsdaten in Vereins-Routen **nur** über `vereinDb` (setzt den Verein in jede Abfrage); der schlichte `PrismaClient` ist Plattform-Operationen vorbehalten (Admin, CLI).

## Sprache und Ton

- Code-Kommentare, Commit-Nachrichten, Spezifikation und Oberfläche sind **deutsch**. Bezeichner im Code sind gemischt (englische Fachbegriffe, deutsche Domänenwörter) — der Umgebung folgen, nicht vereinheitlichen.
- **Auch die Antworten im Chat sind deutsch.**
- Kommentare erklären **warum**, nie was. Wo eine Entscheidung eine verworfene Alternative hat, gehört die Alternative mit ihrem Grund in den Kommentar.
- Commit-Nachrichten sind ASCII (Umlaute umschrieben: `Rueckmeldung`, `Aufloesung`).

## Einrückung

Überall **Tabs**. Ausnahmen, alle erzwungen: YAML (verbietet Tabs), `schema.prisma` (`prisma format` schreibt zwei Leerzeichen), `package.json` (pnpm normalisiert) und Markdown.

## Angular

- **Keine Backticks in Kommentaren innerhalb von `template:`/`styles:`.** Die Vorlagen sind Template-Literale; ein Backtick im Kommentar beendet das Literal und erzeugt eine Lawine aus NG1002/TS1005/TS2304.
- Vorlagen und Stile stehen **inline** im Bauteil, Steuerfluss als `@if`/`@for`/`@switch`, Zustand als Signale, `changeDetection: OnPush`. Keine `*ngIf`-Direktiven, keine separaten `.html`-Dateien.
- Bleibt eine Stiländerung ohne Wirkung: **erst die Server-Logs lesen.** Meist ist der Bau gescheitert und das Stylesheet ist noch das alte.
- Ein Angular-Wirt ohne eigenen Stil ist `display: block` und erbt kein `gap` vom Elterngitter.

## Fachliche Regeln

- Regeln sind reine Funktionen ohne Angular-Abhängigkeit und bekommen `jetzt: Date` als Parameter — nie `new Date()` im Regelcode. Im Entwurf ist das Datum auf den Bezugstag eingefroren.
- Was eine Person nicht sehen darf, ist für sie „nicht gefunden" (404 statt 403, Rahmen-Spec 8).

## Prüfen im Browser

- Nur mit **erfundenen** Daten, nie mit echten Daten der Jugendgruppe.
- Gemessen statt betrachtet: `getBoundingClientRect`, `scrollWidth`. Gerätemaß 375 × 812, Verwaltung 1280 × 800, jeweils hell und dunkel.

## Was nachweislich stolpert

- **`pnpm run deploy:entwurf`, nie `pnpm deploy`.** Letzteres ist pnpms eingebautes Workspace-Deploy.
- **`pnpm run deploy:app`, nie `pnpm deploy`.** Gleicher Grund. Probelauf: `pnpm run deploy:app --dry-run` (braucht `pnpm run db:up` und Docker).
- **Vor jedem Deploy der echten App liegt auf dem Server `jufi-tools`** (`tools/install-backup.sh`), sonst bricht Tor 5 ab.
- **`restic_env` kennt nur `JUFI_RESTIC_*`.**
- **`apps/jufi/src/server.ts` läuft auch beim Bau** — Angular führt sie zur Routenextraktion in einem Worker-Thread aus. Alles mit Umgebung, Datenbank oder Nebenwirkung gehört in `betriebsApp()` (nur im Hauptthread), sonst scheitert der Docker-Bau, der weder `.env` noch Datenbank hat.
- **Neue Domain der App** braucht einen Eintrag in `security.allowedHosts` (`apps/jufi/project.json`) und damit ein neues Image; sonst antwortet jede Seite mit 400, während `/healthz` grün bleibt.
- **Entscheidungen über Vereinsdaten, die „angenommen oder nicht" lauten** (Einlösen, Erneuern, Notfall-Link, Slug-Korrektur), beginnen mit `sperreVereinszeile`. Ohne diese Sperre überholen sich zwei gleichzeitige Anfragen.
- **Vor jedem `git push`: `pnpm exec prettier --check .`** — weder Build noch Tests prüfen das.
- `git push` und Deployment nur, wenn der Eigentümer es ausdrücklich sagt. Vor einem Deployment schaut er sich den Stand lokal an.
