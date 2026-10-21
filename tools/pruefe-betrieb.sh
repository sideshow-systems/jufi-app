#!/usr/bin/env bash
#
# Live-Pruefung der echten App: Health, Routing, Kopf, Manifest und Icons,
# WebSocket-Upgrade, Link-Vorschau, Dateien-Routen ohne Sitzung, optional Mail-DNS
# (SPF, DMARC, DKIM). Nur lesend, aendert nichts.
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

# Ein Wert, der mit -- beginnt, ist der naechste Schalter und kein Wert: sonst
# schluckte `--url --slug demo` den Schalter still als Adresse. Exit 2 (Aufruf
# falsch) und nicht 1 (Pruefung gescheitert), damit ein Tippfehler nicht wie ein
# Befund aussieht.
wert() {
	if [[ $# -lt 2 || "$2" == --* ]]; then
		echo "$1 braucht einen Wert." >&2
		exit 2
	fi
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--url) wert "$@"; URL="$2"; shift 2 ;;
		--slug) wert "$@"; SLUG="$2"; shift 2 ;;
		--ohne-entwurf) MIT_ENTWURF=0; shift ;;
		--mail) wert "$@"; MAIL_DOMAIN="$2"; shift 2 ;;
		--dkim-selector) wert "$@"; DKIM_SELEKTOR="$2"; shift 2 ;;
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

# curls Fehlermeldung landet in einer Datei und nicht im Nichts: "Could not
# resolve host" und "timed out" sind die Ursache, ohne die ein ✗ nur rät. Eine
# Datei, weil die Helfer in Unterschalen laufen und keine Variable zurueckgeben.
CURLERR="$(mktemp)"
trap 'rm -f "$CURLERR"' EXIT
ursache() { tr -d '\r' <"$CURLERR" | head -n1; }
# Mit Klammern, aber nur wenn curl etwas gemeldet hat: ein 404 ist eine
# Antwort ohne Fehlermeldung.
in_klammern() {
	local u
	u="$(ursache)"
	[[ -z "$u" ]] || printf ' (%s)' "$u"
}

# Antwort-Koerper einer Adresse; leer, wenn curl scheitert.
hole() { curl -sS --max-time 15 "$1" 2>"$CURLERR" || true; }
kopf() { curl -sS --max-time 15 -D - -o /dev/null "$1" 2>"$CURLERR" | tr -d '\r' || true; }

# --- 1. Health ----------------------------------------------------------------
step "Pruefung von $URL"
HEALTH="$(hole "$URL/healthz")"
if [[ "$HEALTH" == *'"status":"ok"'* && "$HEALTH" == *'"version"'* ]]; then
	ok "Health: $HEALTH"
else
	nok "Health: /healthz meldet nicht status ok mit Version (Antwort: ${HEALTH:-keine}; $(ursache))"
fi

# --- 2. Plattformseite --------------------------------------------------------
WURZEL="$(hole "$URL/")"
WURZEL_URSACHE="$(ursache)"
if [[ "$WURZEL" == *'<base href="/"'* && "$WURZEL" != *'<base href="/entwurf/"'* ]]; then
	ok 'Plattformseite: / liefert die App (base href "/")'
else
	nok "Plattformseite: / liefert nicht die App (base href \"/\" fehlt, es ist der Entwurf oder keine Antwort: $WURZEL_URSACHE)"
fi

# --- 3. Entwurf ---------------------------------------------------------------
if [[ $MIT_ENTWURF -eq 1 ]]; then
	for pfad in /entwurf/ /entwurf/glonntal/t/2-bowling; do
		if [[ "$(hole "$URL$pfad")" == *'<base href="/entwurf/"'* ]]; then
			ok "Entwurf: $pfad"
		else
			nok "Entwurf: $pfad liefert nicht den Entwurf (base href \"/entwurf/\" fehlt; $(ursache))"
		fi
	done
	# Die umgekehrte Probe: ein Routingfehler legte den Entwurf auf die Wurzel
	# und die App darunter lahm.
	if [[ -z "$WURZEL" ]]; then
		nok "Entwurf: / lieferte keine Antwort, die Gegenprobe sagt nichts ($WURZEL_URSACHE)"
	elif [[ "$WURZEL" == *'<base href="/entwurf/"'* ]]; then
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
		nok "Umzug: erwartet 301 nach https://test.jufi-app.de/impressum?x=1, gefunden ${ALT_STATUS:-keine Antwort} nach ${ALT_ZIEL:-nirgends} $(in_klammern)"
	fi
