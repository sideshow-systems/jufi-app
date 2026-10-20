# JuFi TP2 Etappe 6 — Betrieb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die echte App ist betriebsreif, bevor die drei echten Jugendleiter eingeladen werden: tägliche verschlüsselte Sicherung außer Haus mit geprobter Wiederherstellung, ein Dump vor jeder Migration, ein Rückfallskript, echter Mailversand (umschaltbar), die App auf `test.jufi-app.de` mit dem Entwurf unter `/entwurf`, ein im Image geprüftes Initialen-Icon und Prüfskripte für Betrieb, Mail und offene Rechtstexte.

**Architecture:** Alles Neue sind Skripte unter `tools/` nach dem Muster von `../hwyd/tools/` (Sicherung, Restore-Probe, Rückfall, Installation des Zeitplans) und Änderungen an den versionierten Compose-Blöcken unter `deploy/`. Die Sicherungsskripte laufen auf dem Server, nur mit `JUFI_`-Variablen aus der geteilten `.env` und nur mit den eigenen Dienstnamen. Bewiesen wird jedes Skript zuerst **lokal** gegen eine Wegwerf-Compose-Datei (`tools/probe-sicherung.sh`) und erst in der Abnahme auf dem Server. App-Code ändert sich nur in `apps/jufi/project.json` (`allowedHosts`).

**Tech Stack:** Bash, Docker/Compose, `pg_dump`/`pg_restore` (Postgres 17), restic (nur auf dem Server), Traefik-Labels, Node-Einzeiler mit `nodemailer` und `sharp` (beide im Image), `dig`.

**Spec:** `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md`, Abschnitte 1.1/1.2 (Ergebnis, echte und erfundene Daten), 2.3 (Domains und Routing), 6.4 (Icons), 8.1 bis 8.4 (Dienste, Auslieferung, Sicherung, Mail), 8.6 (Texte vom Eigentümer). Vorlagen für die Skripte: `../hwyd/tools/{_config,backup,install-backup,restore-test,rollback}.sh` und `../hwyd/deploy/hwyd-backup.cron`. Bestand in diesem Repo: `tools/deploy.sh`, `tools/_config.sh`, `tools/deploy-entwurf.sh`, `deploy/jufi-services.yml`, `deploy/jufi-entwurf.yml`, `deploy/nginx-entwurf.conf`, `deploy/env.jufi.example`.

## Entscheidungen, die die Spec nachziehen

Der Plan trifft diese Entscheidungen, Task 11 trägt sie in die Spec ein. Jede ist vom Eigentümer umstoßbar, bevor die Abnahme beginnt.

1. **Die App zieht auf `test.jufi-app.de`** (Spec 2.3), der Entwurf auf `test.jufi-app.de/entwurf`. `app-test.jufi-app.de` war die Zwischenlösung und leitet danach dauerhaft (301, mit Pfad und Abfrage) auf `test.jufi-app.de` um, wie `jufi-app.sideshow-systems.de` beim Entwurf. **Preis:** Passkeys hängen an der Domain (`WEBAUTHN_RP_ID`). Alle auf `app-test` eingerichteten Passkeys sind danach wertlos; Passwort und TOTP bleiben. Betroffen sind nur Testzugänge, denn echte Jugendleiter sind noch nicht eingeladen. Verworfen: beide Domains parallel bedienen, weil eine App nur eine `rpId` hat.
2. **Mailpit bleibt die Voreinstellung, echter Versand ist ein Schalter.** Im Compose-Block lesen `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` und `SMTP_PASS` aus `JUFI_SMTP_*` und fallen ohne (oder bei leerem) `JUFI_SMTP_HOST` auf `jufi-mailpit:1025` zurück. Ein Deploy ändert das Verhalten also nie von selbst; der Eigentümer legt die Zugangsdaten auf dem Server in die `.env`, wenn er so weit ist. `jufi-mailpit` bleibt als Rückfall erhalten und fällt erst mit der Live-VM weg (Teilprojekt 6). Verworfen: Mailpit jetzt entfernen, dann wäre der erste Fehler im SMTP-Zugang ein Ausfall der Einladungen.
3. **Sicherung nach HWYD-Muster, aber mit eigenen Namen:** eigenes restic-Repository mit eigenem Passwort (`JUFI_RESTIC_REPOSITORY`, `JUFI_RESTIC_PASSWORD`), Aufbewahrung **7 täglich / 4 wöchentlich / 6 monatlich** (Spec 8.3; HWYD hält 12 Monate), Lauf um 03:40, Protokoll `/var/log/jufi-backup.log`, Werkzeuge auf dem Server unter `/home/paperless/paperless-ngx/jufi-tools`, Dumps unter `jufi-backups`. `restic_env` übernimmt **nur** die `JUFI_`-Namen und fällt anders als in HWYD nicht auf ein blankes `RESTIC_REPOSITORY` zurück: Die `.env` ist geteilt, und ein fremdes unpräfixiertes Repository würde sonst still das Ziel dieser Sicherung.
4. **Kein Deploy ohne Dump.** `tools/deploy.sh` zieht nach dem Rauchtest und vor dem Übertragen einen geprüften Dump (ohne restic) und bricht ab, wenn das scheitert (Spec 8.2). Fehlen die Sicherungsskripte auf dem Server, bricht schon Tor 5 ab und verweist auf `tools/install-backup.sh`.
5. **`tools/rollback.sh` ist doch da** (Spec 8.2). Der Kommentar am Ende von `tools/deploy.sh` („Kein rollback.sh wie in HWYD“) war eine Etappe-1-Annahme und wird mit Task 5 ersetzt. Das Skript bewacht die Grenze der Spec selbst: Unterscheiden sich `prisma/migrations` zwischen Zielstand und `HEAD`, verweigert es den Rückfall, es sei denn, `--trotz-migration` steht dabei. Verworfen: ein Rückfall ohne Wächter, dann entscheidet im Notfall niemand mehr, ob das alte Image mit dem neuen Schema läuft.
6. **Die vierteljährliche Wiederherstellungsprobe bleibt Handarbeit.** Die Spec verlangt sie „danach vierteljährlich“, aber keinen Zeitplan. Ein Cron-Lauf würde nachts ein Wegwerf-Postgres neben paperless und HWYD starten (3,7 GB, kein Swap) und sein Ergebnis wieder nur in eine Protokolldatei schreiben, die niemand liest. Die README nennt den Befehl und die Monate (Januar, April, Juli, Oktober). Die Probe bekommt `--memory 256m`.
7. **Das Initialen-Icon wird im Rauchtest des Images geprüft** und nicht erst auf dem Server: Das Image ist dasselbe, die Schrift kommt aus dem Image, und der Rauchtest läuft vor dem Ausrollen. Geprüft wird zweifach: `fc-match` findet DejaVu Sans Bold, und das ausgelieferte Icon hat Buchstaben (nicht nur eine Fläche). Dasselbe Prüfmuster steht in `tools/pruefe-betrieb.sh` für die Live-Adresse.
8. **Etappe 6 schreibt keine Rechtstexte.** `tools/pruefe-texte.sh` listet, was noch Platzhalter ist, und endet mit Fehler, solange etwas offen ist. Es ist Teil der Abnahme, nicht des Deploys: Die Testumgebung darf mit Platzhaltern laufen, die Einladung der echten Jugendleiter nicht.
9. **Reihenfolge beim Umzug:** erst der Entwurf (`PathPrefix(/entwurf)`), dann die App (Host `test.jufi-app.de`). Würde die App zuerst umziehen, hätten beide Router bis zum Entwurf-Deploy dieselbe Regel (`Host(...)`) und damit dieselbe Priorität. Andersherum ist `/` für wenige Sekunden unbedient; auf einer Testumgebung ohne Nutzer ist das der kleinere Preis.

## Global Constraints

