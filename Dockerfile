# JuFi App (Teilprojekt 2) -- Laufzeit-Image fuer den gemeinsamen Hetzner-Server (arm64).
# Muster: ../hwyd/Dockerfile. Der Entwurf hat sein eigenes Dockerfile.entwurf.
#
# Gebaut wird auf dem Entwicklungsrechner, nicht auf dem Server: der teilt 3,7 GB
# RAM ohne Swap mit paperless, HWYD und weiteren Apps, ein Angular-Production-Build
# dort weckte den OOM-Killer. Rechner und Server sind beide arm64, der Bau ist
# also nativ -- kein QEMU, kein Multi-Arch-Manifest.
#
# Welche Dateien hereinkommen, regelt Dockerfile.dockerignore (nicht
# .dockerignore, die gehoert dem Entwurf; Begruendung dort).
#
# Vier Stufen, damit im Endbild nur liegt, was zur Laufzeit gebraucht wird: kein
# pnpm-Store, keine Angular-Werkzeuge, keine Quellen.

# --- Stufe 1: Abhaengigkeiten -------------------------------------------------
# Eigene Stufe, damit der Docker-Cache sie behaelt, solange die Sperrdatei
# unveraendert ist. Das ist der langsame Teil.
FROM node:22-alpine AS deps
WORKDIR /src

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Die Angular-Apps haben bewusst keine eigene package.json -- sie werden ueber
# project.json konfiguriert und ziehen ihre Abhaengigkeiten aus der Wurzel. Die
# Workspace-Pakete dagegen muessen hier stehen, sonst passt die Sperrdatei nicht --
# ausser apps/jufi-e2e, das nur Playwright im Paket haelt und nicht ins Image gehoert;
# ein fehlender Importer stoert frozen-lockfile nicht.
COPY apps/cli/package.json apps/cli/
COPY libs/auth/package.json libs/auth/
COPY libs/db/package.json libs/db/
COPY libs/domain/package.json libs/domain/
RUN pnpm install --frozen-lockfile

# --- Stufe 2: Bauen -----------------------------------------------------------
FROM deps AS build
WORKDIR /src

COPY . .

# Prisma-Client zuerst: libs/db importiert ihn, ohne ihn scheitern beide Baue.
# Er wird hier frisch erzeugt; der lokale Stand (libs/db/src/generated) ist in
# Dockerfile.dockerignore ausgeschlossen, damit kein veralteter Client aus einem
# vergessenen `pnpm run db:generate` ins Image rutscht.
#
# `prisma generate` verbindet sich nie, laedt aber prisma.config.ts -- und die
# loest env('DATABASE_URL') sofort auf und bricht ohne den Wert ab. Deshalb ein
# Platzhalter, und zwar nur in dieser Stufe: Stufe 4 beginnt mit einem frischen
# FROM, im Endbild ist die Variable nicht gesetzt. Eine fehlende DATABASE_URL im
# Betrieb meldet sich dann als solche und nicht als Verbindungsfehler gegen
# einen Platzhalter.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN pnpm prisma generate

# Der Commit muss von aussen herein: Dockerfile.dockerignore laesst .git nicht in
# den Kontext. tools/deploy.sh gibt den SHA als Build-Argument mit, und
# tools/version-stamp.mjs liest ihn als JUFI_COMMIT; ohne Argument meldet
# /healthz einen leeren Commit, und der Rauchtest faellt darueber.
#
# Hinter `prisma generate`, weil ein neues Argument alle folgenden Schichten
# ungueltig macht und die davor im Cache bleiben sollen.
ARG GIT_COMMIT=
ENV JUFI_COMMIT=$GIT_COMMIT

