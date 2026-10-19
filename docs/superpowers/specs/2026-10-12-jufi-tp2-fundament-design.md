# JuFi App — Teilprojekt 2: Fundament

Stand: 18.10.2026 · Ergebnis des Brainstormings vom 13.10.2026, nachgezogen mit Etappe 5 · Status: zur Freigabe

Teilprojekt 2 baut die echte App bis zu dem Punkt, an dem ein Verein **einladen, anmelden und Mitglieder pflegen** kann (Rahmen-Spezifikation `2026-10-11-jufi-rahmen-design.md`, Abschnitt 11). Threads, Module, Medien, Offline-Betrieb und Push folgen in den Teilprojekten 3 bis 5.

Die Rahmen-Spezifikation gilt weiter. Diese Datei legt fest, was sie bewusst offen lässt (Felder des Datenmodells, Abläufe, Oberflächen in TP2, Betrieb), und hält die Entscheidungen mit ihren verworfenen Alternativen fest. Wo sie von der Rahmen-Spezifikation abweicht, steht das in Abschnitt 10; die Rahmen-Spezifikation ist entsprechend nachgezogen.

---

## 1. Ausgangslage und Ziel

### 1.1 Ergebnis

Am Ende von Teilprojekt 2 gilt auf `https://test.jufi-app.de`:

1. Der Plattform-Admin legt den Verein „Glonntal Fischereiverein 1889 e.V. Petershausen" an und lädt die erste Leitung ein.
2. Die drei echten Jugendleiter nehmen ihre Einladung an und melden sich mit Passkey oder Passwort an.
3. Sie legen Jungfischer, Familien, Untergruppen und Jugendsprecher an, vergeben Rechte und erzeugen Einladungen.
4. Eine (erfundene) Mutter nimmt ihre Einladung an, willigt für ihr Kind ein, und das Kind richtet seinen eigenen Zugang ein.
5. Die Datenbank wird täglich verschlüsselt außer Haus gesichert, und eine Wiederherstellungsprobe ist gelaufen.

### 1.2 Echte und erfundene Daten

- Bis zum Pilotbetrieb (nach Teilprojekt 5) sind auf dem Testserver **nur die drei Jugendleiter echt**. Kinder und Familien sind erfunden.
- Die echten Jugendleiter werden erst eingeladen, wenn Etappe 6 abgenommen ist: Sicherung, Wiederherstellungsprobe und Mail laufen, Impressum, Datenschutzerklärung und Einwilligungstext stehen.
- Geprüft wird im Browser ausschließlich mit erfundenen Daten.

### 1.3 Ansatz

`libs/auth` und das Server-Gerüst aus `../hwyd` (Express in `@angular/ssr`, Prisma-Client, Healthcheck, Deploy-, Rollback-, Sicherungs- und Wiederherstellungsskripte) werden **einmalig kopiert** und hier umgebaut. Danach entwickeln sich beide Projekte unabhängig.

Verworfen:

- **Gemeinsames Paket für hwyd und JuFi**: Jede JuFi-Anforderung (Vereine, Anmeldenamen) würde zur Änderung an hwyds Anmeldung, dazu kämen Versionierung und Veröffentlichung. hwyd ist in Betrieb und hält sensible Daten.
- **Fertige Anmeldebibliothek** (z. B. better-auth): mehr Angriffsfläche als Nutzen, und Cookies pro Vereinspfad sowie getrennte Konten je Verein passen nicht zu ihrem Modell.

Preis der Kopie: Eine Sicherheitskorrektur in einem Projekt muss im anderen von Hand nachgezogen werden.

### 1.4 Etappen

Jede Etappe ist für sich lauffähig, bekommt einen eigenen Plan und wird vom Eigentümer lokal abgenommen, bevor die nächste beginnt.

| #   | Etappe                  | Inhalt                                                                                                                                     | Abschnitte |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | Gerüst                  | `apps/jufi`, `apps/cli`, `libs/domain`, `libs/db`, `libs/auth`; Postgres und Mailpit lokal; Healthcheck                                    | 2, 3       |
| 2   | Plattform-Admin         | CLI zum Anlegen, `/admin` mit Anmeldung, Vereine anlegen, sperren, erste Einladung, Protokoll                                              | 7          |
| 3   | Einladung und Anmeldung | Einladung annehmen, Passkey, Passwort, Anmeldename, TOTP, Zurücksetzen per Mail, Sitzungen, Backoff, Mail-Arbeiter                         | 4          |
| 4   | Mitglieder pflegen      | Personen, Familie, Jugendsprecher, Untergruppen, Rechte, Einwilligung, Volljährigkeit, Entfernen                                           | 5          |
| 5   | Oberflächen             | Mitglieder-Hülle (Start, Mehr, Profil, Meine Jungfischer), Verwaltungs-Hülle, PWA-Manifest, Plattformseite, Rechtstexte, Ende-zu-Ende-Test | 6, 9       |
| 6   | Betrieb                 | Dienste auf dem Server, Deploy, Rollback, Sicherung mit Wiederherstellungsprobe, Mail-Versand                                              | 8          |

Die API-Endpunkte einer Etappe entstehen zusammen mit den Bauteilen, die sie brauchen. Etappe 5 baut die beiden Hüllen fertig aus (Navigation, Start, Profil, Gestaltung, Messungen, jetzt automatisch in Playwright, 9); die Seiten, die Etappen 2 bis 4 brauchen, entstehen dort bereits in schlichter Form.

---

## 2. Aufbau und Routing

### 2.1 Workspace

```
apps/
	jufi/      Angular (CSR) + Express-Server-Routen; WebSocket folgt in TP3
	cli/       Plattform-Admin anlegen und zurücksetzen, Verein löschen, Demo-Verein
	entwurf/   klickbarer Entwurf, bleibt unverändert (Wegwerfcode)
	jufi-e2e/  Ende-zu-Ende-Test mit Playwright (9); nicht im Image
libs/
	domain/    reine Regeln: Rechte, Sichtbarkeit von Personen, Familie,
	           Volljährigkeit, Slug, Anmeldename, Passwortregel
	db/        Prisma-Client mit Treiber-Adapter, vereinDb(vereinId)
	auth/      aus hwyd kopiert und umgebaut: Passwörter, TOTP, Passkeys,
	           Sitzungen, Tokens, Backoff, env-check
```

- Gestaltung (Tokens, Farbableitung mit WCAG-Prüfung, Hell/Dunkel/System, Icons, Meldungen, Grundbausteine) wird aus `apps/entwurf/src/app/gestaltung/` nach `apps/jufi/src/app/gestaltung/` **kopiert**. Verworfen: eine gemeinsame Bibliothek mit dem Entwurf — der Entwurf ist Wegwerfcode und darf keine Abhängigkeit der App werden.
- Regeln in `libs/domain` sind reine Funktionen ohne Angular- und Express-Abhängigkeit und bekommen `jetzt: Date` als Parameter, nie `new Date()`.
- Lokal: Postgres in Docker auf Port 5433 (wie hwyd), Mailpit in Docker für alle ausgehenden Mails.

### 2.2 Anfrageverarbeitung

Jede Anfrage an `/<slug>/…`:

1. Verein aus dem Slug bestimmen; unbekannt oder gesperrt → 404.
2. Sitzung aus dem Cookie lesen (Pfad `/<slug>/`); die Sitzung gilt nur, wenn ihr Verein der Verein des Slugs ist.
3. Rechte und Sichtbarkeit mit den Funktionen aus `libs/domain` prüfen.
4. Lesen und Schreiben nur über `vereinDb(vereinId)`. Einzige benannte Ausnahme: das Lesen des Admin-Protokolls für den Notfall-Link-Hinweis (6.3).

`/admin/…` hat eine eigene Sitzung und eine eigene Datenschicht, die an Vereinsdaten nur über Kennzahlen und Ansprechpartner herankommt (Abschnitt 7).

Was eine Person nicht sehen darf, ist für sie „nicht gefunden" (404 statt 403).

### 2.3 Domains und Routing