- Code-Kommentare, Commit-Nachrichten, Doku und Meldungen der Skripte sind deutsch. Commit-Nachrichten sind ASCII (Umlaute umschrieben) und enden auf `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Einrückung mit Tabs; Ausnahmen YAML (Spaces), `package.json`, Markdown. Shell-Skripte wie die vorhandenen: Tabs, `set -euo pipefail`, `source "$(dirname "${BASH_SOURCE[0]}")/_config.sh"`.
- Kommentare erklären das Warum und nennen die verworfene Alternative.
- Compose-Aufrufe nennen **immer** ausdrücklich die JuFi-Dienste, nie ein blankes `up -d` oder `down` (gemeinsame Datei mit paperless, HWYD und Entwurf). Alle Variablen in der Server-`.env` tragen das Präfix `JUFI_`.
- Geheimnisse (Passwort des restic-Repositorys, SMTP-Passwort) werden **nie** ausgegeben, auch nicht in Fehlermeldungen; geprüft wird nur, ob eine Zeile gesetzt ist (`grep -c`), und genannt werden nur Namen.
- Spec 8.3: täglich 03:40, `pg_dump -Fc`, Dump mit `pg_restore --list` prüfen, restic per SFTP auf das zweite Hetzner-Konto in ein **eigenes Repository mit eigenem Passwort**, 7 tägliche / 4 wöchentliche / 6 monatliche Stände, Protokoll `/var/log/jufi-backup.log`, Vorprüfung von SSH-Schlüssel und `known_hosts` für root.
- Spec 8.4: Absender `app@jufi-app.de`, Antwort `kontakt@jufi-app.de`, im Test Betreff-Präfix `[Test] `.
- Port 465 ist implizites TLS, auf 587 handelt nodemailer STARTTLS aus (`apps/jufi/src/server/mail/versand.ts`); kein Skript soll das anders annehmen.
- Nach jeder Task müssen `pnpm exec prettier --check .` und die Lokalprobe der Task grün sein; die TypeScript-Tests (`pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache`) laufen vor dem Abschluss und nach Task 8 (wegen `project.json`).
- **Nichts pushen, nichts auf den Server spielen, nichts deployen.** Alle Schritte der Tasks 1 bis 11 laufen lokal. Was den Server berührt (`install-backup.sh`, Compose-Blöcke, `deploy:*`), steht nur in „Abnahme“ und braucht das ausdrückliche Wort des Eigentümers.
- Im Browser und in Proben nur erfundene Daten.

## Review Focus

Diese Zustände legt die Spec nahe, aber keine Task-Spezifikation deckt sie allein ab. Jeder hat seinen Test in der genannten Task.

1. **Ein Dump, der unterwegs abbricht** (Datenbank gestoppt, `pg_dump` scheitert, Platte voll): `backup.sh` endet mit Fehler, lässt **keine** halbe `.dump`-Datei liegen, und `deploy.sh` rollt dann nicht aus (Tasks 2, 5).
2. **Ein Restore, der still unvollständig ist**: abgeschnittener Dump, eine Tabelle mit anderer Zeilenzahl als die Quelle, eine Tabelle, die im Dump fehlt. `restore-test.sh` endet jedes Mal mit Fehler und nennt die Tabelle (Task 3).
3. **Ein leerer restic-Snapshot**: restic legt einen Snapshot auch an, wenn es die Quelldatei nicht lesen konnte (`processed 0 files`), und der wäre danach `latest`. `backup.sh` prüft, dass der Snapshot den Dump in voller Größe enthält, und räumt vorher **nichts** auf (Task 2, aus HWYD übernommen; nur auf dem Server beweisbar, deshalb im Probelauf von `install-backup.sh`, Task 4).
4. **Ein Fremder in der geteilten `.env`**: ein gesetztes `RESTIC_REPOSITORY` einer anderen App darf nie das Ziel dieser Sicherung werden, und ein leeres `JUFI_SMTP_HOST=` bedeutet Mailpit, nicht „kein Server“ (Tasks 1, 7).
5. **Die Domain wechselt, der Rest bleibt**: `app-test.jufi-app.de/<pfad>?x=1` landet mit 301 auf `test.jufi-app.de/<pfad>?x=1`, `/entwurf/…` bleibt der Entwurf (auch ein tiefer Link), `/` ist die Plattformseite, und der Entwurf antwortet nicht mehr auf `/` (Tasks 8, 9).

## Dateistruktur

```
tools/_config.sh                 + REMOTE_TOOLS, BACKUP_DIR, jufi_scp, restic_env, restic_sftp_host, APP_URL auf test.jufi-app.de
tools/backup.sh                  Dump, Dump pruefen, restic, Snapshot pruefen, aufraeumen
tools/restore-test.sh            Dump in Wegwerf-Postgres, Zeilen je Tabelle gegen die Quelle
tools/install-backup.sh          Skripte und Cron auf den Server, restic pruefen, Probelauf
tools/rollback.sh                Rueckfall auf ein frueheres Image, mit Migrationswaechter
tools/probe-sicherung.sh         beweist backup.sh und restore-test.sh lokal gegen eine Wegwerf-Compose-Datei
tools/pruefe-icon.mjs            prueft ein PNG: Groesse, Buchstaben statt Flaeche
tools/mail-testen.mjs            sendet eine Testmail mit der Umgebung der App (im Container oder lokal)
tools/pruefe-betrieb.sh          Live-Pruefung: Health, Routing, Manifest, Icon, Mail-DNS
tools/pruefe-texte.sh            listet offene Platzhalter der Rechtstexte und des Einwilligungstexts
tools/deploy.sh                  + Tor 5: Skripte da, Tor 5b: Dump, Tor 4: Schrift und Icon, neuer Schluss
tools/deploy-entwurf.sh          Rauchtest: / ist nicht mehr Sache des Entwurfs
deploy/jufi-backup.cron          03:40, Protokoll /var/log/jufi-backup.log
deploy/jufi-services.yml         Domain, 301 von app-test, SMTP-Schalter, Volume-Kommentar
deploy/jufi-entwurf.yml          PathPrefix(/entwurf)
deploy/nginx-entwurf.conf        Umleitung von / entfaellt
deploy/env.jufi.example          + JUFI_RESTIC_*, JUFI_SMTP_*
apps/jufi/project.json           allowedHosts ohne app-test
README.md, CLAUDE.md, Spec       Nachzug (Task 11)
```

---

### Task 1: Gemeinsame Konfiguration für Sicherung und Rückfall

**Files:**

- Modify: `tools/_config.sh`, `deploy/env.jufi.example`

**Interfaces:**

- Produces (Variablen, alle mit `: "${NAME:=…}"` überschreibbar): `REMOTE_TOOLS` (`$REMOTE_DIR/jufi-tools`), `BACKUP_DIR` (`$REMOTE_DIR/jufi-backups`). `APP_URL` hat jetzt die Vorgabe `https://test.jufi-app.de`.
- Produces (Funktionen): `jufi_scp ARGS…` (scp mit `SSH_OPTS`), `restic_env` (setzt und exportiert `RESTIC_REPOSITORY` und `RESTIC_PASSWORD` **ausschließlich** aus `JUFI_RESTIC_REPOSITORY` und `JUFI_RESTIC_PASSWORD`, sonst leer), `restic_sftp_host` (gibt den Teil `benutzer@wirt` einer Adresse `sftp:benutzer@wirt:pfad` aus, sonst nichts).
- `deploy/env.jufi.example` bekommt `JUFI_RESTIC_REPOSITORY`, `JUFI_RESTIC_PASSWORD` (mit der Warnung „eigenes Repository, eigenes Passwort, Passwort in den Passwortmanager, nicht nur auf den Server“) und `JUFI_SMTP_HOST`, `JUFI_SMTP_PORT`, `JUFI_SMTP_USER`, `JUFI_SMTP_PASS` (mit der Erklärung des Schalters aus Entscheidung 2 und dem Hinweis, dass ein `$` im Passwort in der `.env` als `$$` geschrieben werden muss, weil Compose es sonst als Variable liest).

- [ ] **Step 1: Probe schreiben (rot).** In der Shell:

