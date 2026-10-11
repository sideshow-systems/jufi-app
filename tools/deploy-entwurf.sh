#!/usr/bin/env bash
#
# Deploy des klickbaren Entwurfs auf den Hetzner-Server (Spec TP1 8.3).
# Streng sequenziell, jeder Schritt ein Tor; Muster wie ../hwyd/tools/deploy.sh
# --transfer.
#
# Gebaut wird hier, nicht dort: der Server teilt 3,7 GB RAM ohne Swap mit
# paperless, HWYD und weiteren Apps. Rechner und Server sind beide arm64, der
# lokale Bau ist also nativ. Das Image geht per SSH hinueber, ohne Registry.
#
# Der Dienst wohnt in der gemeinsamen Compose-Datei von paperless. Jeder
# Compose-Aufruf nennt deshalb ausdruecklich `jufi-entwurf`; ein blankes
# `up -d` wuerde die anderen Apps mit anfassen.
#
# Aufruf:
#   tools/deploy-entwurf.sh --dry-run   Tore 1–4 (bauen, Rauchtest), nichts uebertragen
#   tools/deploy-entwurf.sh             alles, inklusive Uebertragung und Ausrollen

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  ⚠ %s\033[0m\n' "$*"; }

DRY_RUN=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--dry-run) DRY_RUN=1; shift ;;
		*) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
	esac
done

# .env.deploy liefert Serverzugang und WhatsApp-Nummer (Vorlage: deploy/env.deploy.example).
if [[ -f .env.deploy ]]; then
	set -a
	# shellcheck disable=SC1091
	source .env.deploy
	set +a
fi
: "${SSH_TARGET:=}"
: "${SSH_KEY:=}"
: "${REMOTE_DIR:=/home/paperless/paperless-ngx}"
: "${REMOTE_COMPOSE:=docker-compose.yml}"
: "${JUFI_ENTWURF_WHATSAPP:=}"
export JUFI_ENTWURF_WHATSAPP

IMAGE=sideshowsystems/jufi-entwurf
SERVICE=jufi-entwurf
APP_URL=https://jufi-app.sideshow-systems.de
SMOKE_PORT="${SMOKE_PORT:-8089}"

SSH_OPTS=(-o BatchMode=yes)
[[ -n "$SSH_KEY" ]] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")
remote() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }

# --- Tor 1: sauberes Arbeitsverzeichnis --------------------------------------
# Sonst laeuft ein Stand, der in keinem Commit existiert, und das Label
# image.revision luegt.
step 'Tor 1: Git-Arbeitsverzeichnis'
[[ -z "$(git status --porcelain)" ]] || { git status --short; fail 'Nicht sauber. Erst committen.'; }
SHA="$(git rev-parse --short=12 HEAD)"
SHA_FULL="$(git rev-parse HEAD)"
note "HEAD: $SHA"

# --- Tor 2: Format, Tests, Typen ---------------------------------------------
# Ersetzt, was ohne CI fehlt.
step 'Tor 2: Format, Tests und Typen'
LOG="$(mktemp)"
pnpm exec prettier --check . >"$LOG" 2>&1 || { tail -20 "$LOG" >&2; fail 'Formatierung weicht ab (pnpm format).'; }
pnpm nx test entwurf --watch=false --skip-nx-cache >"$LOG" 2>&1 || { tail -40 "$LOG" >&2; fail 'Tests sind rot.'; }
pnpm nx typecheck entwurf --skip-nx-cache >"$LOG" 2>&1 || { tail -40 "$LOG" >&2; fail 'Typpruefung ist rot.'; }
rm -f "$LOG"
note 'Format, Tests und Typpruefung gruen'

# --- Tor 3: Bauen -------------------------------------------------------------
# --skip-nx-cache: die Nummer steckt in einer ignorierten, erzeugten Datei, die
# Nx nicht in den Hash nimmt. Ein Cache-Treffer lieferte sonst die Nummer des
# vorigen Baus aus.
step "Tor 3: Buendel und Image bauen ($IMAGE:$SHA)"
if [[ -z "$JUFI_ENTWURF_WHATSAPP" ]]; then
	[[ "$DRY_RUN" -eq 1 ]] || fail 'JUFI_ENTWURF_WHATSAPP fehlt in .env.deploy — ohne Nummer kommt keine Rueckmeldung an (Spec TP1 1.2).'
	warn 'Keine WhatsApp-Nummer: Rueckmeldungen fallen auf Teilen bzw. Kopieren zurueck.'
fi
LOG="$(mktemp)"
pnpm nx build entwurf --skip-nx-cache >"$LOG" 2>&1 || { tail -40 "$LOG" >&2; fail 'Angular-Build gescheitert.'; }
rm -f "$LOG"
[[ -f dist/apps/entwurf/browser/index.html ]] || fail 'dist/apps/entwurf/browser/index.html fehlt.'
if [[ -n "$JUFI_ENTWURF_WHATSAPP" ]]; then
	grep -rqF "$JUFI_ENTWURF_WHATSAPP" dist/apps/entwurf/browser --include='*.js' || fail 'Die WhatsApp-Nummer steht nicht im Buendel.'
	note 'WhatsApp-Nummer im Buendel'