- **Test**: `https://test.jufi-app.de` auf der bestehenden VM. Die frühere Testdomain `jufi-app.sideshow-systems.de` leitet dauerhaft (301) dorthin um, mit Pfad und Abfrage.
- **Live**: `https://www.jufi-app.de` auf eigener VM (Teilprojekt 6). Der Umzug ist reine Konfiguration (Basis-URL, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`).
- **Bis zur ersten Auslieferung der App** (Etappe 6) gehört die ganze Testdomain dem Entwurf, und nginx im Entwurf leitet `/` auf `/entwurf/` um.
- **Ab Etappe 6** bekommt der Entwurf in Traefik `Host(test.jufi-app.de) && PathPrefix(/entwurf)`, und seine Umleitung von `/` entfällt. Alles andere geht an die App. Traefik bevorzugt die längere Regel von selbst.
- `/` ist eine kleine **Plattformseite**: was die JuFi App ist, ein Link zum Entwurf, Impressum und Datenschutz. **Sie listet keine Vereine auf**, sonst verriete sie, wer die Plattform nutzt.
- `/impressum` und `/datenschutz` sind statische Seiten der Plattform, gerendert aus Markdown-Dateien im Repo.
- **Passkeys** gelten für `test.jufi-app.de`, nicht für `jufi-app.de`: Test und Live bleiben getrennt, ein Testzugang bedeutet live nichts.

Verworfen:

- **App unter eigenem Pfad** (`/app/<slug>/`): widerspricht dem URL-Schema, und beim Umzug brächen Links.
- **Eigene Subdomain für die App**: ein weiteres Zertifikat, ohne Gewinn bei den Passkeys.

### 2.4 URLs in Teilprojekt 2

Ergänzt Rahmen-Spezifikation 5.4.

| URL                                                           | Inhalt                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/`, `/impressum`, `/datenschutz`                             | Plattformseite und Rechtstexte                                                                     |
| `/admin/…`                                                    | Plattform-Admin (Abschnitt 7)                                                                      |
| `/<slug>/`                                                    | Start                                                                                              |
| `/<slug>/anmelden?weiter=…`                                   | Anmeldung; `weiter` gilt nur als relativer Pfad innerhalb desselben Vereins (`sichererWeiterPfad`) |
| `/<slug>/einladung#<token>`                                   | Einladung annehmen, auch der Reset-Link                                                            |
| `/<slug>/zugang-verloren`                                     | Zugang verloren ("Passwort vergessen?")                                                            |
| `/<slug>/mehr`, `/<slug>/profil`, `/<slug>/meine-jungfischer` | Mitglieder-Hülle                                                                                   |
| `/<slug>/verwaltung/…`                                        | Verwaltungs-Hülle                                                                                  |
| `/<slug>/manifest.webmanifest`, `/<slug>/icon-<größe>.png`    | PWA-Manifest und Icons des Vereins                                                                 |
| `/<slug>/api/v1/…`                                            | REST-API des Vereins                                                                               |
| `/healthz`                                                    | Healthcheck (Node und Datenbank, Versionsnummer)                                                   |

- Ohne Sitzung führt jede Vereinsseite zu `anmelden?weiter=…`. Nach der Anmeldung prüft `sichererWeiterPfad` in `libs/domain` den Wert: Erlaubt ist nur ein Pfad, der nach dem Normalisieren unter `/<slug>/` liegt und nicht wieder auf `anmelden`, `einladung` oder `zugang-verloren` zeigt. Alles andere (`//fremd.example`, `/\fremd.example`, eine vollständige Adresse, `/<slug>/../admin`, ein fremder Slug, `javascript:`) führt zum Start des Vereins, nie woandershin. Verworfen: eine Positivliste der erlaubten Seiten — sie müsste mit jeder neuen Seite des Vereins wachsen.
- **„Meine Jungfischer" liegt unter `/<slug>/meine-jungfischer`** und nicht unter `/<slug>/jungfischer`. Verworfen: eine Weiterleitung vom alten Pfad. Echte Nutzer haben ihn nie gesehen, sie wäre Code für niemanden.
- **Reservierte Slugs**: `admin`, `api`, `entwurf`, `assets`, `impressum`, `datenschutz`, `healthz`, `favicon.ico`, `robots.txt` sowie alles, was die Plattform künftig auf oberster Ebene braucht. Die Prüfung liegt in `libs/domain`.

---

## 3. Datenmodell

### 3.1 Mandantentrennung in der Datenbank

- Jede Vereinstabelle trägt `vereinId`, **auch die Verknüpfungstabellen**.
- `Person` hat zusätzlich `@@unique([vereinId, id])`. Verweise zwischen Personen und von Vereinsobjekten auf Personen laufen über das Paar `(vereinId, personId)` als zusammengesetzten Fremdschlüssel.
- Damit kann **die Datenbank selbst** keine Familie, Untergruppe oder Sitzung über Vereinsgrenzen hinweg verknüpfen, nicht erst `vereinDb`. Verworfen: Schutz nur in der Datenschicht — ein einziger Fehler im Code wäre dann ein Leck.
- Primärschlüssel sind `cuid()` wie in hwyd.

### 3.2 Verein und Plattform

**`Verein`**

| Feld           | Bedeutung                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`         | eindeutig; Kleinbuchstaben, Ziffern, Bindestriche; 3–30 Zeichen; nicht reserviert                                                                                                                                                                                                                                                                                                                                                                                                |
| `name`         | offizieller Name, z. B. „Glonntal Fischereiverein 1889 e.V. Petershausen"; in Einwilligungstext, Kontakt, Fußzeile der Mails                                                                                                                                                                                                                                                                                                                                                     |
| `anzeigename`  | höchstens 24 Zeichen, z. B. „Jungfischer Glonntal"; in Kopfzeile, Passkey-Name, Home-Bildschirm, Betreff der Mails                                                                                                                                                                                                                                                                                                                                                               |
| `farbe`        | Vereinsfarbe als Hex-Wert; alles Weitere wird daraus abgeleitet (Rahmen-Spec 5.1.1)                                                                                                                                                                                                                                                                                                                                                                                              |
| `kontakt`      | Freitext                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `status`       | `AKTIV` oder `GESPERRT`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sperrzaehler` | technisch, nie fachlich gelesen: Jede Transaktion, die anhand von „erste Einladung angenommen?" entscheidet (Einlösen, Erneuern, Notfall-Link, Slug-Korrektur), erhöht ihn zuerst und sperrt so die Vereinszeile bis zum Ende der Transaktion. Verworfen: `SELECT … FOR UPDATE` — `vereinDb` verbietet Rohabfragen, und eine Ausnahme dort höhlte die Sperre aus, die Etappe 1 gebaut hat; ebenso die Isolation `Serializable`, die Wiederholschleifen in jeder Route verlangte. |
| `angelegtAm`   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Der offizielle Name ist mit 46 Zeichen für Kopfzeile, Passkey-Auswahl und Home-Bildschirm zu lang; deshalb zwei Namen. Der `gruppenname` aus Rahmen-Spec 7.3 entfällt, weil der Anzeigename ihn abdeckt.

**`VereinLogo`**: eigene Tabelle mit dem Logo als Bytes (PNG oder JPEG) und den daraus erzeugten Icons (192 und 512 px). Eigene Tabelle, damit nicht jede Vereinsabfrage das Bild mitlädt. Verworfen: Dateiablage im Volume — die entsteht erst in TP4, und so ist das Logo mit der Datenbank gesichert.

- **Das Logo wird neu kodiert, nie durchgereicht.** Das Format bestimmt der Inhalt (`sharp(…).metadata()`), nicht der `Content-Type`, den der Aufrufer frei wählt; zugelassen sind nur PNG und JPEG. Gespeichert wird das Bild mit höchstens 1024 px an der längsten Seite, nach EXIF gedreht und ohne Metadaten: Ein Handyfoto trägt sonst womöglich den GPS-Ort, und ein Bild kann hinter seinem Ende weitere Daten verstecken. Verworfen: das hochgeladene Bild unverändert speichern.
- **Eingabegrenzen**: höchstens 1 MB und 25 Megapixel (`limitInputPixels`). Die Bytegrenze allein schützt nicht, denn ein PNG mit 10 000 × 10 000 Pixeln ist einfarbig wenige KB groß und entpackt 400 MB. Ein falsches Format ergibt 415, ein zu großes Bild 413; das alte Logo bleibt dann unverändert.
- **Eine Quelle für die Grenze**: `LOGO_MAX_BYTES` und der Text `LOGO_ZU_GROSS` liegen in `libs/domain`. Client und Server nutzen beide diese Konstanten, damit keine der beiden Seiten abweicht. Verworfen: die Konstante im Server neben `sharp`, weil die Oberfläche sie dann nicht importieren kann, ohne `sharp` ins Bundle zu ziehen. Verworfen: je eine Kopie in Oberfläche und Server, weil zwei Zahlen auseinanderliefen.

**`PlattformAdmin`** mit `AdminSession`, `AdminPasskey`, `AdminRecoveryCode`, `AdminEinrichtung` (Einrichtungs-Token) und **`AdminProtokoll`** (Admin, Zeitpunkt, Aktion, Verein): eigene Tabellen ohne `vereinId` und ohne Verbindung zu den Personen. Verworfen: der Admin als `Zugang` ohne Person — dann stünde er in denselben Tabellen wie die Vereinsdaten, und die Trennung nach Rahmen-Spec 8.3 hinge wieder an Abfragen.

### 3.3 Personen

**`Person`**

| Feld                    | gilt für    | Bedeutung                                                                                                                                                                                         |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `art`                   | alle        | `JUNGFISCHER` oder `ERWACHSENER`                                                                                                                                                                  |
| `vorname`, `nachname`   | alle        | bei entfernten Personen leer                                                                                                                                                                      |
| `geburtsdatum`          | Jungfischer | **Pflicht**; trägt den Hinweis auf die Volljährigkeit (5.6)                                                                                                                                       |
| `jugendsprecher`        | Jungfischer | Merkmal nach Rahmen-Spec 3.5                                                                                                                                                                      |
| `zugangErlaubt`         | Jungfischer | vorbelegt mit ja; Erziehungsberechtigte entscheiden (Rahmen-Spec 4.1)                                                                                                                             |
| `volljaehrigGeprueftAm` | Jungfischer | gesetzt, wenn die Verwaltung den Volljährigkeitshinweis mit „Belassen" quittiert hat                                                                                                              |
| `email`                 | alle        | kleingeschrieben, eindeutig je Verein; für Erwachsene die Kennung, beim Anlegen freiwillig, spätestens beim Annehmen der Einladung Pflicht; für Jungfischer freiwillig, Benachrichtigungen ab TP5 |
| `rechte`                | Erwachsene  | Liste aus Postgres-Enum (siehe unten); leer = kein Jugendleiter                                                                                                                                   |
| `entferntAm`            | alle        | gesetzt = Grabstein (5.8)                                                                                                                                                                         |
| `angelegtAm`            | alle        |                                                                                                                                                                                                   |

`email` liegt an der Person und nicht am `Zugang`, weil die erste Leitung, die Ansprechpartner (7.3) und jeder Erwachsene, der beim Anlegen eine Adresse bekommt (5.3), sie brauchen, bevor es einen Zugang gibt; der entsteht erst beim Einlösen der Einladung. Verworfen: eine zweite Kopie am `Zugang` — zwei Adressen liefen auseinander. Preis: Der CHECK „E-Mail oder Anmeldename am Zugang" lässt sich über zwei Tabellen nicht ausdrücken und entfällt; das Einlösen der Einladung prüft die Kennung in `libs/domain`.

Rechte: `MITGLIEDER`, `THREADS_ERSTELLEN`, `ALLE_THREADS`, `DOKUMENTE`, `ANTWORTEN_DETAIL`, `JUGENDLEITER_RECHTE`, `EINSTELLUNGEN` (Rahmen-Spec 4.2). Rechte für Bereiche, die erst später entstehen, lassen sich schon in TP2 vergeben.

Ob ein Feld zur Art passt, prüft `libs/domain`; ein CHECK-Constraint in der Migration sichert es zusätzlich ab (z. B. kein `geburtsdatum` ohne `JUNGFISCHER`, keine Rechte bei `JUNGFISCHER`, `geburtsdatum` Pflicht bei `JUNGFISCHER` und nicht entfernt).

Die Foto-Einwilligung (Rahmen-Spec 6.6) kommt mit dem Medienbereich in TP4.

**`Bezugsperson`**: `vereinId`, `erwachsenerId`, `jungfischerId`, `beziehung` (Enum: `MUTTER`, `VATER`, `GROSSMUTTER`, `GROSSVATER`, `TANTE`, `ONKEL`, `GESCHWISTER`, `PFLEGEPERSON`, `ANDERE`), `beziehungFreitext` (nur bei `ANDERE`, dann Pflicht), `erziehungsberechtigt`. Das Paar aus Erwachsenem und Jungfischer ist eindeutig.

**`Untergruppe`**: `vereinId`, `name` (eindeutig je Verein). **`UntergruppeMitglied`**: `vereinId`, `untergruppeId`, `personId`; nur Jungfischer.

### 3.4 Zugang und Anmeldung

**`Zugang`** (0..1 je Person)

| Feld                           | Bedeutung                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `anmeldename`                  | kleingeschrieben, eindeutig je Verein; nur Jungfischer und ihre Kennung                               |
| `passwortHash`                 | Argon2id, optional                                                                                    |
| `totpGeheimnis`, `totpAktivAm` | optional, nur für Erwachsene mit Rechten                                                              |
| `letzteAnmeldungAm`            | Zeitpunkt der letzten erfolgreichen Anmeldung; speist die Kennzahl „letzte Anmeldung im Verein" (7.3) |
| `angelegtAm`                   |                                                                                                       |

Die Kennung Erwachsener ist `Person.email` (3.3); der `Zugang` trägt nur den Anmeldenamen der Jungfischer.

Ein `Zugang` ohne Passkey und ohne Passwort entsteht nicht: Er wird erst beim Einlösen der Einladung angelegt, zusammen mit dem ersten Anmeldeweg.

Weitere Tabellen:

- **`Passkey`** wie in hwyd (`credentialId` eindeutig, `publicKey`, `counter`, `transports`, `backedUp`, `label`, `lastUsedAt`), zusätzlich `vereinId` und `zugangId`.
- **`RecoveryCode`**: zehn gehashte Einmalcodes, nur für Zugänge mit TOTP.
- **`WebauthnChallenge`** wie in hwyd, mit `vereinId`.
- **`Session`**: `vereinId`, `zugangId`, `tokenHash`, `ablauf`, `zuletztGesehen`, `userAgent`.
- **`Einladung`**: `vereinId`, `personId`, `art` (`EINLADUNG` oder `RESET`), `tokenHash`, `ablauf`, `eingeloestAm`, `erstelltVon` (Person oder Plattform-Admin). Ein neuer Link macht den offenen alten derselben Art für dieselbe Person ungültig; es gibt also nie zwei gültige.
- **`Einwilligung`**: `vereinId`, `jungfischerId`, `erteiltVon`, `art` (vorerst nur `DSGVO_ART8`), `textVersion`, `erteiltAm`, `widerrufenAm`. Einwilligungen werden nie gelöscht, nur widerrufen; so bleibt nachweisbar, wer wann eingewilligt hat. Beim Entfernen einer Person bleiben sie ebenfalls stehen.
- **`MailWarteschlange`**: `vereinId` (optional), `empfaenger`, `betreff`, `text`, `versuche`, `naechsterVersuch`, `gesendetAm`, `fehler`, `bezug` (z. B. Einladung). Gehört schon in TP2: Der Reset-Dialog muss sofort antworten können, ohne über die Antwortzeit zu verraten, ob es die Adresse gibt.
  - Der `text` enthält Einladungs-, Notfall- und Reset-Links mit Token im Klartext. Der Arbeiter leert ihn beim erfolgreichen Versand und löscht gesendete Zeilen nach 30 Tagen. Eine noch nicht gesendete Zeile behält den Link zwangsläufig, sonst gäbe es keinen nächsten Versuch; das ist die einzige Stelle, an der ein Token ungehasht in der Datenbank steht. Einlösbar ist es dort nur, solange der Link gilt; eine endgültig gescheiterte Zeile bleibt für den Hinweis „Einladungsmail nicht zustellbar" (5.3) stehen.

### 3.5 Bewusst nicht in Teilprojekt 2

- `Aenderung` (Zähler für Echtzeit und Offline) → TP3
- Foto-Einwilligung, `Datei` → TP4
- `PushAnmeldung` → TP5
- Login-Backoff bleibt wie in hwyd **im Speicher des Prozesses**, ohne Tabelle. Nach einem Neustart beginnt es von vorn; bei einem einzigen Prozess vertretbar.

---

## 4. Einladung und Anmeldung

### 4.1 Einladungslink erzeugen

- **Wer**: Wer „Mitglieder verwalten" hat. Für ein Kind zusätzlich dessen Erziehungsberechtigte (unter „Meine Jungfischer"). Für Erwachsene mit Rechten nur, wer „Jugendleiter & Rechte verwalten" hat (5.4). Für die erste Leitung eines Vereins und als Notfall-Link der Plattform-Admin (7.3).
- **Form**: `https://test.jufi-app.de/<slug>/einladung#<token>`, Token aus 32 Zufallsbytes (base64url), nur gehasht gespeichert, **14 Tage** gültig.
  - Hinter `#`, weil Server-Logs, Referer und die Linkvorschau von WhatsApp es dann nie sehen.
  - Eingelöst wird erst beim Absenden, nicht beim Öffnen. Ein Vorschau-Crawler verbraucht den Link nicht.