```bash
bash -c 'source tools/_config.sh; unset JUFI_RESTIC_REPOSITORY JUFI_RESTIC_PASSWORD
  RESTIC_REPOSITORY=fremd RESTIC_PASSWORD=fremd restic_env
  echo "leer:[$RESTIC_REPOSITORY][$RESTIC_PASSWORD]"
  JUFI_RESTIC_REPOSITORY=sftp:benutzer@wirt.example:jufi JUFI_RESTIC_PASSWORD=geheim restic_env
  echo "jufi:[$RESTIC_REPOSITORY]"; echo "wirt:[$(restic_sftp_host)]"; echo "url:$APP_URL"'
```

- [ ] **Step 2:** Probe ausführen — Expected: FAIL (`restic_env: command not found`).
- [ ] **Step 3: Implementieren** wie in Interfaces. Ein Kommentar an `restic_env` nennt die verworfene HWYD-Rückfalllösung (Entscheidung 3) und erklärt, dass es eine **Funktion** ist, weil die `.env` des Servers erst nach dieser Datei gelesen wird.
- [ ] **Step 4:** Probe erneut — Expected:

```
leer:[][]
jufi:[sftp:benutzer@wirt.example:jufi]
wirt:[benutzer@wirt.example]
url:https://test.jufi-app.de
```

- [ ] **Step 5:** `bash -n tools/_config.sh && pnpm exec prettier --check deploy/env.jufi.example` — Expected: ohne Ausgabe bzw. „All matched files use Prettier code style!“.
- [ ] **Step 6: Commit** `Betrieb: Konfiguration fuer Sicherung (restic nur mit JUFI_-Namen) und Rueckfall`

---

### Task 2: Dump ziehen und prüfen — `tools/backup.sh` mit lokaler Probe

**Files:**

- Create: `tools/probe-sicherung.sh`, `tools/backup.sh`, `deploy/jufi-backup.cron`
- Modify: `.gitignore` (Zeile `/backups/`)

**Interfaces:**

- Consumes: Task 1 (`REMOTE_DIR`, `REMOTE_COMPOSE`, `DB_SERVICE`, `BACKUP_DIR`, `restic_env`, `restic_sftp_host`, `step`, `fail`, `note`).
- Produces: `tools/backup.sh [--local] [--no-restic]`.
  - `--local` läuft auf dem Server (Compose liegt in `$REMOTE_DIR`, `.env` liefert `JUFI_POSTGRES_USER` und `JUFI_POSTGRES_DB`); ohne `--local` zieht es den Dump per SSH auf den Entwicklungsrechner nach `backups/` (in `.gitignore`).
  - Der Dump heißt `jufi-<JJJJMMTT-HHMMSS>.dump` und entsteht mit `pg_dump -Fc --no-owner --no-privileges` im Dienst `$DB_SERVICE`.
  - Ende 0 nur, wenn der Dump mindestens 1024 Byte hat und `pg_restore --list` mindestens eine Zeile `TABLE DATA` zeigt. Sonst Fehler **und** die halbe Datei wird gelöscht.
  - Alte Dumps (älter als `LOCAL_KEEP_DAYS`, Vorgabe 30) werden immer gelöscht, nicht nur im restic-Zweig.
  - restic-Zweig (nur ohne `--no-restic` und mit gesetztem Repository): Passwort-Prüfung, SFTP-Vorprüfung mit `sftp -b /dev/null` (nicht `ssh … true`, das Ziel hat keine Shell), `restic snapshots || restic init`, `restic backup --tag jufi-db`, Snapshot-Größe gegen die Dump-Größe prüfen, **dann erst** `restic forget --tag jufi-db --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`.
  - Ohne Repository: meldet „keine Kopie außer Haus“ und endet mit 0.
- Produces: `tools/probe-sicherung.sh` — beweist die Sicherungsskripte ohne Server. Es legt in `mktemp -d` eine Compose-Datei mit **einem** Dienst `jufi-db` (`postgres:17-alpine`, kein Port, `COMPOSE_PROJECT_NAME=jufi-probe-$$`) und eine `.env` mit `JUFI_POSTGRES_USER=probe`, `JUFI_POSTGRES_DB=probe`, `JUFI_POSTGRES_PASSWORD=probe` an, wartet auf `pg_isready`, legt zwei Tabellen `familie` (3 Zeilen) und `person` (5 Zeilen) an und räumt per `trap` Container, Netz, Volume und Verzeichnis immer ab. Aufrufe der Skripte nutzen `REMOTE_DIR=<temp> REMOTE_COMPOSE=docker-compose.yml BACKUP_DIR=<temp>/backups`.
- Produces: `deploy/jufi-backup.cron` mit der Zeile `40 3 * * * root /home/paperless/paperless-ngx/jufi-tools/backup.sh --local >>/var/log/jufi-backup.log 2>&1` und einem Kopf nach dem Muster von `../hwyd/deploy/hwyd-backup.cron` (Warum 03:40: nach HWYD um 03:20; die zwei Dinge, die für root stimmen müssen; das Protokoll als einzige Spur).

- [ ] **Step 1: Probe schreiben (rot).** `tools/probe-sicherung.sh` mit zwei Fällen:
  - **Fall A (Dump gelingt):** `backup.sh --local --no-restic` endet mit 0, genau eine Datei `jufi-*.dump` liegt in `backups/`, und `pg_restore --list` (im Postgres-Image, da lokal oft nicht installiert) zeigt `TABLE DATA` für `familie` und `person`.
  - **Fall B (Dump scheitert):** `docker compose stop jufi-db`, danach `backup.sh --local --no-restic` — Exit ungleich 0, Meldung enthält „pg_dump“, und in `backups/` liegt **keine** `.dump`-Datei (außer der aus Fall A, die vorher in ein anderes Verzeichnis verschoben wird, damit die Zählung eindeutig ist).
    Die Probe meldet jeden Fall mit ✓/✗ und endet mit Fehler, wenn ein Fall ✗ ist.
- [ ] **Step 2:** `bash tools/probe-sicherung.sh` — Expected: FAIL (`tools/backup.sh` fehlt), Aufräumen läuft trotzdem (`docker ps -a --filter name=jufi-probe` leer).
- [ ] **Step 3: `tools/backup.sh` implementieren** nach `../hwyd/tools/backup.sh`: gleiche Struktur und die gleichen Begründungen in den Kommentaren (Dump prüfen, immer aufräumen, `sftp` statt `ssh`, Snapshot-Größe), umbenannt auf `JUFI_`/`jufi-`. Der Fehlerpfad löscht die Datei über ein `trap … ERR`/eine Prüfung nach dem `pg_dump`. Die Aufbewahrung ist 7/4/6, und der Kommentar sagt, dass HWYD 12 Monate hält und Spec 8.3 hier 6 vorgibt.
- [ ] **Step 4:** `bash tools/probe-sicherung.sh` — Expected:

```
✓ A: Dump liegt vor, enthaelt familie und person
✓ B: gestoppte Datenbank -> Fehler, keine halbe Datei
```

- [ ] **Step 5:** `bash -n tools/backup.sh tools/probe-sicherung.sh && pnpm exec prettier --check .` — Expected: grün.
- [ ] **Step 6: Commit** `Sicherung: backup.sh (Dump pruefen, restic, Snapshot pruefen) mit Lokalprobe und Cron`

---

### Task 3: Wiederherstellung beweisen — `tools/restore-test.sh`

**Files:**

- Create: `tools/restore-test.sh`
- Modify: `tools/probe-sicherung.sh` (drei weitere Fälle)

**Interfaces:**

- Consumes: Task 2 (Dump aus `backup.sh`, die Probe-Compose-Datei).
- Produces: `tools/restore-test.sh [--dump <datei>] [--source local|remote] [--no-compare]` wie bei HWYD, mit diesen JuFi-Besonderheiten:
  - Ohne `--dump` holt es den neuesten Snapshot mit Tag `jufi-db` aus restic (`restic_env`; ohne Repository bricht es mit Hinweis ab).
  - Wegwerf-Container `jufi-restore-probe-$$` aus `postgres:17-alpine` mit `--memory 256m` und ohne veröffentlichten Port, `trap` räumt immer ab. Benutzer und Datenbank aus `JUFI_POSTGRES_USER`/`JUFI_POSTGRES_DB` (Vorgabe `jufi`).
  - Zeilenzahl **je Tabelle**, Tabellenliste aus `information_schema` der Quelle und der Wiederherstellung (eine im Dump fehlende Tabelle fällt auf).
  - Quelle `local`: Container `jufi-postgres-dev`, sonst der Compose-Dienst `$DB_SERVICE` in `$REMOTE_DIR` (dort läuft das Skript auf dem Server); `SOURCE_CONTAINER=<name>` überschreibt. Quelle `remote`: dieselben Zählungen per SSH.
  - Ende 0 nur, wenn jede Tabelle dieselbe Zeilenzahl hat; jede Abweichung wird mit Tabellenname, Quell- und Ist-Zahl genannt.

