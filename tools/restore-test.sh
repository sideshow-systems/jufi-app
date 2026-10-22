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
#   tools/restore-test.sh --dateien                       zusaetzlich die Dateien pruefen
#
# `--dateien` stellt aus dem letzten restic-Snapshot mit Tag jufi-dateien bis zu
# 20 zufaellige Dateien wieder her, die der zurueckgelesene Dump kennt, und
# vergleicht ihre SHA-256-Summe mit der Zeile der Tabelle Datei. Ohne das waere
# die Probe gruen fuer eine Wiederherstellung, deren Dokumente beim Oeffnen
# fehlen. Braucht JUFI_RESTIC_* auch dann, wenn der Dump mit --dump kommt.
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
DATEIEN=0
SOURCE=local
while [[ $# -gt 0 ]]; do
	case "$1" in
		--dump) DUMP="${2:?--dump braucht eine Datei}"; shift 2 ;;
		--no-compare) COMPARE=0; shift ;;
		--dateien) DATEIEN=1; shift ;;
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
# EXIT raeumt auf; INT/TERM nur, damit der Abbruch den EXIT-Trap ausloest und mit
# 130 endet statt mit dem Status des letzten Befehls.
trap cleanup EXIT
trap 'exit 130' INT TERM

# --- Dump beschaffen ----------------------------------------------------------
# Vor dem Wegwerf-Postgres: eine fehlende Ablage soll nach Sekunden auffallen und
# nicht erst, nachdem Container und Restore gelaufen sind.
if [[ "$DATEIEN" -eq 1 ]]; then
	restic_env
	[[ -n "$RESTIC_REPOSITORY" ]] || fail '--dateien braucht JUFI_RESTIC_REPOSITORY (auf dem Server: set -a; . ./.env; set +a).'
	[[ -n "$RESTIC_PASSWORD" ]] || fail '--dateien braucht JUFI_RESTIC_PASSWORD.'
fi
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
# Eine Wiederherstellung ohne Tabellen ist kein Erfolg, auch wenn pg_restore 0
# meldete und die Quelle ebenfalls leer ist -- sonst verglichen zwei leere Listen.
[[ -s "$WORKDIR/restored.tsv" ]] || fail 'Die Wiederherstellung enthaelt keine Tabellen.'

# --- Dateien ------------------------------------------------------------------
# Stichprobe statt aller Dateien: Der Verein darf bis zu 5 GB belegen, und der
# Arbeitsordner liegt auf dem Server unter /tmp. Verworfen: den ganzen Snapshot
# wiederherstellen -- das kostete Platz und Zeit, die die Probe nicht braucht,
# um ein defektes Archiv zu finden. Zufaellig (random() in der Datenbank), damit
# nicht jede Probe dieselben 20 Dateien sieht.
DATEIEN_FEHLER=0
if [[ "$DATEIEN" -eq 1 ]]; then
	step 'Dateien: Pruefsummen aus dem letzten Snapshot (jufi-dateien)'
	# Der Pfad, unter dem das Volume gesichert wurde (backup.sh nimmt den
	# Mountpoint); restic legt ihn im Ziel nach, deshalb muss er bekannt sein.
	# Erst abfragen, dann auswerten: In einer Pipeline mit `|| true` verschluckte ein restic-Fehler
	# (falsches Passwort, Ablage nicht erreichbar) sich als "kein Snapshot". Ein leerer Treffer
	# ist bei restic Exit 0 mit `[]`; nur der ist "kein Snapshot".
	SNAPSHOTS="$(restic snapshots --tag jufi-dateien --latest 1 --json 2>"$WORKDIR/restic.err")" \
		|| fail "restic snapshots scheitert: $(tail -3 "$WORKDIR/restic.err")"
	SNAP_PFAD="$(grep -o '"paths":\["[^"]*"' <<<"$SNAPSHOTS" | head -1 | cut -d'"' -f4 || true)"
	[[ -n "$SNAP_PFAD" ]] || fail 'Kein Snapshot mit Tag jufi-dateien in der Ablage (hat backup.sh mit restic schon gesichert?).'
	ZEILEN="$(docker exec -i "$PROBE_NAME" psql -U "$PGUSER_" -d "$PGDB_" -tAF ' ' \
		-c 'SELECT "vereinId", id, sha256 FROM "Datei" ORDER BY random() LIMIT 20')"
	if [[ -z "$ZEILEN" ]]; then
		warn 'Der Dump kennt keine Dateien -- nichts zu pruefen.'
	else
		INCLUDES=()
		while read -r verein id _; do
			INCLUDES+=(--include "$SNAP_PFAD/$verein/$id")
		done <<<"$ZEILEN"
		mkdir -p "$WORKDIR/dateien"
		restic restore latest --tag jufi-dateien --target "$WORKDIR/dateien" "${INCLUDES[@]}" >/dev/null
		summe() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
		while read -r verein id erwartet; do
			datei="$WORKDIR/dateien$SNAP_PFAD/$verein/$id"
			if [[ ! -f "$datei" ]]; then
				printf '  ✗ %s/%s fehlt im Snapshot\n' "$verein" "$id"
				DATEIEN_FEHLER=1
			elif [[ "$(summe "$datei")" != "$erwartet" ]]; then
				printf '  ✗ %s/%s Pruefsumme weicht ab\n' "$verein" "$id"
				DATEIEN_FEHLER=1
			else
				printf '  ✓ %s/%s\n' "$verein" "$id"
			fi
		done <<<"$ZEILEN"
	fi
fi

if [[ "$COMPARE" -eq 0 ]]; then
	if [[ "$DATEIEN_FEHLER" -ne 0 ]]; then
		echo '✗ Restore-Probe fehlgeschlagen: Dateien stimmen nicht.' >&2
		exit 1
	fi
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
	# Erst in eine Variable: in `for t in $(...)` verschluckte die Schleife den
	# Fehlschlag der SSH-Abfrage, und die Probe sah eine leere Quelle als gleich.
	remote_tables="$(remote_psql "$count_sql" | tr -d '\r')"
	: >"$WORKDIR/source.tsv"
	for t in $remote_tables; do
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

[[ -s "$WORKDIR/source.tsv" ]] || fail 'Quelle lieferte keine Tabellen -- nichts zu vergleichen.'

FAILED="$DATEIEN_FEHLER"
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
# Gegenrichtung: eine Tabelle, die nur in der Wiederherstellung steht, ist ebenfalls
# eine Abweichung (die Quelle hat sie inzwischen verloren).
while IFS=$'\t' read -r table _; do
	if ! awk -F'\t' -v t="$table" '$1==t {f=1} END {exit !f}' "$WORKDIR/source.tsv"; then
		printf '  ✗ %-24s nur in der Wiederherstellung, nicht in der Quelle\n' "$table"
		FAILED=1
	fi
done <"$WORKDIR/restored.tsv"

if [[ "$FAILED" -ne 0 ]]; then
	echo '✗ Restore-Probe fehlgeschlagen.' >&2
	exit 1
fi
echo '✓ Restore-Probe bestanden: jede Tabelle hat dieselbe Zeilenzahl wie die Quelle.'
[[ "$DATEIEN" -eq 0 ]] || echo '✓ Dateien: Pruefsummen der Stichprobe stimmen.'
