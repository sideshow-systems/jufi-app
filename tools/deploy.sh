#!/usr/bin/env bash
#
# Deploy der echten App (apps/jufi, Teilprojekt 2) auf den gemeinsamen
# Hetzner-Server. Streng sequenziell, jeder Schritt ein Tor; Muster wie
# ../hwyd/tools/deploy.sh --transfer. Der Entwurf hat sein eigenes Skript
# (tools/deploy-entwurf.sh).
#
# Gebaut wird hier, nicht dort: der Server teilt 3,7 GB RAM ohne Swap mit
# paperless, HWYD und weiteren Apps, ein Angular-Build dort weckte den
# OOM-Killer. Rechner und Server sind beide arm64, der lokale Bau ist nativ.
#
# JuFi wohnt in der gemeinsamen Compose-Datei von paperless. Jeder
# Compose-Aufruf nennt deshalb ausdruecklich die JuFi-Dienste.
#
# Das Skript legt auf dem Server **nichts** an: keinen Compose-Block, keine
# Geheimnisse, keine Zeile in der .env. Das geschieht einmalig von Hand
# (README, Deployment der echten App). Hier wird nur geprueft, dass es da ist --
# ein Skript, das fehlende Geheimnisse selbst erzeugt, erzeugt sie auch dann,
# wenn sie nur an der falschen Stelle stehen, und dann ist der TOTP-Schluessel
# der Datenbank verloren.
#
# Aufruf:
#   tools/deploy.sh --dry-run    alle lokalen Tore (Tests, Bau, Rauchtest), nichts uebertragen
#   tools/deploy.sh [--transfer] alles, inklusive Uebertragung per SSH und Ausrollen
#
# Nur --transfer, kein Push in eine Registry: dann braucht der Server keine
# Zugangsdaten fuer Docker Hub, und es gibt kein oeffentliches Image, das man
# vergessen kann zu schuetzen. Preis: jeder Deploy schiebt das ganze Image
# (knapp 500 MB, komprimiert weniger) statt nur der geaenderten Schichten.

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_config.sh"
cd "$JUFI_ROOT"

DRY_RUN=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--transfer) shift ;;
		--dry-run) DRY_RUN=1; shift ;;
		*) echo "Unbekanntes Argument: $1 (erlaubt: --dry-run, --transfer)" >&2; exit 2 ;;
	esac
done

# --- Tor 1: sauberes Arbeitsverzeichnis --------------------------------------
# Ohne das laeuft irgendwann ein Image, dessen Stand in keinem Commit existiert --
# und dann luegen das Label image.revision und der Commit in /healthz.
step 'Tor 1: Git-Arbeitsverzeichnis'
git rev-parse --git-dir >/dev/null 2>&1 || fail 'Kein Git-Repository.'
[[ -z "$(git status --porcelain)" ]] || { git status --short; fail 'Nicht sauber. Erst committen.'; }
SHA="$(git rev-parse --short=12 HEAD)"
SHA_FULL="$(git rev-parse HEAD)"
note "HEAD: $SHA"

# Die Version steht nur im Label und in /healthz, nicht im Tag. Anders als HWYD
# hat JuFi (noch) keinen Release-Ablauf: package.json sagt seit dem Anfang
# 0.1.0, und ein Tag v0.1.0 wanderte bei jedem Deploy auf einen neuen Commit --
# ein Name, der nichts unterscheidet. Getaggt wird deshalb nur mit dem SHA (die
# Identitaet, an der ein Rueckfall haengt) und latest (Bequemlichkeit fuer
# Handarbeit auf dem Server). Kommt ein Release-Ablauf, kommt das Versions-Tag dazu.
VERSION="$(node -p "require('./package.json').version")"
note "Version: $VERSION"

# --- Tor 2: Format, Tests, Typen ---------------------------------------------
# Ersetzt, was ohne CI fehlt. Die Tests brauchen die Entwicklungsdatenbank
# (jufi_test_<projekt>); ohne sie scheitern sie mit einer Meldung, die nach
# rotem Code aussieht. Deshalb vorher fragen.
step 'Tor 2: Format, Tests und Typen'
[[ -n "$(docker compose -f docker-compose.dev.yml ps --status running -q postgres 2>/dev/null)" ]] \
	|| fail 'Die Entwicklungsdatenbank laeuft nicht. Erst: pnpm run db:up'