- [ ] **Step 1: Probe erweitern (rot).** Drei Fälle in `tools/probe-sicherung.sh`, jeweils nach einem frischen `backup.sh`-Dump und mit `SOURCE_CONTAINER=<Container des Probe-Dienstes>`:
  - **Fall C (Restore gleich Quelle):** `restore-test.sh --dump <dump>` endet mit 0 und meldet `✓ familie 3` und `✓ person 5`.
  - **Fall D (Quelle wuchs nach dem Dump):** eine Zeile in `person` einfügen, dann `restore-test.sh` — Exit ungleich 0, Ausgabe nennt `person` mit „Quelle 6, wiederhergestellt 5“.
  - **Fall E (Dump abgeschnitten):** `head -c <halbe Größe>` des Dumps in eine neue Datei, `restore-test.sh --dump <diese>` — Exit ungleich 0 mit „pg_restore ist gescheitert“.
- [ ] **Step 2:** `bash tools/probe-sicherung.sh` — Expected: FAIL ab Fall C (`tools/restore-test.sh` fehlt).
- [ ] **Step 3: Implementieren** nach `../hwyd/tools/restore-test.sh`. Die Kommentare über `_config.sh` neben dem Skript (nicht unter `../tools`), den Rückfall auf den Compose-Dienst auf dem Server und den Zählvergleich aus einer abgefragten statt festen Tabellenliste bleiben, auf JuFi umgeschrieben.
- [ ] **Step 4:** `bash tools/probe-sicherung.sh` — Expected: alle fünf Fälle ✓, zuletzt „✓ Sicherung und Wiederherstellung bewiesen“; danach `docker ps -a --filter name=jufi-probe --filter name=jufi-restore-probe -q` leer.
- [ ] **Step 5:** `bash -n tools/restore-test.sh && pnpm exec prettier --check .` — Expected: grün.
- [ ] **Step 6: Commit** `Sicherung: restore-test.sh (Zeilen je Tabelle) und Fehlerfaelle in der Lokalprobe`

---

### Task 4: Zeitplan auf den Server bringen — `tools/install-backup.sh`

**Files:**

- Create: `tools/install-backup.sh`

**Interfaces:**

- Consumes: Tasks 1 bis 3 (`jufi_ssh`, `jufi_scp`, `REMOTE_TOOLS`, die Dateien `tools/_config.sh`, `tools/backup.sh`, `tools/restore-test.sh`, `deploy/jufi-backup.cron`).
- Produces: `tools/install-backup.sh [--dry-run] [--no-cron] [--no-run]` wie `../hwyd/tools/install-backup.sh`:
  - kopiert die vier Dateien nach `$REMOTE_TOOLS` (Rechte 755/644) — `backup.sh` bindet `_config.sh` aus seinem **eigenen** Verzeichnis ein, beide wandern immer zusammen;
  - stellt sicher, dass `restic` installiert ist (`apt-get install restic`, falls nicht);
  - meldet nur, **ob** `JUFI_RESTIC_REPOSITORY` und `JUFI_RESTIC_PASSWORD` in `$REMOTE_DIR/.env` stehen (`grep -c '^NAME=.'`), nie die Werte, und sagt, was ohne sie passiert (nur geprüfter Dump lokal);
  - installiert `/etc/cron.d/jufi-backup` mit `install -m 644 -o root -g root` (Cron ignoriert schreibbare Dateien dort still) und verlangt dafür root (`${SSH_TARGET%%@*} = root`);
  - führt am Ende `backup.sh --local` einmal im Wachzustand aus — **der Punkt der Übung**: Das beweist restic, Schlüssel, `known_hosts`, Snapshot-Prüfung und Aufräumen einmal, statt sie um 03:40 zum ersten Mal zu versuchen;
  - nennt zum Schluss den Befehl für die Restore-Probe auf dem Server.
  - Es ändert **kein** `deploy.sh` und läuft nie als Teil eines Deploys (Begründung wie bei HWYD: ein Deploy läuft oft und fällt auch mal an einem Tor aus).

- [ ] **Step 1: Probe schreiben (rot).** `bash tools/install-backup.sh --dry-run` ohne `SSH_TARGET` — Expected: FAIL mit „command not found“ bzw. fehlender Datei.
- [ ] **Step 2: Implementieren** wie in Interfaces. Alle Meldungen deutsch, Fehler nennen den nächsten Schritt.
- [ ] **Step 3:** Dieselbe Probe (`env -u SSH_TARGET bash tools/install-backup.sh --dry-run`) — Expected: Ende mit Fehler und der Meldung „SSH_TARGET fehlt. deploy/env.deploy.example nach .env.deploy kopieren.“; `bash tools/install-backup.sh --bogus` — Expected: „Unbekanntes Argument: --bogus“ und Exit 2.
- [ ] **Step 4:** `bash -n tools/install-backup.sh && pnpm exec prettier --check .` — Expected: grün. Gegen den echten Server wird dieses Skript erst in der Abnahme ausgeführt.
- [ ] **Step 5: Commit** `Sicherung: install-backup.sh (Skripte, restic, Cron, Probelauf auf dem Server)`

---

### Task 5: Dump vor der Migration und Rückfall — `deploy.sh`, `rollback.sh`

**Files:**

- Modify: `tools/deploy.sh`
- Create: `tools/rollback.sh`

**Interfaces:**

- Consumes: Task 2 (`backup.sh --local --no-restic` auf dem Server unter `$REMOTE_TOOLS`).
- Produces in `tools/deploy.sh`:
  - **Tor 5** prüft zusätzlich, dass `$REMOTE_TOOLS/backup.sh` ausführbar da ist; sonst „kein Deploy ohne Sicherung: tools/install-backup.sh ausführen“.
  - **Tor 5b „Dump vor der Migration“** zwischen Tor 5 und Tor 6: läuft `$DB_SERVICE`, wird `$REMOTE_TOOLS/backup.sh --local --no-restic` per SSH aufgerufen, ein Fehler bricht mit „Dump gescheitert — kein Deploy ohne Sicherung“ ab (das Übertragen kommt danach, also wurde noch nichts verändert). Läuft der Dienst nicht (allererstes Ausrollen), steht eine Notiz statt eines Fehlers.
  - Der Schlusskommentar „Kein rollback.sh wie in HWYD“ wird ersetzt: Die Rückfallzeile verweist auf `tools/rollback.sh`.
- Produces: `tools/rollback.sh [--list | <sha> [--trotz-migration]]` nach `../hwyd/tools/rollback.sh`:
  - `--list` nennt die auf dem Server vorhandenen Tags von `$IMAGE` und den eingetragenen `JUFI_IMAGE_TAG`.
  - Ohne SHA gilt der Commit vor `HEAD`.
  - **Migrationswächter vor jedem SSH-Aufruf:** `git diff --quiet <sha> HEAD -- prisma/migrations`. Unterscheiden sie sich, Ende mit Fehler und der Meldung, dass das alte Image mit dem neuen Schema laufen können muss; nur mit `--trotz-migration` geht es weiter.
  - Prüft vor dem Umschalten, dass `$IMAGE:<sha>` auf dem Server liegt (ein `up -d` auf ein fehlendes Tag stoppt die laufende App und startet nichts), setzt `JUFI_IMAGE_TAG`, startet nur `$APP_SERVICE` und vergleicht `/healthz` von innen mit dem Commit-Anfang des Ziel-SHA.

