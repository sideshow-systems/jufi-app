#!/usr/bin/env bash
#
# Live-Pruefung der echten App: Health, Routing, Kopf, Manifest und Icons,
# optional Mail-DNS (SPF, DMARC, DKIM). Nur lesend, aendert nichts.
#
# Aufruf:
#   tools/pruefe-betrieb.sh [--url <basis>] [--slug <slug>] [--ohne-entwurf]
#                           [--mail <domain>] [--dkim-selector <name>]
#
# Die Vorgabe fuer --url ist $APP_URL (tools/_config.sh).
#
# Das Skript prueft **alles** durch und endet erst am Schluss mit Fehler, wenn
# mindestens ein ✗ stand. Verworfen: Abbruch beim ersten ✗ (set -e). Nach einem
# Deploy will man alle Befunde auf einmal sehen; bei einem Abbruch behebt man
# einen, startet neu und stoesst auf den naechsten.
#
# curl nie mit -k: eine Pruefung, die ein kaputtes Zertifikat durchwinkt, belegt
# nichts ueber das, was Mitglieder im Browser sehen.

set -uo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_config.sh"

URL="$APP_URL"
SLUG=''
MIT_ENTWURF=1
MAIL_DOMAIN=''
DKIM_SELEKTOR=''

while [[ $# -gt 0 ]]; do
	case "$1" in
		--url) URL="${2:?--url braucht eine Adresse}"; shift 2 ;;
		--slug) SLUG="${2:?--slug braucht einen Namen}"; shift 2 ;;
		--ohne-entwurf) MIT_ENTWURF=0; shift ;;
		--mail) MAIL_DOMAIN="${2:?--mail braucht eine Domain}"; shift 2 ;;
		--dkim-selector) DKIM_SELEKTOR="${2:?--dkim-selector braucht einen Namen}"; shift 2 ;;
		*)
			echo "Unbekanntes Argument: $1 (erlaubt: --url, --slug, --ohne-entwurf, --mail, --dkim-selector)" >&2
			exit 2
			;;
	esac
done
URL="${URL%/}"

FEHLER=0
ok() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
nok() {
	printf '\033[31m✗ %s\033[0m\n' "$*"
	FEHLER=$((FEHLER + 1))
}

# Antwort-Koerper einer Adresse; leer, wenn curl scheitert. Die Statuszeile
# kommt separat, weil mehrere Pruefungen nur den Koerper brauchen.
hole() { curl -sS --max-time 15 "$1" 2>/dev/null || true; }
kopf() { curl -sS --max-time 15 -D - -o /dev/null "$1" 2>/dev/null | tr -d '\r' || true; }
status() { curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true; }

# --- 1. Health ----------------------------------------------------------------
step "Pruefung von $URL"
HEALTH="$(hole "$URL/healthz")"
if [[ "$HEALTH" == *'"status":"ok"'* && "$HEALTH" == *'"version"'* ]]; then
	ok "Health: $HEALTH"
else
	nok "Health: /healthz meldet nicht status ok mit Version (Antwort: ${HEALTH:-keine})"
fi

# --- 2. Plattformseite --------------------------------------------------------
WURZEL="$(hole "$URL/")"
if [[ "$WURZEL" == *'<base href="/"'* && "$WURZEL" != *'<base href="/entwurf/"'* ]]; then
	ok 'Plattformseite: / liefert die App (base href "/")'
else
	nok 'Plattformseite: / liefert nicht die App (base href "/" fehlt oder es ist der Entwurf)'
fi

# --- 3. Entwurf ---------------------------------------------------------------
if [[ $MIT_ENTWURF -eq 1 ]]; then
	for pfad in /entwurf/ /entwurf/glonntal/t/2-bowling; do
		if [[ "$(hole "$URL$pfad")" == *'<base href="/entwurf/"'* ]]; then
			ok "Entwurf: $pfad"
		else
			nok "Entwurf: $pfad liefert nicht den Entwurf (base href \"/entwurf/\" fehlt)"
		fi
	done
	# Die umgekehrte Probe: ein Routingfehler legte den Entwurf auf die Wurzel
	# und die App darunter lahm.
	if [[ "$WURZEL" == *'<base href="/entwurf/"'* ]]; then
		nok 'Entwurf: / liefert den Entwurf statt der App'
	else
		ok 'Entwurf: / liefert nicht den Entwurf'
	fi
fi

# --- 4. Umzug von der alten Adresse ------------------------------------------
# Nur fuer die Test-Domain: sie ist die einzige, die einen Umzug hinter sich hat.
if [[ "$URL" == 'https://test.jufi-app.de' ]]; then
	ALT='https://app-test.jufi-app.de/impressum?x=1'
	ALT_KOPF="$(kopf "$ALT")"
	ALT_STATUS="$(head -n1 <<<"$ALT_KOPF" | awk '{print $2}')"
	ALT_ZIEL="$(grep -i '^location:' <<<"$ALT_KOPF" | head -n1 | cut -d' ' -f2-)"
	if [[ "$ALT_STATUS" == 301 && "$ALT_ZIEL" == 'https://test.jufi-app.de/impressum?x=1' ]]; then
		ok 'Umzug: app-test.jufi-app.de leitet mit 301 samt Pfad und Anfrage um'
	else
		nok "Umzug: erwartet 301 nach https://test.jufi-app.de/impressum?x=1, gefunden ${ALT_STATUS:-keine Antwort} nach ${ALT_ZIEL:-nirgends}"
	fi
fi

