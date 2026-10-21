# JuFi App

Plattform für Jugendgruppen von Vereinen, zuerst für die Jungfischer eines Fischereivereins: Termine, Umfragen,
Helferlisten, Fahrgemeinschaften, Kosten und Dokumente an einem Ort statt verstreut in WhatsApp-Gruppen.

Das Repo enthält zwei Teile. **Teilprojekt 1** ist der klickbare Entwurf (`apps/entwurf`): Er läuft nur im Browser,
ohne Server und ohne Anmeldung, mit erfundenen Beispieldaten. Testpersonen spielen ihn per Link durch, lösen Aufgaben
im Testmodus und schicken eine Rückmeldung per WhatsApp. **Teilprojekt 2** ist die echte App (`apps/jufi`, Kommandozeile
in `apps/cli`) bis Etappe 6: Vereine anlegen, einladen, anmelden, Mitglieder pflegen, die Oberflächen dazu und der Betrieb (Sicherung, Rückfall, Mailversand). **Teilprojekt 3** bringt
die Threads mit Aushang und Verlauf, Umfragen und Terminen, Kalender, Live-Aktualisierung und Teilen mit Link-Vorschau. Weitere Module folgen in späteren Teilprojekten.

- Rahmen: [`docs/superpowers/specs/2026-10-11-jufi-rahmen-design.md`](docs/superpowers/specs/2026-10-11-jufi-rahmen-design.md)
- Entwurf: [`docs/superpowers/specs/2026-10-11-jufi-tp1-entwurf-design.md`](docs/superpowers/specs/2026-10-11-jufi-tp1-entwurf-design.md)

## Loslegen

Voraussetzungen: Node 22+, pnpm 10+.

```bash
pnpm install
pnpm run dev:entwurf
```

Der Entwurf läuft dann unter <http://localhost:4300/entwurf/>. Der Stand liegt im `localStorage` des Browsers
(Schlüssel `jufi-entwurf:v1`); „Entwurf zurücksetzen" im violetten Testmodus-Knopf stellt die Beispieldaten neu her.

## App entwickeln

Die echte App (Teilprojekt 2) liegt in `apps/jufi`, die Kommandozeile in `apps/cli`. Sie braucht Docker für Postgres
und Mailpit.

```bash
pnpm install
cp .env.example .env     # SESSION_SECRET und TOTP_ENC_KEY eintragen (Hinweise in der Datei); ohne sie bricht schon pnpm run dev ab
pnpm run db:up           # Postgres (127.0.0.1:5433) und Mailpit
pnpm prisma migrate dev  # Schema in die Entwicklungsdatenbank
pnpm run db:generate     # Prisma-Client erzeugen; er liegt nicht im Repo
pnpm run demo            # erfundener Verein "Jungfischer Demo"
pnpm run dev
```

Die App läuft dann unter <http://localhost:4200/>, der Demo-Verein unter <http://localhost:4200/demo>. Mails der App
fängt Mailpit unter <http://127.0.0.1:8025> ab. Nach jeder Schemaänderung ist `pnpm run db:generate` erneut nötig. `pnpm run demo` spielt den Demo-Verein jedes Mal frisch ein; andere
Vereine bleiben unberührt.

**Live-Verbindung (WebSocket):** Unter `pnpm run dev` gibt Vite den eigenen Server nicht heraus, der Hub lauscht darum
auf Port 4201, und [`apps/jufi/proxy.conf.json`](apps/jufi/proxy.conf.json) leitet `/<slug>/ws` dorthin; der Browser
spricht weiter nur mit 4200. Lädt der Dev-Server `server.ts` neu, schließt der neue Hub den alten samt Port. Ist 4201
belegt, meldet der Start „JuFi-Hub (Entwicklung) nicht gestartet“ und die App läuft ohne Live weiter. Ein anderer Port:
`JUFI_WS_DEV_PORT` in der `.env` **und** das Ziel in `proxy.conf.json` ändern, die Datei ist statisch. Im Betrieb hängt
der Hub am Server der App selbst, dort gibt es keinen zweiten Port.

