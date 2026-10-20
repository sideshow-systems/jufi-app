#!/usr/bin/env bash
#
# Rueckfall auf eine frueher ausgerollte Version. Muster: ../hwyd/tools/rollback.sh.
#
# Praktisch gratis, weil `deploy.sh` ohnehin nach Git-SHA taggt.
#
# Aufruf:
#   tools/rollback.sh                          auf den Commit vor HEAD
#   tools/rollback.sh <sha>                    auf einen bestimmten
#   tools/rollback.sh <sha> --trotz-migration  auch wenn sich die Migrationen unterscheiden
#   tools/rollback.sh --list                   zeigt, was auf dem Server liegt
#
# **Grenze, die man kennen muss:** ein Rueckfall dreht den Code zurueck, nicht das
# Datenbankschema. Migrationen laufen nur vorwaerts. Unterscheiden sich die
# Migrationen des Ziels von denen in HEAD, bricht das Skript ab, bevor es den
# Server anfasst: ob das alte Image mit dem neuen Schema zurechtkommt, entscheidet
# ein Mensch (--trotz-migration) -- oder es geht ueber den Dump, den `deploy.sh`
# vor jeder Migration zieht (BACKUP_DIR auf dem Server).

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_config.sh"
cd "$JUFI_ROOT"

[[ -n "$SSH_TARGET" ]] || fail 'SSH_TARGET fehlt. deploy/env.deploy.example nach .env.deploy kopieren.'

TARGET_SHA=''
TROTZ_MIGRATION=0
LIST=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--list) LIST=1; shift ;;
		--trotz-migration) TROTZ_MIGRATION=1; shift ;;
		-*) echo "Unbekanntes Argument: $1 (erlaubt: --list, --trotz-migration)" >&2; exit 2 ;;
		*) [[ -z "$TARGET_SHA" ]] || { echo 'Nur ein SHA erlaubt.' >&2; exit 2; }; TARGET_SHA="$1"; shift ;;
	esac
done

if [[ "$LIST" -eq 1 ]]; then
	echo "Auf dem Server vorhandene JuFi-Images:"
	jufi_ssh "docker images '$IMAGE' --format '  {{.Tag}}\t{{.CreatedSince}}\t{{.Size}}'"
	echo
	echo 'Aktuell eingetragen:'
	jufi_ssh "grep '^JUFI_IMAGE_TAG=' $REMOTE_DIR/.env | sed 's/^/  /'"
	exit 0
fi

if [[ -z "$TARGET_SHA" ]]; then
	TARGET_SHA="$(git rev-parse --short=12 HEAD~1 2>/dev/null)" \
		|| fail 'HEAD hat keinen Vorgaenger -- bitte einen SHA angeben.'
	note "Kein SHA angegeben, nehme den Commit vor HEAD: $TARGET_SHA"
fi
# Aufgeloest auf die zwoelf Stellen, mit denen deploy.sh taggt; eine Kurzform
# oder ein Name wie HEAD~1 fuehrte sonst zu einem Tag, den es nicht gibt.
TARGET_SHA="$(git rev-parse --short=12 "$TARGET_SHA^{commit}" 2>/dev/null)" \
	|| fail "$TARGET_SHA ist kein Commit dieses Repositories."

# Der Waechter steht vor dem ersten SSH-Aufruf: wer ihn ausloest, hat den Server
# nicht beruehrt. Verglichen wird der Git-Stand, nicht der des Servers -- der
# laufende Stand ist HEAD, weil deploy.sh nur aus einem sauberen HEAD ausrollt.
if ! git diff --quiet "$TARGET_SHA" HEAD -- prisma/migrations; then
	if [[ "$TROTZ_MIGRATION" -eq 1 ]]; then
		warn "Die Migrationen unterscheiden sich zwischen $TARGET_SHA und HEAD -- weiter auf eigene Verantwortung (--trotz-migration)."
	else
		git diff --stat "$TARGET_SHA" HEAD -- prisma/migrations >&2
		fail "Die Migrationen unterscheiden sich zwischen $TARGET_SHA und HEAD. Das alte Image muss mit dem neuen Schema laufen koennen; Migrationen laufen nur vorwaerts. Wenn das sicher ist: --trotz-migration. Sonst den Dump aus $BACKUP_DIR einspielen."
	fi
fi

# Erst pruefen, ob das Image ueberhaupt da ist. Ein `up -d` auf ein Tag, das es
# nicht gibt, stoppt die laufende App und startet nichts. Kein `docker pull`
# als Ausweg wie in HWYD: JuFi hat keine Registry, nur uebertragene Tags.
# Erst erreichbar?, dann das Image: sonst hiesse ein SSH-Ausfall "Image fehlt".
step "Verbindung zu $SSH_TARGET"
jufi_ssh true || fail "Server nicht erreichbar ($SSH_TARGET). Nichts geaendert."

step "Pruefen, ob $IMAGE:$TARGET_SHA auf dem Server liegt"
jufi_ssh "docker image inspect '$IMAGE:$TARGET_SHA' >/dev/null 2>&1" \
	|| fail "Image $IMAGE:$TARGET_SHA liegt nicht auf dem Server. Nichts geaendert. ('tools/rollback.sh --list' zeigt die vorhandenen Tags.)"

step "Zuruecksetzen auf $TARGET_SHA"
jufi_ssh "cd $REMOTE_DIR && sed -i.bak 's|^JUFI_IMAGE_TAG=.*|JUFI_IMAGE_TAG=$TARGET_SHA|' .env" \
	|| fail 'JUFI_IMAGE_TAG in .env setzen gescheitert.'
# Nur der App-Dienst, wie im Deploy: ein blankes up -d nahme die anderen Apps mit.
remote_compose "up -d $APP_SERVICE" \
	|| fail "Ausrollen gescheitert. In .env steht jetzt JUFI_IMAGE_TAG=$TARGET_SHA. Zurueck: ein vorheriges Tag aus der Liste von 'tools/rollback.sh --list' mit rollback.sh <sha> setzen."

step 'Nachpruefen'
TARGET_FULL="$(git rev-parse "$TARGET_SHA")"
INNER=''
for _ in $(seq 1 30); do
	INNER="$(remote_compose "exec -T $APP_SERVICE curl -fsS http://127.0.0.1:4000/healthz" 2>/dev/null || true)"
	grep -q "\"commit\":\"$TARGET_FULL\"" <<<"$INNER" && break
	sleep 2
done
# Der Commit, nicht nur "ok": die alte App koennte noch laufen und ebenfalls ok melden.
if ! grep -q '"status":"ok"' <<<"$INNER" || ! grep -q "\"commit\":\"$TARGET_FULL\"" <<<"$INNER"; then
	echo "✗ Nach dem Rueckfall meldet der Container nicht ok mit Commit $TARGET_SHA: ${INNER:-keine Antwort}" >&2
	echo '  Jetzt haendisch nachsehen:' >&2
	echo "  ssh $SSH_TARGET 'cd $REMOTE_DIR && docker compose -f $REMOTE_COMPOSE logs --tail=50 $APP_SERVICE'" >&2
	exit 1
fi
echo "✓ Rueckfall auf $TARGET_SHA erledigt, /healthz ist ok."
