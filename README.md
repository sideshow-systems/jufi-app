# JuFi App

Plattform für Jugendgruppen von Vereinen, zuerst für die Jungfischer eines Fischereivereins: Termine, Umfragen,
Helferlisten, Fahrgemeinschaften, Kosten und Dokumente an einem Ort statt verstreut in WhatsApp-Gruppen.

Das Repo enthält bisher **Teilprojekt 1: den klickbaren Entwurf** (`apps/entwurf`). Er läuft nur im Browser, ohne
Server und ohne Anmeldung, mit erfundenen Beispieldaten. Testpersonen spielen ihn per Link durch, lösen Aufgaben im
Testmodus und schicken eine Rückmeldung per WhatsApp.

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

Der Demo-Verein enthält zwei Untergruppen, drei Jungfischer (einer ohne Einwilligung, einer, der morgen volljährig wird und Jugendsprecher ist), zwei Familien und einen Betreuer, alles erfunden. Er legt keine Zugänge an; die entstehen erst durch Einladung.

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

## Deployment der echten App

Die echte App wird als Node-Image (`Dockerfile`, `sideshowsystems/jufi`) lokal gebaut und per SSH übertragen, ohne
Registry. Auf dem Server wohnt sie wie der Entwurf in der gemeinsamen Compose-Datei hinter Traefik, unter
<https://app-test.jufi-app.de>, mit eigener Datenbank (`jufi-db`), einem Migrationsdienst (`jufi-migrate`) und einer
Mail-Falle (`jufi-mailpit`): auf der Testumgebung verlässt keine Mail den Server.

Einmalig von Hand auf dem Server (das Skript legt dort nichts an, es prüft nur):

1. DNS-Eintrag `app-test.jufi-app.de` auf den Server.
2. Den Block aus [`deploy/jufi-services.yml`](deploy/jufi-services.yml) in
   `/home/paperless/paperless-ngx/docker-compose.yml` übernehmen (Dienste unter `services:`, `jufi-pgdata` unter
   `volumes:`).
3. Die Variablen aus [`deploy/env.jufi.example`](deploy/env.jufi.example) in der dortigen `.env` **auf dem Server
   erzeugen** (Befehl steht in der Datei). `JUFI_TOTP_ENC_KEY` zusätzlich in den Passwortmanager.

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

**Erster Admin** — die CLI liegt im Image, `BASIS_URL` kommt aus der Umgebung des Dienstes:

```bash
cd /home/paperless/paperless-ngx
docker compose exec jufi node apps/cli/dist/main.js admin anlegen <name>
```

Der ausgegebene Link führt nach `https://app-test.jufi-app.de/admin/einrichten#…` und gilt 1 Stunde.

**Mails lesen** — Mailpit ist absichtlich nicht öffentlich (die Mails enthalten Einladungs- und Zurücksetzen-Links),
sondern nur an `127.0.0.1` des Servers gebunden:

```bash
ssh -L 8025:127.0.0.1:8025 <server>
```

Dann im Browser <http://127.0.0.1:8025>. Läuft lokal schon Mailpit auf 8025, einen anderen lokalen Port nehmen
(`-L 18025:127.0.0.1:8025`).
