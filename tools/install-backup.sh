#!/usr/bin/env bash
#
# Bringt die Sicherungsskripte auf den Server und haengt den taeglichen Lauf in
# den Zeitplan. Muster: ../hwyd/tools/install-backup.sh.
#
# `deploy.sh` rollt das Image aus, aber **nichts** aktualisiert `jufi-tools` auf
# dem Server. Eine Verbesserung in `backup.sh` bliebe sonst auf dem
# Entwicklungsrechner liegen, waehrend nachts die alte Fassung laeuft -- der
# unangenehmste Fehler einer Sicherung, weil sie weiter "ok" schreibt.
#
# Bewusst **kein** Teil von `deploy.sh`: ein Deploy laeuft oft, faellt an einem
# Tor auch mal aus, und dann waere unklar, ob der Zeitplan gerade steht. Dieses
# Skript laeuft selten und tut genau eine Sache.
#
# Aufruf:
#   tools/install-backup.sh                Skripte kopieren, Cron einrichten, einmal laufen
#   tools/install-backup.sh --dry-run      nur zeigen, was passieren wuerde
#   tools/install-backup.sh --no-cron      nur die Skripte auffrischen
#   tools/install-backup.sh --no-run       ohne den Probelauf am Ende
#
# Der Probelauf am Ende ist der Punkt der ganzen Uebung: er beweist restic,
# Schluessel, known_hosts, Snapshot-Pruefung und Aufraeumen einmal im
# Wachzustand, statt sie um 03:40 zum ersten Mal zu versuchen.

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_config.sh"
cd "$JUFI_ROOT"

DRY_RUN=0
WITH_CRON=1
WITH_RUN=1
while [[ $# -gt 0 ]]; do
	case "$1" in
		--dry-run) DRY_RUN=1; shift ;;
		--no-cron) WITH_CRON=0; shift ;;
		--no-run) WITH_RUN=0; shift ;;
		*) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
	esac
done

[[ -n "$SSH_TARGET" ]] || fail 'SSH_TARGET fehlt. deploy/env.deploy.example nach .env.deploy kopieren.'

# Der Cron-Eintrag liegt in /etc/cron.d und gehoert root. Wer hier nicht root
# ist, merkt das besser jetzt als nach dem Kopieren.
if [[ "$WITH_CRON" -eq 1 && "${SSH_TARGET%%@*}" != 'root' ]]; then
	fail "Cron einrichten braucht root ($SSH_TARGET ist es nicht; SSH_TARGET muss die Form root@host haben). Oder mit --no-cron nur die Skripte auffrischen."
fi

# Erst erreichbar?, dann alles andere. Sonst erschiene ein SSH-Ausfall weiter
# unten als "restic fehlt" oder "Variablen fehlen" und sendete auf falsche Faehrte.
step "Verbindung zu $SSH_TARGET"
jufi_ssh true || fail "Server nicht erreichbar ($SSH_TARGET). SSH_TARGET und SSH_KEY in .env.deploy pruefen und per ssh von Hand anmelden."

FILES=(tools/_config.sh tools/backup.sh tools/restore-test.sh deploy/jufi-backup.cron)
for f in "${FILES[@]}"; do
	[[ -f "$f" ]] || fail "$f fehlt."
done

# `backup.sh` bindet `_config.sh` aus seinem **eigenen** Verzeichnis ein. Beide
# muessen deshalb zusammen liegen und zusammen aufgefrischt werden; eine der
# beiden allein zu kopieren ist der Weg in einen Lauf, der sich auf Vorgaben von
# letztem Monat stuetzt.
step "Skripte nach $SSH_TARGET:$REMOTE_TOOLS"
for f in "${FILES[@]}"; do note "$f"; done

if [[ "$DRY_RUN" -eq 1 ]]; then
	note '(--dry-run: nichts kopiert)'
else
	jufi_ssh "mkdir -p $REMOTE_TOOLS" || fail "$REMOTE_TOOLS liess sich nicht anlegen. Schreibrechte von $SSH_TARGET auf $REMOTE_DIR pruefen."
	jufi_scp "${FILES[@]}" "$SSH_TARGET:$REMOTE_TOOLS/" >/dev/null || fail 'Kopieren gescheitert. Plattenplatz und Schreibrechte in '"$REMOTE_TOOLS"' pruefen, dann erneut aufrufen.'
	jufi_ssh "chmod 755 $REMOTE_TOOLS/backup.sh $REMOTE_TOOLS/restore-test.sh && chmod 644 $REMOTE_TOOLS/_config.sh $REMOTE_TOOLS/jufi-backup.cron" \
		|| fail "Rechte liessen sich nicht setzen. In $REMOTE_TOOLS pruefen, wem die Dateien gehoeren, dann erneut aufrufen."
