#!/usr/bin/env bash
#
# Probe fuer die Entscheidung in Tor 5b von tools/deploy.sh (db_vorzustand in
# _config.sh), ohne Server und ohne Docker: ein ssh-Stub im PATH antwortet auf die
# zwei `docker compose ps`-Abfragen. Geprueft wird die Zuordnung der vier Faelle,
# nicht ssh selbst.
#
# Die Skripte laufen aus einer Kopie im Temp-Verzeichnis, weil _config.sh die
# .env.deploy des Eigentuemers einlesen und die Stub-Werte ueberschreiben wuerde.

set -euo pipefail

JUFI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/tools" "$WORK/bin"
cp "$JUFI_ROOT/tools/_config.sh" "$WORK/tools/"

# Der Stub unterscheidet die Abfragen am Text: "--status running" fragt nach
# laufenden Containern, "ps -a" nach allen. STUB_ALL/STUB_RUN sind die Antworten,
# STUB_FAIL laesst jede Abfrage scheitern.
cat >"$WORK/bin/ssh" <<'STUB'
#!/usr/bin/env bash
[[ "${STUB_FAIL:-0}" == 1 ]] && exit 255
case "$*" in
	*'--status running'*) printf '%s' "${STUB_RUN:-}" ;;
	*'ps -a'*) printf '%s' "${STUB_ALL:-}" ;;
esac
STUB
chmod +x "$WORK/bin/ssh"

FAILED=0
pruefe() {
	local name="$1" erwartet="$2" code_erwartet="$3" all="$4" run="$5" fail="$6" aus code
	if aus="$(PATH="$WORK/bin:$PATH" SSH_TARGET=stub STUB_ALL="$all" STUB_RUN="$run" STUB_FAIL="$fail" \
		bash -c 'source "$1"; db_vorzustand' _ "$WORK/tools/_config.sh" 2>/dev/null)"; then code=0; else code=$?; fi
	if [[ "$aus" == "$erwartet" && "$code" -eq "$code_erwartet" ]]; then
		echo "✓ $name -> '$aus' (Exit $code)"
	else
		echo "✗ $name: erwartet '$erwartet'/$code_erwartet, bekam '$aus'/$code"
		FAILED=1
	fi
}

pruefe 'kein Container (erstes Ausrollen)' keiner 0 '' '' 0
pruefe 'Container vorhanden, laeuft nicht'  steht  0 'abc123' '' 0
pruefe 'Container laeuft'                   laeuft 0 'abc123' 'abc123' 0
pruefe 'ps scheitert'                       ''     1 '' '' 1

[[ "$FAILED" -eq 0 ]] && echo '✓ Tor 5b: Vorzustand richtig zugeordnet'
exit "$FAILED"