- **Vorbedingungen beim Jungfischer**: `zugangErlaubt` ist gesetzt **und** eine erziehungsberechtigte Bezugsperson hat eine gültige Einwilligung gegeben. Fehlt eines davon, nennt der Knopf den Grund statt eines Links.
- **Verteilung**: fertiger WhatsApp-Text zum Teilen oder Kopieren; optional zusätzlich als Mail, wenn eine Adresse bekannt ist.

### 4.2 Einladung annehmen

Eine Seite mit Schritten:

1. **Begrüßung**: „Hallo Sandra, willkommen bei den Jungfischern Glonntal." Ein abgelaufener oder benutzter Link zeigt „Dieser Link gilt nicht mehr – frag nach einem neuen".
2. **Einwilligung** (nur Erziehungsberechtigte, je eigenem minderjährigem Kind): Häkchen für die Einwilligung nach Art. 8 DSGVO mit dem Text in seiner aktuellen Fassung, dazu „Soll Lena einen eigenen Zugang bekommen?" (vorbelegt: ja). Ohne Einwilligung bleibt das Kind ohne Zugang; die Familie handelt dann in seinem Namen. Die Oberfläche folgt mit Etappe 4; Etappe 3 prüft nur das Vorhandensein einer gültigen Einwilligung beim Einlösen. Hat schon eine andere erziehungsberechtigte Person eingewilligt, steht das dort, und der Schritt ist freiwillig. **Gültig** ist eine Einwilligung, wenn sie nicht widerrufen ist **und** ihr Erteiler noch erziehungsberechtigt ist (und das Kind minderjährig). Wird die Familie gelöst, fällt die Einwilligung des Erteilers damit weg, ohne dass ein Datensatz geändert wird.
3. **Kennung**: Erwachsene bestätigen ihre E-Mail (vorbelegt, änderbar, eindeutig im Verein). Jungfischer wählen ihren Anmeldenamen; vorbelegt ist der Vorname, ist er vergeben, schlägt die App „lena2" vor.
4. **Zugang einrichten**: Kann das Gerät Passkeys, steht der Passkey vorne, sonst ein Passwort; beides zusammen geht auch.
5. **Fertig**: Die Person ist angemeldet. Ein Hinweis erklärt, wie man die App auf den Home-Bildschirm holt, und dass man sich dort noch einmal anmeldet (iOS teilt die Sitzung des WhatsApp-Browsers nicht mit der installierten App; mit Passkey ist das ein Tipp).

