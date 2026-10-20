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
cp "$JUFI_ROOT/tools/restore-test.sh" "$WORK/tools/" 2>/dev/null || true

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
# Die Wiederherstellungsprobe liegt wie auf dem Server neben _config.sh. Benutzer
# und Datenbank der Probe-Compose, Quelle ist deren Container.
run_restore() {
	JUFI_POSTGRES_USER=probe JUFI_POSTGRES_DB=probe SOURCE_CONTAINER="$SRC" \
		bash "$WORK/tools/restore-test.sh" "$@"
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
# Klartext-Dumps enthalten Daten von Kindern: nur der Besitzer darf sie lesen.
# macOS (BSD) und Linux (GNU) haben verschiedene stat-Schalter.
rechte() { stat -f %Lp "$1" 2>/dev/null || stat -c %a "$1"; }
RECHTE_A=''
if [[ "$A_OK" -eq 1 ]]; then
	RECHTE_A="$(rechte "$DUMP_A")"
	[[ "$RECHTE_A" == 600 ]] || A_OK=0
fi
if [[ "$A_OK" -eq 1 ]]; then
	echo '✓ A: Dump liegt vor, enthaelt familie und person, Rechte 600'
else
	[[ -n "$RECHTE_A" && "$RECHTE_A" != 600 ]] && echo "  Dateirechte $RECHTE_A statt 600"
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

# --- Fall B2: Abbruch mitten im Dump --------------------------------------------
# Ein docker-Stub haengt, das Skript bekommt SIGTERM. Danach darf kein
# `jufi-*.dump` liegen: der Aufraeumer und der Restore-Test hielten es fuer einen
# Dump. Uebrig bleibt hoechstens eine `.part`-Datei, und auch die raeumt der
# Abbruch selbst weg.
mkdir -p "$WORK/stubbin"
printf '#!/bin/sh\nexec sleep 20\n' >"$WORK/stubbin/docker"
chmod +x "$WORK/stubbin/docker"
rm -rf "$BACKUPS"
PATH="$WORK/stubbin:$PATH" REMOTE_DIR="$WORK" REMOTE_COMPOSE=docker-compose.yml BACKUP_DIR="$BACKUPS" \
	bash "$WORK/tools/backup.sh" --local --no-restic >/dev/null 2>&1 &
BPID=$!
for _ in $(seq 1 20); do
	[[ -n "$(find "$BACKUPS" -name 'jufi-*' 2>/dev/null)" ]] && break
	sleep 0.5
done
kill -TERM "$BPID" 2>/dev/null || true
wait "$BPID" 2>/dev/null || true
pkill -f "sleep 20" 2>/dev/null || true
COUNT_B2="$(find "$BACKUPS" -name 'jufi-*.dump' 2>/dev/null | wc -l | tr -d ' ' || true)"
REST_B2="$(find "$BACKUPS" -name 'jufi-*' 2>/dev/null | wc -l | tr -d ' ' || true)"
if [[ "$COUNT_B2" -eq 0 && "$REST_B2" -eq 0 ]]; then
	echo '✓ B2: Abbruch mitten im Dump -> kein jufi-*.dump, keine Reste'
else
	echo "✗ B2: nach Abbruch $COUNT_B2 .dump-Dateien, $REST_B2 Dateien insgesamt"
	FAILED=1
fi

# --- Faelle C bis E: Wiederherstellung ----------------------------------------
# Fall B hat die Datenbank gestoppt; fuer die Restore-Faelle laeuft sie wieder
# und liefert einen frischen Dump.
DB start jufi-db >/dev/null
for _ in $(seq 1 60); do
	DB exec -T jufi-db psql -U probe -d probe -tAc 'select 1' >/dev/null 2>&1 && break
	sleep 1
done
SRC="$(DB ps -q jufi-db | head -1)"
find "$BACKUPS" -name 'jufi-*.dump' -delete 2>/dev/null || true
run_backup >/dev/null 2>&1 || true
DUMP_C="$(find "$BACKUPS" -name 'jufi-*.dump' | head -1)"

# --- Fall C: Restore gleich Quelle ----------------------------------------------
if OUT_C="$(run_restore --dump "$DUMP_C" 2>&1)"; then CODE_C=0; else CODE_C=$?; fi
if [[ "$CODE_C" -eq 0 && "$OUT_C" == *'✓ familie '*3* && "$OUT_C" == *'✓ person '*5* ]]; then
	echo '✓ C: Wiederherstellung gleich Quelle (familie 3, person 5)'
else
	echo "✗ C: Exit $CODE_C"
	printf '%s\n' "$OUT_C" | sed 's/^/    /'
	FAILED=1
fi

# --- Fall D: Quelle wuchs nach dem Dump -----------------------------------------
DB exec -T jufi-db psql -U probe -d probe -q -c "insert into person (familie_id, name) values (1, 'Nachzuegler')" >/dev/null
if OUT_D="$(run_restore --dump "$DUMP_C" 2>&1)"; then CODE_D=0; else CODE_D=$?; fi
if [[ "$CODE_D" -ne 0 && "$OUT_D" == *person*'Quelle 6, wiederhergestellt 5'* ]]; then
	echo '✓ D: gewachsene Quelle -> Abweichung benannt, Exit != 0'
else
	echo "✗ D: Exit $CODE_D"
	printf '%s\n' "$OUT_D" | sed 's/^/    /'
	FAILED=1
fi

# --- Fall E: Dump abgeschnitten -------------------------------------------------
HALF=$(( $(wc -c <"$DUMP_C" | tr -d ' ') / 2 ))
head -c "$HALF" "$DUMP_C" >"$WORK/abgeschnitten.dump"
if OUT_E="$(run_restore --dump "$WORK/abgeschnitten.dump" 2>&1)"; then CODE_E=0; else CODE_E=$?; fi
if [[ "$CODE_E" -ne 0 && "$OUT_E" == *'pg_restore ist gescheitert'* ]]; then
	echo '✓ E: abgeschnittener Dump -> pg_restore ist gescheitert, Exit != 0'
else
	echo "✗ E: Exit $CODE_E"
	printf '%s\n' "$OUT_E" | sed 's/^/    /'
	FAILED=1
fi

# --- Fall F: Quelle ohne Tabellen ----------------------------------------------
# Eine leere Quelle darf nicht als gleich gelten.
LEER="jufi-probe-leer-$$"
docker run -d --name "$LEER" -e POSTGRES_USER=probe -e POSTGRES_PASSWORD=probe -e POSTGRES_DB=probe postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do
	docker exec "$LEER" psql -U probe -d probe -tAc 'select 1' >/dev/null 2>&1 && break
	sleep 1
done
sleep 3
if OUT_F="$(SRC="$LEER" run_restore --dump "$DUMP_C" 2>&1)"; then CODE_F=0; else CODE_F=$?; fi
docker rm -f "$LEER" >/dev/null 2>&1 || true
if [[ "$CODE_F" -ne 0 && "$OUT_F" == *'keine Tabellen'* ]]; then
	echo '✓ F: leere Quelle -> Fehler, Exit != 0'
else
	echo "✗ F: Exit $CODE_F"
	printf '%s\n' "$OUT_F" | sed 's/^/    /'
	FAILED=1
fi

# --- Fall G und H: Tabellenliste weicht ab --------------------------------------
# G: Tabelle nur in der Wiederherstellung (Quelle verlor sie nach dem Dump).
# H: Tabelle fehlt im Dump (Quelle bekam sie nach dem Dump).
DB exec -T jufi-db psql -U probe -d probe -q -c "create table zusatz (id int)" >/dev/null
find "$BACKUPS" -name 'jufi-*.dump' -delete 2>/dev/null || true
run_backup >/dev/null 2>&1 || true
DUMP_G="$(find "$BACKUPS" -name 'jufi-*.dump' | head -1)"
DB exec -T jufi-db psql -U probe -d probe -q -c "drop table zusatz" >/dev/null
if OUT_G="$(run_restore --dump "$DUMP_G" 2>&1)"; then CODE_G=0; else CODE_G=$?; fi
if [[ "$CODE_G" -ne 0 && "$OUT_G" == *zusatz*'nur in der Wiederherstellung'* ]]; then
	echo '✓ G: Tabelle nur im Restore -> benannt, Exit != 0'
else
	echo "✗ G: Exit $CODE_G"
	printf '%s\n' "$OUT_G" | sed 's/^/    /'
	FAILED=1
fi
DB exec -T jufi-db psql -U probe -d probe -q -c "create table neu (id int)" >/dev/null
if OUT_H="$(run_restore --dump "$DUMP_G" 2>&1)"; then CODE_H=0; else CODE_H=$?; fi
if [[ "$CODE_H" -ne 0 && "$OUT_H" == *neu*'fehlt in der Wiederherstellung'* ]]; then
	echo '✓ H: Tabelle fehlt im Dump -> benannt, Exit != 0'
else
	echo "✗ H: Exit $CODE_H"
	printf '%s\n' "$OUT_H" | sed 's/^/    /'
	FAILED=1
fi

[[ "$FAILED" -eq 0 ]] && echo '✓ Sicherung und Wiederherstellung bewiesen'
exit "$FAILED"