LOG="$(mktemp)"
pnpm exec prettier --check . >"$LOG" 2>&1 || { tail -20 "$LOG" >&2; fail 'Formatierung weicht ab (pnpm format).'; }
pnpm nx run-many -t test test-server typecheck --skip-nx-cache >"$LOG" 2>&1 \
	|| { tail -60 "$LOG" >&2; fail 'Tests oder Typpruefung sind rot.'; }
rm -f "$LOG"
note 'Format, Tests und Typpruefung gruen'

# --- Tor 3: Bauen -------------------------------------------------------------
step "Tor 3: Image bauen ($IMAGE:$SHA)"
LOG="$(mktemp)"
if ! docker build \
	--build-arg "APP_VERSION=$VERSION" \
	--build-arg "GIT_COMMIT=$SHA_FULL" \
	-t "$IMAGE:$SHA" -t "$IMAGE:latest" . >"$LOG" 2>&1; then
	tail -60 "$LOG" >&2
	fail 'Docker-Build gescheitert.'
fi
rm -f "$LOG"
note "$(docker images --format '{{.Size}}' "$IMAGE:$SHA" | head -1)"

# Die Labels kommen aus Build-Argumenten, der Stempel in /healthz ueber
# JUFI_COMMIT aus demselben Argument, aber auf einem anderen Weg. Hier laufen
# beide zum ersten Mal zusammen; ein falsches Argument gaebe ein Image, dessen
# Metadaten etwas anderes behaupten als es tut.
LABEL_VERSION="$(docker image inspect "$IMAGE:$SHA" --format '{{index .Config.Labels "org.opencontainers.image.version"}}')"
LABEL_REVISION="$(docker image inspect "$IMAGE:$SHA" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
[[ "$LABEL_VERSION" == "$VERSION" ]] || fail "Label image.version ist '$LABEL_VERSION', erwartet '$VERSION'."
[[ "$LABEL_REVISION" == "$SHA_FULL" ]] || fail "Label image.revision ist '$LABEL_REVISION', erwartet '$SHA_FULL'."
note 'Labels image.version und image.revision stimmen'

# --- Tor 4: Rauchtest des Images ---------------------------------------------
# Beweist, dass im Image nichts fehlt, was zur Laufzeit gebraucht wird -- ein
# vergessenes Laufzeitpaket faellt hier auf und nicht auf dem Server. Die
# Umgebung ist dieselbe wie in deploy/jufi-services.yml, bis auf die frisch
# erzeugten Geheimnisse und die Wegwerf-Datenbank; die Dienstnamen
# (jufi-db, jufi-mailpit) sind als Netz-Aliase nachgestellt.
step 'Tor 4: Rauchtest gegen Wegwerf-Datenbank und Wegwerf-Mailpit'
SMOKE_DB="jufi-rauchtest-db-$$"
SMOKE_MAIL="jufi-rauchtest-mail-$$"
SMOKE_APP="jufi-rauchtest-app-$$"
SMOKE_NET="jufi-rauchtest-net-$$"
SMOKE_PORT="${SMOKE_PORT:-4198}"
smoke_cleanup() {
	docker rm -f "$SMOKE_APP" "$SMOKE_DB" "$SMOKE_MAIL" >/dev/null 2>&1 || true
	docker network rm "$SMOKE_NET" >/dev/null 2>&1 || true
}
trap smoke_cleanup EXIT INT TERM

docker network create "$SMOKE_NET" >/dev/null
docker run -d --name "$SMOKE_DB" --network "$SMOKE_NET" --network-alias jufi-db \
	-e POSTGRES_USER=jufi -e POSTGRES_PASSWORD=rauchtest -e POSTGRES_DB=jufi \
	-e POSTGRES_INITDB_ARGS='--locale=C --encoding=UTF8' postgres:17-alpine >/dev/null
