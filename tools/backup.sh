#!/usr/bin/env bash
#
# Sicherung der JuFi-Datenbank. Muster: ../hwyd/tools/backup.sh.
#
# Das Postgres-Volume ist das einzige Exemplar der Vereinsdaten. Deshalb: Dump
# erzeugen, Dump *pruefen*, verschluesselt ausser Haus schieben, alte Snapshots
# aufraeumen.
#
# Ausser Haus heisst: restic auf ein Konto, das einen anderen Wirt hat als der
# Server (JUFI_RESTIC_REPOSITORY). Gegen Hardwareverlust hilft ein zweites
# Verzeichnis auf demselben Server nicht, und gegen einen verlorenen Zugang
# hilft dasselbe Konto nicht.
#
# Laeuft in zwei Rollen:
#
#   Auf dem Server (so gehoert es in einen Zeitplan, siehe deploy/jufi-backup.cron):
#     /home/paperless/paperless-ngx/jufi-tools/backup.sh --local
#
#   Vom Entwicklungsrechner, holt den Dump ueber SSH nach backups/ hierher:
#     tools/backup.sh
#
# `--no-restic` laesst die Uebertragung ausser Haus weg -- fuer einen Dump vor
# einer riskanten Migration, wenn dafuer kein Snapshot entstehen soll. Ohne
# `JUFI_RESTIC_REPOSITORY` in der `.env` verhaelt sich das Skript ohnehin so und
# sagt es auch: dann liegt die Historie nur auf diesem Server.

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_config.sh"

LOCAL_MODE=0
USE_RESTIC=1
while [[ $# -gt 0 ]]; do
	case "$1" in
		--local) LOCAL_MODE=1; shift ;;
		--no-restic) USE_RESTIC=0; shift ;;
		*) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
	esac
done

STAMP="$(date +%Y%m%d-%H%M%S)"

# Eine halbe oder ungeprueft schlechte Datei darf nicht liegen bleiben: der
# naechste Mensch (oder die Aufraeumregel unten) hielte sie fuer einen Dump. Alle
# Fehlerpfade nach dem Anlegen laufen deshalb ueber diese Funktion. Verworfen:
# `trap ... ERR` -- das feuerte auch bei harmlosen Fehlschlaegen (etwa dem
# `grep -c` ohne Treffer) und liesse sich nicht auf die Dump-Datei eingrenzen.
DUMP=''
verwirf() {
	[[ -n "$DUMP" ]] && rm -f "$DUMP"
	fail "$@"
}

if [[ "$LOCAL_MODE" -eq 1 ]]; then
	# Auf dem Server: Compose liegt neben uns, .env liefert die Zugaenge.
	cd "$REMOTE_DIR"
	# shellcheck disable=SC1091
	{ set -a; source ./.env; set +a; }
	: "${JUFI_POSTGRES_USER:?JUFI_POSTGRES_USER fehlt in .env}"
	: "${JUFI_POSTGRES_DB:?JUFI_POSTGRES_DB fehlt in .env}"
	mkdir -p "$BACKUP_DIR"
	DUMP="$BACKUP_DIR/jufi-$STAMP.dump"
	# Kein `set -e`-Abbruch hier: dann bliebe die vom Umleiten angelegte, leere
	# oder halbe Datei zurueck, und die Meldung nennte nicht, was gescheitert ist.
	if ! docker compose -f "$REMOTE_COMPOSE" exec -T "$DB_SERVICE" \
		pg_dump -U "$JUFI_POSTGRES_USER" -d "$JUFI_POSTGRES_DB" -Fc --no-owner --no-privileges >"$DUMP"; then
		verwirf 'pg_dump im Dienst '"$DB_SERVICE"' gescheitert (Datenbank gestoppt? Zugang falsch?). Halbe Datei geloescht.'
	fi
