# Gemeinsame Konfiguration der Skripte fuer die echte App (Teilprojekt 2).
# Wird per `source` eingebunden, nicht ausgefuehrt. Muster: ../hwyd/tools/_config.sh.
#
# Eingebunden von deploy.sh, rollback.sh, backup.sh, restore-test.sh,
# install-backup.sh und pruefe-betrieb.sh: Deploy, Rueckfall, Sicherung und Wiederherstellungsprobe
# brauchen dieselben Adressen und dieselben zwei Regeln. tools/deploy-entwurf.sh bleibt eigenstaendig: der Entwurf ist
# Wegwerfcode und soll nicht an dieser Datei haengen.
#
# Hintergrund: JuFi wohnt nicht in einem eigenen Stack, sondern in der
# gemeinsamen Compose-Datei von paperless unter /home/paperless/paperless-ngx.
# Dort laufen ausserdem traefik, paperless, HWYD und weitere Apps. Daraus folgen
# zwei Regeln, die in allen Skripten gelten:
#
#   1. Compose-Aufrufe nennen **immer** ausdruecklich die JuFi-Dienste. Ein
#      blankes `up -d` oder `down` wuerde die anderen Apps mitnehmen.
#   2. Alle Variablen in der Server-.env tragen das Praefix `JUFI_`, weil die
#      `.env` geteilt ist (deploy/env.jufi.example).

# shellcheck shell=bash

JUFI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# .env.deploy liefert Adressen (Vorlage: deploy/env.deploy.example). Dieselbe
# Datei wie fuer den Entwurf: ein Server, ein Zugang.
if [[ -f "$JUFI_ROOT/.env.deploy" ]]; then
	set -a
	# shellcheck disable=SC1091
	source "$JUFI_ROOT/.env.deploy"
	set +a
fi

: "${SSH_TARGET:=}"
: "${SSH_KEY:=}"
: "${REMOTE_DIR:=/home/paperless/paperless-ngx}"
: "${REMOTE_COMPOSE:=docker-compose.yml}"
: "${APP_SERVICE:=jufi}"
: "${DB_SERVICE:=jufi-db}"
: "${MIGRATE_SERVICE:=jufi-migrate}"
: "${MAIL_SERVICE:=jufi-mailpit}"
: "${REMOTE_TOOLS:=$REMOTE_DIR/jufi-tools}"
: "${BACKUP_DIR:=$REMOTE_DIR/jufi-backups}"
: "${IMAGE:=sideshowsystems/jufi}"
: "${APP_URL:=https://test.jufi-app.de}"

# ssh/scp mit ausdruecklichem Schluessel, damit der Deploy nicht davon abhaengt,
# was im Agent gerade geladen ist. BatchMode: eine Passwortabfrage mitten im Deploy
# soll scheitern statt haengen.
SSH_OPTS=(-o BatchMode=yes)
[[ -n "$SSH_KEY" ]] && SSH_OPTS+=(-i "${SSH_KEY/#\~/$HOME}")

jufi_ssh() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }
jufi_scp() { scp "${SSH_OPTS[@]}" "$@"; }

# Compose auf dem Server, immer mit Datei und immer aus dem richtigen Verzeichnis.
remote_compose() { jufi_ssh "cd $REMOTE_DIR && docker compose -f $REMOTE_COMPOSE $*"; }

# Zustand der Datenbank vor der Migration (Tor 5b in deploy.sh): keiner | laeuft |
# steht. Exit 1, wenn der Zustand nicht abfragbar ist.
#
# "Erstes Ausrollen" (keiner) heisst nur: es gibt gar keinen Container des
# Dienstes. Ein vorhandener, aber gestoppter oder neustartender Container hat
# Daten im Volume; als erstes Ausrollen gedeutet, uebersprange der Deploy den Dump
# und `jufi-migrate` migrierte ohne Sicherung. Verworfen: allein `ps --status
# running` auszuwerten -- das kann "nie gestartet" und "gerade abgestuerzt" nicht
# unterscheiden. Auch ein scheiternder ps-Aufruf ist kein "nichts da".
db_vorzustand() {
	local alle laeuft
	alle="$(remote_compose "ps -a -q $DB_SERVICE" 2>/dev/null)" || return 1
	if [[ -z "$alle" ]]; then echo keiner; return 0; fi
	laeuft="$(remote_compose "ps --status running -q $DB_SERVICE" 2>/dev/null)" || return 1
	if [[ -n "$laeuft" ]]; then echo laeuft; else echo steht; fi
}

# restic kennt nur RESTIC_REPOSITORY und RESTIC_PASSWORD. In der geteilten .env
# tragen die Werte nach Regel 2 das Praefix JUFI_ -- unpraefixiert sicherte eine
# zweite App mit restic in dieselbe Ablage.
#
# Verworfen: HWYDs Rueckfall auf ein schon gesetztes RESTIC_REPOSITORY. In einer
# geteilten Umgebung hiesse das, dass JuFi stillschweigend in die Ablage einer
# anderen App schriebe, sobald der eigene Name fehlt; leer ist die sicherere
# Vorgabe, denn dann scheitert die Sicherung laut.
#
# Eine **Funktion** und keine Zuweisung, weil die .env des Servers erst *nach*
# dieser Datei gelesen wird; eine Zuweisung hier waere immer leer.
restic_env() {
	RESTIC_REPOSITORY="${JUFI_RESTIC_REPOSITORY:-}"
	RESTIC_PASSWORD="${JUFI_RESTIC_PASSWORD:-}"
	# restic zieht PASSWORD_FILE/-COMMAND und REPOSITORY_FILE dem Klartextwert vor.
	# Stuende eine davon fremd in der Umgebung (geteilter Server, andere App), legte
	# `restic init` das Repository mit deren Passwort an und nicht mit unserem.
	unset RESTIC_PASSWORD_FILE RESTIC_PASSWORD_COMMAND RESTIC_REPOSITORY_FILE
	export RESTIC_REPOSITORY RESTIC_PASSWORD
}

# Der Teil benutzer@wirt aus sftp:benutzer@wirt:pfad, fuer Vorpruefungen und
# Meldungen. Nichts, wenn die Ablage kein SFTP ist.
restic_sftp_host() {
	[[ "${RESTIC_REPOSITORY:-}" == sftp:* ]] || return 0
	local rest="${RESTIC_REPOSITORY#sftp:}"
	printf '%s' "${rest%%:*}"
}

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  ⚠ %s\033[0m\n' "$*"; }
