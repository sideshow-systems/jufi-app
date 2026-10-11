# JuFi App — was in diesem Projekt gilt

Die **Begründungen** stehen in den Spezifikationen unter `docs/superpowers/specs/`; hier steht nur, was beim Arbeiten sofort schiefgeht, wenn man es nicht weiß. Vorlage für Stack und Stil ist `../hwyd`.

## Stand

- `apps/entwurf` ist der klickbare Entwurf (Teilprojekt 1) und **Wegwerfcode**. Erhalten bleiben das Workspace-Grundgerüst, die Gestaltung und die Erkenntnisse aus den Rückmeldungen.
- Lokal: `pnpm run dev:entwurf` → http://localhost:4300/entwurf/

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
- **Vor jedem `git push`: `pnpm exec prettier --check .`** — weder Build noch Tests prüfen das.
- `git push` und Deployment nur, wenn der Eigentümer es ausdrücklich sagt. Vor einem Deployment schaut er sich den Stand lokal an.
