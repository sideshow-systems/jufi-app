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

# Klartext-Dumps enthalten Daten von Kindern. Ohne diese Maske waeren sie mit der
# Vorgabe 022 fuer alle Benutzer des gemeinsamen Servers lesbar. Vor dem ersten
# Anlegen einer Datei oder eines Verzeichnisses, nicht erst danach per chmod:
# dazwischen laege ein Zeitfenster.
umask 077

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
#
# Geschrieben wird nach <ziel>.part und erst nach bestandener Pruefung per mv in
# den endgueltigen Namen gebracht. Bei SIGINT/SIGTERM mitten im Dump (Cron-Ende,
# Strg-C, Neustart) bliebe sonst eine halbe `jufi-*.dump`, die Aufraeumregel und
# Wiederherstellungsprobe fuer einen Dump hielten; `*.part` passt auf kein
# `jufi-*.dump`-Muster. Verworfen: die Datei bei jedem Signal erst nachtraeglich
# auf Gueltigkeit zu pruefen -- ein Name, der nie vorzeitig stimmt, braucht das nicht.
ZIEL=''
DUMP=''
verwirf() {
	[[ -n "$DUMP" ]] && rm -f "$DUMP"
	fail "$@"
}
# Signale in einen normalen Exit umsetzen, damit der EXIT-Trap sicher laeuft.
# Nach dem mv ist DUMP leer, dann bleibt die fertige Datei unberuehrt.
trap '[[ -n "$DUMP" ]] && rm -f "$DUMP"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$LOCAL_MODE" -eq 1 ]]; then
	# Auf dem Server: Compose liegt neben uns, .env liefert die Zugaenge.
	cd "$REMOTE_DIR"
	# shellcheck disable=SC1091
	{ set -a; source ./.env; set +a; }
	: "${JUFI_POSTGRES_USER:?JUFI_POSTGRES_USER fehlt in .env}"
	: "${JUFI_POSTGRES_DB:?JUFI_POSTGRES_DB fehlt in .env}"
	mkdir -p "$BACKUP_DIR"
	ZIEL="$BACKUP_DIR/jufi-$STAMP.dump"
	DUMP="$ZIEL.part"
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
	ZIEL="$BACKUP_DIR/jufi-$STAMP.dump"
	DUMP="$ZIEL.part"
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
# Erst jetzt ist es ein Dump. mv im selben Verzeichnis ist atomar.
mv "$DUMP" "$ZIEL"
DUMP="$ZIEL"
trap - EXIT
note "$DUMP"
note "$SIZE Byte, $TABLES Tabellen mit Daten"

# Alte Dumps aufraeumen, und zwar **immer**. Nur im restic-Zweig zu raeumen hiesse:
# ohne eingerichtete Ablage ausser Haus wuerde nie etwas geloescht, und die Platte
# des gemeinsamen Servers laeuft voll.
LOCAL_KEEP_DAYS="${LOCAL_KEEP_DAYS:-30}"
# Reste abgebrochener Laeufe (SIGKILL, Stromausfall -- der Trap greift dort nicht)
# erst nach einem Tag: ein gleichzeitig laufender Dump hat eine frische .part, die
# nicht unter ihm weggeloescht werden darf.
find "$(dirname "$DUMP")" -name 'jufi-*.dump.part' -mtime +0 -delete 2>/dev/null || true
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
SNAP_SIZE="$(restic ls --long latest --tag jufi-db 2>/dev/null | awk -v p="$DUMP" '$NF == p { print $4 }' | tail -1 || true)"
[[ "$SNAP_SIZE" == "$SIZE" ]] \
	|| fail "Snapshot enthaelt den Dump nicht in voller Groesse (${SNAP_SIZE:-nichts} statt $SIZE Byte). Nichts aufgeraeumt -- der vorige Snapshot bleibt der gueltige."
note "$SNAP_SIZE Byte im Snapshot, gleich dem Dump"

# 7/4/6: HWYD haelt 12 Monate, Spezifikation 8.3 gibt hier 6 vor. Aufgeraeumt wird
# erst *nach* der Snapshot-Pruefung, damit ein misslungener Lauf nie den letzten
# guten Stand wegraeumt.
#
# `--group-by host,tags` ist noetig: restic gruppiert vorgabemaessig nach
# host,paths, und der Pfad des Dumps ist bei jedem Lauf ein anderer
# (jufi-<STAMP>.dump). Jeder Snapshot bildete dann eine eigene Gruppe, die
# keep-Regeln griffen nie, und es bliebe alles fuer immer liegen. Dasselbe Muster
# steckt im HWYD-Original (dort unveraendert gelassen).
step 'Aufraeumen: 7 taeglich / 4 woechentlich / 6 monatlich'
restic forget --tag jufi-db --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --group-by host,tags --prune

