#!/usr/bin/env bash
#
# Zeigt, welche Texte der Eigentuemer noch liefern muss (Spec 8.6): Platzhalter
# in Impressum und Datenschutzerklaerung sowie der Wortlaut der Einwilligung
# Fassung 1. Nur lesend, rein lokal.
#
# Aufruf: tools/pruefe-texte.sh
#
# Exit 1, solange etwas gefunden wird; Exit 0, wenn alles leer ist. Das Skript
# ist **kein** Tor von deploy.sh: die Testumgebung darf mit Platzhaltern laufen,
# nur die Einladung echter Jugendleiter muss warten.
#
# grep auf feste Satzteile und kein Parsen von Markdown: die Platzhalter stehen
# in eckigen Klammern mit einem festen Vermerk, und ein Parser wuerde bei der
# ersten Umformatierung der Texte etwas anderes zaehlen als das, was man sieht.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

# Die Muster stehen als UTF-8-Bytes im Skript; ohne Locale vergleicht grep
# Bytes und findet dieselben Zeilen. LC_ALL=C macht das unabhaengig davon, was
# die Shell des Aufrufers eingestellt hat.
export LC_ALL=C

RECHTSTEXT='liefert der Eigentümer|vom Eigentümer zu bestätigen|nach Inbetriebnahme bestätigen|Geplant, noch nicht in Betrieb'

GESAMT=0

# Gibt die Fundstellen einer Datei aus (Zeilennummer, erste 80 Zeichen).
# $1 Datei, $2 Muster, $3 Schalter fuer grep (leer oder -i).
pruefe() {
	local datei="$1" muster="$2" schalter="$3" treffer anzahl
	if [[ ! -f "$datei" ]]; then
		printf '\033[31m✗ %s fehlt\033[0m\n' "$datei" >&2
		exit 2
	fi
	# shellcheck disable=SC2086
	treffer="$(grep -n -E $schalter -- "$muster" "$datei")"
	anzahl=0
	[[ -z "$treffer" ]] || anzahl="$(printf '%s\n' "$treffer" | wc -l | tr -d ' ')"
	GESAMT=$((GESAMT + anzahl))
	printf '\n\033[1m%s\033[0m: %s Fundstellen\n' "$datei" "$anzahl"
	[[ "$anzahl" -gt 0 ]] || return 0
	# perl statt cut: cut -c zaehlt je nach Locale Bytes und schnitte einen
	# Umlaut mitten durch.
	printf '%s\n' "$treffer" | perl -CSD -ne '
		chomp; /^(\d+):(.*)$/ or next;
		printf "  %s:%s\n", $1, substr($2, 0, 80);'
}

pruefe apps/jufi/src/rechtstexte/impressum.md "$RECHTSTEXT" ''
pruefe apps/jufi/src/rechtstexte/datenschutz.md "$RECHTSTEXT" ''
# Wer den Wortlaut einsetzt, entfernt das Wort im Kommentar von einwilligung.ts
# und zaehlt EINWILLIGUNG_TEXT_VERSION hoch, falls schon Einwilligungen existieren.
pruefe libs/domain/src/einwilligung.ts 'Platzhalter' '-i'

printf '\n'
if [[ "$GESAMT" -gt 0 ]]; then
	printf '\033[31m✗ %s offene Fundstellen insgesamt.\033[0m\n' "$GESAMT"
	echo 'Die echten Jugendleiter werden erst eingeladen, wenn das leer ist (Spec 1.2).'
	exit 1
fi
printf '\033[32m✓ Keine offenen Texte.\033[0m\n'