Erst das Absenden legt `Zugang`, Passkey oder Passwort, Einwilligungen und Sitzung in **einer Transaktion** an und markiert die Einladung als eingelöst.

**Passwortregel**: mindestens 10 Zeichen, keine Vorschriften zur Zusammensetzung, die bekanntesten Passwörter (Liste im Repo) werden abgelehnt. Gilt für alle, auch Kinder; Kinder werden zum Passkey ermutigt.

**Passkey-Name** (`user.name`/`displayName`): „Sandra Huber · Jungfischer Glonntal". Wer in zwei Vereinen ist, unterscheidet die Passkeys so in der Auswahl des Telefons. `residentKey: 'required'`, `userVerification: 'required'`.

### 4.3 Anmelden

Unter `/<slug>/anmelden`:

- „Mit Passkey anmelden" ohne `allowCredentials`; zusätzlich schlägt das Kennungsfeld vorhandene Passkeys per Autofill vor.
- Kennung (E-Mail bei Erwachsenen, Anmeldename bei Jungfischern) plus Passwort; mit TOTP danach Code oder Wiederherstellungscode.
- Fehlermeldung immer nur „Anmeldung fehlgeschlagen", ohne Hinweis, ob die Kennung existiert.
- Backoff je Kennung und je IP wie in hwyd (drei freie Versuche, dann verdoppelnd bis 15 Minuten). Ein Erfolg erstattet nur die eigene Zählung auf dem IP-Zähler (`m-ip`), setzt ihn nicht zurück: Wer mit einer gültigen Anmeldung dazwischenfunkt, soll die Zählung für andere Kennungen derselben IP nicht löschen können. Läuft der Zähler über, lehnt die Anmeldung ab (fail-closed), statt durchzulassen.
- Ein Passkey eines anderen Vereins ergibt „Dieser Passkey gehört nicht zu diesem Verein". Das verrät nichts, denn nur der Besitzer kann ihn vorlegen. Die Anmeldung schlägt den Passkey nur im eigenen Verein nach; „fremd" und „gelöscht" sind für sie dasselbe und bekommen dieselbe Meldung. Verworfen: globales Nachschlagen ohne Vereinsfilter, nur um beides zu unterscheiden.
- Gesperrter oder unbekannter Verein: „nicht gefunden".

### 4.4 Zugang verloren

- **Erwachsene**: „Passwort vergessen?" antwortet immer „Falls die Adresse bekannt ist, kommt eine Mail". Der Reset-Link gilt **1 Stunde**.
- **Jungfischer**: „Frag deine Familie oder einen Jugendleiter nach einem neuen Link".
- Wird ein Reset-Link oder ein neuer Einladungslink für eine Person **mit bestehendem Zugang** eingelöst, werden altes Passwort, alle Passkeys, TOTP und alle Sitzungen gelöscht; die Kennung bleibt. Grund: Das verlorene Gerät hat womöglich jemand anderes. TOTP richtet man danach im Profil neu ein.

### 4.5 Sitzungen

| Sitzung         | Cookie         | Pfad       | Dauer                                |
| --------------- | -------------- | ---------- | ------------------------------------ |
| Mitglieder      | `jufi_sitzung` | `/<slug>/` | 90 Tage, verlängert sich bei Nutzung |
| Plattform-Admin | `jufi_admin`   | `/admin/`  | 12 Stunden, ohne Verlängerung        |

- Beide `HttpOnly`, `Secure`, `SameSite=Lax`; serverseitig in Postgres, nur der Hash des Tokens gespeichert.
- 90 Tage mit Verlängerung, damit vor allem Kinder sich praktisch nie neu anmelden müssen.
- Schreibende Anfragen prüfen zusätzlich den `Origin`-Header.
- „Abmelden" beendet die Sitzung auf diesem Gerät, „Überall abmelden" im Profil alle Sitzungen des Zugangs.

### 4.6 Zugang entziehen

Erziehungsberechtigte des Kindes oder wer „Mitglieder verwalten" hat: `zugangErlaubt` wird nein; `Zugang`, Passkeys, Sitzungen und offene Einladungen werden gelöscht. Die Person bleibt, ihre Familie handelt weiter für sie. Ein Widerruf der Einwilligung, wenn danach keine gültige Einwilligung eines Erziehungsberechtigten mehr besteht, entzieht den Zugang ebenso.

Die Verwaltung tut das mit `POST /personen/:id/zugang` (`{ erlaubt }`, Recht „Mitglieder verwalten“); Erlauben verlangt bei Minderjährigen eine gültige Einwilligung (409 `EINWILLIGUNG_FEHLT`), und eine Korrektur des Geburtsdatums auf „minderjährig“ ohne Einwilligung entzieht den Zugang ebenso (5.6).