else
	[[ -n "$SSH_TARGET" ]] || fail 'SSH_TARGET fehlt. deploy/env.deploy.example nach .env.deploy kopieren.'
	# Auf dem Entwicklungsrechner gilt nicht der Serverpfad aus _config.sh.
	BACKUP_DIR="$JUFI_ROOT/backups"
	mkdir -p "$BACKUP_DIR"
	DUMP="$BACKUP_DIR/jufi-$STAMP.dump"
	step "Dump vom Server holen"
	if ! jufi_ssh "cd $REMOTE_DIR && set -a && . ./.env && set +a && docker compose -f $REMOTE_COMPOSE exec -T $DB_SERVICE pg_dump -U \"\$JUFI_POSTGRES_USER\" -d \"\$JUFI_POSTGRES_DB\" -Fc --no-owner --no-privileges" >"$DUMP"; then
		verwirf 'pg_dump auf dem Server gescheitert. Halbe Datei geloescht.'
	fi
fi

# Ein Dump, der nicht lesbar ist, ist kein Backup. `pg_restore --list` parst das
# Inhaltsverzeichnis, ohne etwas zu schreiben -- der billigste echte Test.
SIZE=$(wc -c <"$DUMP" | tr -d ' ')
[[ "$SIZE" -ge 1024 ]] || verwirf "Dump ist nur $SIZE Byte gross. Datei geloescht."
TABLES=$(pg_restore --list "$DUMP" 2>/dev/null | grep -c 'TABLE DATA' || true)
if [[ "${TABLES:-0}" -lt 1 ]]; then
	# Ohne pg_restore auf dem Host (der Server hat es nicht): im Container pruefen.
	TABLES=$(docker run --rm -i postgres:17-alpine pg_restore --list <"$DUMP" 2>/dev/null | grep -c 'TABLE DATA' || true)
fi
[[ "${TABLES:-0}" -ge 1 ]] || verwirf 'Dump enthaelt keine Tabellendaten. Datei geloescht.'
note "$DUMP"
note "$SIZE Byte, $TABLES Tabellen mit Daten"

# Alte Dumps aufraeumen, und zwar **immer**. Nur im restic-Zweig zu raeumen hiesse:
# ohne eingerichtete Ablage ausser Haus wuerde nie etwas geloescht, und die Platte
# des gemeinsamen Servers laeuft voll.
LOCAL_KEEP_DAYS="${LOCAL_KEEP_DAYS:-30}"
find "$(dirname "$DUMP")" -name 'jufi-*.dump' -mtime "+$LOCAL_KEEP_DAYS" -delete 2>/dev/null || true
REMAINING=$(find "$(dirname "$DUMP")" -name 'jufi-*.dump' | wc -l | tr -d ' ')
note "$REMAINING Dumps vorhanden, Aufbewahrung $LOCAL_KEEP_DAYS Tage"

restic_env

if [[ "$USE_RESTIC" -eq 0 || -z "$RESTIC_REPOSITORY" ]]; then
	if [[ -z "$RESTIC_REPOSITORY" && "$USE_RESTIC" -eq 1 ]]; then
		note 'Kein JUFI_RESTIC_REPOSITORY gesetzt -- keine Kopie ausser Haus.'
		note 'Solange das so ist, liegt die Historie nur auf diesem Server.'
	fi
	echo '✓ Dump liegt vor'
	exit 0
fi

[[ -n "$RESTIC_PASSWORD" ]] || fail 'JUFI_RESTIC_PASSWORD fehlt -- ohne den Satz ist die Ablage nicht lesbar.'

