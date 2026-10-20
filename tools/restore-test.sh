#!/usr/bin/env bash
#
# Wiederherstellungsprobe. **Ein nie geprobter Restore ist kein Restore.**
# Muster: ../hwyd/tools/restore-test.sh.
#
# Spielt einen Dump in ein Wegwerf-Postgres, zaehlt die Zeilen jeder Tabelle und
# vergleicht sie mit der Quelldatenbank. Weicht eine Zahl ab, endet das Skript
# mit Fehler -- sonst waere die Probe nur ein gutes Gefuehl.
#
# Aufruf:
#   tools/restore-test.sh --dump pfad.dump                bestimmter Dump
#   tools/restore-test.sh --dump x --source remote        gegen die Server-DB vergleichen
#   tools/restore-test.sh --dump x --no-compare           nur zaehlen
#   tools/restore-test.sh                                 letzter restic-Snapshot
#
# `--source local` (Vorgabe) vergleicht gegen die Entwicklungsdatenbank
# (`jufi-postgres-dev`) oder, auf dem Server, gegen den Compose-Dienst;
# `--source remote` gegen die auf dem Server, per SSH.
#
# Der letzte Snapshot kommt aus der Ablage ausser Haus; dafuer braucht es
# `JUFI_RESTIC_REPOSITORY` und `JUFI_RESTIC_PASSWORD` in der Umgebung. Auf dem
# Server stehen sie in der geteilten `.env` und werden so geladen:
#
#   cd /home/paperless/paperless-ngx && set -a && . ./.env && set +a
#   jufi-tools/restore-test.sh
#
# Das Wegwerf-Postgres bekommt keinen veroeffentlichten Port und wird am Ende
# immer entfernt, auch bei Abbruch.

set -euo pipefail

# `_config.sh` liegt **neben** diesem Skript, nicht unter `../tools`. Der
# Unterschied ist auf dem Entwicklungsrechner unsichtbar (dort ist beides
# `repo/tools`), auf dem Server aber der Abbruch: `jufi-tools/restore-test.sh`
# suchte `../tools/_config.sh` und damit ein Verzeichnis, das es dort nicht gibt.
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_config.sh"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
PROBE_NAME="jufi-restore-probe-$$"

DUMP=""
COMPARE=1
SOURCE=local
while [[ $# -gt 0 ]]; do
	case "$1" in
		--dump) DUMP="${2:?--dump braucht eine Datei}"; shift 2 ;;
		--no-compare) COMPARE=0; shift ;;
		--source) SOURCE="${2:-}"; shift 2 ;;
		*) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
	esac
done
[[ "$SOURCE" == 'local' || "$SOURCE" == 'remote' ]] || { echo '--source nimmt local oder remote' >&2; exit 2; }

# Namen wie in der geteilten .env auf dem Server; lokal genuegen die Vorgaben.
PGUSER_="${JUFI_POSTGRES_USER:-jufi}"
PGDB_="${JUFI_POSTGRES_DB:-jufi}"

WORKDIR="$(mktemp -d)"
cleanup() {
	docker rm -f "$PROBE_NAME" >/dev/null 2>&1 || true
	rm -rf "$WORKDIR"
}
trap cleanup EXIT INT TERM

# --- Dump beschaffen ----------------------------------------------------------
if [[ -z "$DUMP" ]]; then
	# Dieselbe Umschreibung wie in backup.sh, aus derselben geteilten `.env`.
	restic_env
	[[ -n "$RESTIC_REPOSITORY" ]] || fail 'Ohne --dump braucht es JUFI_RESTIC_REPOSITORY (auf dem Server: set -a; . ./.env; set +a).'
	[[ -n "$RESTIC_PASSWORD" ]] || fail 'Ohne --dump braucht es JUFI_RESTIC_PASSWORD.'
	step 'Letzten Snapshot aus restic holen'
	restic restore latest --tag jufi-db --target "$WORKDIR" >/dev/null
	DUMP="$(find "$WORKDIR" -name 'jufi-*.dump' | sort | tail -1)"
	[[ -n "$DUMP" ]] || fail 'Kein Dump im Snapshot gefunden.'
	note "$DUMP"
fi
[[ -f "$DUMP" ]] || fail "Dump nicht gefunden: $DUMP"

# --- Wegwerf-Postgres ---------------------------------------------------------
# 256 MB: die Probe soll den gemeinsamen Server nicht in die Enge treiben.
step "Wegwerf-Postgres starten ($PG_IMAGE)"
docker run -d --name "$PROBE_NAME" --memory 256m \
	-e POSTGRES_USER="$PGUSER_" \
	-e POSTGRES_PASSWORD=restore-probe \
	-e POSTGRES_DB="$PGDB_" \
	-e POSTGRES_INITDB_ARGS='--locale=C --encoding=UTF8' \
	"$PG_IMAGE" >/dev/null

# pg_isready antwortet schon beim Hilfsserver des ersten Starts; ein echtes
# `select 1` scheitert dort noch nicht, der anschliessende Neustart aber mitten
# im Restore. Deshalb zweimal hintereinander bereit verlangen.
READY=0
for _ in $(seq 1 60); do
	if docker exec "$PROBE_NAME" psql -U "$PGUSER_" -d "$PGDB_" -tAc 'select 1' >/dev/null 2>&1; then
		sleep 2
		if docker exec "$PROBE_NAME" psql -U "$PGUSER_" -d "$PGDB_" -tAc 'select 1' >/dev/null 2>&1; then READY=1; break; fi
	fi
	sleep 1