- [ ] **Step 1: Proben schreiben (rot).**
  - `bash tools/rollback.sh` ohne `SSH_TARGET` — Expected: FAIL (Datei fehlt).
  - Den jüngsten Commit finden, der `prisma/migrations` geändert hat (`git log -1 --format=%h -- prisma/migrations`, im Folgenden `<M>`), und den davor (`<M>~1`). `SSH_TARGET=nobody@invalid bash tools/rollback.sh <M>~1` muss am Wächter scheitern, **bevor** SSH versucht wird.
- [ ] **Step 2: `tools/rollback.sh` implementieren.**
- [ ] **Step 3:** Probe 2 erneut — Expected: Exit ungleich 0, Meldung beginnt mit „Die Migrationen unterscheiden sich“ und nennt `--trotz-migration`; kein `ssh`-Fehler in der Ausgabe. `SSH_TARGET=nobody@invalid bash tools/rollback.sh HEAD` — Expected: Der Wächter lässt durch (gleiche Migrationen) und das Skript scheitert erst am SSH-Aufruf.
- [ ] **Step 4: `tools/deploy.sh` ändern** wie in Interfaces; Kommentare erklären, warum der Dump vor dem Übertragen und nicht danach liegt (Spec 8.2: „Dump vor der Migration“, und ein gescheiterter Dump darf nichts verändert haben) und warum er ohne restic läuft (die Kopie außer Haus macht der nächtliche Lauf; ein Deploy soll nicht an der Erreichbarkeit des zweiten Kontos hängen).
- [ ] **Step 5:** `bash -n tools/deploy.sh tools/rollback.sh && pnpm run deploy:app --dry-run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -12` — Expected: Tor 1 bis 4 laufen wie bisher grün durch und enden mit der Dry-run-Meldung; Tor 5 wird nicht erreicht (braucht den Server).
- [ ] **Step 6: Commit** `Auslieferung: Dump vor der Migration (kein Deploy ohne Sicherung), rollback.sh mit Migrationswaechter`

---

### Task 6: Schrift und Initialen-Icon im Rauchtest des Images

**Files:**

- Create: `tools/pruefe-icon.mjs`
- Modify: `tools/deploy.sh` (Tor 4)

**Interfaces:**

- Produces: `node tools/pruefe-icon.mjs <größe>` liest ein PNG von stdin und beendet sich mit 0 nur, wenn
  - das Bild genau `<größe>` × `<größe>` Pixel hat und
  - **Buchstaben** drauf sind: Mehr als 3 % und weniger als 60 % der Pixel weichen vom Pixel in der Ecke (0, 0) um mehr als 40 in der Summe der drei Kanäle ab. Eine einfarbige Fläche (fehlende Schrift ohne Ersatzzeichen) und ein Bild voller Kästchen (Tofu) fallen durch die erste bzw. zweite Schranke; für Tofu gilt zusätzlich die `fc-match`-Prüfung unten.
  - Bei Fehler steht in der Meldung, was gemessen wurde (Größe, Anteil).
- Produces in `tools/deploy.sh` Tor 4, nach „Docker-Healthcheck“ und vor der CLI-Probe:
  1. `docker exec "$SMOKE_APP" fc-match 'DejaVu Sans:bold' file` enthält `DejaVuSans-Bold`, sonst Fehler „DejaVu Sans Bold fehlt im Image (apk add font-dejavu, Dockerfile)“.
  2. Der Demo-Verein wird mit `node apps/cli/dist/main.js demo einspielen` in der Wegwerf-Datenbank angelegt (gleicher Aufruf wie die vorhandene CLI-Probe, gleiche `SMOKE_ENV`), `/demo/icon-192.png` und `/demo/icon-512.png` werden mit dem Host-Header der Domain geholt und durch `pruefe-icon.mjs 192` bzw. `512` auf dem Entwicklungsrechner geprüft (sharp steht in `node_modules`).
  3. Ein Vermerk „Initialen-Icon: DejaVu Sans Bold, 192 und 512 px, Buchstaben gezeichnet“.

- [ ] **Step 1: Proben schreiben (rot).** Mit dem laufenden Entwicklungsserver (`pnpm run db:up`, `pnpm run demo`, `pnpm run dev`) und erfundenen Daten:
  - `curl -fsS http://localhost:4200/demo/icon-192.png | node tools/pruefe-icon.mjs 192` — Expected: FAIL (Datei fehlt).
  - Ein einfarbiges PNG: `node -e "require('sharp')({create:{width:192,height:192,channels:3,background:'#336699'}}).png().toBuffer().then(b=>process.stdout.write(b))" | node tools/pruefe-icon.mjs 192` — Expected: Exit 1.
- [ ] **Step 2: `tools/pruefe-icon.mjs` implementieren** (ESM, `sharp` aus dem Workspace, rohe Pixel über `.raw()`, Kommentar zur Wahl der Schranken und zur Rolle von `fc-match` als zweiter Hälfte).
- [ ] **Step 3:** Beide Proben erneut — Expected: das Demo-Icon besteht (Exit 0, Zeile `192 x 192, … % Zeichen`), das einfarbige fällt durch (Exit 1, „keine Zeichen“).
- [ ] **Step 4: Tor 4 in `tools/deploy.sh` erweitern** wie in Interfaces; Kommentar: Lokal liefert macOS eine Schrift, im Image fehlte sie womöglich trotzdem und der Fehler bliebe unsichtbar (Spec 6.4); deshalb wird das Bild geprüft, das **das Image** erzeugt hat.
- [ ] **Step 5:** `pnpm run deploy:app --dry-run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Initialen|Tor 4|Fehler|✗"` — Expected: Zeile „Initialen-Icon: DejaVu Sans Bold, 192 und 512 px, Buchstaben gezeichnet“, kein ✗.
- [ ] **Step 6: Commit** `Rauchtest: DejaVu Sans Bold und Initialen-Icon im Image geprueft`

---

### Task 7: Mail-Schalter im Compose-Block und `tools/mail-testen.mjs`

**Files:**

- Modify: `deploy/jufi-services.yml`
- Create: `tools/mail-testen.mjs`

**Interfaces:**

- Produces in `deploy/jufi-services.yml` (Dienst `jufi`, `environment`): `SMTP_HOST: ${JUFI_SMTP_HOST:-jufi-mailpit}`, `SMTP_PORT: ${JUFI_SMTP_PORT:-1025}`, `SMTP_USER: ${JUFI_SMTP_USER:-}`, `SMTP_PASS: ${JUFI_SMTP_PASS:-}`. Der Kommentar nennt Entscheidung 2, dass `:-` auch bei **leerem** Wert greift (also `JUFI_SMTP_HOST=` aus der Vorlage Mailpit bedeutet), und dass `jufi-mailpit` unter `depends_on` bleibt.
- Produces: `node tools/mail-testen.mjs <empfänger>` — sendet eine Klartext-Testmail mit `nodemailer` aus `process.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_ABSENDER`, `MAIL_ANTWORT`, `MAIL_BETREFF_PRAEFIX`. Transport wie `apps/jufi/src/server/mail/versand.ts` (`secure` nur bei Port 465, Anmeldung nur mit gesetztem `SMTP_USER`). Betreff `<Präfix>Testmail der JuFi App`, Text: dass es eine Testmail ist, von welchem Host sie kam und die Aufforderung, in Gmail/Apple Mail die Originalnachricht anzusehen und `spf=pass`, `dkim=pass` und `dmarc=pass` zu suchen. Ausgabe nur die Message-ID und der Host, nie Zugangsdaten. Fehlende Pflichtvariablen werden mit ihren **Namen** gemeldet (Exit 2). Aufruf im Container: `ssh <server> 'cd /home/paperless/paperless-ngx && docker compose exec -T jufi node --input-type=module - <adresse>' < tools/mail-testen.mjs` (steht als Kommentar im Kopf der Datei).