# Mailpit statt eines unerreichbaren SMTP_HOST: der Mail-Arbeiter sendet nur,
# wenn etwas in der Warteschlange liegt, und fiele hier also nicht auf -- aber
# die Umgebung soll aussehen wie auf dem Server und nicht nur zufaellig genuegen.
docker run -d --name "$SMOKE_MAIL" --network "$SMOKE_NET" --network-alias jufi-mailpit \
	axllent/mailpit:v1.21 >/dev/null
DB_READY=0
for _ in $(seq 1 60); do
	docker exec "$SMOKE_DB" pg_isready -U jufi -d jufi >/dev/null 2>&1 && { DB_READY=1; break; }
	sleep 1
done
# Ohne diese Pruefung scheiterte migrate deploy darunter an einer noch nicht
# bereiten Datenbank, und die Meldung saehe nach einem Migrationsfehler aus
# (in HWYD so geschehen, direkt nach einem Bau, der die Maschine ausgelastet hatte).
[[ "$DB_READY" -eq 1 ]] || fail 'Wegwerf-Datenbank wurde nach 60s nicht bereit.'

# Frisch erzeugt statt festgeschrieben: der Rauchtest soll die Startpruefung der
# App (libs/auth env-check, server/umgebung.ts) so bestehen, wie es eine echte
# Umgebung muss. In HWYD hatte die erste Fassung handgeschriebene Werte mit 29
# Byte -- die Startpruefung hat sie zu Recht abgelehnt.
SMOKE_ENV=(
	-e "DATABASE_URL=postgresql://jufi:rauchtest@jufi-db:5432/jufi?schema=public"
	-e "SESSION_SECRET=$(openssl rand -base64 32)"
	-e "TOTP_ENC_KEY=$(openssl rand -base64 32)"
	# Ohne Volume: /daten gehoert im Image node (Dockerfile), der Rauchtest prueft damit
	# zugleich, dass die App dort schreiben kann.
	-e 'DATEIEN_PFAD=/daten'
	-e "BASIS_URL=$APP_URL"
	-e "WEBAUTHN_RP_ID=${APP_URL#https://}"
	-e "WEBAUTHN_ORIGIN=$APP_URL"
	-e 'SMTP_HOST=jufi-mailpit'
	-e 'SMTP_PORT=1025'
	-e 'MAIL_ABSENDER=app@jufi-app.de'
	-e 'MAIL_ANTWORT=kontakt@jufi-app.de'
	-e 'MAIL_BETREFF_PRAEFIX=[Test] '
)

# Nicht nach /dev/null: in HWYD stand zweimal ein Fehlschlag hier ohne
# sichtbaren Grund, weil der eigentliche Prisma-Fehler verschluckt wurde.
LOG="$(mktemp)"
docker run --rm --network "$SMOKE_NET" "${SMOKE_ENV[@]}" "$IMAGE:$SHA" \
	npx prisma migrate deploy >"$LOG" 2>&1 || { tail -40 "$LOG" >&2; fail 'migrate deploy im Image gescheitert.'; }
rm -f "$LOG"
note 'migrate deploy im Image: alle Migrationen angewendet'

docker run -d --name "$SMOKE_APP" --network "$SMOKE_NET" \
	-p "127.0.0.1:$SMOKE_PORT:4000" "${SMOKE_ENV[@]}" "$IMAGE:$SHA" >/dev/null
BASIS="http://127.0.0.1:$SMOKE_PORT"
HEALTH=''
for _ in $(seq 1 40); do
	HEALTH="$(curl -fsS "$BASIS/healthz" 2>/dev/null || true)"
	grep -q '"status":"ok"' <<<"$HEALTH" && break
	sleep 1
done
grep -q '"status":"ok"' <<<"$HEALTH" || { docker logs "$SMOKE_APP" 2>&1 | cut -c1-300 | tail -20; fail 'Image antwortet nicht mit ok auf /healthz.'; }