### 4.7 TOTP

Freiwillig für Erwachsene mit mindestens einem Recht, im Profil. Dem Plattform-Admin wird es bei der Einrichtung gleich angeboten und dringend empfohlen. Zehn Wiederherstellungscodes. Bezugspersonen ohne Rechte und Jungfischer bekommen es nicht angeboten.

---

## 5. Mitglieder pflegen und Rechte

### 5.1 Regeln in `libs/domain`

Mindestens:

- `hatRecht(person, recht)`, `istJugendleiter(person)`
- `istVolljaehrig(person, jetzt)`
- `istErziehungsberechtigt(zuordnung, kind, jetzt)` — nein, sobald das Kind volljährig ist
- `darfFuerKindHandeln(erwachsener, kind, zuordnungen)` — jede Bezugsperson
- `sichtbarePersonen(betrachter, …)` und `darfPersonSehen(betrachter, person, …)`
- `darfEinladen(handelnder, ziel, …)`, `darfRechteAendern(handelnder, ziel, neueRechte, …)`
- `pruefeSlug(slug)`, `pruefeAnmeldename(name)`, `pruefePasswort(passwort)`, `anmeldenameVorschlag(vorname, vergebene)`

Jeder Endpunkt fragt diese Funktionen; die Oberfläche blendet dasselbe nur zusätzlich aus.

### 5.2 Wer wen sieht

| Betrachter                           | sieht                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| mit „Mitglieder verwalten"           | alle Personen mit allen Angaben, auch E-Mail, Einladungs- und Einwilligungsstand                     |
| übrige Jugendleiter (z. B. Betreuer) | alle Personen lesend: Name, Familie, Untergruppen, Jugendsprecher; **keine E-Mail-Adressen**         |
| Familie und Jungfischer              | sich selbst, die eigenen Jungfischer und deren Familie; alle Jugendleiter als Ansprechpartner (Name) |

Mitglieder bekommen in TP2 kein Mitgliederverzeichnis; wer sonst in der Gruppe ist, zeigt sich in Threads (TP3). Entfernte Personen sieht niemand.

### 5.3 Personen anlegen und Familie verknüpfen

Recht „Mitglieder verwalten":

- **Jungfischer**: Vorname, Nachname, Geburtsdatum, Untergruppen.
- **Erwachsener**: Vorname, Nachname, E-Mail (beim Anlegen freiwillig, spätestens beim Annehmen der Einladung Pflicht).
- **Familie hinzufügen** auf der Seite des Jungfischers: vorhandenen Erwachsenen wählen (z. B. bei Geschwistern) oder neuen anlegen; Beziehung und erziehungsberechtigt (vorbelegt bei Mutter, Vater, Pflegeperson). Zuordnungen lassen sich ändern und lösen.
- **Doppelte Personen**: gleicher Vor- und Nachname und gleiches Geburtsdatum ergibt eine Warnung, die man übergehen kann. Eine doppelte E-Mail im Verein wird abgelehnt.
- **Warnhinweise** in Liste und Personenseite: „Ohne erziehungsberechtigte Familie", „Einwilligung fehlt", „Einladung offen, läuft am … ab", „Einladungsmail nicht zustellbar", „Volljährig seit …".

### 5.4 Jugendleiter und Rechte

Recht „Jugendleiter & Rechte verwalten":