fi
LOG="$(mktemp)"
docker build -f Dockerfile.entwurf --build-arg "GIT_COMMIT=$SHA_FULL" -t "$IMAGE:$SHA" -t "$IMAGE:latest" . >"$LOG" 2>&1 \
	|| { tail -40 "$LOG" >&2; fail 'Docker-Build gescheitert.'; }
rm -f "$LOG"
REVISION="$(docker image inspect "$IMAGE:$SHA" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
[[ "$REVISION" == "$SHA_FULL" ]] || fail "Label image.revision ist '$REVISION', erwartet '$SHA_FULL'."
note "$(docker images --format '{{.Size}}' "$IMAGE:$SHA" | head -1)"

# --- Tor 4: Rauchtest ----------------------------------------------------------
step "Tor 4: Rauchtest auf 127.0.0.1:$SMOKE_PORT"
SMOKE="jufi-entwurf-rauchtest-$$"
trap 'docker rm -f "$SMOKE" >/dev/null 2>&1 || true' EXIT INT TERM
docker run -d --name "$SMOKE" -p "127.0.0.1:$SMOKE_PORT:80" "$IMAGE:$SHA" >/dev/null
BASIS="http://127.0.0.1:$SMOKE_PORT"
OK=0
for _ in $(seq 1 20); do
	curl -fsS "$BASIS/entwurf/" >/dev/null 2>&1 && { OK=1; break; }
	sleep 0.5
done
[[ "$OK" -eq 1 ]] || { docker logs "$SMOKE" 2>&1 | tail -20; fail "Das Image antwortet nicht auf $BASIS/entwurf/."; }

curl -fsS "$BASIS/entwurf/" | grep -qF '<base href="/entwurf/">' || fail '/entwurf/ liefert keine index.html mit base href.'
curl -fsS "$BASIS/entwurf/glonntal/t/2-bowling" | grep -qF '<base href="/entwurf/">' \
	|| fail 'Tiefer Link liefert nicht die index.html.'
KOPF="$(curl -sS -o /dev/null -D - "$BASIS/")"
grep -qi '^location: /entwurf/' <<<"$KOPF" || fail "/ leitet nicht relativ auf /entwurf/ um: $KOPF"
KOPF="$(curl -fsS -o /dev/null -D - "$BASIS/entwurf/")"
grep -qi '^cache-control: no-cache' <<<"$KOPF" || fail 'index.html ohne Cache-Control: no-cache.'
grep -qi '^x-content-type-options: nosniff' <<<"$KOPF" || fail 'Header X-Content-Type-Options fehlt.'
MAIN="$(curl -fsS "$BASIS/entwurf/" | grep -oE 'main-[A-Z0-9]{8}\.js' | head -1)"
[[ -n "$MAIN" ]] || fail 'Kein main-<hash>.js in der index.html gefunden.'
curl -fsS -o /dev/null -D - "$BASIS/entwurf/$MAIN" | grep -qi '^cache-control: .*immutable' \
	|| fail "$MAIN wird nicht dauerhaft gecacht."
note "/ → /entwurf/, tiefe Links → index.html, Cache-Header und nosniff stimmen"
docker rm -f "$SMOKE" >/dev/null
trap - EXIT INT TERM

if [[ "$DRY_RUN" -eq 1 ]]; then
	step 'Probelauf — nichts uebertragen, nichts angefasst'
	note "Waere uebertragen: $IMAGE:$SHA"
	exit 0
fi

# --- Tor 5: Uebertragen und Ausrollen ------------------------------------------
[[ -n "$SSH_TARGET" ]] || fail 'SSH_TARGET fehlt. deploy/env.deploy.example nach .env.deploy kopieren.'
step "Tor 5: Image per SSH uebertragen und $SERVICE ausrollen"
docker save "$IMAGE:$SHA" "$IMAGE:latest" | gzip -1 | remote 'gunzip | docker load' | tail -2 \
	|| fail 'Uebertragung gescheitert.'
# Ausdruecklich nur dieser Dienst. Das Tag geht als Variable mit; `latest`
# zeigt auf dasselbe Image, ein spaeteres `up -d jufi-entwurf` bleibt also beim Stand.
remote "cd $REMOTE_DIR && JUFI_ENTWURF_TAG=$SHA docker compose -f $REMOTE_COMPOSE up -d $SERVICE" \
	|| fail 'Ausrollen gescheitert. Die alte Version laeuft weiter.'

# --- Tor 6: Nachpruefen ------------------------------------------------------
step 'Tor 6: Nachpruefen'
OK=0
for _ in $(seq 1 20); do
	curl -fsS -o /dev/null "$APP_URL/entwurf/" 2>/dev/null && { OK=1; break; }
	sleep 3
done
if [[ "$OK" -eq 1 ]]; then
	note "$APP_URL/entwurf/: 200"
else
	warn "$APP_URL/entwurf/ ist von aussen nicht erreichbar."
	note 'Fehlt der DNS-Eintrag, der Block in der Compose-Datei oder das Zertifikat?'
	note "  ssh: cd $REMOTE_DIR && docker compose -f $REMOTE_COMPOSE logs --tail=30 traefik"
	exit 1
fi

printf '\n\033[32m✓ Entwurf ausgerollt: %s\033[0m\n' "$SHA"