# Traegt das Image ueberhaupt den Stand, mit dem es getaggt wurde? Das kann
# schiefgehen, ohne dass sonst etwas auffaellt -- ein fehlendes Build-Argument,
# ein Cache-Treffer auf einer alten Schicht. Nach dem Ausrollen wird genau diese
# Angabe von aussen verglichen; sie muss hier also schon stimmen.
grep -q "\"commit\":\"$SHA_FULL\"" <<<"$HEALTH" || fail "Das Image meldet einen anderen Commit als $SHA: $HEALTH"
grep -q "\"version\":\"$VERSION\"" <<<"$HEALTH" || fail "Das Image meldet nicht Version $VERSION: $HEALTH"
note "/healthz: ok, $VERSION, Commit $SHA"

# Eine Seite, so angefragt, wie Traefik sie weiterreicht: mit dem Host der
# Domain. Angular SSR prueft den Host gegen security.allowedHosts aus dem Bau
# (apps/jufi/project.json); fehlt die Domain dort, antwortet die App auf dem
# Server auf jede Seite mit 400, waehrend /healthz gruen bleibt.
HOST="${APP_URL#https://}"
SEITE="$(curl -fsS -H "Host: $HOST" -H 'X-Forwarded-Proto: https' "$BASIS/" 2>/dev/null || true)"
grep -qE '<base href="/" ?/?>' <<<"$SEITE" || fail "/ liefert mit Host $HOST keine index.html (allowedHosts in apps/jufi/project.json?)."
MAIN="$(grep -oE 'main-[A-Z0-9]{8}\.js' <<<"$SEITE" | head -1)"
[[ -n "$MAIN" ]] || fail 'Kein main-<hash>.js in der index.html gefunden.'
curl -fsS -o /dev/null -H "Host: $HOST" "$BASIS/$MAIN" || fail "$MAIN wird nicht ausgeliefert."
curl -fsS -o /dev/null -H "Host: $HOST" -H 'X-Forwarded-Proto: https' "$BASIS/rauchtest/anmelden" \
	|| fail 'Ein tiefer Link (/<slug>/anmelden) liefert keine Seite.'
# Und die Gegenprobe: ein fremder Host darf keine Seite bekommen. Sonst ist die
# Liste wirkungslos, und die Pruefung oben bewiese nichts.
FREMD="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: fremd.example' "$BASIS/" || true)"
[[ "$FREMD" == '400' ]] || fail "Ein fremder Host bekommt $FREMD statt 400 -- die Host-Pruefung greift nicht."
KOPF="$(curl -fsS -o /dev/null -D - -H "Host: $HOST" "$BASIS/")"
grep -qi "^content-security-policy: .*frame-ancestors 'none'" <<<"$KOPF" || fail 'Content-Security-Policy fehlt.'
note "/ und /<slug>/anmelden mit Host $HOST: index.html, $MAIN, CSP; fremder Host: 400"

# Der Docker-Healthcheck selbst (curl im Image, Pfad im Dockerfile): Traefik nimmt
# den Dienst erst bei "healthy" auf. Ein Tippfehler im Pfad liesse /healthz oben
# gruen und den Dienst auf dem Server trotzdem draussen.
STATUS=''
for _ in $(seq 1 40); do
	STATUS="$(docker inspect "$SMOKE_APP" --format '{{.State.Health.Status}}')"
	[[ "$STATUS" == 'healthy' ]] && break
	sleep 1
done
[[ "$STATUS" == 'healthy' ]] || fail "Docker-Healthcheck meldet '$STATUS' statt healthy."
# Erst in eine Variable: grep -q beendet sich beim ersten Treffer, docker logs
# bekommt SIGPIPE, und pipefail machte daraus (141) einen falschen Fehlschlag.
APP_LOG="$(docker logs "$SMOKE_APP" 2>&1)"
grep -q 'Mail-Arbeiter gestartet' <<<"$APP_LOG" || fail 'Der Mail-Arbeiter ist nicht gestartet.'
[[ "$(docker exec "$SMOKE_APP" id -u)" != '0' ]] || fail 'Der Container laeuft als root.'
# Ein leeres Volume erbt Besitzer und Rechte von /daten im Image; gehoerte das Verzeichnis
# dort root, scheiterte jeder Upload erst auf dem Server mit EACCES und kein Test sah es.
docker exec "$SMOKE_APP" test -w /daten || fail '/daten ist fuer den App-Benutzer nicht beschreibbar (Dockerfile: chown node).'
note "Docker-Healthcheck: healthy; Mail-Arbeiter gestartet; laeuft nicht als root; $(docker stats --no-stream --format '{{.MemUsage}}' "$SMOKE_APP" | cut -d/ -f1)im Leerlauf"