Der Demo-Verein enthält zwei Untergruppen, vier Jungfischer (zwei ohne Einwilligung, davon Tim ohne Familie, und einer, der morgen volljährig wird und Jugendsprecher ist), zwei Familien und einen Betreuer, alles erfunden. Dazu kommen fünf Threads: „Wichtige Infos“, „Bowling“, „Zeltlager <Jahr>“ (das Folgejahr, nur für die Älteren), „🎣 Fischerfest“ (von selbst archiviert) und der Jugendsprecher-Austausch; `pnpm run demo` gibt ihre Adressen aus. Die Leitung hat alle Rechte, auch die Vereinseinstellungen, und der Verein einen erfundenen Kontakttext (`jugend@example.org`). Er hat bewusst kein Logo, damit das Initialen-Icon zu sehen ist. Er legt keine Zugänge an; die entstehen erst durch Einladung.

**Link-Vorschau lokal prüfen:** Wer einen Thread-Link in einen Messenger einfügt, lässt die Seite ohne Cookie abrufen und liest nur den Kopf. Die Tags setzt der Server in die Seite, die Angular sonst ausliefert (`apps/jufi/src/server/verein/vorschau.ts`); ob sie ankommen, zeigt `curl`: Ein Messenger führt kein JavaScript aus, der Browser zeigt also mehr, als er sieht.

```bash
pnpm run demo            # gibt die Adressen der Threads aus; den Teil hinter /t/ kopieren
curl -s http://localhost:4200/demo/t/<segment> | grep og:
```

Erwartet sind sechs `og:`-Zeilen: `og:type`, `og:site_name` (Anzeigename des Vereins), `og:title`, `og:image` (`<BASIS_URL>/demo/icon-512.png`), `og:image:width` und `og:image:height` (512). Bei „Bowling“ und „Wichtige Infos“ steht im `og:title` der Thread-Titel, beim Austausch, bei einer unbekannten ID und bei Unsinn hinter `/t/` der Anzeigename des Vereins („Jungfischer Demo“), und diese drei Antworten sind byte-gleich. Der Kopf der Antwort (`curl -s -D - -o /dev/null <adresse>`) trägt `Cache-Control: no-store`. Bei einem unbekannten Verein (`/gibtsnicht/t/abc`) gibt es keine `og:`-Zeilen. Das gehört zur Prüfung, wenn `angularApp` in `server.ts` wandert oder sich der Render-Modus ändert (Spec TP3 7.2). Gegen die Live-Adresse prüft dasselbe der Abschnitt 8 von `tools/pruefe-betrieb.sh` (siehe „Betrieb prüfen“).

Die Tests (`pnpm test`) laufen gegen echte Postgres-Datenbanken `jufi_test_<projekt>` und brauchen deshalb das
laufende `pnpm run db:up`. Sie legen ihre Datenbanken selbst an und setzen sie zurück, die Entwicklungsdatenbank
`jufi` berühren sie nicht.

## Mail