- Rechte vergeben über die Vorlagen Leitung (alle), Jugendleiter (alle außer „Jugendleiter & Rechte verwalten" und „Vereinseinstellungen"), Betreuer („Antworten im Detail sehen"); danach jedes Häkchen einzeln.
- Erwachsene **mit Rechten** bearbeiten, einladen oder entfernen kann nur, wer dieses Recht hat. Sonst könnte jemand mit „Mitglieder verwalten" einen Jugendleiter löschen.
- Der **letzte Inhaber** dieses Rechts kann es nicht abgeben und nicht entfernt werden. Der Server schützt das mit `sperreVereinszeile`, damit zwei Leitungen, die sich gleichzeitig gegenseitig das Recht entziehen, nicht beide ohne dastehen. Verworfen: `Serializable` (bricht mit Serialisierungsfehlern ab, die der Aufrufer wiederholen müsste) und `SELECT FOR UPDATE` auf den Inhabern (sperrt nur vorhandene Zeilen, nicht die Entscheidung „bin ich der letzte").
- **Fehlendes Recht ergibt 404, nicht 403** (Rahmen-Spec 8): Wer eine Person oder Aktion nicht sehen darf, erfährt nicht, dass es sie gibt.
- **Keine Selbstentfernung**: Wer sich selbst entfernen will, bekommt 409 `SELBST`. Das Entfernen übernimmt eine andere Leitung.

### 5.5 Jugendsprecher und Untergruppen

- **Jugendsprecher**: Häkchen am Jungfischer (Recht „Mitglieder verwalten"). Wirkung in TP2 nur unter „Meine Jungfischer": „Lena ist Jugendsprecherin und nimmt am Austausch mit den Jugendleitern teil." Den Thread „Jugendsprecher-Austausch" legt TP3 an, für bestehende Vereine per Migration.
- **Untergruppen**: anlegen, umbenennen, löschen; Jungfischer zuordnen aus der Untergruppe oder der Personenseite. Löschen einer Untergruppe löscht keine Personen.

### 5.6 Volljährigkeit

Klärt Rahmen-Spezifikation 15 („Jungfischer, die volljährig werden").

- Ab dem 18. Geburtstag wirkt „erziehungsberechtigt" nicht mehr: `istErziehungsberechtigt` liefert nein. Die Familie bleibt verknüpft und darf weiter sehen und für den Jungfischer antworten, aber nicht mehr einwilligen und den Zugang nicht mehr steuern.
- Die Volljährigkeit ergibt sich immer aus dem Geburtsdatum; `volljaehrigGeprueftAm` quittiert nur den Hinweis und ändert keine Rechte.
- Die Verwaltung zeigt „Lena ist seit dem … volljährig" mit drei Wegen: **Belassen** (setzt `volljaehrigGeprueftAm`, der Hinweis verschwindet), **Familie lösen**, **Aus der Gruppe entfernen**.
- Die Einwilligung der Familie wird für **alle Minderjährigen** verlangt. Art. 8 DSGVO ließe ab 16 die eigene Einwilligung genügen; verworfen, weil zwei Altersgrenzen schwerer zu erklären sind und der Verein die Familie ohnehin braucht.
- Vorgemerkt für später: eine Übergangszeit und „als Erwachsenen weiterführen" (etwa wenn ein Jugendsprecher Jugendleiter wird). Bis dahin legt man ihn als Erwachsenen neu an.

### 5.7 Was Erziehungsberechtigte selbst tun

Unter „Meine Jungfischer": Zugang erlauben oder entziehen, neuen Link erzeugen, Einwilligung geben oder widerrufen. Namen und Zuordnungen ändern sie nicht; das bleibt beim Verein (Rahmen-Spec 3.3). **Der Widerruf der Einwilligung entzieht dem Kind den Zugang**, und ein minderjähriges Kind ohne gültige Einwilligung verliert ihn auch, wenn die Familie gelöst wird.

### 5.8 Entfernen

- Die Zeile bleibt als **Grabstein**: Namen, Geburtsdatum und E-Mail geleert (die Adresse wird frei und kann im Verein neu vergeben werden), Rechte geleert, `entferntAm` gesetzt. Zugang, Passkeys, Sitzungen, Einladungen, Familienzuordnungen und Untergruppen-Mitgliedschaften werden gelöscht. Einwilligungen bleiben als Nachweis.
- Spätere Antworten und Kommentare verweisen weiter auf die Zeile und erscheinen als „ehemaliges Mitglied" (Rahmen-Spec 8.4).
- Hat ein Erwachsener nach dem Entfernen eines Jungfischers keine Jungfischer und keine Rechte mehr, fragt die App: „Opa Hans hat keine Jungfischer mehr in der Gruppe – auch entfernen?"

---

## 6. Oberflächen

### 6.1 Gestaltung

Aus dem Entwurf kopiert (2.1): Grundcharakter „Am Wasser", Vereinsfarbe als einziger Eingabewert, Dunkelmodus Pflicht, Tokens als CSS-Variablen. Geprüft wird gemessen (`getBoundingClientRect`, `scrollWidth`) bei 375 × 812 und 1280 × 800, jeweils hell und dunkel.

### 6.2 Mitglieder-Hülle (Handy)

- **Untere Leiste in TP2 nur mit Start und Mehr.** Threads, Termine und Medien kommen mit ihren Teilprojekten dazu. Verworfen: die volle Leiste mit Platzhaltern — sie führt in Sackgassen, und echte Nutzer sind in TP2 nur die drei Jugendleiter.
- **Start**: Begrüßung mit Vereinslogo; für Bezugspersonen eine Karte je eigenem Jungfischer; Ansprechpartner (alle Jugendleiter mit Namen); für Inhaber von „Mitglieder verwalten" „In der Verwaltung warten" mit offenen Einladungen und Warnhinweisen und einem Link dorthin. Betreuer und übrige Jugendleiter sehen den Block nicht: Ihre Sicht zeigt nur einen Teil der Hinweise (Familie und Volljährigkeit, nicht Einwilligungs- und Einladungsstand, 5.2), und sie können nichts davon erledigen (`einsichtIn` liefert für sie nur `LESEN`). Verworfen: der Block für alle Jugendleiter — er zeigte Betreuern Aufgaben, die sie nicht anfassen können.
- **Mehr**: Profil, Meine Jungfischer (nur Bezugspersonen), Verwaltung (nur Jugendleiter), Darstellung (Hell/Dunkel/System), Impressum, Datenschutz, Abmelden.
- **Profil**: Name und Kennung nur lesend; Passkeys hinzufügen, umbenennen, löschen (der letzte Anmeldeweg lässt sich nicht löschen); Passwort setzen oder ändern; TOTP (nur Jugendleiter); „Überall abmelden"; **„Meine Daten herunterladen"** als JSON (Rahmen-Spec 8.4) mit Personendaten (bei Jungfischern auch, ob der Zugang erlaubt ist und wann die Verwaltung die Volljährigkeit geprüft hat), Zugang (Anmeldename, ob Passwort und TOTP gesetzt sind, Zeitpunkte), Wiederherstellungscodes (nur ob eingerichtet und wie viele unbenutzt), offenen Einladungen und Reset-Links (nur Art, Erzeugung und Ablauf; dasselbe je Kind, dazu bei Kindern Zugangsstand und Volljährigkeitsprüfung), Passkey-Namen, Sitzungen, Familie, Untergruppen und Einwilligungen. Nicht darin stehen technische Schlüssel, Passkey-Zähler, der rohe User-Agent und Abschriften verschickter Mails. Spätere Teilprojekte ergänzen ihre Daten. Es ist ein schlichter Link (`<a href="…/ich/daten" download>`) auf einen GET-Endpunkt mit `Content-Disposition: attachment`; das Sitzungscookie geht mit, weil Pfad und Ursprung passen. Verworfen: Laden per `HttpClient` und Blob — mehr Code ohne Gewinn. Der Auszug enthält weder Passwort-Hash noch TOTP-Geheimnis, Token-Hashes (auch nicht die der Einladungen), Wiederherstellungscodes oder deren Hashes, öffentliche Schlüssel oder Credential-IDs. Über andere Personen nennt er nur Vor- und Nachname, Beziehung (mit Freitext bei „Andere"), ob sie erziehungsberechtigt sind, und ob sie Kind oder Bezugsperson sind; die Einwilligungen nennen Kind und Erteiler beim Namen. Ohne Sitzung kommt 401. Verworfen: die ganzen Zeilen nehmen und Geheimnisse herausstreichen — ein später ergänztes Geheimnisfeld landete dann still im Auszug; der Auszug wird Feld für Feld aufgebaut.
- **Meine Jungfischer**: je Kind Untergruppen, Jugendsprecher-Hinweis, Familie mit Beziehung, Zugangsstand; für Erziehungsberechtigte die Aktionen aus 5.7.

### 6.3 Verwaltungs-Hülle (Desktop)

- **Seitenleiste in TP2**: Mitglieder, Untergruppen, Jugendleiter & Rechte, Vereinseinstellungen. Jeder Punkt erscheint nur mit dem passenden Recht; Betreuer sehen „Mitglieder" lesend. Threads und Dokumente folgen mit TP3 und TP4.
- **Mitglieder**: Liste mit Suche und Filtern (Jungfischer/Erwachsene, Untergruppe, mit Warnhinweis). Personenseite mit Stammdaten, Familie, Untergruppen und Zugang (Einladung mit WhatsApp-Text, Kopieren, optionaler Mail; Status und Ablauf).
- **Jugendleiter & Rechte**: Rechtetabelle mit Vorlagen (5.4).
- **Vereinseinstellungen** (Recht „Vereinseinstellungen"): Anzeigename, offizieller Name, Kontakt, Farbe mit Live-Vorschau beider Modi und Kontrasthinweis, Logo. Der Slug ist hier nicht änderbar (7.3).
- **Hinweis aus dem Admin-Protokoll**: „Der Plattform-Admin hat am … einen neuen Link für Thomas erzeugt" (7.3), sichtbar für Inhaber von „Jugendleiter & Rechte verwalten". Er steht **30 Tage** und zeigt alle `NOTFALL_LINK`-Einträge des Vereins aus dieser Zeit, die neuesten zuerst. Es gibt keine Quittung und kein neues Feld. Verworfen: ein Hinweis, der bis zu einer Quittung stehen bleibt — er bräuchte dafür ein Feld und eine Oberfläche.
  - **Lesen als benannte Ausnahme**: `AdminProtokoll` ist eine Plattformtabelle, die `vereinDb` nicht erreicht; gelesen wird mit dem schlichten `PrismaClient`. Die Abfrage ist eng gefasst: nur `vereinId` aus dem Slug, nur diese Aktion, nur `zeitpunkt` und `betroffenePersonId`.
- Wechsel zwischen den Hüllen: „Zur App" in der Verwaltung, „Verwaltung" unter Mehr.

### 6.4 PWA in Teilprojekt 2

- Manifest je Verein: `name` = Anzeigename, `start_url` = `/<slug>/`, `scope` = `/<slug>` (ohne Schrägstrich am Ende: Nach der Manifest-Spec liegt eine Adresse im Scope, wenn ihr Pfad mit dem des Scopes beginnt, und die App navigiert zu `/<slug>`, weil Angular den Schrägstrich am Ende wegnormalisiert. Damit liegt formal auch `/<slug>-xyz/` im Scope, was harmlos ist. Verworfen: alle Links auf `/<slug>/` umbauen — das liefe gegen den Router), `theme_color` aus der Vereinsfarbe, `background_color` die feste helle Seitenfläche.
- **Der Manifest-Link steht zur Laufzeit im `<head>`**, zusammen mit `apple-touch-icon` und `theme-color`; `VereinKontext` setzt ihn und nimmt ihn beim Wechsel zu einem anderen Verein, zur Plattform oder zu einem unbekannten Verein wieder heraus. Verworfen: der Server schreibt den Link in `index.html`. Die App rendert nur im Client (`app.routes.server.ts`), und `AngularNodeAppEngine` liefert für jeden Pfad dieselbe Datei aus. Chrome wertet einen nachträglich gesetzten Manifest-Link aus, und iOS liest ihn erst beim „Zum Home-Bildschirm".
- **Manifest, Icons und Logo sind ohne Anmeldung abrufbar.** Browser laden das Manifest ohne Cookies, und die Anmeldeseite soll das Logo zeigen. Anzeigename und Farbe gibt `GET /verein` schon ohne Anmeldung preis. Ein gesperrter oder unbekannter Verein bleibt 404. Verworfen: Manifest, Icons und Logo nur mit Sitzung — das Manifest käme dann nie an, und die Anmeldeseite zeigte kein Logo. Die Antworten tragen `Cache-Control: no-cache` und einen ETag, die Logo-Adresse hängt `?v=` an, damit nach einer Änderung kein altes Icon aus dem Cache kommt.
- Icons 192 und 512 px, beim Hochladen des Logos mit `sharp` erzeugt (3.2). Ohne Logo zeigt das Icon die Initialen (`initialen(anzeigename)`) auf `vereinsfarben(farbe).hell.akzent` in `aufAkzent`. Die Schrift ist DejaVu Sans Bold; das Image bringt sie über `apk add font-dejavu` mit. Verworfen: eine Schriftdatei im Repo. Preis der gewählten Lösung: Lokal liefert macOS eine Schrift, im Image könnte sie trotzdem fehlen, und der Fehler bliebe unsichtbar; deshalb prüft Etappe 6 das Icon auf dem Server.
- Service Worker und Offline-Betrieb erst in TP5. Zum Home-Bildschirm hinzufügen klappt auf iOS und Android auch ohne; TP2 hat damit schon Icon und Namen.

### 6.5 Fehler

- Unbekannter Verein, fremde oder unsichtbare Person: „Nicht gefunden oder keine Berechtigung".
- Kein Netz: Meldung „Keine Verbindung – nochmal versuchen". Echtes Offline-Verhalten in TP5.

### 6.6 Rechtstexte

- Impressum und Datenschutz liegen als Markdown unter `apps/jufi/src/rechtstexte/`. Sie werden mit dem Text-Loader des Builds eingebunden und im Browser mit `marked` gerendert (verworfen: HTML-Dateien, weil der Eigentümer Markdown pflegt; verworfen: die Texte als TypeScript-Zeichenketten, aus demselben Grund); Text und Parser laden erst mit ihrer Route nach, damit Mitglieder, die nie ein Impressum aufrufen, beides nicht im Startbündel tragen. Die Gliederung steht, den Inhalt liefert der Eigentümer (8.6). Bis dahin enthalten die Dateien nur Platzhalter in eckigen Klammern, und beide Seiten sind ohne Anmeldung erreichbar.
- **„← Zurück" erscheint nur nach einer vorherigen Navigation in der App.** Bei einem Direktaufruf (Mail, Messenger, Suche) steht dort „← JuFi App" mit dem Link zur Plattformseite. Gefragt wird, ob die App selbst schon eine Seite gezeigt hat (`previousNavigation` der laufenden Navigation). Verworfen: `history.length > 1`. Ein Direktaufruf hat dort schon zwei Einträge, und `back()` führte aus der App heraus.
- **Bei einem Ladefehler** zeigt die Seite eine Meldung mit „Neu laden". Nach einem Deployment kann ein veralteter Chunk fehlen; der Link lädt die ganze Seite und holt damit die Dateien des neuen Stands.

---

## 7. Plattform-Admin

### 7.1 Kommandozeile

Das CLI aus `apps/cli` ist im Image enthalten und läuft auf dem Server als `docker compose run --rm jufi node cli.mjs …`.

| Befehl                               | Wirkung                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `admin anlegen <benutzername>`       | legt einen Admin an und gibt einen einmaligen Einrichtungslink aus (1 Stunde gültig)                          |
| `admin zuruecksetzen <benutzername>` | löscht Passwort, Passkeys, TOTP und Sitzungen und gibt einen neuen Einrichtungslink aus                       |
| `verein loeschen <slug>`             | löscht einen Verein mit allen Daten; verlangt, den Slug zur Bestätigung erneut einzutippen                    |
| `demo einspielen`                    | legt den Verein „Jungfischer Demo" (Slug `demo`) mit erfundenen Personen an; für Entwicklung und Browsertests |

Löschen liegt bewusst **nur** in der Kommandozeile: endgültig und selten (etwa wenn ein Verein kündigt).

### 7.2 Anmeldung

`/admin/anmelden`: Benutzername, Passwort und TOTP oder Passkey (nur aus `AdminPasskey`; ein Vereins-Passkey wird nicht erkannt). Backoff wie bei den Vereinen. Sitzung 4.5. Bei der Einrichtung wird TOTP gleich angeboten.

### 7.3 Oberfläche

- **Vereinsliste**: Anzeigename, Slug, Status; Kennzahlen: Jungfischer, Erwachsene, eingerichtete Zugänge, offene Einladungen, letzte Anmeldung im Verein (nur Datum). Speicherverbrauch ab TP4.
- **Verein anlegen**: offizieller Name, Anzeigename, Slug (aus dem Anzeigenamen vorgeschlagen), Farbe, dazu die **erste Leitung** mit Vorname, Nachname und E-Mail; sie bekommt alle Rechte. Das Logo kommt mit den Vereinseinstellungen (Etappe 5): Es braucht Upload jenseits der 100-KB-Grenze und `sharp` für Icons und Manifest, der Verein lädt es dort selbst hoch. Danach zeigt die Seite den Einladungslink mit fertigem Text; per Mail geht er ab Etappe 3 raus, wenn der Mail-Arbeiter entsteht.
- **Vereinsseite**: Kennzahlen; **Ansprechpartner** = alle Inhaber von „Jugendleiter & Rechte verwalten" mit Name und E-Mail; sperren und entsperren (gesperrt: alle Seiten des Vereins „nicht gefunden"; Sitzungen bleiben, wirken aber erst nach dem Entsperren wieder). Bei gesperrtem Verein sind Erneuern und Notfall-Link nicht möglich (409): Der Link führte bis zum Entsperren ins Leere, und eine Mail dorthin wäre schlimmer als ein Klick mehr.
- **Notfall-Link**: neuer Einladungslink für einen **Ansprechpartner**, für niemanden sonst. Der Ausweg, wenn sich die Leitung ausgesperrt hat und der Reset per Mail nicht hilft. Der Verein sieht das in seiner Verwaltung (6.3); verdeckt kann der Admin kein Konto übernehmen.
- **Slug korrigieren**: möglich, solange die erste Einladung noch nicht angenommen ist. Danach ist der Slug fest, weil er in Links, Cookies und installierten Apps steckt. Verworfen: Umbenennen mit Weiterleitung vom alten Slug — eigene Tabelle und Regeln für alte Slugs, die ein anderer Verein will, für einen Fall, der kaum vorkommt.

### 7.4 Was der Admin nicht sieht

Keine Namen von Kindern und Familien, keine Personenlisten, keine Inhalte (Rahmen-Spec 8.3). Die Admin-Endpunkte geben nur Zahlen und Ansprechpartner zurück.

### 7.5 Protokoll

`AdminProtokoll` hält fest: anlegen, sperren, entsperren, Slug korrigieren, Notfall-Link, Einladung der ersten Leitung erneuern. Als Auftragsverarbeiter muss die Plattform belegen können, wer wann was an einem Verein getan hat.

---

## 8. Betrieb, Sicherheit, Datenschutz

### 8.1 Dienste auf dem Server

In der gemeinsamen Compose-Datei (`/home/paperless/paperless-ngx/docker-compose.yml`), versioniert unter `deploy/jufi-services.yml`. Aufgerufen wird immer nur mit den eigenen Dienstnamen, nie mit blankem `up -d`.

| Dienst         | Was                                                                                                           | Grenze            |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ----------------- |
| `jufi-db`      | `postgres:17-alpine`, kein veröffentlichter Port, `shared_buffers=64MB`, `max_connections=30`, eigenes Volume | `mem_limit: 256m` |
| `jufi-migrate` | `prisma migrate deploy`; `jufi` startet erst nach erfolgreichem Ende                                          | –                 |
| `jufi`         | Node mit Angular und Express, `--max-old-space-size=256`; Healthcheck `/healthz` prüft Node und Datenbank     | `mem_limit: 384m` |

Der Server hat 3,7 GB ohne Swap, davon am 12.10.2026 rund 2,2 GB verfügbar. Mit dem Entwurf liegen die Grenzen von JuFi bei etwa 670 MB.

**Umgebungsvariablen** mit Präfix `JUFI_` in der `.env` neben der Compose-Datei: Datenbank-URL, Basis-URL, `WEBAUTHN_RP_ID=test.jufi-app.de`, `WEBAUTHN_ORIGIN`, SMTP-Zugang, Absender `app@jufi-app.de`, Antwortadresse `kontakt@jufi-app.de`, Betreff-Präfix `[Test] `. Das SMTP-Passwort steht **nur** in dieser Datei. Ein Start ohne vollständige Werte bricht mit Meldung ab (`env-check`).

### 8.2 Auslieferung

- `tools/deploy.sh` nach hwyd-Muster, streng sequenziell mit Toren: sauberer Stand → Prettier, Tests, Typprüfung → Image für arm64 bauen → Rauchtest mit Wegwerf-Postgres → **Dump vor der Migration** → Übertragung per SSH → `jufi-migrate`, dann `jufi` → Nachprüfung, dass `/healthz` die neue Version meldet.
- `tools/rollback.sh` schaltet auf das vorige Image zurück. Migrationen laufen nur vorwärts und werden so geschrieben, dass die vorige Version damit noch läuft; Migrationen mit Datenerhalt von Hand.
- Versionsnummer in `package.json`.
- Aufruf als `pnpm run deploy`-Skript mit eigenem Namen (z. B. `deploy:jufi`), nie `pnpm deploy`.

### 8.3 Sicherung

- Täglich um 03:40 (nach hwyd um 03:20): `pg_dump -Fc`, Dump mit `pg_restore --list` prüfen, per restic verschlüsselt auf das zweite Hetzner-Konto per SFTP, in ein **eigenes Repository mit eigenem Passwort**.
- Aufbewahrung: 7 tägliche, 4 wöchentliche, 6 monatliche Stände.
- Das Upload-Volume kommt in TP4 dazu; das Logo liegt in der Datenbank und ist damit gesichert.
- `tools/restore-test.sh` spielt den letzten Stand in eine Wegwerf-Postgres und vergleicht Zeilenzahlen je Tabelle mit dem Dump. Teil der Abnahme von Etappe 6, danach vierteljährlich.
- Protokoll unter `/var/log/jufi-backup.log`; das Skript prüft vorher SSH-Schlüssel und `known_hosts` für root und schreibt, was fehlt.

### 8.4 Mail

- SMTP über Hetzner, `nodemailer`. Absender `app@jufi-app.de`, Antwort an `kontakt@jufi-app.de`, im Test mit Betreff-Präfix `[Test] `.
- Versand über `MailWarteschlange`: Ein Arbeiter im Prozess versucht es alle 30 Sekunden, Wiederholungen mit wachsendem Abstand bis zu 24 Stunden. Gescheiterte Einladungsmails zeigt die Verwaltung an der Person.
- Mails in TP2: Einladung (optional) und Reset. Den Einrichtungslink des Admins gibt nur die Kommandozeile aus.
- Lokal fängt Mailpit alle Mails ab.
- SPF, DKIM und DMARC für `jufi-app.de` richtet der Eigentümer bei Hetzner ein; Etappe 6 prüft sie.

### 8.5 Härtung

- Sicherheits-Header und CSP gleichwertig zum Entwurf: `script-src 'self'`, kein Inline-Code, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`.
- Größengrenzen: Anfragen höchstens 100 KB, Logo-Upload höchstens 1 MB und 25 Megapixel (3.2).
- `Origin`-Prüfung für schreibende Anfragen; Postgres ohne Port.
- Logs enthalten IDs, Status und Dauer, aber weder Tokens noch E-Mail-Adressen noch Namen.

### 8.6 Texte vom Eigentümer

Vor der Einladung der echten Jugendleiter:

- Impressum und Datenschutzerklärung der Plattform (Markdown; die Gliederung steht in `apps/jufi/src/rechtstexte/`, der Inhalt kommt vom Eigentümer, 6.6). **Offen:** Beide Dateien enthalten bisher nur Platzhalter in eckigen Klammern und sind ohne Anmeldung erreichbar; vor einem öffentlichen Betrieb muss der Eigentümer sie füllen.
- Einwilligungstext Fassung 1 für Art. 8 DSGVO; die Fassung wird mit jeder Einwilligung gespeichert. **Offen:** Der Text in Fassung 1 ist ein Platzhalter; den Wortlaut liefert der Eigentümer, bevor echte Familien einwilligen.

---

## 9. Tests

- **`libs/domain` testgetrieben** mit Vitest: Rechte, Sichtbarkeit von Personen, Volljährigkeit (Geburtstag genau am Stichtag, 29. Februar), letzte Leitung, Slug, Anmeldename und Vorschlag, Passwortregel.
- **API-Tests gegen eine Wegwerf-Postgres** (Port 5433) in jeder Etappe.
- **Mandanten-Test**: Er liest die Routen aus dem Express-Router, ruft jede mit IDs eines fremden Vereins auf und erwartet 404. **Eine neue Route ohne Eintrag im Test lässt den Test scheitern.**
- **Admin-Test**: In keiner Admin-Antwort kommt ein Name eines Jungfischers oder einer Bezugsperson aus dem Demo-Verein vor.
- **Ende-zu-Ende mit Playwright** (seit Etappe 5), Passkeys über den virtuellen Authenticator von Chromium: Verein anlegen → erste Leitung nimmt an → legt Familie mit Kind an → Mutter willigt ein → Kind richtet Passkey ein und meldet sich an.
- **Layout gemessen** bei 375 × 812 und 1280 × 800, hell und dunkel, als automatischer Test im selben Lauf.
- **Aufruf**: `pnpm run e2e`, **nicht** in `pnpm test`. Der Lauf braucht einen Produktionsbau von App und CLI, die Entwicklungsdienste (`pnpm run db:up`) und dauert deutlich länger als die übrigen Tests (die Tests selbst gut eine Minute, dazu der Bau). Einmalig vorher `pnpm exec playwright install chromium`. Verworfen: den Lauf in `pnpm test` aufnehmen — jeder Testlauf bräuchte dann den Bau, und die schnellen Tests würden langsam.
- **Aufbau**: `apps/jufi-e2e` ist ein eigenes Workspace-Paket mit `type: module` (sonst lädt Playwright als CommonJS und kann `libs/db/src/testing.ts` mit `import.meta` nicht laden) und hängt von `@jufi/db` ab, damit der Aufbau `bereiteTestDatenbankVor` über den Paketnamen findet. Verworfen: `paths` in `tsconfig.json` wie bei `apps/jufi` — `nx sync` verlangt den Projektverweis ohnehin, und die Abhängigkeit steht so dort, wo pnpm und Nx sie lesen.
- **Server und Umgebung**: Der Aufbau startet den Produktionsbau auf Port 4210 (nicht 4200 wie `pnpm run dev`) mit der Datenbank `jufi_test_e2e` und eigenen, je Lauf neu erzeugten Geheimnissen. Die Umgebung der Kindprozesse hat Vorrang vor der `.env`: `process.loadEnvFile` überschreibt gesetzte Variablen nicht, also stehen alle Werte ausdrücklich im Aufbau; fehlte einer, käme er still aus der `.env`, und der Lauf schriebe etwa in die Entwicklungsdatenbank.
- **Zwei Playwright-Projekte**: `ablauf` (der Ablauf oben, ein Worker, nur Chromium) und `layout` (die Messungen), das von `ablauf` abhängt, weil es dessen Sitzungen und IDs liest. Verworfen: zusätzlich Firefox und WebKit — der virtuelle Authenticator ist eine CDP-Funktion nur in Chromium, und der Ablauf prüft Fachliches, keine Browserunterschiede.
- **Nicht im Image**: `apps/jufi-e2e` fehlt im Docker-Bau-Kontext (`Dockerfile.dockerignore`); das Image braucht keinen Playwright.
- Ausschließlich erfundene Daten.

---

## 10. Abweichungen von der Rahmen-Spezifikation

In der Rahmen-Spezifikation nachgezogen:

| Stelle | Rahmen-Spezifikation bisher             | Jetzt                                                                           | Grund                                                                    |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 5.4    | `/<slug>/einladung/<token>`             | `/<slug>/einladung#<token>`                                                     | Token nie in Server-Logs, Referer und Linkvorschau                       |
| 7.2    | `libs/domain`, `libs/db`                | zusätzlich `libs/auth`                                                          | aus hwyd kopiert (1.3)                                                   |
| 7.3    | `Verein` mit `Gruppenname`              | `name` (offiziell) und `anzeigename` (höchstens 24 Zeichen), ohne `gruppenname` | offizieller Name zu lang für Kopfzeile, Passkey-Auswahl, Home-Bildschirm |
| 10.1   | Test auf `jufi-app.sideshow-systems.de` | `test.jufi-app.de` (bereits am 12.10.2026 umgestellt)                           | gleich unter der eigenen Domain                                          |
| 15     | Volljährigkeit offen                    | entschieden in 5.6                                                              |                                                                          |