done
[[ "$READY" -eq 1 ]] || fail 'Wegwerf-Postgres wurde nicht bereit.'

step 'Dump zuruecklesen'
docker exec -i "$PROBE_NAME" pg_restore -U "$PGUSER_" -d "$PGDB_" \
	--no-owner --no-privileges <"$DUMP" >"$WORKDIR/restore.log" 2>&1 || {
	echo "✗ pg_restore ist gescheitert:" >&2
	tail -20 "$WORKDIR/restore.log" >&2
	exit 1
}

# --- Zaehlen ------------------------------------------------------------------
# Zeilenzahl je Tabelle, aus der Datenbank selbst erfragt statt aus einer festen
# Liste -- so faellt auch eine Tabelle auf, die im Dump fehlt.
count_sql="select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"

counts_of() {
	local target="$1" # docker-Containername
	local tables t n
	tables="$(docker exec -i "$target" psql -U "$PGUSER_" -d "$PGDB_" -tAc "$count_sql")"
	for t in $tables; do
		n="$(docker exec -i "$target" psql -U "$PGUSER_" -d "$PGDB_" -tAc "select count(*) from \"$t\"")"
		printf '%s\t%s\n' "$t" "$n"
	done
}

step 'Zeilen in der wiederhergestellten Datenbank'
counts_of "$PROBE_NAME" >"$WORKDIR/restored.tsv"
awk -F'\t' '{printf "  %-24s %8s\n", $1, $2}' "$WORKDIR/restored.tsv"

if [[ "$COMPARE" -eq 0 ]]; then
	echo '✓ Restore gelesen, Vergleich uebersprungen (--no-compare)'
	exit 0
fi

# --- Vergleich mit der Quelle -------------------------------------------------
step "Vergleich mit der Quelle ($SOURCE)"
if [[ "$SOURCE" == 'remote' ]]; then
	[[ -n "$SSH_TARGET" ]] || fail 'Fuer --source remote braucht es SSH_TARGET in .env.deploy.'
	remote_psql() {
		jufi_ssh "cd $REMOTE_DIR && set -a && . ./.env && set +a && docker compose -f $REMOTE_COMPOSE exec -T $DB_SERVICE psql -U \"\$JUFI_POSTGRES_USER\" -d \"\$JUFI_POSTGRES_DB\" -tAc \"$1\""
	}
	: >"$WORKDIR/source.tsv"
	for t in $(remote_psql "$count_sql" | tr -d '\r'); do
		printf '%s\t%s\n' "$t" "$(remote_psql "select count(*) from \\\"$t\\\"" | tr -d '\r')" >>"$WORKDIR/source.tsv"
	done
else
	# Vorgabe ist die Entwicklungsdatenbank. Laeuft das Skript aber **auf dem
	# Server** -- dort ist der Snapshot ohne Umweg erreichbar --, gibt es kein
	# `jufi-postgres-dev`, sondern den Compose-Dienst. Ohne diesen Rueckfall
	# verlangte die Fehlermeldung dort ein `pnpm run db:up`, das es auf dem
	# Server nie geben wird.
	if [[ -z "${SOURCE_CONTAINER:-}" ]]; then
		if docker inspect jufi-postgres-dev >/dev/null 2>&1; then
			SOURCE_CONTAINER=jufi-postgres-dev
		elif [[ -f "$REMOTE_DIR/$REMOTE_COMPOSE" ]]; then
			SOURCE_CONTAINER="$(cd "$REMOTE_DIR" && docker compose -f "$REMOTE_COMPOSE" ps -q "$DB_SERVICE" 2>/dev/null | head -1)"
			[[ -n "$SOURCE_CONTAINER" ]] && note "Quelle ist der Dienst $DB_SERVICE auf diesem Rechner"
		fi
	fi
	docker inspect "${SOURCE_CONTAINER:-keine}" >/dev/null 2>&1 || {
		echo '⚠ Keine Quelldatenbank gefunden -- kein Vergleich moeglich.' >&2
		echo '  Der Restore selbst ist gelungen. Entweder pnpm run db:up (Entwicklung),' >&2
		echo '  SOURCE_CONTAINER=<name> setzen, oder --no-compare.' >&2
		exit 1
	}
	counts_of "$SOURCE_CONTAINER" >"$WORKDIR/source.tsv"
fi

FAILED=0
while IFS=$'\t' read -r table expected; do
	actual="$(awk -F'\t' -v t="$table" '$1==t {print $2}' "$WORKDIR/restored.tsv")"
	if [[ -z "$actual" ]]; then
		printf '  ✗ %-24s fehlt in der Wiederherstellung\n' "$table"
		FAILED=1
	elif [[ "$actual" != "$expected" ]]; then
		printf '  ✗ %-24s Quelle %s, wiederhergestellt %s\n' "$table" "$expected" "$actual"
		FAILED=1
	else
		printf '  ✓ %-24s %s\n' "$table" "$actual"
	fi
done <"$WORKDIR/source.tsv"

if [[ "$FAILED" -ne 0 ]]; then
	echo '✗ Restore-Probe fehlgeschlagen.' >&2
	exit 1
fi
echo '✓ Restore-Probe bestanden: jede Tabelle hat dieselbe Zeilenzahl wie die Quelle.'