# Schrift und Initialen-Icon. Lokal liefert macOS eine Schrift, im Image fehlte
# sie womoeglich trotzdem, und der Fehler bliebe unsichtbar (Spec 6.4): sharp
# zeichnet dann Kaestchen oder gar nichts, und kein Test schlaegt an. Deshalb
# wird das Bild geprueft, das **das Image** erzeugt hat -- die Messung selbst
# (Groesse, Buchstaben) laeuft hier auf dem Entwicklungsrechner, wo sharp steht.
# fc-match ist die zweite Haelfte: Tofu hat Kontrast und besteht die Messung,
# aber nur mit der richtigen Schrift ist es DejaVu Sans Bold und nicht ein Ersatz.
FONT="$(docker exec "$SMOKE_APP" fc-match 'DejaVu Sans:bold' file 2>&1 || true)"
grep -q 'DejaVuSans-Bold' <<<"$FONT" || fail "DejaVu Sans Bold fehlt im Image (apk add font-dejavu, Dockerfile): $FONT"
# Der Demo-Verein hat kein Logo, also kommt das Icon aus den Initialen. Er wird
# in der Wegwerf-Datenbank angelegt, die gleich weggeworfen wird.
LOG="$(mktemp)"
docker run --rm --network "$SMOKE_NET" "${SMOKE_ENV[@]}" "$IMAGE:$SHA" \
	node apps/cli/dist/main.js demo einspielen >"$LOG" 2>&1 \
	|| { tail -20 "$LOG" >&2; fail 'Der Demo-Verein liess sich im Image nicht anlegen.'; }
rm -f "$LOG"
for GROESSE in 192 512; do
	curl -fsS -H "Host: $HOST" -H 'X-Forwarded-Proto: https' "$BASIS/demo/icon-$GROESSE.png" \
		| node tools/pruefe-icon.mjs "$GROESSE" \
		|| fail "Das Initialen-Icon ($GROESSE px) aus dem Image ist kaputt (Schrift? sharp?)."
done
note 'Initialen-Icon: DejaVu Sans Bold, 192 und 512 px, Buchstaben gezeichnet'

# Und die CLI, die im selben Image daneben liegt. Sie ist ein eigenes Buendel mit
# eigenen externen Paketen (tools/runtime-package.mjs) -- in HWYD ist genau das
# durchgerutscht: der Rauchtest startete nur die App, und auf dem Server
# scheiterte der erste Nutzer-Anlegen-Aufruf beim Laden eines Moduls.
# `admin anlegen` ist der Aufruf, um den es auf dem Server geht: er laedt das
# ganze Buendel, liest BASIS_URL, schreibt in die Datenbank -- die Wegwerf-
# Datenbank, die gleich weggeworfen wird. Der Link selbst wird nicht ausgegeben.
LOG="$(mktemp)"
docker run --rm --network "$SMOKE_NET" "${SMOKE_ENV[@]}" "$IMAGE:$SHA" \
	node apps/cli/dist/main.js admin anlegen rauchtest >"$LOG" 2>&1 \
	|| { sed -E 's/#.*/#…/' "$LOG" | tail -20 >&2; fail 'Die CLI im Image laeuft nicht. Fehlt ein Paket in tools/runtime-package.mjs?'; }
grep -q "^$APP_URL/admin/einrichten#" "$LOG" || { sed -E 's/#.*/#…/' "$LOG" >&2; fail 'Die CLI gibt keinen Einrichtungslink aus.'; }
rm -f "$LOG"
note "CLI im Image: admin anlegen gibt $APP_URL/admin/einrichten#… aus"
smoke_cleanup
trap - EXIT INT TERM

if [[ "$DRY_RUN" -eq 1 ]]; then
	step 'Probelauf -- nichts uebertragen, der Server nicht angefasst'
	note "Waere uebertragen: $IMAGE:$SHA ($VERSION)"
	exit 0
fi