fi

# --- Voraussetzungen ----------------------------------------------------------
# Alles, was nachts still scheitern kann, wird hier laut geprueft.

step 'Voraussetzungen auf dem Server'

if jufi_ssh 'command -v restic >/dev/null 2>&1'; then
	note "restic: $(jufi_ssh 'restic version' | head -1)"
elif [[ "$DRY_RUN" -eq 1 ]]; then
	note 'restic fehlt (--dry-run: nicht installiert)'
else
	note 'restic fehlt -- wird installiert'
	jufi_ssh 'apt-get update -qq && apt-get install -y -qq restic' >/dev/null \
		|| fail 'apt-get install restic ist gescheitert. Von Hand nachziehen.'
	jufi_ssh 'command -v restic >/dev/null 2>&1' \
		|| fail 'restic ist nach der Installation nicht auffindbar. Auf dem Server apt-get install restic von Hand pruefen.'
	note "restic: $(jufi_ssh 'restic version' | head -1)"
fi

# Die Werte selbst haben hier nichts zu suchen -- gefragt ist nur, **ob** sie
# stehen. Ein Passwortsatz, der durch eine Ausgabe laeuft, ist keiner mehr.
# `grep -c` meldet bei 0 Treffern Exit 1 *und* gibt "0" aus; `|| echo 0` machte
# daraus "0\n0" und einen Syntaxfehler im Vergleich. Bei unlesbarer .env bleibt
# die Ausgabe leer, dafuer der Vorgabewert.
REPO_SET="$(jufi_ssh "grep -c '^JUFI_RESTIC_REPOSITORY=.' $REMOTE_DIR/.env" 2>/dev/null || true)"
PASS_SET="$(jufi_ssh "grep -c '^JUFI_RESTIC_PASSWORD=.' $REMOTE_DIR/.env" 2>/dev/null || true)"
REPO_SET="${REPO_SET:-0}"
PASS_SET="${PASS_SET:-0}"
if [[ "$REPO_SET" -ge 1 && "$PASS_SET" -ge 1 ]]; then
	note 'JUFI_RESTIC_REPOSITORY und JUFI_RESTIC_PASSWORD stehen in der .env'
else
	warn 'Keine Kopie ausser Haus: JUFI_RESTIC_REPOSITORY/JUFI_RESTIC_PASSWORD fehlen in der .env.'
	note 'Der taegliche Lauf macht dann nur einen geprueften Dump auf diesem Server.'
	note 'Nachtragen nach deploy/env.jufi.example -- der Passwortsatz aus dem Passwortmanager, nicht von hier.'
fi

# --- Zeitplan -----------------------------------------------------------------

if [[ "$WITH_CRON" -eq 1 ]]; then
	step 'Cron-Eintrag /etc/cron.d/jufi-backup'
	if [[ "$DRY_RUN" -eq 1 ]]; then
		note '(--dry-run: nicht eingerichtet)'
	else
		# 644 und root:root sind nicht Geschmack: cron ignoriert Dateien in
		# /etc/cron.d, die fuer andere schreibbar sind -- und zwar schweigend.
		jufi_ssh "install -m 644 -o root -g root $REMOTE_TOOLS/jufi-backup.cron /etc/cron.d/jufi-backup" \
			|| fail 'Cron-Datei liess sich nicht installieren.'
		note "$(jufi_ssh 'grep -v "^#" /etc/cron.d/jufi-backup | grep backup.sh')"
	fi
fi

# --- Probelauf ----------------------------------------------------------------

if [[ "$WITH_RUN" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
	step 'Probelauf: backup.sh --local'
	jufi_ssh "$REMOTE_TOOLS/backup.sh --local" || fail 'Der Probelauf ist gescheitert -- siehe Meldung oben. Ursache beheben und tools/install-backup.sh erneut aufrufen.'
fi

step 'Fertig'
if [[ "$WITH_CRON" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
	note 'Naechster Lauf: 03:40 (Serverzeit), Protokoll in /var/log/jufi-backup.log'
fi
# Nicht `--source remote`: das braucht SSH_TARGET aus .env.deploy, und die gibt es
# auf dem Server nicht. Dort ist die Quelle der Dienst neben uns.
note 'Restore-Probe aus dem neuesten Snapshot, auf dem Server:'
note "  cd $REMOTE_DIR && set -a && . ./.env && set +a && $REMOTE_TOOLS/restore-test.sh"