- [ ] **Step 1: Proben schreiben (rot).**
  - `docker compose -f deploy/jufi-services.yml --env-file <(printf 'JUFI_POSTGRES_USER=u\nJUFI_POSTGRES_DB=d\nJUFI_POSTGRES_PASSWORD=p\nJUFI_SESSION_SECRET=s\nJUFI_TOTP_ENC_KEY=k\nJUFI_IMAGE_TAG=latest\nJUFI_SMTP_HOST=\n') config | grep -E "SMTP_(HOST|PORT)"` — Expected: FAIL, weil dort noch festes `jufi-mailpit` steht und die zweite Probe (mit gesetztem Host) dasselbe zeigt.
  - Mit `JUFI_SMTP_HOST=smtp.example.test` und `JUFI_SMTP_PORT=587` soll `SMTP_HOST: smtp.example.test` herauskommen.
  - `node tools/mail-testen.mjs adresse@example.test` ohne `SMTP_HOST` — Expected: FAIL (Datei fehlt).
- [ ] **Step 2: Compose-Block ändern** und `tools/mail-testen.mjs` schreiben.
- [ ] **Step 3:** Beide Compose-Proben erneut — Expected: leer → `SMTP_HOST: jufi-mailpit` und `SMTP_PORT: "1025"`; gesetzt → `smtp.example.test` und `"587"`.
- [ ] **Step 4: Gegen Mailpit beweisen.** `pnpm run db:up`, dann `SMTP_HOST=127.0.0.1 SMTP_PORT=1025 MAIL_ABSENDER=app@jufi-app.de MAIL_ANTWORT=kontakt@jufi-app.de 'MAIL_BETREFF_PRAEFIX=[Test] ' node tools/mail-testen.mjs lena.test@example.test` und `curl -s http://127.0.0.1:8025/api/v1/messages | head -c 600` — Expected: Die Nachricht liegt in Mailpit, Betreff `[Test] Testmail der JuFi App`, `From` `app@jufi-app.de`, `Reply-To` `kontakt@jufi-app.de`. Ohne `SMTP_HOST`: Exit 2 und die Meldung nennt `SMTP_HOST`, `SMTP_PORT`, `MAIL_ABSENDER`, `MAIL_ANTWORT`.
- [ ] **Step 5:** `pnpm exec prettier --check .` — Expected: grün (YAML mit Spaces, `.mjs` mit Tabs).
- [ ] **Step 6: Commit** `Mail: SMTP aus JUFI_SMTP_* mit Mailpit als Voreinstellung, mail-testen.mjs`

---

### Task 8: Domain-Umzug — App auf `test.jufi-app.de`, Entwurf unter `/entwurf`

**Files:**

- Modify: `deploy/jufi-services.yml`, `deploy/jufi-entwurf.yml`, `deploy/nginx-entwurf.conf`, `tools/deploy-entwurf.sh`, `apps/jufi/project.json`, `tools/deploy.sh` (nur Kommentare und Vorgaben, die `app-test` nennen), `deploy/env.deploy.example` (falls dort `app-test` vorkommt)

**Interfaces:**

- Produces in `deploy/jufi-services.yml` (Dienst `jufi`): `BASIS_URL`, `WEBAUTHN_ORIGIN` auf `https://test.jufi-app.de`, `WEBAUTHN_RP_ID` auf `test.jufi-app.de`; Router `jufi` mit Regel `Host(\`test.jufi-app.de\`)`; ein zweiter Router `jufi-alt`für`Host(\`app-test.jufi-app.de\`)`mit Middleware`jufi-umzug` (`redirectregex`, `^https://app-test\.jufi-app\.de/(.*)` → `https://test.jufi-app.de/$${1}`, `permanent=true`), gleiche Entry-Points, Zertifikat und `service=jufi`. Der Kommentar nennt Entscheidung 1 samt Preis (Passkeys) und dass die Umleitung entfällt, wenn `app-test` aus dem DNS genommen wird.
- Produces in `deploy/jufi-entwurf.yml`: Regel `Host(\`test.jufi-app.de\`) && PathPrefix(\`/entwurf\`)`; der Kommentar „Abweichung von Spec TP1 8.3 … ohne PathPrefix“ wird durch die Erklärung ersetzt, dass die Abweichung mit Etappe 6 endet, und durch Entscheidung 9 (Reihenfolge). Die Umleitung von `jufi-app.sideshow-systems.de` bleibt unverändert.
- Produces in `deploy/nginx-entwurf.conf`: Der Block `location = / { return 302 /entwurf/; }` entfällt ersatzlos; der Kommentar darüber („Bis Teilprojekt 2 gehört die Domain dem Entwurf“) auch.
- Produces in `tools/deploy-entwurf.sh` (Rauchtest): Die Prüfung, dass `/` relativ auf `/entwurf/` umleitet, wird durch die Gegenprobe ersetzt, dass `/` **nicht** mehr umleitet (Status 404 von nginx, `Location` fehlt). Die Prüfung des relativen Umleitens bleibt für `/entwurf` (ohne Schrägstrich), falls sie dort heute schon steht.
- Produces in `apps/jufi/project.json`: `allowedHosts` ohne `app-test.jufi-app.de` (Traefik beantwortet diesen Host mit der Umleitung, er erreicht die App nie), und der Begleitkommentar passend umgeschrieben. `tools/_config.sh` hat die neue `APP_URL`-Vorgabe seit Task 1.

- [ ] **Step 1: Proben schreiben (rot).**
  - `docker compose -f deploy/jufi-services.yml --env-file <Beispielwerte wie in Task 7> config | grep -E "Host\(|WEBAUTHN_RP_ID|BASIS_URL"` — Expected heute: `app-test.jufi-app.de` überall (FAIL gegen das Soll).
  - `docker compose -f deploy/jufi-entwurf.yml config | grep -E "rule"` — Expected heute: `Host(test.jufi-app.de)` ohne PathPrefix (FAIL).
  - `grep -n "return 302" deploy/nginx-entwurf.conf` — Expected heute: eine Treffer-Zeile (FAIL).
- [ ] **Step 2: Änderungen** wie in Interfaces, mit Kommentaren, die das Warum und die verworfene Alternative nennen (Entscheidungen 1 und 9).
- [ ] **Step 3:** Die drei Proben erneut — Expected:
  - App: Router `jufi` auf `test.jufi-app.de`, Router `jufi-alt` auf `app-test.jufi-app.de`, `WEBAUTHN_RP_ID: test.jufi-app.de`, `BASIS_URL: https://test.jufi-app.de`, und im Label `jufi-umzug` die Ersetzung `https://test.jufi-app.de/${1}` (Compose zeigt `$$` als `$`).
  - Entwurf: `Host(`test.jufi-app.de`) && PathPrefix(`/entwurf`)` und unverändert der Router `jufi-entwurf-alt`.
  - nginx: keine Zeile `return 302`.
- [ ] **Step 4: Rauchtest des Entwurfs.** `bash tools/deploy-entwurf.sh --dry-run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -15` — Expected: grün, mit der neuen Gegenprobe zu `/`. Danach `pnpm exec nx run jufi:build --skip-nx-cache` (der `allowedHosts`-Eintrag steckt im Bau) und `pnpm run deploy:app --dry-run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Host|fremder|✗"` — Expected: „mit Host test.jufi-app.de … fremder Host: 400“, kein ✗.
- [ ] **Step 5:** `pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache && pnpm exec prettier --check .` — Expected: alles grün.
- [ ] **Step 6: Commit** `Domain: App auf test.jufi-app.de, Entwurf unter /entwurf, app-test leitet um`

---

### Task 9: Live-Prüfung — `tools/pruefe-betrieb.sh`

**Files:**

- Create: `tools/pruefe-betrieb.sh`

**Interfaces:**