# --- 5. Kopf ------------------------------------------------------------------
if grep -i '^content-security-policy:' <<<"$(kopf "$URL/")" | grep -q "frame-ancestors 'none'"; then
	ok "Kopf: content-security-policy mit frame-ancestors 'none'"
else
	nok "Kopf: content-security-policy mit frame-ancestors 'none' fehlt"
fi

# --- 6. Manifest und Icons ----------------------------------------------------
# Hat der Verein ein Logo, prueft pruefe-icon.mjs das Logo und nicht die Schrift:
# die Buchstaben-Pruefung greift nur, wenn er keins hat. Bei Logo besteht die
# Pruefung also auf Groesse, und `fc-match` im Image (tools/deploy.sh, Tor 4)
# bleibt die andere Haelfte und wird hierdurch nicht ersetzt.
if [[ -n "$SLUG" ]]; then
	MANIFEST="$(hole "$URL/$SLUG/manifest.webmanifest")"
	MANIFEST_STATUS="$(status "$URL/$SLUG/manifest.webmanifest")"
	if [[ "$MANIFEST_STATUS" != 200 ]]; then
		nok "Manifest $SLUG: Status $MANIFEST_STATUS statt 200"
	elif PRUEF="$(printf '%s' "$MANIFEST" | node -e '
		const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
		if (!Array.isArray(m.icons) || m.icons.length === 0) { console.log("keine icons"); process.exit(1); }
		if (typeof m.start_url !== "string" || !m.start_url.startsWith("/" + process.argv[1] + "/")) {
			console.log("start_url " + m.start_url + " beginnt nicht mit /" + process.argv[1] + "/"); process.exit(1);
		}
	' "$SLUG" 2>&1)"; then
		ok "Manifest $SLUG: JSON mit icons und start_url unter /$SLUG/"
	else
		nok "Manifest $SLUG: $PRUEF"
	fi

	PRUEFER="$(dirname "${BASH_SOURCE[0]}")/pruefe-icon.mjs"
	for groesse in 192 512; do
		# Datei statt Pipe, damit der Status von curl nicht im Rohr untergeht.
		TMP="$(mktemp)"
		ICON_STATUS="$(curl -sS --max-time 15 -o "$TMP" -w '%{http_code}' "$URL/$SLUG/icon-$groesse.png" 2>/dev/null || true)"
		if [[ "$ICON_STATUS" != 200 ]]; then
			nok "icon-$groesse: Status ${ICON_STATUS:-keiner} statt 200"
		elif MELDUNG="$(node "$PRUEFER" "$groesse" <"$TMP" 2>&1)"; then
			ok "icon-$groesse: $groesse x $groesse, mit Zeichnung"
		else
			nok "icon-$groesse: $MELDUNG"
		fi
		rm -f "$TMP"
	done
fi

# --- 7. Mail-DNS --------------------------------------------------------------
# Mit ausdruecklichem Server 1.1.1.1, damit das Ergebnis nicht davon abhaengt,
# was der lokale Resolver noch zwischengespeichert hat.
txt() { dig +short +time=5 +tries=1 @1.1.1.1 TXT "$1" 2>/dev/null | tr -d '"' || true; }

if [[ -n "$MAIL_DOMAIN" ]]; then
	# Mehrere SPF-Eintraege sind ungueltig (RFC 7208, 4.5): der Empfaenger
	# wertet dann gar keinen aus.
	SPF="$(txt "$MAIL_DOMAIN" | grep '^v=spf1' || true)"
	SPF_ANZAHL=$(grep -c . <<<"$SPF" || true)
	if [[ "$SPF_ANZAHL" -eq 1 ]]; then
		ok "SPF: $SPF"
	elif [[ "$SPF_ANZAHL" -eq 0 ]]; then
		nok "SPF: kein TXT-Eintrag mit v=spf1 fuer $MAIL_DOMAIN"
	else
		nok "SPF: $SPF_ANZAHL Eintraege mit v=spf1 (nur einer ist gueltig): $(tr '\n' '|' <<<"$SPF")"
	fi

	DMARC="$(txt "_dmarc.$MAIL_DOMAIN" | grep '^v=DMARC1' || true)"
	if [[ -n "$DMARC" && "$DMARC" == *'p='* ]]; then
		ok "DMARC: $DMARC"
	elif [[ -n "$DMARC" ]]; then
		nok "DMARC: Eintrag ohne Richtlinie p=: $DMARC"
	else
		nok "DMARC: kein TXT-Eintrag mit v=DMARC1 unter _dmarc.$MAIL_DOMAIN"
	fi

	if [[ -n "$DKIM_SELEKTOR" ]]; then
		DKIM="$(txt "$DKIM_SELEKTOR._domainkey.$MAIL_DOMAIN" | grep 'v=DKIM1' || true)"
		if [[ -n "$DKIM" ]]; then
			ok "DKIM: Schluessel unter $DKIM_SELEKTOR._domainkey.$MAIL_DOMAIN gefunden"
		else
			nok "DKIM: kein v=DKIM1 unter $DKIM_SELEKTOR._domainkey.$MAIL_DOMAIN"
		fi
	else
		note 'DKIM: ohne --dkim-selector nicht pruefbar. Beweis ist tools/mail-testen.mjs'
		note 'plus "Originalnachricht anzeigen" im Postfach (dkim=pass).'
	fi
fi

echo
if [[ $FEHLER -gt 0 ]]; then
	printf '\033[31m%d Pruefung(en) fehlgeschlagen.\033[0m\n' "$FEHLER"
	exit 1
fi
printf '\033[32mAlle Pruefungen bestanden.\033[0m\n'
