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
cp .env.example .env     # SESSION_SECRET und TOTP_ENC_KEY eintragen (Hinweise in der Datei); pnpm run dev laeuft auch ohne, der Produktionsstart bricht ohne sie ab
pnpm run db:up           # Postgres (127.0.0.1:5433) und Mailpit
pnpm prisma migrate dev  # Schema in die Entwicklungsdatenbank
pnpm run db:generate     # Prisma-Client erzeugen; er liegt nicht im Repo
pnpm run demo            # erfundener Verein "Jungfischer Demo"
pnpm run dev
```

Die App läuft dann unter <http://localhost:4200/>, der Demo-Verein unter <http://localhost:4200/demo>. Mails der App
fängt Mailpit unter <http://127.0.0.1:8025> ab. Nach jeder Schemaänderung ist `pnpm run db:generate` erneut nötig. `pnpm run demo` spielt den Demo-Verein jedes Mal frisch ein; andere
Vereine bleiben unberührt.

Die Tests (`pnpm test`) laufen gegen echte Postgres-Datenbanken `jufi_test_<projekt>` und brauchen deshalb das
laufende `pnpm run db:up`. Sie legen ihre Datenbanken selbst an und setzen sie zurück, die Entwicklungsdatenbank
`jufi` berühren sie nicht.

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