- Consumes: Task 6 (`tools/pruefe-icon.mjs`), Task 7 (nur als Verweis in der Mail-Ausgabe).
- Produces: `tools/pruefe-betrieb.sh [--url <basis>] [--slug <slug>] [--ohne-entwurf] [--mail <domain>] [--dkim-selector <name>]`. Jede Prüfung druckt `✓ …` oder `✗ …`; das Skript prüft alles durch und endet mit Fehler, wenn mindestens ein ✗ stand. Vorgabe für `--url` ist `$APP_URL`.
  1. **Health:** `<url>/healthz` meldet `"status":"ok"` und eine Version.
  2. **Plattformseite:** `<url>/` liefert `<base href="/"` und kein Entwurfs-`<base href="/entwurf/"`.
  3. **Entwurf** (außer mit `--ohne-entwurf`): `<url>/entwurf/` und `<url>/entwurf/glonntal/t/2-bowling` liefern `<base href="/entwurf/"`; und `<url>/` liefert **nicht** den Entwurf.
  4. **Umzug** (nur wenn die URL `https://test.jufi-app.de` ist): `https://app-test.jufi-app.de/impressum?x=1` antwortet 301 mit `Location: https://test.jufi-app.de/impressum?x=1`.
  5. **Kopf:** `content-security-policy` mit `frame-ancestors 'none'`.
  6. **Mit `--slug`:** `<url>/<slug>/manifest.webmanifest` ist JSON mit `icons` und einem `start_url`, das mit `/<slug>/` beginnt; `icon-192.png` und `icon-512.png` bestehen `pruefe-icon.mjs` (Hinweis im Kommentar: bei einem Verein **mit Logo** wird das Logo geprüft und nicht die Schrift, die Buchstaben-Prüfung gilt dann nur, wenn der Verein keins hat — deshalb besteht die Prüfung bei Logo auf Größe und `fc-match` wird nicht ersetzt).
  7. **Mit `--mail <domain>`** (kommt aus `dig`, Server `1.1.1.1` ausdrücklich genannt, damit das Ergebnis nicht vom lokalen Resolver abhängt): TXT-Eintrag mit `v=spf1` (✗ bei keinem oder mehr als einem, weil mehrere SPF-Einträge ungültig sind); `_dmarc.<domain>` TXT mit `v=DMARC1` und nennt die Richtlinie `p=`; mit `--dkim-selector` zusätzlich `<selector>._domainkey.<domain>` mit `v=DKIM1` (ohne Selektor: Hinweis, dass DKIM so nicht prüfbar ist und `mail-testen.mjs` plus „Originalnachricht anzeigen“ der Beweis ist).
  - Prüfungen mit `curl` nutzen `-sS --max-time 15` und ein Zertifikat wird nie abgeschaltet (`-k` ist verboten).

- [ ] **Step 1: Proben schreiben (rot).** `bash tools/pruefe-betrieb.sh --mail jufi-app.de` — Expected: FAIL (Datei fehlt).
- [ ] **Step 2: Implementieren.**
- [ ] **Step 3: Gegen den Entwicklungsserver** (`pnpm run db:up`, `pnpm run demo`, `pnpm run dev`; erfundener Demo-Verein): `bash tools/pruefe-betrieb.sh --url http://localhost:4200 --slug demo --ohne-entwurf` — Expected: `✓ Health`, `✓ Plattformseite`, `✓ Kopf`, `✓ Manifest demo`, `✓ icon-192`, `✓ icon-512` und Exit 0; mit `--slug gibtsnicht` — Expected: `✗ Manifest gibtsnicht` (404) und Exit 1.
- [ ] **Step 4: Mail-DNS gegen die echte Domain:** `bash tools/pruefe-betrieb.sh --mail jufi-app.de --ohne-entwurf --url http://localhost:4200` — Expected: je Eintrag ✓ oder ✗ mit dem gefundenen Wert (heute vermutlich ✗, weil der Eigentümer die Einträge erst bei Hetzner anlegt); der Lauf darf nicht abstürzen, wenn ein Eintrag fehlt.
- [ ] **Step 5:** `bash -n tools/pruefe-betrieb.sh && pnpm exec prettier --check .` — Expected: grün.
- [ ] **Step 6: Commit** `Betrieb: pruefe-betrieb.sh (Health, Routing, Umzug, Manifest und Icons, SPF/DKIM/DMARC)`

---

### Task 10: Offene Texte sichtbar machen — `tools/pruefe-texte.sh`

**Files:**

- Create: `tools/pruefe-texte.sh`

**Interfaces:**

- Produces: `tools/pruefe-texte.sh` — listet mit Datei und Zeile alles, was Spec 8.6 als offen führt, und endet mit Exit 1, solange etwas gefunden wird:
  - `apps/jufi/src/rechtstexte/impressum.md` und `datenschutz.md`: jede Zeile mit `liefert der Eigentümer`, `vom Eigentümer zu bestätigen`, `nach Inbetriebnahme bestätigen` oder `Geplant, noch nicht in Betrieb`;
  - `libs/domain/src/einwilligung.ts`: jede Zeile, die `Platzhalter` enthält (ohne Beachtung der Groß-/Kleinschreibung) — der Wortlaut in Fassung 1 ist laut Spec 8.6 ein Platzhalter. **Wer den Wortlaut einsetzt, entfernt das Wort in seinem Kommentar** und zählt `EINWILLIGUNG_TEXT_VERSION` hoch, falls schon Einwilligungen existieren.
  - Ausgabe je Datei: Anzahl der Fundstellen und die ersten 80 Zeichen jeder Zeile, am Ende eine Gesamtzahl und der Satz „Die echten Jugendleiter werden erst eingeladen, wenn das leer ist (Spec 1.2).“
  - Das Skript ändert nichts und ist **kein** Tor von `deploy.sh`.

- [ ] **Step 1: Probe schreiben (rot).** `bash tools/pruefe-texte.sh; echo "Exit $?"` — Expected: FAIL (Datei fehlt).
- [ ] **Step 2: Implementieren** (`grep -n -E`, kein Parsen von Markdown).
- [ ] **Step 3:** Probe erneut — Expected: Exit 1, mit Fundstellen in allen drei Dateien (heute 9 im Impressum, mehr als 10 im Datenschutz, 1 im Einwilligungstext). Gegenprobe mit einer Kopie des Repos ist nicht nötig: `grep -c "liefert der Eigentümer" apps/jufi/src/rechtstexte/impressum.md` stimmt mit der Zahl im Bericht überein.
- [ ] **Step 4:** `bash -n tools/pruefe-texte.sh && pnpm exec prettier --check .` — Expected: grün.
- [ ] **Step 5: Commit** `Betrieb: pruefe-texte.sh listet offene Platzhalter der Rechtstexte und des Einwilligungstexts`

---

### Task 11: Doku, Spec-Nachzug und Abnahmeliste

**Files:**

- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md`, `docs/superpowers/plans/2026-10-20-jufi-tp2-etappe6-betrieb.md` (nur der Haken in der Abnahme, falls gewünscht)

**Interfaces:**

- README neue Abschnitte: **Sicherung** (was läuft wann, wo liegen Dumps und Protokoll, wie `tools/install-backup.sh` aufgerufen wird, wo das restic-Passwort hingehört), **Wiederherstellungsprobe** (Befehl auf dem Server, vierteljährlich im Januar, April, Juli und Oktober, was „bestanden“ heißt), **Rückfall** (`tools/rollback.sh --list`, der Migrationswächter), **Mail umstellen** (die vier `JUFI_SMTP_*`-Zeilen, der Schalter, `mail-testen.mjs`, `pruefe-betrieb.sh --mail`), **Prüfen** (`pruefe-betrieb.sh`, `pruefe-texte.sh`). Der Abschnitt „Deployment der echten App“ wird auf `test.jufi-app.de` umgeschrieben (DNS-Eintrag nur noch dort, `app-test` als Umleitung; Passkeys-Hinweis; Reihenfolge Entwurf vor App).
- CLAUDE.md „Stand“: „Etappe 6 ist da: Sicherung (täglich 03:40, restic), Restore-Probe, Rückfall, echter Mailversand per Schalter, App auf test.jufi-app.de. Offen bis zur Einladung der Jugendleiter: Rechtstexte und Einwilligungstext (`tools/pruefe-texte.sh`).“ Unter „Was nachweislich stolpert“: „**Vor jedem Deploy der echten App liegt auf dem Server `jufi-tools`** (`tools/install-backup.sh`), sonst bricht Tor 5 ab.“ und „**`restic_env` kennt nur `JUFI_RESTIC_*`.**“
- Spec-Nachzug, Kopfzeile „nachgezogen mit Etappe 6“: 2.3 (App auf `test.jufi-app.de`, `app-test` als 301, Entwurf `PathPrefix`, Reihenfolge), 8.1 (Mailpit bleibt als umschaltbare Voreinstellung bis Teilprojekt 6; Pfade `jufi-tools`, `jufi-backups`), 8.2 (Dump vor Übertragung ohne restic; `rollback.sh` mit Migrationswächter), 8.3 (Aufbewahrung wie beschlossen, Probe von Hand vierteljährlich, `restic_env` nur mit `JUFI_`), 8.4 (Schalter, `mail-testen.mjs`, DNS-Prüfung), 6.4 (Icon wird im Rauchtest geprüft), 8.6 (Prüfskript), je Entscheidung mit ihrer verworfenen Alternative.
- Abnahmeliste (steht in der README unter „Abnahme von Etappe 6“ und ist die Liste unten in diesem Plan).

- [ ] **Step 1:** README, CLAUDE.md und Spec wie oben schreiben.
- [ ] **Step 2: Gesamtlauf lokal.** `bash tools/probe-sicherung.sh && pnpm run db:up && pnpm nx run-many -t test test-server typecheck --skip-nx-cache && pnpm exec prettier --check .` — Expected: alle fünf Fälle ✓, alle Tests und Typprüfungen grün, Prettier ohne Befund.
- [ ] **Step 3: Gesamt-Dry-run.** `pnpm run deploy:app --dry-run` und `bash tools/deploy-entwurf.sh --dry-run` — Expected: beide grün (Tor 1 bis 4).
- [ ] **Step 4: Commit** `Etappe 6: README, CLAUDE.md und Spec-Nachzug (Betrieb)`

---

## Abnahme von Etappe 6

Der Rest ist Handarbeit und Serverarbeit. **Nichts davon läuft ohne das Wort des Eigentümers**; vorher ist Etappe 6 fertig gebaut, aber nicht in Betrieb. Die Reihenfolge ist nicht beliebig.

**A. Vom Eigentümer vorzubereiten (außerhalb des Repos):**

1. Zweites Hetzner-Konto (SFTP, ohne Shell) und ein SSH-Schlüssel **ohne Passphrase** für root auf dem Server; `JUFI_RESTIC_REPOSITORY=sftp:benutzer@wirt:jufi-backup` und ein **neues** `JUFI_RESTIC_PASSWORD` (nicht das von HWYD) in die `.env` auf dem Server, das Passwort zusätzlich in den Passwortmanager. Ohne dieses Passwort ist die Ablage nicht lesbar.
2. Hetzner-Postfach `app@jufi-app.de` samt SMTP-Zugang; SPF, DKIM und DMARC für `jufi-app.de` bei Hetzner. `JUFI_SMTP_HOST`, `JUFI_SMTP_PORT`, `JUFI_SMTP_USER`, `JUFI_SMTP_PASS` **noch nicht** in die `.env`; das ist Schritt 11.
3. DNS: `test.jufi-app.de` zeigt schon auf den Server; `app-test.jufi-app.de` bleibt, bis die Umleitung geprüft ist.
4. Impressum, Datenschutzerklärung und Wortlaut des Einwilligungstexts (Spec 8.6), außerdem die Entscheidung zu I2 aus Etappe 4.

**B. Auf dem Server und von hier aus (jeweils nach ausdrücklichem Wort):**

5. Die geänderten Blöcke aus `deploy/jufi-services.yml` (Domain, Umleitung, SMTP-Schalter) und `deploy/jufi-entwurf.yml` (PathPrefix) von Hand in `/home/paperless/paperless-ngx/docker-compose.yml` übernehmen. `docker compose config --services` muss weiter alle Dienste nennen.
6. `bash tools/install-backup.sh` — kopiert die Skripte, richtet den Cron ein und macht den **Probelauf mit restic**. Erwartet: Dump geprüft, Snapshot hat die Dump-Größe, aufgeräumt, `✓ Sicherung fertig`.
7. Restore-Probe auf dem Server aus dem neuesten Snapshot (Befehl am Ende der Ausgabe von Schritt 6). Erwartet: jede Tabelle hat dieselbe Zeilenzahl wie die Quelle.
8. `bash tools/deploy-entwurf.sh` (zuerst), danach `pnpm run deploy:app` (Dump vor der Migration erscheint als Tor 5b).
9. `bash tools/pruefe-betrieb.sh --slug <slug des Vereins> --mail jufi-app.de --dkim-selector <selektor von Hetzner>` — Erwartet: nur ✓, auch für `app-test` → 301.
10. Rückfall-Probe, solange noch nichts Echtes auf dem Server liegt: `bash tools/rollback.sh --list`, dann `bash tools/rollback.sh <SHA des zuletzt vor Etappe 6 ausgerollten Stands>` (steht in der Liste von `--list`; das Image muss als Tag auf dem Server liegen). Zwischen Etappe 5 und 6 gibt es keine Migration, der Rückfall ist gefahrlos. Erwartet: `/healthz` meldet den Ziel-Commit. Danach erneut `pnpm run deploy:app`, damit der Server wieder auf dem Stand von Etappe 6 läuft.
11. Mail umschalten: die vier `JUFI_SMTP_*`-Zeilen in die `.env`, `docker compose up -d jufi` auf dem Server, dann vom Entwicklungsrechner `ssh <server> 'cd /home/paperless/paperless-ngx && docker compose exec -T jufi node --input-type=module - <eigene Adresse>' < tools/mail-testen.mjs` (die Datei liegt weder im Image noch auf dem Server); in der empfangenen Mail „Originalnachricht anzeigen“: `spf=pass`, `dkim=pass`, `dmarc=pass`.
12. `bash tools/pruefe-texte.sh` — muss leer sein (Exit 0).
13. Erst jetzt die drei Jugendleiter einladen (Spec 1.2).

**Danach, vierteljährlich:** Restore-Probe (README), und gelegentlich `tail -20 /var/log/jufi-backup.log`.

## Self-Review

- **Spec-Abdeckung:** 1.1 Punkt 5 (täglich verschlüsselt außer Haus, Probe gelaufen): Tasks 2 bis 4, Abnahme 6/7. 1.2 (Einladung erst nach Etappe 6): Tasks 9, 10, Abnahme 13. 2.3 (Domains, Entwurf `PathPrefix`, Plattformseite): Tasks 8, 9. 6.4 (Icon prüfen): Tasks 6, 9. 8.1 (Dienste, `jufi-services.yml`, nur eigene Dienstnamen): Task 7 und 8, Global Constraints. 8.2 (Dump vor Migration, `rollback.sh`, Version): Task 5; `deploy:app` mit eigenem Namen besteht schon. 8.3 (03:40, restic, 7/4/6, Protokoll, SSH-Vorprüfung, `restore-test.sh`): Tasks 2 bis 4. 8.4 (Mail, SPF/DKIM/DMARC prüfen): Tasks 7, 9. 8.5 (Header): bleibt, wird in Task 9 mitgeprüft. 8.6 (Texte): Task 10. Lücke bewusst: Der Mail-Arbeiter mit Wiederholungen besteht seit Etappe 3, hier ändert sich nur der Transport über die Umgebung.
- **Typ- und Namenskonsistenz:** `restic_env`, `restic_sftp_host`, `REMOTE_TOOLS`, `BACKUP_DIR`, `jufi_scp` (Task 1) werden in den Tasks 2 bis 5 genau so benutzt. Dumps heißen überall `jufi-*.dump`, der Tag `jufi-db`, der Cron `/etc/cron.d/jufi-backup`, das Protokoll `/var/log/jufi-backup.log`. Die Probe-Container heißen `jufi-probe-*` und `jufi-restore-probe-*`.
- **Verhältnis:** Das Spec-Kapitel 8 ist rund 55 Zeilen, der Plan setzt es in elf Tasks um, weil jede Fehlerkante (halber Dump, falsche Zeilenzahl, leerer Snapshot) einen Beweis braucht. Code steht nur dort, wo Signatur und Verhalten nicht reichen.