# --- Tor 5: Vorbedingungen auf dem Server -------------------------------------
# Vor dem Uebertragen, weil das Uebertragen das Teure ist. Geprueft wird nur,
# dass da ist, was von Hand angelegt werden muss; ausgegeben werden Namen, nie Werte.
[[ -n "$SSH_TARGET" ]] || fail 'SSH_TARGET fehlt. deploy/env.deploy.example nach .env.deploy kopieren.'
step 'Tor 5: Vorbedingungen auf dem Server'
DIENSTE="$(remote_compose 'config --services' 2>/dev/null)" \
	|| fail "docker compose config scheitert in $REMOTE_DIR/$REMOTE_COMPOSE."
for DIENST in "$DB_SERVICE" "$MIGRATE_SERVICE" "$MAIL_SERVICE" "$APP_SERVICE"; do
	grep -qx "$DIENST" <<<"$DIENSTE" || fail \
		"Dienst $DIENST fehlt in $REMOTE_DIR/$REMOTE_COMPOSE. Den Block aus deploy/jufi-services.yml dort einmalig von Hand einfuegen (README)."
done
# JUFI_IMAGE_TAG muss als Zeile existieren: das sed weiter unten ersetzt nur,
# und eine fehlende Zeile liesse es still nichts tun -- der Server liefe dann auf
# latest, und ein Rueckfall durch Aendern dieser Zeile ginge ins Leere.
FEHLT="$(jufi_ssh "cd $REMOTE_DIR && for v in JUFI_POSTGRES_USER JUFI_POSTGRES_PASSWORD JUFI_POSTGRES_DB JUFI_SESSION_SECRET JUFI_TOTP_ENC_KEY JUFI_IMAGE_TAG; do grep -q \"^\$v=.\" .env || echo \$v; done")" \
	|| fail "Die .env in $REMOTE_DIR ist nicht lesbar."
[[ -z "$FEHLT" ]] || fail "In $REMOTE_DIR/.env fehlen oder sind leer: $(tr '\n' ' ' <<<"$FEHLT")(Vorlage: deploy/env.jufi.example)"
note "Dienste $DB_SERVICE, $MIGRATE_SERVICE, $MAIL_SERVICE, $APP_SERVICE und alle JUFI_-Variablen vorhanden"
# Dateien-Etappe (TP4): Die App startet ohne DATEIEN_PFAD gar nicht -- das faellt laut
# auf. Still ist nur die halbe Uebernahme des Blocks: DATEIEN_PFAD gesetzt, das Volume
# aber nicht eingehaengt oder ohne den festen Namen. Dann schreibt die App in die
# beschreibbare Schicht des Containers, der naechste Ausrollen verliert die Dateien, und
# backup.sh findet kein Volume jufi-dateien und warnt nur. Geprueft wird die aufgeloeste
# Konfiguration (config --format json) statt der Datei per grep, damit auch Anker und
# Interpolation zaehlen. Verworfen: jq -- steht nicht ueberall, node steht hier ohnehin.
# Die JSON-Ausgabe enthaelt Geheimnisse; sie geht nur in die Pipe, ausgegeben werden Texte.
KONFIG="$(remote_compose 'config --format json' 2>/dev/null)" \
	|| fail "docker compose config --format json scheitert in $REMOTE_DIR/$REMOTE_COMPOSE."
DATEIEN_PROBLEME="$(printf '%s' "$KONFIG" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
	const konfig = JSON.parse(s);
	const dienst = konfig.services?.[process.argv[1]] ?? {};
	const pfad = dienst.environment?.DATEIEN_PFAD;
	const probleme = [];
	if (!pfad) probleme.push("Am Dienst " + process.argv[1] + " fehlt DATEIEN_PFAD (/daten).");
	const einhaengung = (dienst.volumes ?? []).find((v) => v.type === "volume" && v.source === "jufi-dateien");
	if (!einhaengung) probleme.push("Das Volume jufi-dateien ist am Dienst " + process.argv[1] + " nicht eingehaengt.");
	else if (pfad && einhaengung.target !== pfad)
		probleme.push("jufi-dateien haengt unter " + einhaengung.target + ", DATEIEN_PFAD ist " + pfad + ".");
	if (konfig.volumes?.["jufi-dateien"]?.name !== "jufi-dateien")
		probleme.push("Das Volume jufi-dateien fehlt oder hat keinen festen Namen (name: jufi-dateien).");
	console.log(probleme.join("\n"));
});
' "$APP_SERVICE")" \
	|| fail "Die Compose-Konfiguration in $REMOTE_DIR/$REMOTE_COMPOSE ist nicht lesbar."
