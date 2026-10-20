#!/usr/bin/env bash
#
# Probe fuer tools/backup.sh, ohne Server: eine Wegwerf-Postgres (nur der Dienst
# jufi-db, kein Port) in einem Temp-Verzeichnis. Beweist die zwei Dinge, auf die
# es ankommt: ein gelungener Dump ist lesbar und enthaelt die Tabellen, und ein
# gescheiterter Dump hinterlaesst **keine** halbe Datei. Der restic-Zweig ist
# hier nicht abgedeckt (kein restic, kein Ziel); er wird gegen eine echte
# Wegwerf-Ablage geprobt.
#
# Verworfen: pg_dump gegen eine Datenbank auf dem Host. Die Probe soll dieselben
# `docker compose exec`-Aufrufe durchlaufen wie der Lauf auf dem Server, sonst
# prueft sie nur eine Nachbildung.

set -euo pipefail

JUFI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WORK="$(mktemp -d)"
export COMPOSE_PROJECT_NAME="jufi-probe-$$"

# Immer aufraeumen, auch bei Abbruch: sonst bleibt ein Container samt Volume auf
# dem Entwicklungsrechner liegen. `-v` nimmt das namenlose Datenvolume mit.
cleanup() {
	(cd "$WORK" 2>/dev/null && docker compose -f docker-compose.yml down -v --remove-orphans >/dev/null 2>&1) || true
	rm -rf "$WORK"
}
trap cleanup EXIT

cat >"$WORK/docker-compose.yml" <<'YML'
services:
  jufi-db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ${JUFI_POSTGRES_USER}
      POSTGRES_DB: ${JUFI_POSTGRES_DB}
      POSTGRES_PASSWORD: ${JUFI_POSTGRES_PASSWORD}
YML
cat >"$WORK/.env" <<'ENV'
JUFI_POSTGRES_USER=probe
JUFI_POSTGRES_DB=probe
JUFI_POSTGRES_PASSWORD=probe
ENV

# Die Skripte laufen aus einer Kopie im Temp-Verzeichnis. _config.sh liest
# .env.deploy neben dem tools-Ordner und liesse dessen REMOTE_DIR die Werte der
# Probe ueberschreiben -- auf dem Rechner des Eigentuemers liegt so eine Datei.
# Verworfen: .env.deploy fuer die Probe umzubenennen; die Probe soll nie an
# fremden Dateien aendern, auch nicht kurz.
mkdir -p "$WORK/tools"
cp "$JUFI_ROOT/tools/_config.sh" "$WORK/tools/" 2>/dev/null || true
cp "$JUFI_ROOT/tools/backup.sh" "$WORK/tools/" 2>/dev/null || true

BACKUPS="$WORK/backups"
DB() { docker compose -f "$WORK/docker-compose.yml" --project-directory "$WORK" --env-file "$WORK/.env" "$@"; }

echo '▸ Wegwerf-Datenbank starten'
DB up -d jufi-db >/dev/null
for _ in $(seq 1 60); do
	DB exec -T jufi-db pg_isready -U probe -d probe >/dev/null 2>&1 && break
	sleep 1
done
# pg_isready allein genuegt nicht: das offizielle Image startet beim ersten Mal
# einen Hilfsserver, faehrt ihn herunter und startet neu, und pg_isready
# antwortet schon beim Hilfsserver. Deshalb wird das Anlegen der Tabellen
# wiederholt, bis es in einem Zug gelingt (`-1`: eine Transaktion, kein halb
# angelegter Zustand beim Wiederholen).
SEED="$(cat <<'SQL'
create table familie (id serial primary key, name text not null);
create table person (id serial primary key, familie_id int references familie(id), name text not null);
insert into familie (name) select 'Familie ' || g from generate_series(1, 3) g;
insert into person (familie_id, name) select (g % 3) + 1, 'Person ' || g from generate_series(1, 5) g;
SQL
)"
SEEDED=0
for _ in $(seq 1 30); do
	if printf '%s\n' "$SEED" | DB exec -T jufi-db psql -U probe -d probe -q -1 -v ON_ERROR_STOP=1 >/dev/null 2>&1; then SEEDED=1; break; fi
	sleep 1
done
[[ "$SEEDED" -eq 1 ]] || { echo '✗ Testtabellen liessen sich nicht anlegen' >&2; exit 1; }

FAILED=0
run_backup() {
	REMOTE_DIR="$WORK" REMOTE_COMPOSE=docker-compose.yml BACKUP_DIR="$BACKUPS" \
		COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
		bash "$WORK/tools/backup.sh" --local --no-restic
}
# pg_restore liegt auf dem Entwicklungsrechner oft nicht vor: im Image lesen.
restore_list() { docker run --rm -i postgres:17-alpine pg_restore --list <"$1"; }

# --- Fall A: Dump gelingt -------------------------------------------------------
if OUT_A="$(run_backup 2>&1)"; then CODE_A=0; else CODE_A=$?; fi
COUNT_A="$(find "$BACKUPS" -name 'jufi-*.dump' 2>/dev/null | wc -l | tr -d ' ' || true)"
A_OK=0
if [[ "$CODE_A" -eq 0 && "$COUNT_A" -eq 1 ]]; then
	DUMP_A="$(find "$BACKUPS" -name 'jufi-*.dump')"
	LIST_A="$(restore_list "$DUMP_A" 2>/dev/null || true)"
	if grep -q 'TABLE DATA public familie' <<<"$LIST_A" && grep -q 'TABLE DATA public person' <<<"$LIST_A"; then A_OK=1; fi
fi
if [[ "$A_OK" -eq 1 ]]; then
	echo '✓ A: Dump liegt vor, enthaelt familie und person'
else
	echo "✗ A: Dump liegt nicht (korrekt) vor (Exit $CODE_A, $COUNT_A Dateien)"
	printf '%s\n' "$OUT_A" | sed 's/^/    /'
	FAILED=1
fi

# --- Fall B: Dump scheitert -----------------------------------------------------
# Die Datei aus Fall A zur Seite, damit die Zaehlung in backups/ eindeutig ist.
mkdir -p "$WORK/zurueckgestellt"
find "$BACKUPS" -name 'jufi-*.dump' -exec mv {} "$WORK/zurueckgestellt/" \; 2>/dev/null || true
DB stop jufi-db >/dev/null 2>&1
if OUT_B="$(run_backup 2>&1)"; then CODE_B=0; else CODE_B=$?; fi
COUNT_B="$(find "$BACKUPS" -name '*.dump' 2>/dev/null | wc -l | tr -d ' ' || true)"
if [[ "$CODE_B" -ne 0 && "$OUT_B" == *pg_dump* && "$COUNT_B" -eq 0 ]]; then
	echo '✓ B: gestoppte Datenbank -> Fehler, keine halbe Datei'
else
	echo "✗ B: Exit $CODE_B, $COUNT_B .dump-Dateien, Meldung mit pg_dump: $([[ "$OUT_B" == *pg_dump* ]] && echo ja || echo nein)"
	printf '%s\n' "$OUT_B" | sed 's/^/    /'
	FAILED=1
fi

exit "$FAILED"