# Cron hat keinen Agenten und keine Rueckfrage. Fehlt der Wirtsschluessel des
# Ziels in /root/.ssh/known_hosts, bricht restic mit "Host key verification
# failed" ab -- und zwar nachts, in einer Protokolldatei, die niemand liest.
# Deshalb die Vorpruefung hier, mit einer Meldung, die sagt was zu tun ist.
# Verworfen: `-o StrictHostKeyChecking=accept-new` in der restic-Verbindung. Das
# nimmt dem ersten Lauf die Rueckfrage, aber auch jedem spaeteren Wirtstausch --
# und genau der waere das Zeichen, das man sehen will.
#
# Geprueft wird mit `sftp -b /dev/null`, **nicht** mit `ssh ... true`: ein Ziel
# ohne Shell-Zugang antwortet auf `ssh ... true` mit "This service allows sftp
# connections only." und gibt 255 zurueck, waehrend `sftp` mit 0 endet und restic
# tadellos sichert. Die ssh-Pruefung meckerte also am gesunden Ziel. `sftp`
# oeffnet dasselbe Subsystem wie restic -- deshalb ist jeder Fehlschlag hier ein
# echter und keine Vermutung.
SFTP_HOST="$(restic_sftp_host)"
if [[ -n "$SFTP_HOST" ]]; then
	if ! SFTP_ERR="$(sftp -o BatchMode=yes -o ConnectTimeout=10 -b /dev/null "$SFTP_HOST" 2>&1)"; then
		case "$SFTP_ERR" in
			*'Host key verification failed'* | *'REMOTE HOST IDENTIFICATION HAS CHANGED'*)
				fail "Wirtsschluessel von $SFTP_HOST ist nicht bestaetigt. Einmal von Hand als root: sftp $SFTP_HOST -- danach laeuft der Lauf."
				;;
			*'Permission denied'* | *'publickey'*)
				fail "$SFTP_HOST nimmt den Schluessel von root nicht an. Ohne Schluessel *ohne Passphrase* in /root/.ssh kann der Lauf sich nicht anmelden."
				;;
			*) fail "SFTP zu $SFTP_HOST geht nicht: ${SFTP_ERR%%$'\n'*}" ;;
		esac
	fi
fi

restic snapshots >/dev/null 2>&1 || restic init
step 'restic backup'
restic backup --tag jufi-db "$DUMP"

# **restic legt auch dann einen Snapshot an, wenn es die Quelldatei nicht lesen
# konnte** -- dann steht "processed 0 files" in der Ausgabe, der Rueckgabewert ist
# 3, und im Repository liegt ein leerer Snapshot, der ab jetzt `latest` ist. Weil
# eine Wiederherstellungsprobe ohne Argument genau diesen `latest` zurueckliest,
# waere sie danach eine Probe auf ein leeres Archiv. Der Rueckgabewert allein
# reicht also nicht: es wird nachgesehen, ob der Snapshot den Dump in seiner
# Groesse enthaelt.
step 'Snapshot pruefen'
SNAP_SIZE="$(restic ls --long latest --tag jufi-db 2>/dev/null | awk -v p="$DUMP" '$NF == p { print $4 }' | tail -1)"
[[ "$SNAP_SIZE" == "$SIZE" ]] \
	|| fail "Snapshot enthaelt den Dump nicht in voller Groesse (${SNAP_SIZE:-nichts} statt $SIZE Byte). Nichts aufgeraeumt -- der vorige Snapshot bleibt der gueltige."
note "$SNAP_SIZE Byte im Snapshot, gleich dem Dump"

# 7/4/6: HWYD haelt 12 Monate, Spezifikation 8.3 gibt hier 6 vor. Aufgeraeumt wird
# erst *nach* der Snapshot-Pruefung, damit ein misslungener Lauf nie den letzten
# guten Stand wegraeumt.
step 'Aufraeumen: 7 taeglich / 4 woechentlich / 6 monatlich'
restic forget --tag jufi-db --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

# Verworfen: eine zweite, kuerzere lokale Aufbewahrung, sobald die Ablage ausser
# Haus steht. Sie schnitte am ersten erfolgreichen Lauf die lokalen Dumps zusammen
# -- genau dann, wenn noch niemand einen Restore aus der neuen Ablage geprobt hat.
# Es gilt allein LOCAL_KEEP_DAYS oben.
echo '✓ Sicherung fertig'