[[ -z "$DATEIEN_PROBLEME" ]] || fail "$DATEIEN_PROBLEME
Den Block jufi-dateien (Volume und DATEIEN_PFAD am Dienst $APP_SERVICE) aus deploy/jufi-services.yml in $REMOTE_DIR/$REMOTE_COMPOSE uebernehmen, sonst gehen die Dateien beim naechsten Ausrollen verloren."
note "Dateien: DATEIEN_PFAD gesetzt, Volume jufi-dateien am Dienst $APP_SERVICE eingehaengt"
# Ohne Sicherungsskript auf dem Server gaebe es gleich keinen Dump vor der
# Migration. Das faellt hier auf, vor dem Uebertragen, und nicht mittendrin.
jufi_ssh "test -x $REMOTE_TOOLS/backup.sh" \
	|| fail 'Kein Deploy ohne Sicherung: tools/install-backup.sh ausfuehren.'
note "Sicherungsskript $REMOTE_TOOLS/backup.sh ausfuehrbar"
# Ein altes backup.sh kennt das Volume nicht und sicherte nur die Datenbank, ohne Warnung.
# Das Skript wird auf dem Server gelesen, nicht das lokale: install-backup.sh kopiert es erst.
jufi_ssh "grep -q jufi-dateien $REMOTE_TOOLS/backup.sh" \
	|| fail 'Das installierte backup.sh auf dem Server kennt jufi-dateien nicht: tools/install-backup.sh erneut ausfuehren.'
note 'backup.sh sichert das Volume jufi-dateien'

# --- Tor 5b: Dump vor der Migration --------------------------------------------
# Spec 8.2. Bewusst **vor** dem Uebertragen und nicht danach: ein gescheiterter
# Dump bricht ab, bevor irgendetwas auf dem Server veraendert wurde (weder Image
# noch JUFI_IMAGE_TAG). Nach dem Ausrollen laeuft die Migration schon, und der
# Dump zeigte den Stand danach -- der Zweck, der Stand davor, waere verfehlt.
# Ohne restic (--no-restic): die Kopie ausser Haus macht der naechtliche Lauf; ein
# Deploy soll nicht an der Erreichbarkeit des zweiten Kontos haengen.
step 'Tor 5b: Dump vor der Migration'
# Die Entscheidung steht in db_vorzustand (_config.sh, geprobt mit
# tools/probe-deploy-tor.sh). Nur "kein Container" ist ein erstes Ausrollen; ein
# vorhandener, nicht laufender Container hat Daten und braucht erst den Start.
DB_ZUSTAND="$(db_vorzustand)" \
	|| fail 'Zustand von '"$DB_SERVICE"' nicht abfragbar -- kein Deploy ohne Sicherung. Auf dem Server wurde nichts veraendert.'
case "$DB_ZUSTAND" in
	laeuft)
		jufi_ssh "$REMOTE_TOOLS/backup.sh --local --no-restic" \
			|| fail 'Dump gescheitert -- kein Deploy ohne Sicherung. Auf dem Server wurde nichts veraendert.'
		note 'Dump gezogen (lokal auf dem Server, ohne restic)'
		;;
	steht)
		fail "Datenbank laeuft nicht -- kein Deploy ohne Sicherung. Naechster Schritt: auf dem Server $DB_SERVICE starten (docker compose up -d $DB_SERVICE in $REMOTE_DIR), dann den Deploy erneut. Auf dem Server wurde nichts veraendert."
		;;
	*)
		# Allererstes Ausrollen: es gibt noch nichts zu sichern.
		note "Kein Container von $DB_SERVICE (erstes Ausrollen) -- kein Dump noetig"
		;;
esac