# --- Dateien (Volume jufi-dateien) ---------------------------------------------
# Die Datenbank kennt nur die Zeilen der Dateien; die Bytes liegen im Volume. Ein
# Dump ohne Volume stellte Dokumente wieder her, die beim Oeffnen 404 melden.
# Deshalb im selben Lauf, und zwar **nach** dem Dump: Dateien verschwinden erst
# 24 Stunden nach dem Loeschen der Zeile (Loeschliste), also hat jede Zeile des
# Dumps ihre Bytes im spaeteren Snapshot. Verworfen: erst die Dateien, dann der
# Dump -- eine dazwischen hochgeladene Datei stuende im Dump ohne Bytes im
# Snapshot. Scheitert der Teil hier, liegt der Dump schon ausser Haus.
#
# Das Volume heisst fest jufi-dateien (deploy/jufi-services.yml). Fehlt es, laeuft
# der Server noch ohne diese Etappe: eine Warnung, kein Abbruch, sonst bliebe die
# Datenbanksicherung bis zum ersten Deploy der Etappe aus.
MP=''
if ! MP="$(docker volume inspect jufi-dateien --format '{{ .Mountpoint }}' 2>/dev/null)" || [[ -z "$MP" ]]; then
	warn 'Volume jufi-dateien fehlt -- Dateien nicht gesichert (Server vor dem ersten Deploy der Dateien-Etappe?).'
else
	# Das Verzeichnis tmp enthaelt halbe Uploads, die nach einer Stunde ohnehin
	# aufgeraeumt werden; sie gehoeren in keinen Snapshot.
	step 'restic backup (Dateien)'
	# Exit 3 heisst bei restic: Snapshot geschrieben, aber einzelne Dateien waren nicht lesbar.
	# Hier trifft das fast nur eine Datei, die waehrend der Sicherung geloescht wurde (der
	# Aufraeumer laeuft im Betrieb weiter); das ist eine Warnung, kein Abbruch. Jeder andere
	# Code (Ablage weg, falsches Passwort) bricht ab. Ob der Snapshot taugt, entscheidet
	# darunter die Pruefung auf einen Snapshot von heute. Verworfen: jeden Code ausser 0 als
	# Abbruch -- eine geloeschte Datei risse sonst die ganze Sicherung der Nacht ein.
	set +e
	restic backup --tag jufi-dateien --exclude "$MP/tmp" "$MP"
	BACKUP_CODE=$?
	set -e
	case "$BACKUP_CODE" in
		0) ;;
		3) warn 'restic konnte einzelne Dateien nicht lesen (Exit 3), vermutlich waehrend der Sicherung geloescht -- der Snapshot ist geschrieben.' ;;
		*) fail "restic backup der Dateien gescheitert (Exit $BACKUP_CODE)." ;;
	esac

	# Wie beim Dump: restic legt auch bei unlesbarer Quelle einen Snapshot an.
	# Geprueft wird also, dass ein Snapshot von heute existiert (Zeit in der Zone
	# des Servers, wie das STAMP oben).
	step 'Snapshot pruefen (Dateien)'
	SNAP_TAG="$(restic snapshots --tag jufi-dateien --latest 1 --json 2>/dev/null | grep -o '"time":"[0-9-]*' | head -1 | cut -d'"' -f4 || true)"
	[[ "$SNAP_TAG" == "$(date +%Y-%m-%d)" ]] \
		|| fail "Kein Snapshot der Dateien von heute (letzter: ${SNAP_TAG:-keiner}). Nichts aufgeraeumt."
	note "Snapshot der Dateien vom $SNAP_TAG"

	# Gleiche Werte und gleiches `--group-by host,tags` wie beim Dump. Der Pfad ist hier zwar
	# bei jedem Lauf derselbe, aber ein neuer Mountpoint (Docker-Umzug, anderer Datenpfad)
	# bildete mit der Vorgabe host,paths eine zweite Gruppe, und fuer sie liefen die keep-Regeln
	# getrennt: der alte Pfad behielte seine Staende fuer immer.
	step 'Aufraeumen (Dateien): 7 taeglich / 4 woechentlich / 6 monatlich'
	restic forget --tag jufi-dateien --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --group-by host,tags --prune
fi

# Verworfen: eine zweite, kuerzere lokale Aufbewahrung, sobald die Ablage ausser
# Haus steht. Sie schnitte am ersten erfolgreichen Lauf die lokalen Dumps zusammen
# -- genau dann, wenn noch niemand einen Restore aus der neuen Ablage geprobt hat.
# Es gilt allein LOCAL_KEEP_DAYS oben.
echo '✓ Sicherung fertig'