# `nx sync --yes` schreibt die TypeScript-Projektreferenzen, die Nx sonst
# interaktiv erfragen wuerde -- im Container antwortet niemand. `nx build jufi`
# zieht ueber dependsOn das Ziel stamp mit und schreibt damit
# apps/jufi/src/version.generated.ts. Die CLI kommt mit ins Image, damit auf dem
# Server `node apps/cli/dist/main.js admin anlegen <name>` den ersten Admin
# anlegen kann (README, Deployment der echten App).
RUN pnpm nx sync --yes \
	&& pnpm nx build jufi --configuration=production \
	&& pnpm nx build cli --configuration=production

RUN node tools/runtime-package.mjs /src/runtime-package.json

# --- Stufe 3: Laufzeit-Abhaengigkeiten ---------------------------------------
# Nur die Pakete, die nicht gebuendelt werden konnten. npm statt pnpm, weil hier
# ein flacher, symlinkfreier Baum gebraucht wird -- pnpm-Symlinks ueber
# Stufengrenzen zu kopieren fuehrt zu Modulen, die im Endbild ins Leere zeigen.
FROM node:22-alpine AS runtime-deps
WORKDIR /app

COPY --from=build /src/runtime-package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

# --- Stufe 4: Laufzeit --------------------------------------------------------
FROM node:22-alpine AS runtime

# tini als PID 1: Node allein gibt Signale nicht sauber weiter, und ohne das
# dauert jedes `docker compose stop` zehn Sekunden bis zum SIGKILL -- und der
# Mail-Arbeiter kaeme nie dazu, einen laufenden Versand zu beenden (server.ts).
# curl fuer den Healthcheck.
# font-dejavu und fontconfig fuer das Initialen-Icon (server/verein/logo.ts):
# sharp zeichnet den Text ueber librsvg, und das findet im schlanken Alpine-Image
# keine einzige Schrift -- die Initialen blieben ohne Fehlermeldung unsichtbar.
# Verworfen: eine Schriftdatei im Repo.
RUN apk add --no-cache tini curl font-dejavu fontconfig

ENV NODE_ENV=production \
	PORT=4000 \
	TZ=Europe/Berlin

WORKDIR /app

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=runtime-deps /app/package.json ./package.json
COPY --from=build /src/dist/apps/jufi ./dist/apps/jufi
# Nur das Buendel, nicht die .d.ts-Dateien, die der Bau daneben legt.
COPY --from=build /src/apps/cli/dist/main.js ./apps/cli/dist/main.js

# Schema und Migrationen fuer `prisma migrate deploy` im Dienst jufi-migrate.
# prisma.config.ts gehoert dazu: seit Prisma 7 steht die Verbindung dort und
# nicht mehr im Schema.
COPY --from=build /src/prisma ./prisma
COPY --from=build /src/prisma.config.ts ./prisma.config.ts

# Nicht als root. Das node-Konto bringt das Basisbild mit; die App schreibt
# nirgends hin ausser in die Datenbank, braucht also kein beschreibbares
# Verzeichnis.
USER node

EXPOSE 4000

# Prueft, was ein Nutzer merken wuerde: Node **und** Datenbank (server/health.ts).
# Ein Healthcheck, der nur den Port anfasst, meldet eine App gesund, die auf jede
# Anfrage 500 antwortet. start-interval wie beim Entwurf: Traefik nimmt den
# Dienst erst bei "healthy" auf, und ohne die schnelle Startphase fehlte die
# Seite nach jedem Ausrollen bis zur ersten regulaeren Pruefung.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=1s --retries=3 \
	CMD curl -fsS http://127.0.0.1:4000/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/apps/jufi/server/server.mjs"]

# Zum Schluss, damit ein neuer Commit keine Schicht darueber ungueltig macht:
# Labels sind reine Metadaten. Sie sind der Weg, `docker images` und
# `docker inspect` auf dem Server zu fragen, was in einem Tag steckt -- ohne den
# Container zu starten.
ARG APP_VERSION=
ARG GIT_COMMIT=
LABEL org.opencontainers.image.title="jufi" \
	org.opencontainers.image.description="JuFi App" \
	org.opencontainers.image.version="$APP_VERSION" \
	org.opencontainers.image.revision="$GIT_COMMIT"