# --- Tor 6: Uebertragen und Ausrollen ------------------------------------------
step "Tor 6: Image per SSH uebertragen ($IMAGE:$SHA)"
# docker save schreibt alle Schichten. Ohne Registry gibt es kein inkrementelles
# Uebertragen -- dafuer auch keine Zugangsdaten auf dem Server.
docker save "$IMAGE:$SHA" "$IMAGE:latest" | gzip -1 \
	| jufi_ssh 'gunzip | docker load' | tail -2 || fail 'Uebertragung gescheitert.'

step "Ausrollen: $SHA"
# JUFI_IMAGE_TAG landet in der geteilten .env, damit ein spaeteres `up -d jufi`
# denselben Stand nimmt -- und ein Rueckfall nur diese Zeile aendern muss.
jufi_ssh "cd $REMOTE_DIR && sed -i.bak 's|^JUFI_IMAGE_TAG=.*|JUFI_IMAGE_TAG=$SHA|' .env" \
	|| fail 'JUFI_IMAGE_TAG in .env setzen gescheitert.'
# Ausdruecklich nur der App-Dienst. Datenbank, Migration und Mailpit kommen ueber
# depends_on mit; die Migration laeuft vor der App, und scheitert sie, startet
# die neue App nicht und die alte laeuft weiter.
if ! remote_compose "up -d $APP_SERVICE"; then
	remote_compose "logs --tail=30 $MIGRATE_SERVICE" >&2 || true
	fail 'Ausrollen gescheitert. Die alte Version laeuft weiter.'
fi

# --- Tor 7: Nachpruefen ------------------------------------------------------
step 'Tor 7: Nachpruefen'
# Zuerst von innen: das geht auch ohne oeffentlichen DNS-Eintrag und ohne Traefik.
INNER=''
for _ in $(seq 1 30); do
	INNER="$(remote_compose "exec -T $APP_SERVICE curl -fsS http://127.0.0.1:4000/healthz" 2>/dev/null || true)"
	grep -q "\"commit\":\"$SHA_FULL\"" <<<"$INNER" && break
	sleep 2
done
grep -q '"status":"ok"' <<<"$INNER" || fail "Der Container meldet nicht ok: ${INNER:-keine Antwort}"
grep -q "\"commit\":\"$SHA_FULL\"" <<<"$INNER" || fail "Im Container laeuft nicht $SHA: $INNER"
note "im Container: $INNER"

# Die Frage, um die es eigentlich geht: liefert die oeffentliche Adresse den
# Stand aus, der gerade gebaut wurde? "Container gesund" heisst das nicht --
# Traefik nimmt den neuen Container erst bei healthy auf und zeigt bis dahin
# auf den alten. Deshalb wiederholt, bis der Commit stimmt.
LIVE=''
for _ in $(seq 1 30); do
	LIVE="$(curl -fsS "$APP_URL/healthz" 2>/dev/null || true)"
	grep -q "\"commit\":\"$SHA_FULL\"" <<<"$LIVE" && break
	sleep 3
done
if grep -q "\"commit\":\"$SHA_FULL\"" <<<"$LIVE"; then
	note "$APP_URL/healthz: $LIVE"
elif [[ -n "$LIVE" ]]; then
	fail "Draussen laeuft nicht $SHA, sondern: $LIVE. Der Container ist gesund -- dann steckt etwas dazwischen."
else
	warn "$APP_URL ist von aussen nicht erreichbar."
	note 'Der Container ist gesund. Fehlt der DNS-Eintrag, die Traefik-Labels oder das Zertifikat?'
	note "  ssh: cd $REMOTE_DIR && docker compose -f $REMOTE_COMPOSE logs --tail=30 traefik"
	exit 1
fi

printf '\n\033[32m✓ Ausgerollt: %s (%s)\033[0m\n' "$SHA" "$VERSION"
# Die Rueckfallzeile nennt das Skript, nicht die Handarbeit: es prueft vorher, ob
# die Migrationen gleich sind und das Image auf dem Server liegt.
note "Rueckfall: tools/rollback.sh (--list zeigt die Tags; bricht ab, wenn sich Migrationen unterscheiden)"