fi

# --- 5. Kopf ------------------------------------------------------------------
KOPF_WURZEL="$(kopf "$URL/")"
KOPF_URSACHE="$(ursache)"
if grep -i '^content-security-policy:' <<<"$KOPF_WURZEL" | grep -q "frame-ancestors 'none'"; then
	ok "Kopf: content-security-policy mit frame-ancestors 'none'"
else
	nok "Kopf: content-security-policy mit frame-ancestors 'none' fehlt${KOPF_URSACHE:+ ($KOPF_URSACHE)}"
fi

# --- 6. Manifest und Icons ----------------------------------------------------
# Hat der Verein ein Logo, prueft pruefe-icon.mjs das Logo und nicht die Schrift:
# die Buchstaben-Pruefung greift nur, wenn er keins hat. Bei Logo besteht die
# Pruefung also auf Groesse, und `fc-match` im Image (tools/deploy.sh, Tor 4)
# bleibt die andere Haelfte und wird hierdurch nicht ersetzt.
if [[ -n "$SLUG" ]]; then
	MANIFEST_FILE="$(mktemp)"
	MANIFEST_STATUS="$(curl -sS --max-time 15 -o "$MANIFEST_FILE" -w '%{http_code}' "$URL/$SLUG/manifest.webmanifest" 2>"$CURLERR" || true)"
	MANIFEST="$(cat "$MANIFEST_FILE")"
	rm -f "$MANIFEST_FILE"
	if ! command -v node >/dev/null; then
		nok "Manifest $SLUG: node fehlt, das Manifest laesst sich nicht pruefen"
	elif [[ "$MANIFEST_STATUS" != 200 ]]; then
		nok "Manifest $SLUG: Status $MANIFEST_STATUS statt 200 $(in_klammern)"
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
		ICON_STATUS="$(curl -sS --max-time 15 -o "$TMP" -w '%{http_code}' "$URL/$SLUG/icon-$groesse.png" 2>"$CURLERR" || true)"
		if ! command -v node >/dev/null; then
			nok "icon-$groesse: node fehlt, das Icon laesst sich nicht pruefen"
		elif [[ "$ICON_STATUS" != 200 ]]; then
			nok "icon-$groesse: Status ${ICON_STATUS:-keiner} statt 200 $(in_klammern)"
		elif MELDUNG="$(node "$PRUEFER" "$groesse" <"$TMP" 2>&1)"; then
			ok "icon-$groesse: $groesse x $groesse, mit Zeichnung"
		else
			nok "icon-$groesse: $MELDUNG"
		fi
		rm -f "$TMP"
	done
fi

# --- 7. WebSocket -------------------------------------------------------------
# Ein Upgrade ohne Cookie auf /<slug>/ws muss mit 401 abgelehnt werden: Nur der
# Hub antwortet so, also hat der Upgrade Traefik und die App erreicht und den
# Verein gefunden. Ein Erfolg (101) ist ohne Sitzung nicht zu haben und waere
# selbst ein Befund. Verworfen: mit einer echten Sitzung bis zum offenen Socket
# pruefen -- das Skript braeuchte dafuer Zugangsdaten eines Mitglieds.
# Der Origin ist die gepruefte Adresse, wie im Browser; weicht --url von der
# BASIS_URL der App ab, lehnt der Hub mit 403 ab. Der Schluessel ist fest und
# beliebig (RFC 6455 verlangt nur 16 Byte base64), es kommt ja kein Socket
# zustande. --http1.1, weil der Upgrade-Kopf in HTTP/2 nicht vorkommt.
if [[ -n "$SLUG" ]]; then
	WS_STATUS="$(curl --http1.1 -sS --max-time 15 -o /dev/null -w '%{http_code}' \
		-H 'Connection: Upgrade' \
		-H 'Upgrade: websocket' \
		-H 'Sec-WebSocket-Version: 13' \
		-H 'Sec-WebSocket-Key: SnVGaS1QcnVlZnVuZy0xMg==' \
		-H "Origin: $URL" \
		"$URL/$SLUG/ws" 2>"$CURLERR" || true)"
	case "$WS_STATUS" in
		401) ok "WebSocket $SLUG: Upgrade ohne Sitzung mit 401 abgelehnt (erreicht den Hub)" ;;
		403) nok "WebSocket $SLUG: 403 statt 401, der Origin $URL ist nicht die BASIS_URL der App" ;;
		404) nok "WebSocket $SLUG: 404 statt 401, Verein unbekannt oder gesperrt" ;;
		*) nok "WebSocket $SLUG: Status ${WS_STATUS:-keiner} statt 401 $(in_klammern)" ;;
	esac