Der Mail-Arbeiter im Serverprozess versendet die Mails aus der Warteschlange (Einladung, „Passwort vergessen?"). Er
liest `SMTP_HOST` und `SMTP_PORT` (lokal 127.0.0.1:1025), `MAIL_ABSENDER`, `MAIL_ANTWORT` und `MAIL_BETREFF_PRAEFIX`
aus der `.env`. Lokal fängt Mailpit alles ab und zeigt es unter <http://localhost:8025>; echte Adressen erreicht nichts.

### Einladung lokal ausprobieren

```bash
pnpm run db:up
pnpm run dev
```

Den Admin wie unten anlegen, unter <http://localhost:4200/admin> anmelden und einen Verein mit der Option „per Mail"
anlegen. Die Einladungsmail liegt in Mailpit; den Link darin öffnen und den Zugang einrichten. Nur erfundene Daten
verwenden.

## Admin anlegen

Den ersten Plattform-Admin legt nur die Kommandozeile an; die Oberfläche kann das bewusst nicht. `BASIS_URL` in der
`.env` muss gesetzt sein, denn der Befehl baut daraus den Link.

```bash
pnpm run cli admin anlegen <name>
```

Der Befehl gibt einen Einrichtungslink aus (`<BASIS_URL>/admin/einrichten#<token>`). Den Link im Browser öffnen und
Passwort sowie TOTP setzen. Er gilt 1 Stunde und nur einmal, und er funktioniert nur unter der `BASIS_URL`, aus der er
gebaut wurde: Wer die App unter einer anderen Adresse betreibt, muss `BASIS_URL` vorher dorthin setzen.

Sind Passwort, TOTP und Passkeys verloren, setzt `pnpm run cli admin zuruecksetzen <name>` den Admin zurück
(löscht Passwort, Passkeys, TOTP und Sitzungen) und gibt einen neuen Einrichtungslink aus.
`pnpm run cli verein loeschen <slug>` löscht einen Verein mit allen Daten; zur Bestätigung ist der Slug einzutippen.
Das Admin-Protokoll bleibt dabei erhalten.

## Ende-zu-Ende-Test

Playwright spielt den Ablauf aus der Spezifikation (Abschnitt 9) im Browser durch, von der Vereinsanlage bis zum Kind mit
eigenem Passkey (virtueller Authenticator von Chromium), und misst die Layouts bei 375 × 812 und 1280 × 800, hell und
dunkel. Er liegt in `apps/jufi-e2e` und ist **nicht** Teil von `pnpm test`: Er baut App und CLI im Produktionsmodus (der
erste Lauf nach einer Änderung braucht dafür länger), die Tests selbst laufen gut eine Minute.

```bash
pnpm exec playwright install chromium   # einmalig
pnpm run db:up                          # Postgres und Mailpit
pnpm run e2e
```

Der Lauf startet den Bau auf Port 4210 gegen die Datenbank `jufi_test_e2e` mit eigenen, je Lauf erzeugten Geheimnissen;
die Entwicklungsdatenbank und ein laufendes `pnpm run dev` (Port 4200) bleiben unberührt. Belegt schon etwas Port 4210,
bricht der Lauf mit einer Meldung ab. Das Docker-Image enthält `apps/jufi-e2e` nicht.

## Rechtstexte

Impressum (`/impressum`) und Datenschutzerklärung (`/datenschutz`) liegen als Markdown in
`apps/jufi/src/rechtstexte/impressum.md` und `datenschutz.md`; die Plattformseite `/` und der Menüpunkt „Mehr“ verlinken
darauf.

> **Achtung, vor einem öffentlichen Betrieb ausfüllen:** Beide Dateien enthalten bisher nur die Gliederung und
> Platzhalter in eckigen Klammern (`[Name des Anbieters]` …). Sie sind **ohne Anmeldung erreichbar**. Den Inhalt muss
> der Eigentümer liefern; ohne ihn dürfen keine echten Nutzer eingeladen werden. Die Texte werden beim Bau eingebunden,
> eine Änderung braucht also ein neues Image.

## Prüfen

```bash
pnpm nx test entwurf --watch=false
pnpm nx typecheck entwurf
pnpm format:check
```

Die fachlichen Regeln liegen als reine Funktionen in `apps/entwurf/src/app/regeln/`, die Aufgaben und Prüfregeln des
Testmodus in `apps/entwurf/src/app/testmodus/`.

## Ausliefern

Der Entwurf wird als nginx-Image (`Dockerfile.entwurf`) lokal gebaut und per SSH auf den Server übertragen; dort
wohnt der Dienst `jufi-entwurf` in der gemeinsamen Compose-Datei hinter Traefik.

Vor dem ersten Deploy:

1. DNS-Eintrag `test.jufi-app.de` auf den Server.
2. Den Block aus [`deploy/jufi-entwurf.yml`](deploy/jufi-entwurf.yml) in
   `/home/paperless/paperless-ngx/docker-compose.yml` übernehmen.
3. `cp deploy/env.deploy.example .env.deploy` und Serverzugang sowie `JUFI_ENTWURF_WHATSAPP` (Nummer für
   Rückmeldungen, international ohne `+`) eintragen. Die Datei steht in `.gitignore`.
4. Docker lokal.

```bash
bash tools/deploy-entwurf.sh --dry-run
bash tools/deploy-entwurf.sh
```

Der Probelauf prüft Format, Tests und Typen, baut Bündel und Image und macht einen Rauchtest gegen einen lokalen
Container, ohne etwas zu übertragen. Der echte Lauf überträgt das Image und startet nur `jufi-entwurf` neu.

Der Entwurf wohnt unter `https://test.jufi-app.de/entwurf/` (Traefik-Regel `Host && PathPrefix(/entwurf)`); die
Wurzel der Domain gehört seit Etappe 6 der echten App. Das Image enthält deshalb keine nginx-Willkommensseite mehr, und
`/` antwortet dort nicht mit einer Seite (403 oder 404; der Rauchtest prüft das). Ein alter Link auf die Wurzel von
`jufi-app.sideshow-systems.de` landet damit in der App statt im Entwurf; Links der Form `/entwurf/…` bleiben im Entwurf.
**Reihenfolge beim Ausrollen: erst der Entwurf, dann die App** (Spec 2.3).

## Deployment der echten App

Die echte App wird als Node-Image (`Dockerfile`, `sideshowsystems/jufi`) lokal gebaut und per SSH übertragen, ohne
Registry. Auf dem Server wohnt sie wie der Entwurf in der gemeinsamen Compose-Datei hinter Traefik, unter
<https://test.jufi-app.de>, mit eigener Datenbank (`jufi-db`), einem Migrationsdienst (`jufi-migrate`) und einer
Mail-Falle (`jufi-mailpit`): solange `JUFI_SMTP_HOST` leer ist, verlässt keine Mail den Server (Abschnitt „Mail
umstellen“). `app-test.jufi-app.de` war die frühere Adresse und leitet nur noch mit 301 (samt Pfad und Anfrage) auf
`test.jufi-app.de` um; die Umleitung entfällt, sobald der DNS-Eintrag von `app-test` weg ist.

**Passkeys und der Umzug:** Passkeys hängen an der Domain. Alle, die unter `app-test` eingerichtet wurden, gelten unter
`test.jufi-app.de` nicht mehr; Passwort und TOTP bleiben. Betroffen sind nur Testzugänge, denn echte Jugendleiter sind
noch nicht eingeladen.

Einmalig von Hand auf dem Server (das Skript legt dort nichts an, es prüft nur):

1. DNS-Eintrag `test.jufi-app.de` auf den Server (steht schon für den Entwurf). `app-test.jufi-app.de` bleibt nur, solange
   die Umleitung gebraucht wird.
2. Den Block aus [`deploy/jufi-services.yml`](deploy/jufi-services.yml) in
   `/home/paperless/paperless-ngx/docker-compose.yml` übernehmen (Dienste unter `services:`, `jufi-pgdata` unter
   `volumes:`); bei einer bestehenden Installation die geänderten Teile (Domain, Umleitung, SMTP-Schalter), dazu den
   Block aus [`deploy/jufi-entwurf.yml`](deploy/jufi-entwurf.yml) (`PathPrefix`).
3. Die Variablen aus [`deploy/env.jufi.example`](deploy/env.jufi.example) in der dortigen `.env` **auf dem Server
   erzeugen** (Befehl steht in der Datei). `JUFI_TOTP_ENC_KEY` zusätzlich in den Passwortmanager.

4. `bash tools/install-backup.sh` ausführen: ohne `jufi-tools/backup.sh` auf dem Server bricht Tor 5 ab (Abschnitt „Sicherung“).
   Bei einer Neuinstallation, in der `jufi-db` noch nie lief, `--no-run` anhängen: der Probelauf braucht eine laufende
   Datenbank, und die entsteht erst mit dem ersten `pnpm run deploy:app`. Danach den Aufruf ohne `--no-run` wiederholen.

Lokal: `.env.deploy` wie beim Entwurf, Docker und die Entwicklungsdatenbank (`pnpm run db:up`, für die Tests).

```bash
pnpm run deploy:app --dry-run   # Tore, Bau, Rauchtest; überträgt nichts
pnpm run deploy:app             # dazu Übertragen, Ausrollen, Nachprüfen
```

Der Probelauf prüft Format, Tests und Typen, baut das Image und startet es gegen eine Wegwerf-Datenbank: Migrationen,
`/healthz` mit dem gebauten Commit, eine Seite unter dem Host der Domain, Docker-Healthcheck und die CLI im Image. Der
echte Lauf prüft zusätzlich, dass Compose-Block und `JUFI_`-Variablen auf dem Server stehen, überträgt das Image, setzt
`JUFI_IMAGE_TAG` auf den Commit, startet nur `jufi` (Datenbank, Migration und Mailpit kommen über `depends_on` mit)
und vergleicht den Commit in `/healthz` von innen und von außen.

**Live-Verbindung:** Der WebSocket unter `/<slug>/ws` läuft über denselben Port 4000 wie die Seiten; Traefik reicht den
Upgrade ohne eigene Regel durch. Ob er die App erreicht, prüft `tools/pruefe-betrieb.sh --slug <slug>` (Abschnitt
„Betrieb prüfen“). Beim Herunterfahren schließt die App die Sockets mit 1012, die Clients verbinden sich danach neu.
Änderungen älter als 90 Tage räumt die App beim Start und dann täglich selbst auf.

Die Tore im Einzelnen: 1 sauberer Stand, 2 Format, Tests und Typen, 3 Image bauen, 4 Rauchtest (dazu gehört das
Initialen-Icon: `fc-match` muss DejaVu Sans Bold im Image finden, und das ausgelieferte Icon in 192 und 512 px muss
Buchstaben zeigen, `tools/pruefe-icon.mjs`). Bis hier läuft auch `--dry-run`. Weiter: 5 Vorbedingungen auf dem Server
(Dienste, `JUFI_`-Variablen, **Sicherungsskript `jufi-tools/backup.sh`**), 5b Dump vor der Migration (ohne restic, **vor**
dem Übertragen, damit ein gescheiterter Dump den Server unberührt lässt; gibt es einen Container von `jufi-db`, der nicht
läuft, bricht der Deploy ab, nur ohne Container gilt es als erstes Ausrollen), 6 Übertragen und Ausrollen, 7 Nachprüfen.
Fehlt `jufi-tools` auf dem Server, bricht Tor 5 ab und verweist auf `tools/install-backup.sh`.

**Erster Admin** — die CLI liegt im Image, `BASIS_URL` kommt aus der Umgebung des Dienstes:

```bash
cd /home/paperless/paperless-ngx
docker compose run --rm --no-deps -T -l traefik.enable=false jufi node apps/cli/dist/main.js admin anlegen <name>
```

Der ausgegebene Link führt nach `https://test.jufi-app.de/admin/einrichten#…` und gilt 1 Stunde.

**Warum `run` und nicht `exec`:** `jufi` hat ein Speicherlimit von 256 MiB. Die CLI als zweiter Node-Prozess im laufenden
Container sprengt es, der Kernel beendet dann Prozesse (Exit 137, oft ohne Ausgabe) und startet dabei die App neu. `run`
startet einen eigenen Wegwerf-Container mit demselben Image und derselben Umgebung; `--no-deps` lässt Datenbank und
Migration in Ruhe, `-l traefik.enable=false` hält Traefik davon ab, Anfragen an den Wegwerf-Container zu schicken. Dasselbe
gilt für jede CLI-Aufgabe, etwa den Demo-Verein: `… jufi node apps/cli/dist/main.js demo einspielen`.

**Mails lesen** — Mailpit ist absichtlich nicht öffentlich (die Mails enthalten Einladungs- und Zurücksetzen-Links),
sondern nur an `127.0.0.1` des Servers gebunden:

```bash
ssh -L 8025:127.0.0.1:8025 <server>
```

Dann im Browser <http://127.0.0.1:8025>. Läuft lokal schon Mailpit auf 8025, einen anderen lokalen Port nehmen
(`-L 18025:127.0.0.1:8025`).

## Sicherung

Die Postgres-Datenbank (`jufi-db`) ist das einzige Exemplar der Vereinsdaten. Deshalb läuft auf dem Server **täglich um
03:40** (HWYD sichert um 03:20) `jufi-tools/backup.sh --local` aus `/etc/cron.d/jufi-backup`:

1. `pg_dump -Fc` nach `/home/paperless/paperless-ngx/jufi-backups/jufi-<Zeit>.dump`.
2. Den Dump **prüfen** (`pg_restore --list`, mindestens eine Tabelle mit Daten). Geschrieben wird erst nach
   `jufi-<Zeit>.dump.part` und nach bestandener Prüfung umbenannt; ein ungültiger oder abgebrochener Dump hinterlässt nie
   ein `jufi-*.dump`. Die Dumps sind nur für den Besitzer lesbar (`umask 077`), denn sie enthalten Klartext-Daten von
   Kindern.
3. Lokale Dumps nach 30 Tagen löschen (`LOCAL_KEEP_DAYS`).
4. Verschlüsselt mit restic nach außen schieben (Hetzner-Konto wie bei HWYD, SFTP, eigenes Repository `backups/jufi`, Tag `jufi-db`),
   prüfen, dass der Snapshot den Dump in voller Größe enthält, und erst dann aufräumen: 7 tägliche, 4 wöchentliche und
   6 monatliche Stände.

Das Protokoll ist die einzige Spur des nächtlichen Laufs: `tail -20 /var/log/jufi-backup.log`. Gelegentlich
hineinsehen. Ohne `JUFI_RESTIC_REPOSITORY` in der `.env` endet der Lauf nach dem geprüften Dump und sagt, dass keine Kopie
außer Haus entsteht; das schützt gegen eine kaputte Migration, nicht gegen Hardwareverlust.

**Einrichten** (einmalig und nach jeder Änderung an den Skripten, vom Entwicklungsrechner aus; `SSH_TARGET` in
`.env.deploy` muss die Form `root@host` haben, weil der Cron-Eintrag root gehört):

```bash
bash tools/install-backup.sh             # Skripte nach jufi-tools, restic bei Bedarf, Cron, Probelauf mit restic
bash tools/install-backup.sh --dry-run   # nur zeigen
bash tools/install-backup.sh --no-cron   # nur die Skripte auffrischen
bash tools/install-backup.sh --no-run    # ohne Probelauf
```

Der Probelauf am Ende beweist restic, Schlüssel, `known_hosts`, Snapshot-Prüfung und Aufräumen einmal im Wachzustand,
statt sie um 03:40 zum ersten Mal zu versuchen. Er ist nur mit einem erreichbaren Server und einer echten Ablage
beweisbar.

**Wohin das restic-Passwort gehört:** `JUFI_RESTIC_REPOSITORY` (`sftp:sidesha@www417.your-server.de:backups/jufi`, dasselbe Konto wie HWYD, daneben dessen `backups/hwyd`) und
`JUFI_RESTIC_PASSWORD` stehen in der geteilten `.env` auf dem Server (Vorlage: `deploy/env.jufi.example`), das Passwort
**zusätzlich im Passwortmanager**. Es ist ein **eigenes** Passwort für ein eigenes Repository, nicht das von HWYD; ohne
den Passwortsatz ist die Ablage nicht lesbar, und auf dem Server liegt er neben dem, was er schützt. Die Skripte kennen
nur die `JUFI_`-Namen und fallen nie auf ein blankes `RESTIC_REPOSITORY` zurück (eine zweite App in der geteilten `.env`
würde sonst in dieselbe Ablage schreiben). Für root braucht der Server außerdem einen SSH-Schlüssel **ohne
Passphrase** (Cron hat keinen Agenten) und den Wirtsschlüssel des Ziels in `/root/.ssh/known_hosts` (einmal von Hand
`sftp <benutzer@wirt>`). `backup.sh` prüft beides vorher und schreibt ins Protokoll, was fehlt.

Einen Dump von Hand auf den Entwicklungsrechner holen: `bash tools/backup.sh` (nach `backups/`, ohne `--local` über SSH).

Ob die Sicherung auch ohne Server funktioniert, zeigt `bash tools/probe-sicherung.sh` (Wegwerf-Postgres, braucht Docker):
ein gelungener Dump ist lesbar und enthält Tabellen, ein gescheiterter hinterlässt keine halbe Datei, ein abgeschnittener
Dump oder eine abweichende Zeilenzahl fällt bei der Wiederherstellungsprobe auf. Der restic-Zweig ist dort nicht
abgedeckt. `bash tools/probe-deploy-tor.sh` (ohne Docker, mit ssh-Stub) belegt die Entscheidung in Tor 5b und `restic_env`.

## Wiederherstellungsprobe

**Ein nie geprobter Restore ist kein Restore.** Vierteljährlich, im **Januar, April, Juli und Oktober**, auf dem Server:

```bash
cd /home/paperless/paperless-ngx && set -a && . ./.env && set +a && jufi-tools/restore-test.sh
```

Das Skript holt den neuesten restic-Snapshot (Tag `jufi-db`), startet ein Wegwerf-Postgres (`postgres:17-alpine`, 256 MB,
ohne veröffentlichten Port, wird immer wieder entfernt), spielt den Dump ein und vergleicht die Zeilenzahl **jeder**
Tabelle mit der laufenden Datenbank (`jufi-db`). Die Tabellenliste kommt aus der Datenbank selbst und nicht aus einer
festen Liste, so fällt auch eine Tabelle auf, die im Dump fehlt.

**Bestanden** heißt: Ausgabe `✓ Restore-Probe bestanden: jede Tabelle hat dieselbe Zeilenzahl wie die Quelle.` und Exit 0.
Jede abweichende, fehlende oder zusätzliche Tabelle steht mit `✗` und Namen da, das Skript endet dann mit Fehler. Weil
der Vergleich gegen die **laufende** Datenbank geht, kann eine Tabelle seit dem Lauf um 03:40 gewachsen sein (Einladungen,
Sitzungen); eine solche Abweichung ist erklärbar, eine fehlende Tabelle oder eine leere Wiederherstellung nie. Dann hilft
es, die Probe gleich nach einem frischen `jufi-tools/backup.sh --local` zu machen.

Weitere Aufrufe: `--dump <datei>` für einen bestimmten Dump (auch ein lokaler aus `backups/`), `--source remote` zum
Vergleich gegen die Server-Datenbank vom Entwicklungsrechner aus, `--no-compare` nur zum Lesen.

## Rückfall

```bash
bash tools/rollback.sh --list        # Image-Tags auf dem Server und der eingetragene JUFI_IMAGE_TAG
bash tools/rollback.sh               # auf den Commit vor HEAD
bash tools/rollback.sh <sha>         # auf einen bestimmten Commit
bash tools/rollback.sh <sha> --trotz-migration
```

Das Skript setzt `JUFI_IMAGE_TAG` in der `.env` auf den Ziel-SHA, startet nur `jufi` und prüft `/healthz` auf den Commit
(nicht nur auf „ok“, denn die alte App würde ebenfalls ok melden). Das Image muss als Tag auf dem Server liegen; JuFi hat
keine Registry, `--list` zeigt, was da ist.

**Der Migrationswächter:** Ein Rückfall dreht den Code zurück, nicht das Datenbankschema; Migrationen laufen nur
vorwärts. Unterscheiden sich `prisma/migrations` zwischen Ziel und `HEAD`, bricht das Skript ab, **bevor es den Server
berührt**. Ob das alte Image mit dem neuen Schema läuft, entscheidet ein Mensch (`--trotz-migration`). Sonst bleibt der
Weg über den Dump: `deploy.sh` zieht vor jeder Migration einen in `jufi-backups` (Tor 5b), der sich mit
`jufi-tools/restore-test.sh --dump <datei> --no-compare` prüfen und von Hand einspielen lässt.

## Mail umstellen

Auf der Testumgebung fängt `jufi-mailpit` alle Mails ab. Echter Versand ist ein Schalter in der `.env` auf dem Server:

```
JUFI_SMTP_HOST=smtp.example.org
JUFI_SMTP_PORT=587
JUFI_SMTP_USER=app@jufi-app.de
JUFI_SMTP_PASS=…
```

Port 465 ist implizites TLS, auf 587 handelt nodemailer STARTTLS aus. Ein `$` im Passwort muss als `$$` stehen, weil
Compose es sonst als Variable liest. Ist `JUFI_SMTP_HOST` leer oder fehlt die Zeile, bleibt es bei Mailpit; ein Deploy
ändert das nie von selbst. Voraussetzung sind SPF, DKIM und DMARC für `jufi-app.de` bei Hetzner (der Eigentümer richtet
sie ein).

Umschalten und prüfen:

```bash
# auf dem Server, nach dem Eintragen der vier Zeilen
cd /home/paperless/paperless-ngx && docker compose up -d jufi

# vom Entwicklungsrechner; das Skript liegt nicht im Image und nicht auf dem Server, daher über stdin
ssh <server> 'cd /home/paperless/paperless-ngx && docker compose exec -T jufi node --input-type=module - <eigene Adresse>' < tools/mail-testen.mjs
```

`tools/mail-testen.mjs` schickt eine Klartext-Testmail mit der Umgebung der App und gibt nur Message-ID und Host aus,
nie Zugangsdaten. Lokal mit gesetzter Umgebung geht auch `node tools/mail-testen.mjs <adresse>`. In der empfangenen Mail zeigt „Originalnachricht anzeigen“ bei Gmail:
`spf=pass`, `dkim=pass`, `dmarc=pass`. Zurück zu Mailpit: die vier Zeilen leeren oder entfernen und `up -d jufi`.

Die DNS-Einträge allein prüft `bash tools/pruefe-betrieb.sh --mail jufi-app.de --dkim-selector <selektor>`.

## Betrieb prüfen

Beide Skripte ändern nichts.

```bash
bash tools/pruefe-betrieb.sh [--url <basis>] [--slug <slug>] [--ohne-entwurf] [--mail <domain>] [--dkim-selector <name>]
bash tools/pruefe-texte.sh
```

`pruefe-betrieb.sh` prüft die Live-Adresse (Vorgabe: `APP_URL`, also `https://test.jufi-app.de`) und meldet **alles** auf
einmal, statt beim ersten `✗` abzubrechen; Exit 1, sobald eines steht: `/healthz` mit Version und Commit, die
Plattformseite `/` (die App, nicht der Entwurf), den Entwurf unter `/entwurf/` samt Gegenprobe, dass `/` nicht der
Entwurf ist, bei `test.jufi-app.de` den Umzug (`app-test` → 301 mit Pfad und Anfrage), die Content-Security-Policy, mit
`--slug` Manifest und Icons (192 und 512 px, mit Zeichnung) sowie den WebSocket (Abschnitt 7: ein Upgrade ohne Cookie auf
`/<slug>/ws` muss mit 401 abgelehnt werden: dann hat er Traefik und die App erreicht) und die Link-Vorschau (Abschnitt 8: `/<slug>/t/vorschaupruefung`, eine ID, die es nicht gibt, muss mit 200, `Cache-Control: no-store` und dem `og:image` der App antworten; geprüft wird die Kette aus Traefik, App und Angular-Seite, nicht ein Thread), mit `--mail` SPF, DMARC (Abschnitt 9) und mit `--dkim-selector` DKIM
(Abfrage über 1.1.1.1). Es braucht `curl`, `node` und `dig`. Der Selektor kommt von Hetzner.

`pruefe-texte.sh` zeigt mit Zeilennummern, was Impressum, Datenschutzerklärung und der Einwilligungstext (Fassung 1) noch
an Platzhaltern haben, und endet mit Exit 1, solange etwas offen ist, mit Exit 0, wenn alles leer ist. Es ist **kein**
Tor des Deploys: die Testumgebung darf mit Platzhaltern laufen, nur die Einladung echter Jugendleiter muss warten.

## Abnahme von Etappe 6

Der Rest ist Handarbeit und Serverarbeit. **Nichts davon läuft ohne das Wort des Eigentümers**; vorher ist Etappe 6 fertig gebaut, aber nicht in Betrieb. Die Reihenfolge ist nicht beliebig.

**A. Vom Eigentümer vorzubereiten (außerhalb des Repos):**

1. Das Hetzner-Konto, in das schon HWYD sichert (SFTP, ohne Shell), und der dort schon eingerichtete SSH-Schlüssel ohne Passphrase für root auf dem Server werden mitbenutzt — kein neues Konto nötig. `JUFI_RESTIC_REPOSITORY=sftp:sidesha@www417.your-server.de:backups/jufi` (Verzeichnis neben `backups/hwyd`; `restic init` legt es an) und ein **neues** `JUFI_RESTIC_PASSWORD` (nicht das von HWYD) in die `.env` auf dem Server, das Passwort zusätzlich in den Passwortmanager. Ohne dieses Passwort ist die Ablage nicht lesbar.
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