fi

# --- 8. Link-Vorschau ---------------------------------------------------------
# Eine Thread-Adresse ohne Cookie muss die Open-Graph-Tags im Kopf tragen, wie ein
# Messenger sie holt. Die ID "vorschaupruefung" gibt es nicht: Die Antwort ist
# dieselbe wie fuer jeden Thread, den die Person nicht sehen darf, und traegt den
# Vereinsnamen. Geprueft wird also die Kette (Traefik, App, Angular-Seite), nicht
# ein Thread -- das Skript braeuchte sonst Zugangsdaten oder einen echten Titel.
# Das Bild muss die BASIS_URL der App tragen; weicht --url davon ab, schlaegt das
# hier an, wie beim Origin des WebSockets.
if [[ -n "$SLUG" ]]; then
	VORSCHAU_KOPF="$(mktemp)"
	VORSCHAU_TEXT="$(curl -sS --max-time 15 -D "$VORSCHAU_KOPF" -w '\n%{http_code}' "$URL/$SLUG/t/vorschaupruefung" 2>"$CURLERR" || true)"
	VORSCHAU_STATUS="${VORSCHAU_TEXT##*$'\n'}"
	VORSCHAU_KOERPER="${VORSCHAU_TEXT%$'\n'*}"
	VORSCHAU_CACHE="$(tr -d '\r' <"$VORSCHAU_KOPF" | grep -i '^cache-control:' || true)"
	rm -f "$VORSCHAU_KOPF"
	if [[ "$VORSCHAU_STATUS" != 200 ]]; then
		nok "Link-Vorschau $SLUG: Status ${VORSCHAU_STATUS:-keiner} statt 200 $(in_klammern)"
	elif ! grep -qi 'no-store' <<<"$VORSCHAU_CACHE"; then
		nok "Link-Vorschau $SLUG: Kopf cache-control: no-store fehlt (${VORSCHAU_CACHE:-kein cache-control})"
	elif ! grep -qF "property=\"og:image\" content=\"$URL/$SLUG/icon-512.png\"" <<<"$VORSCHAU_KOERPER"; then
		nok "Link-Vorschau $SLUG: og:image mit $URL/$SLUG/icon-512.png fehlt im Kopf"
	else
		ok "Link-Vorschau $SLUG: 200, no-store, og:image im Kopf"
	fi
fi

# --- 9. Mail-DNS --------------------------------------------------------------
# Mit ausdruecklichem Server 1.1.1.1, damit das Ergebnis nicht davon abhaengt,
# was der lokale Resolver noch zwischengespeichert hat.
# Setzt TXT_AUS (Zeilen ohne Anfuehrungszeichen) und TXT_FEHLER (Ursache, leer
# wenn die Abfrage selbst gelungen ist). Getrennt vom leeren Treffer: ein
# Zeitueberschreitung darf nicht als "kein Eintrag" erscheinen, sonst legte der
# Eigentuemer einen Eintrag an, der laengst da ist.
txt() {
	local roh rc
	roh="$(dig +short +time=5 +tries=1 @1.1.1.1 TXT "$1" 2>&1)"
	rc=$?
	TXT_FEHLER=''
	TXT_AUS=''
	if [[ $rc -ne 0 ]]; then
		TXT_FEHLER="dig Status $rc: $(grep -m1 . <<<"$roh" || echo 'keine Meldung')"
	else
		TXT_AUS="$(tr -d '"' <<<"$roh")"
	fi
}

if [[ -n "$MAIL_DOMAIN" ]]; then
	if ! command -v dig >/dev/null; then
		nok 'Mail-DNS: dig fehlt (macOS: dig ist dabei; Debian: dnsutils), nichts geprueft'
		MAIL_DOMAIN=''
	fi
fi

if [[ -n "$MAIL_DOMAIN" ]]; then
	# Mehrere SPF-Eintraege sind ungueltig (RFC 7208, 4.5): der Empfaenger
	# wertet dann gar keinen aus.
	txt "$MAIL_DOMAIN"
	SPF="$(grep '^v=spf1' <<<"$TXT_AUS" || true)"
	SPF_ANZAHL=$(grep -c . <<<"$SPF" || true)
	if [[ -n "$TXT_FEHLER" ]]; then
		nok "SPF: Abfrage fehlgeschlagen ($TXT_FEHLER)"
	elif [[ "$SPF_ANZAHL" -eq 1 ]]; then
		ok "SPF: $SPF"
	elif [[ "$SPF_ANZAHL" -eq 0 ]]; then
		nok "SPF: kein TXT-Eintrag mit v=spf1 fuer $MAIL_DOMAIN"
	else
		nok "SPF: $SPF_ANZAHL Eintraege mit v=spf1 (nur einer ist gueltig): $(tr '\n' '|' <<<"$SPF")"
	fi

	txt "_dmarc.$MAIL_DOMAIN"
	DMARC="$(grep '^v=DMARC1' <<<"$TXT_AUS" || true)"
	if [[ -n "$TXT_FEHLER" ]]; then
		nok "DMARC: Abfrage fehlgeschlagen ($TXT_FEHLER)"
	elif [[ -n "$DMARC" && "$DMARC" == *'p='* ]]; then
		ok "DMARC: $DMARC"
	elif [[ -n "$DMARC" ]]; then
		nok "DMARC: Eintrag ohne Richtlinie p=: $DMARC"
	else
		nok "DMARC: kein TXT-Eintrag mit v=DMARC1 unter _dmarc.$MAIL_DOMAIN"
	fi

	if [[ -n "$DKIM_SELEKTOR" ]]; then
		txt "$DKIM_SELEKTOR._domainkey.$MAIL_DOMAIN"
		DKIM="$(grep 'v=DKIM1' <<<"$TXT_AUS" || true)"
		if [[ -n "$TXT_FEHLER" ]]; then
			nok "DKIM: Abfrage fehlgeschlagen ($TXT_FEHLER)"
		elif [[ -n "$DKIM" ]]; then
			ok "DKIM: Schluessel unter $DKIM_SELEKTOR._domainkey.$MAIL_DOMAIN gefunden"
		else
			nok "DKIM: kein v=DKIM1 unter $DKIM_SELEKTOR._domainkey.$MAIL_DOMAIN"
		fi
	else
		note 'DKIM: ohne --dkim-selector nicht pruefbar. Beweis ist tools/mail-testen.mjs'
		note 'plus "Originalnachricht anzeigen" im Postfach (dkim=pass).'
	fi
fi

# --- 10. Dateien --------------------------------------------------------------
# Ohne Cookie muessen beide Dateien-Routen mit 401 antworten: Die Dateien eines
# Vereins sind nie oeffentlich, auch nicht fuer eine unbekannte ID (dann waere es
# ein 404 -- das gibt es erst mit Sitzung). Ein 200 oder 404 hiesse, dass die
# Pruefung der Sitzung nicht vor der Route steht, oder dass Traefik die Adresse
# nicht an die App reicht. Verworfen: mit Sitzung eine echte Datei holen -- das
# Skript braeuchte Zugangsdaten eines Mitglieds (wie beim WebSocket oben).
if [[ -n "$SLUG" ]]; then
	for pfad in "dateien/x" "dokumente"; do
		DATEI_STATUS="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$URL/$SLUG/api/v1/$pfad" 2>"$CURLERR" || true)"
		if [[ "$DATEI_STATUS" == 401 ]]; then
			ok "Dateien $SLUG: GET /api/v1/$pfad ohne Sitzung mit 401 abgelehnt"
		else
			nok "Dateien $SLUG: GET /api/v1/$pfad ohne Sitzung gibt ${DATEI_STATUS:-keinen Status} statt 401 $(in_klammern)"
		fi
	done
fi

echo
if [[ $FEHLER -gt 0 ]]; then
	printf '\033[31m%d Pruefung(en) fehlgeschlagen.\033[0m\n' "$FEHLER"
	exit 1
fi
printf '\033[32mAlle Pruefungen bestanden.\033[0m\n'
