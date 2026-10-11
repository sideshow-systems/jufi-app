# JuFi App — Rahmen-Spezifikation

Stand: 11.10.2026 · Ergebnis des Brainstormings vom selben Tag · Status: freigegeben, ergänzt um die Entscheidungen aus dem Brainstorming zu Teilprojekt 1

Diese Spezifikation legt den **Rahmen** fest: Zweck, Rollen, Domänenmodell, Architektur, Querschnittsthemen und die Aufteilung in Teilprojekte. Jedes Teilprojekt bekommt eine eigene, detaillierte Spezifikation, die auf dieser aufbaut und ihr nicht widerspricht. Wo eine Teilprojekt-Spezifikation etwas ändern muss, wird diese Datei mitgeändert.

---

## 1. Zweck und Ausgangslage

Die Jugendgruppe des Glonntal Fischereivereins koordiniert Termine, Veranstaltungen, Abstimmungen und Dokumente über WhatsApp. Bei vielen gleichzeitigen Themen geht der Überblick verloren: Antworten, Rückfragen und Dateien verschiedener Anlässe stehen durcheinander, der aktuelle Stand muss aus dem Verlauf rekonstruiert werden.

Die JuFi App (Jungfischer App) ersetzt WhatsApp als Koordinationskanal. Jeder Anlass bekommt einen **Thread**, dessen aktueller Stand auf einen Blick lesbar ist. WhatsApp bleibt höchstens für Hinweise der Art „Neues in der App, hier der Link".

Die Plattform ist von Anfang an **mandantenfähig**: Sie startet mit der eigenen Jugendgruppe, soll aber später anderen Vereinen offenstehen.

### 1.1 Erfolgskriterien

- Die eigene Jugendgruppe nutzt im Pilotbetrieb die App statt der WhatsApp-Gruppe für Termine, Abstimmungen, Helferplanung, Fahrgemeinschaften und Dokumente.
- Eltern und Jungfischer finden am Handy innerhalb weniger Sekunden: was sie beantworten müssen, was als Nächstes ansteht, was neu ist.
- Jugendleiter erledigen die Verwaltung am Desktop ohne Umwege.
- Ein zweiter Verein lässt sich vom Plattform-Admin anlegen, ohne Code, Deploy oder Datenbankeingriff.

### 1.2 Annahmen

- Die erste echte Nutzung ist die eigene Gruppe (~20 Jugendliche, deren Eltern, 3 Jugendleiter). Weitere Vereine kommen erst nach dem Live-Gang (Teilprojekt 6), das Datenmodell trägt sie aber ab dem ersten Tag.
- Elterliche Einwilligungen nach Art. 8 DSGVO sind in der eigenen Gruppe kein Hindernis.

---

## 2. Begriffe

| Begriff | Bedeutung |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Plattform-Admin | Betreiber der Plattform. Steht außerhalb aller Vereine. |
| Verein | Mandant. Hat genau eine Jugendgruppe; deren Einstellungen sind Einstellungen des Vereins. |
| Slug | URL-Kennung eines Vereins, z. B. `glonntal` in `jufi-app.de/glonntal/`. |
| Person | Mitglied eines Vereins: Jungfischer oder Erwachsener. |
| Zugang | Anmeldedaten einer Person (E-Mail, Passkeys, Passwort, TOTP). Optional. |
| Jugendleiter | Erwachsener mit mindestens einem Recht aus 4.2. |
| Elternteil | Erwachsener, dem mindestens ein Jungfischer zugeordnet ist. |
| Untergruppe | Frei benannte Teilmenge der Jungfischer, z. B. „Ältere", „Zeltlager-Teilnehmer". |
| Thread | Ein Anlass oder Thema: Aushang aus Modulen plus Verlauf. |
| Modul | Baustein im Aushang eines Threads (Umfrage, Termin, Helferliste …). |
| Verlauf | Chronologischer Teil eines Threads: Nachrichten, Kommentare, Systemereignisse. |
| Antwort-Einheit | Legt bei einem Antwort-Modul fest, für wen eine Antwort gilt (6.3). |

---

## 3. Mandanten und Konten

### 3.1 Ebenen

- **Plattform-Admin** unter `/admin`. Legt Vereine an (Name, Slug, Logo), sperrt sie und lädt den jeweils ersten Jugendleiter ein. Dieses erste Konto bekommt alle Rechte.
- **Verein**: alles Weitere gehört zu genau einem Verein. Pro Verein gibt es genau eine Jugendgruppe; eine Aufteilung erfolgt über Untergruppen (3.4). Mehrere Jugendgruppen pro Verein wurden verworfen, weil sie Navigation und Rechte für alle Vereine verkomplizieren, obwohl fast jeder Verein nur eine Gruppe hat.

### 3.2 Getrennte Konten pro Verein

Eine Person, die in zwei Vereinen ist, hat **zwei unabhängige Konten**. Ein vereinsübergreifendes Konto wurde verworfen: Verein A dürfte nie erfahren, dass jemand auch in Verein B ist, und bei einem gemeinsamen Konto hinge das an jeder einzelnen Abfrage. Getrennte Konten machen das Leck unmöglich statt unwahrscheinlich.

Folgen:

- E-Mail-Adressen sind **innerhalb eines Vereins** eindeutig, nicht global.
- Das Session-Cookie gilt nur für den Pfad `/<slug>/` (siehe 8.2). Man kann im selben Browser in zwei Vereinen gleichzeitig angemeldet sein.
- Jeder Verein hat ein eigenes PWA-Manifest; auf dem Home-Bildschirm erscheint jeder Verein als eigenes Icon mit eigenem Namen und Logo.
- Passkeys hängen an der Domain. Wer zwei Konten hat, bekommt beim Anmelden beide zur Auswahl.

### 3.3 Personen

- **Jungfischer**: Kind oder Jugendlicher. Hat standardmäßig einen eigenen Zugang. Wünschen die Eltern das nicht, bleibt der Jungfischer eine Person ohne Zugang; die Eltern erledigen dann alles in seinem Namen.
- **Erwachsener**: Rollen sind kombinierbar. Elternteil, wenn ihm Jungfischer zugeordnet sind; Jugendleiter, wenn er Rechte hat. Ein Jugendleiter mit eigenem Kind in der Gruppe ist beides.
- **Elternschaft**: n:m zwischen Erwachsenen und Jungfischern (beide Elternteile, Geschwister).
- Eltern handeln immer auch im Namen ihrer Kinder, unabhängig davon, ob das Kind einen eigenen Zugang hat.

### 3.4 Untergruppen

Untergruppen enthalten Jungfischer. Eltern gehören keiner Untergruppe an; sie sehen, was ihre Kinder sehen (6.2). Untergruppen pflegt, wer das Recht „Mitglieder verwalten" hat.

---

## 4. Anmeldung und Rechte

### 4.1 Einladung und Anmeldung

- Ein Jugendleiter legt eine Person an und erzeugt einen **persönlichen, einmaligen Einladungslink** (14 Tage gültig, jederzeit neu erzeugbar). Die App liefert dazu einen fertigen WhatsApp-Text zum Kopieren oder Teilen; optional geht der Link zusätzlich per E-Mail raus.
- Beim Öffnen richtet die Person ihren Zugang ein: bevorzugt ein **Passkey**, sonst ein **Passwort**.
- E-Mail ist für Erwachsene Pflicht, für Jungfischer freiwillig.
- Eltern bestätigen beim Annehmen der Einladung die Einwilligung für ihre Kinder (8.4).
- **TOTP** ist optional für Jugendleiter und den Plattform-Admin. Für den Plattform-Admin wird es dringend empfohlen. Eltern und Jungfischer bekommen kein TOTP angeboten.
- **Zugang verloren**: Erwachsene bekommen einen Reset-Link per E-Mail. Für Jungfischer erzeugt ein Jugendleiter **oder ein Elternteil** einen neuen Einladungslink.
- Eltern entscheiden, ob ihr Kind überhaupt einen Zugang bekommt, und können ihn wieder entziehen.

Verworfen: Magic Links als einziger Weg (Kinder ohne E-Mail fallen heraus; der Wechsel Mail-App → installierte PWA ist auf iOS holprig) und vom Jugendleiter vergebene Passwörter (Pflegeaufwand, Passwörter wären bekannt).

### 4.2 Rechte der Jugendleiter

Intern gibt es nur **Einzelrechte**. Rollen sind **Vorlagen**, die die Häkchen vorbelegen; danach ist jedes Recht pro Person änderbar. Neue Rechte lassen sich so ergänzen, ohne Rollen umzubauen.

| Recht | Umfasst |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Mitglieder verwalten | Personen anlegen, einladen, Eltern und Kinder verknüpfen, Untergruppen pflegen |
| Threads erstellen | Threads anlegen, Module hinzufügen, eigene Threads bearbeiten |
| Alle Threads bearbeiten | fremde Threads ändern, archivieren, Modus umstellen, Kommentare löschen |
| Globale Dokumente verwalten | Dokumente hochladen, ersetzen, Kategorien pflegen |
| Antworten im Detail sehen | sehen, wer was geantwortet hat; ohne dieses Recht nur Summen |
| Jugendleiter & Rechte verwalten | weitere Jugendleiter anlegen und Rechte vergeben |
| Vereinseinstellungen | Name, Logo, Farben, Kontaktdaten des Vereins |

Rollen-Vorlagen:

| Vorlage | Vorbelegte Rechte |
| ------------ | ------------------------------------------------------------------------- |
| Leitung | alle |
| Jugendleiter | alle außer „Jugendleiter & Rechte verwalten" und „Vereinseinstellungen" |
| Betreuer | „Antworten im Detail sehen" |

Feste Regeln:

- Jugendleiter sehen alle Threads ihres Vereins.
- Der letzte Inhaber von „Jugendleiter & Rechte verwalten" kann sich dieses Recht nicht entziehen und nicht gelöscht werden. Ein Verein kann sich so nicht aussperren.

---

## 5. Navigation und URLs

### 5.1 Zwei Oberflächen

- **Mitglieder-Hülle**, optimiert fürs Handy, mit unterer Leiste: **Start · Threads · Termine · Medien · Mehr**. Unter „Mehr" liegen globale Dokumente, Profil, die eigenen Kinder, offline gespeicherte Dokumente und Benachrichtigungseinstellungen.
- **Verwaltungs-Hülle** unter `/<slug>/verwaltung`, optimiert für den Desktop, mit Seitenleiste: Mitglieder, Untergruppen, Jugendleiter und Rechte, Threads, globale Dokumente, Vereinseinstellungen.

Module im Thread anlegen und bearbeiten geht auch am Handy, ist aber auf den Desktop ausgelegt. Der **Thread-Editor** zeigt links das Formular (Titel, Zielgruppe, Modus, „Mitglieder benachrichtigen", sortierbare Modulliste) und rechts eine **Live-Vorschau am Handy**, in der das gerade bearbeitete Modul markiert ist. Verworfen: Bearbeiten in einer breiten Thread-Ansicht mit Seitenleiste — Jugendleiter arbeiten am Desktop, gelesen wird am Handy, und die Vorschau zeigt sofort, ob ein Modul dort verständlich ist.

### 5.1.1 Gestaltung

- Grundcharakter **„Am Wasser"**: helle, ruhige Flächen, weiße Karten mit weichen Ecken, Knöpfe direkt an jeder Aufgabe. Verworfen: eine neutrale Listenoptik (zu nüchtern für Jungfischer) und eine kräftige, jugendliche Optik mit dunklem Kopf (für Eltern zu laut).
- **Die Vereinsfarbe ist ein einziger Eingabewert.** Akzent, helle Akzentfläche und die Variante für den dunklen Modus werden daraus abgeleitet; der Kontrast wird auf WCAG AA geprüft und notfalls angepasst.
- **Dunkler Modus ist Pflicht** in beiden Hüllen. Er folgt `prefers-color-scheme` und ist unter „Mehr" bzw. in der Verwaltung umschaltbar (Hell / Dunkel / System).
- Gestaltungs-Tokens als CSS-Variablen; die Grundlage entsteht im klickbaren Entwurf (Teilprojekt 1) und wird übernommen.

### 5.2 Start (Dashboard)

Von oben nach unten:

1. **Braucht deine Antwort**: offene Umfragen, Helferlisten und Kosten mit Frist. Bei Eltern pro Kind („Lena: Bowling noch offen").
2. **Als Nächstes**: die nächsten Termine mit Ort und Uhrzeit.
3. **Neu seit deinem letzten Besuch**: neue Threads, Änderungen, Kommentare, kurz zusammengefasst.

Die genaue Gestaltung wird im klickbaren Entwurf (Teilprojekt 1) ausgearbeitet.

### 5.3 Threads, Termine, Archiv

- Thread-Liste: angepinnte Threads oben, dann aktive nach letzter Aktivität.
- **Termine** zeigt alle Termine aus Termin-Modulen als **Kalenderansicht**.
- Ein Thread mit Termin wird **eine Woche nach seinem letzten Termin** automatisch archiviert. Jugendleiter können manuell archivieren und wiederherstellen. Archivierte Threads bleiben les- und durchsuchbar.

### 5.4 URL-Schema

Jeder Bereich ist direkt verlinkbar, damit aus WhatsApp heraus gezielt hineingesprungen werden kann.

| URL | Inhalt |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `/admin/…` | Plattform-Admin |
| `/<slug>/` | Dashboard |
| `/<slug>/threads` | Thread-Liste |
| `/<slug>/t/<id>-<titel-slug>` | Thread; die ID ist maßgeblich, der Titelteil nur zur Lesbarkeit |
| `/<slug>/t/<id>/m/<modulId>` | Sprung zu einem Modul im Thread |
| `/<slug>/termine` · `/<slug>/medien` · `/<slug>/dokumente` | Kalender, Medienbereich, globale Dokumente |
| `/<slug>/einladung/<token>` | Einladung annehmen |
| `/<slug>/verwaltung/…` | Verwaltung |
| `/<slug>/api/v1/…` | REST-API des Vereins |
| `/<slug>/ws` | WebSocket des Vereins |

Ein umbenannter Thread bleibt unter seinem alten Link erreichbar, weil nur die ID zählt.

**Reservierte Slugs**: `admin`, `api`, `entwurf`, `assets` sowie alle Namen, die die Plattform künftig selbst auf oberster Ebene braucht. Kein Verein darf so heißen; die Prüfung liegt in `libs/domain`.

---

## 6. Threads und Module

### 6.1 Aufbau eines Threads

Jeder Thread hat denselben Aufbau mit zwei **Reitern**: **Übersicht** zeigt den **Aushang** aus Modulen in fester, vom Jugendleiter bestimmter Reihenfolge; **Verlauf** zeigt Nachrichten, Kommentare und Systemereignisse und trägt einen Zähler für Neues. Verworfen: eine durchgehende Seite mit Verlauf unter dem Aushang — bei vielen Modulen läge der Verlauf weit unten, und der Aushang soll als „aktueller Stand" ungestört bleiben. Der **Modus** legt fest, wer im Verlauf schreiben darf:

| Modus | Verlauf |
| -------------------- | ------------------------------------------------------------------ |
| Nur Aushang | niemand schreibt; der Reiter „Verlauf" entfällt |
| Aushang + Kommentare | alle Leser kommentieren |
| Offener Chat | alle Leser schreiben frei |

Der Modus ist jederzeit änderbar, etwa von „Offener Chat" auf „Nur Aushang" nach der Veranstaltung. Ein einheitlicher Aufbau statt dreier Seitentypen hält die Oberfläche für alle Modi gleich.

### 6.2 Sichtbarkeit (Zielgruppe)

Die Zielgruppe gilt für den **ganzen Thread**; Module haben keine eigene Sichtbarkeit. Wer eine Eltern-Helferliste zu einem Kinder-Thread braucht, legt einen zweiten Thread an.

Die Zielgruppe besteht aus zwei Teilen:

1. **Untergruppen**: „Alle" oder eine Auswahl.
2. **Rollenfilter**:
   - **Jungfischer + Eltern** (Vorgabe): die Jungfischer der gewählten Untergruppen und deren Eltern.
   - **Nur Eltern**: die Eltern der Jungfischer der gewählten Untergruppen.
   - **Nur Jugendleiter**: interne Orga.

Feste Regeln: Eltern sehen alles, was ihre Kinder sehen. Jugendleiter sehen alle Threads.

### 6.3 Antwort-Einheiten

Jedes Modul, auf das man antwortet (Umfrage, Helferliste, Fahrgemeinschaft), hat eine Antwort-Einheit. Das Kosten-Modul gilt immer pro Jungfischer und hat einen eigenen Status-Ablauf (6.4.2).

| Antwort-Einheit | Beispiel | Wer antwortet |
| ---------------- | ---------------------------- | -------------------------------------------------------------------- |
| Pro Jungfischer | „Kommst du zum Bowling?" | der Jungfischer selbst **oder** seine Eltern; eine Antwort pro Kind |
| Pro Erwachsenem | „Wer bringt Kuchen?" | jeder Elternteil und Jugendleiter für sich |
| Pro Person | „Welche Pizza wollt ihr?" | jeder mit Zugang, Kinder und Erwachsene |

Eine Antwort-Einheit „pro Familie" ist ausdrücklich nicht vorgesehen.

Bei „pro Jungfischer" speichert jede Antwort, **für wen** und **von wem** sie abgegeben wurde. Es gilt die zuletzt abgegebene Antwort; angezeigt wird, wer sie eingetragen hat („eingetragen von Mama"). Ein Elternteil mit zwei Kindern sieht eine Zeile pro Kind.

### 6.4 Kernmodule

Alle acht gehören zu Version 1:

| Modul | Zweck |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Info-Text | Formatierter Text |
| Termin | Datum, Uhrzeit, Ende, Ort mit Karten-Link, Treffpunkt. Speist Kalender, Dashboard und Archiv-Regel. |
| Umfrage | Ja/Nein/Vielleicht, Einfach- oder Mehrfachauswahl; Antwort-Einheit; Antwortfrist; Ergebnisse für alle sichtbar, nur als Summe oder nur für Jugendleiter |
| Helfer- & Mitbringliste | Plätze mit begrenzter Anzahl („Kuchen 3/5"); man trägt sich ein. Eigenes Modul neben der Umfrage, weil es um knappe Plätze geht. |
| Fahrgemeinschaft | Fahrer bieten Plätze für Hin- und/oder Rückfahrt an; Kinder werden eingetragen; Übersicht „Wer fährt mit wem" (6.4.1) |
| Kosten | Betrag pro Kind, Hinweis zur Bezahlung, Status offen → gemeldet → bezahlt (6.4.2) |
| Dateien | PDFs und Dokumente zum Herunterladen. Hochladen nur durch Jugendleiter. |
| Fotos | Galerie im Thread. Hochladen durch alle Leser des Threads; Jugendleiter können jedes Foto löschen. |

Später: Packliste/Checkliste, digitale Einverständniserklärung, Fangbuch/Ergebnisse, Wettbewerbe.

#### 6.4.1 Fahrgemeinschaft

- **Selbstbedienung, Jugendleiter können umsetzen.** Erwachsene bieten ein Auto an (Plätze, Abfahrtszeit, Abfahrtsort). Eltern setzen ihre Kinder in ein Auto, Jungfischer mit Zugang sich selbst. Jugendleiter verschieben Kinder zwischen Autos und ändern Plätze, etwa wenn ein Auto ausfällt. Verworfen: reine Zuteilung durch den Jugendleiter (Arbeit für ihn, Wartezeit für alle).
- **Hin- und Rückfahrt sind getrennt**; ein Fahrer kann für beide anbieten.
- Die Liste **„Braucht noch Mitfahrt"** zeigt Kinder ohne Platz — bei einem Thread mit Teilnahme-Umfrage nur die mit Zusage.
- Wer ein Kind in ein Auto setzt, sieht nur Vornamen; Telefonnummern werden nicht gezeigt. Abstimmung läuft über den Verlauf.

#### 6.4.2 Kosten

- Betrag pro Kind, freier Hinweis zur Bezahlung, optional Bankverbindung oder PayPal-Link. Ein Kopier-Knopf liefert den Verwendungszweck („Bowling 10.10. – Lena Huber").
- Status pro Kind: **offen → gemeldet → bezahlt**. Eltern tippen „Habe bezahlt" (gemeldet), ein Jugendleiter bestätigt (bezahlt). Jugendleiter können auch direkt auf „bezahlt" setzen, etwa bei Barzahlung.
- **Zahlungspflichtig** sind bei einem Thread mit Teilnahme-Umfrage die Kinder mit Zusage, sonst die ganze Zielgruppe.
- Eltern sehen nur ihre eigenen Kinder; die Liste aller Kinder sieht nur, wer „Antworten im Detail sehen" hat.
- Nicht vorgesehen: Anzahlungen, Teilbeträge, Erstattungen, Kassen-Export.

Die Kosten zählen in „Braucht deine Antwort" (5.2), solange ein Kind auf „offen" steht.

### 6.5 Medienbereich und globale Dokumente

- Der **Medienbereich** hat keine eigenen Daten. Er zeigt alle Foto- und Datei-Module, gruppiert nach Thread, soweit die Person den Thread sehen darf.
- **Globale Dokumente** (Jugendfischereiordnung, Merkblätter, Fragebögen) gehören keinem Thread, sind in einfachen Kategorien geordnet und für alle Mitglieder sichtbar.

### 6.6 Foto-Einwilligung

Jeder Jungfischer hat im Profil eine Foto-Einwilligung, die die Eltern pflegen und die mit Zeitpunkt gespeichert wird. Jugendleiter sehen sie als Warnhinweis. Die App erkennt keine Gesichter; die Einwilligung ist eine sichtbare Erinnerung, kein Filter.

### 6.7 Teilen nach WhatsApp

„Teilen" erzeugt einen **WhatsApp-tauglichen Text** (Fettdruck, Emojis, Listen) mit dem aktuellen Stand und einem Link zurück in die App. Am Handy öffnet sich das Teilen-Menü (Web Share API), am Desktop wird der Text kopiert. Es gibt **keine öffentlichen Seiten**: Wer den Link öffnet, muss angemeldet sein.

Beispiel:

```
🎳 *Bowling am 10.10.2026* – Stand Fr 18:30
✅ Dabei (9): Max, Lena, Tim, …
❌ Abgesagt (3): …
❓ Offen (4): Jonas, Mia, …
🚗 Fahrer: Fam. Huber (3 Plätze), Fam. Maier (2)
👉 Antworten: https://jufi-app.de/glonntal/t/42-bowling-am-10-10
```

**Link-Vorschau**: Für Thread-Links liefert der Server Open-Graph-Tags mit **Thread-Titel und Vereinslogo**, ohne Inhalte. Wer einen Link zugespielt bekommt, sieht also nur den Titel. Das ist bewusst so entschieden.

Fotos und Galerien sind nie öffentlich teilbar.

Verworfen: öffentliche Nur-Lese-Links (Namen von Kindern wären für jeden mit dem Link einsehbar).

---

## 7. Architektur

### 7.1 Stack

Übernommen von HWYD (`../hwyd`, dort `SPEZIFIKATION.md` Abschnitt 5):

| Baustein | Wahl |
| ------------ | ------------------------------------------------------------------------------ |
| Frontend | Angular 22, CSR, Signale, `OnPush`, Inline-Vorlagen, `@if`/`@for` |
| Backend | Express-Server-Routen über `@angular/ssr` im **selben Deployable** |
| Echtzeit | `ws` am selben HTTP-Server |
| ORM / DB | Prisma 7 mit `@prisma/adapter-pg`, Postgres 17 |
| Monorepo | Nx 23, pnpm |
| Auth | `@node-rs/argon2`, `otplib`, `@simplewebauthn`, serverseitige Sessions in Postgres |
| PWA | Angular `ngsw`, eigener Speicher in IndexedDB (`idb`) |
| Push | `web-push` (VAPID) |
| Mail | `nodemailer` über SMTP |
| Bilder | `sharp` |
| Zeitpläne | `node-cron` im selben Prozess |
| Tests | Vitest |
| Auslieferung | Docker-Image (arm64), lokal gebaut, Traefik mit Let's Encrypt |

Verworfen: eine getrennte API (NestJS/Fastify) neben einem statischen Frontend (zwei Deployables, CORS, Abweichung vom bewährten HWYD-Betrieb) und eine Instanz pro Verein (jeder Verein bräuchte Container, Datenbank und Deploy).

**Capacitor später**: Die API wird von Anfang an als eigenständige REST-Schnittstelle gebaut, nicht als Anhängsel der Seiten. CORS und eine Token-Anmeldung für native Apps kommen erst, wenn Capacitor tatsächlich angegangen wird.

### 7.2 Workspace

```
apps/
	jufi/      Angular (CSR) + Express-Server-Routen + WebSocket
	cli/       Plattform-Admin anlegen, Demo-Verein einspielen, Wartung
	entwurf/   Klickbarer Entwurf (Teilprojekt 1, Wegwerfcode)
libs/
	domain/    Regeln ohne Framework: Rechte, Sichtbarkeit, Antwort-Einheiten,
	           Fristen, Archiv-Regel, Validierung
	db/        Prisma-Client mit Treiber-Adapter
```

`libs/domain` wird von App und CLI gebraucht und muss isoliert testbar sein.

**Modul-Aufbau**: Jeder Modultyp lebt an drei festen Orten: `libs/domain/src/module/<typ>` (Regeln), `apps/jufi/src/server/module/<typ>` (API-Routen) und `apps/jufi/src/app/module/<typ>` (Bauteile). Ein neues Modul ist ein neuer Ordner an diesen drei Stellen plus eigene Tabellen.

### 7.3 Datenmodell (konzeptuell)

Die genauen Felder legt Teilprojekt 2 fest. Konzeptuell:

- `Verein` (Slug, Name, Logo, Farben, Kontakt, Status, Gruppenname)
- `Person` (Verein, Art Jungfischer/Erwachsener, Name, Foto-Einwilligung, Rechte)
- `Zugang` (Person, E-Mail, Passwort-Hash, TOTP, Passkeys) — optional pro Person
- `Elternschaft` (Erwachsener ↔ Jungfischer)
- `Untergruppe`, `UntergruppeMitglied`
- `Einladung` (Person, Token-Hash, Ablauf, eingelöst)
- `Thread` (Verein, Titel, Zielgruppe, Modus, angepinnt, archiviert)
- `ThreadModul` (Thread, Typ, Position, Titel) plus **eigene Tabellen je Modultyp**, z. B. Umfrage → Option → Antwort, Helferliste → Platz → Eintrag
- `VerlaufEintrag` (Thread, Autor, Art, Inhalt)
- `Datei` (Verein, Speicherschlüssel, Typ, Größe, Vorschaubild)
- `GlobalesDokument`, `DokumentKategorie`
- `Aenderung` (Verein, fortlaufender Zähler, betroffenes Objekt) — siehe 9.1
- `Session`, `PushAnmeldung`, `MailWarteschlange`, `Einwilligung`
- `PlattformAdmin` — außerhalb aller Vereine

Eigene Tabellen je Modultyp statt eines generischen JSON-Felds, weil Regeln wie „eine Antwort pro Kind" oder „Platz ist voll" in der Datenbank abgesichert sein sollen.

**Mandantentrennung**: gemeinsame Tabellen mit `vereinId`. Zugriff ausschließlich über eine vereinsgebundene Datenschicht `vereinDb(vereinId)`, die den Verein in jede Abfrage einsetzt. Ein Schema pro Verein wurde verworfen (Prisma-Migrationen je Schema). Row-Level-Security in Postgres ist als zweites Netz nachrüstbar, aber nicht Teil von Version 1.

### 7.4 Anfrageverarbeitung

Jede Anfrage an `/<slug>/api/v1/…`:

1. Verein aus dem Slug bestimmen; unbekannt oder gesperrt → 404.
2. Session aus dem Cookie prüfen.
3. Rechte und Sichtbarkeit mit den reinen Funktionen aus `libs/domain` prüfen.
4. Daten nur über `vereinDb(vereinId)` lesen und schreiben.

### 7.5 Echtzeit

- Ein WebSocket pro Client und Verein unter `/<slug>/ws`, angemeldet über das Session-Cookie beim Upgrade.
- Der Client abonniert Threads; der Server lässt nur Abos auf sichtbare Threads zu.
- Der Server schickt in der Regel nur **Signale** („Modul 7 hat sich geändert", mit Zählernummer aus 9.1). Der Client lädt per REST nach. Damit gibt es eine einzige Datenquelle und keine zweite Rechteprüfung für Inhalte im Socket. Chatnachrichten werden direkt mit Inhalt geschickt.
- Verteilung über einen Speicher-Bus im Prozess. Redis ist nicht nötig, solange es ein Prozess ist.
- Live aktualisiert werden Verlauf, Umfrageergebnisse, Helferlisten, Fahrgemeinschaften und die „Neu"-Markierungen.

### 7.6 PWA pro Verein und Link-Vorschau

- Express erzeugt `/<slug>/manifest.webmanifest` dynamisch: Name, Icons aus dem Vereinslogo, `start_url` und `scope` = `/<slug>/`.
- Ein Service Worker für die ganze Domain.
- Für `/<slug>/t/…` schreibt Express Open-Graph-Tags (Thread-Titel, Vereinslogo) in die HTML-Hülle (6.7).

### 7.7 Dateien

- Upload → Typprüfung (Bilder, PDF, Office) und Größengrenze (Foto 20 MB, Datei 25 MB) → bei Fotos `sharp`: verkleinern, Vorschaubild erzeugen, **EXIF- und GPS-Daten entfernen** → Speicher-Schnittstelle.
- Speicher in Version 1: Docker-Volume. Die Schnittstelle erlaubt später Hetzner Object Storage (S3), ohne Aufrufer zu ändern.
- Ausgeliefert werden Dateien nur über `/<slug>/api/v1/dateien/<id>` nach Prüfung von Session und Sichtbarkeit. Es gibt keine öffentlichen Datei-URLs.

---

## 8. Sicherheit und Datenschutz

### 8.1 Anmeldung

- Passwörter mit Argon2id; Passkeys mit `userVerification: 'required'`; TOTP optional (4.1).
- Exponentielles Backoff pro Konto und pro IP beim Login.
- Einladungs- und Reset-Tokens nur gehasht gespeichert, einmalig verwendbar.

### 8.2 Sessions

- Serverseitig in Postgres, kein JWT.
- Cookie `httpOnly`, `Secure`, `SameSite=Lax`, **`Path=/<slug>/`**. Deshalb liegt die API unter `/<slug>/api/v1/…` und nicht unter `/api/v1/<slug>/…`: nur so deckt ein Cookie Seiten und API desselben Vereins ab, und nur diese.
- Der Plattform-Admin hat eine eigene Session unter `Path=/admin/`.

### 8.3 Mandanten und Plattform-Admin

- Der Plattform-Admin sieht Vereine, Ansprechpartner und Kennzahlen (Mitgliederzahl, Speicherverbrauch), **keine Inhalte**: keine Threads, keine Namen von Kindern, keine Fotos. Das ist die Grundlage für die Rolle als Auftragsverarbeiter gegenüber fremden Vereinen.
- Zugriffe auf Objekte eines fremden Vereins oder auf unsichtbare Threads beantwortet der Server mit **404**, nicht 403. Ein Link auf einen gesperrten Thread verrät nicht, dass es ihn gibt. Die Oberfläche zeigt „Nicht gefunden oder keine Berechtigung".

### 8.4 DSGVO

- **Einwilligungen** werden mit Zeitpunkt gespeichert: die Einwilligung der Eltern für ihr Kind (Art. 8 DSGVO) beim Annehmen der Einladung, die Foto-Einwilligung im Profil des Kindes.
- **Person entfernen**: Antworten und Kommentare bleiben erhalten, damit Listen und Verläufe stimmen, und erscheinen als „ehemaliges Mitglied". Zugang, Profil, Push-Anmeldungen und Sessions werden gelöscht.
- **Auskunft**: Export „Meine Daten" als JSON pro Person.
- **Logs** enthalten keine Inhalte, nur technische Daten.
- **Rechtstexte**: Impressum und Datenschutzerklärung der Plattform; pro Verein Kontaktdaten. Ein AV-Vertrag für fremde Vereine ist eine organisatorische Aufgabe vor dem Live-Gang (Teilprojekt 6).

### 8.5 Härtung

Sicherheits-Header und Content-Security-Policy, Größengrenzen für Anfragen, Postgres ohne veröffentlichten Port.

---

## 9. Offline, Echtzeit-Abgleich, Benachrichtigungen

### 9.1 Änderungszähler

Jede Änderung in einem Verein erhöht einen fortlaufenden Zähler und wird in `Aenderung` vermerkt. Der Client fragt `/<slug>/api/v1/sync?seit=<zähler>` und erhält, was sich seither geändert hat **und was er sehen darf**.

Derselbe Mechanismus dient drei Zwecken: App-Start, Rückkehr ins Netz und Lückenschluss nach einem WebSocket-Abbruch (fehlt eine Zählernummer in den Signalen, holt der Client per Sync nach).

### 9.2 Offline lesen

- Alle sichtbaren Threads mit Aushang und Verlauf, den Verlauf bis zu einer begrenzten Länge pro Thread.
- Terminübersicht und eigene Profildaten.
- Globale Dokumente und Thread-Dateien mit dem Schalter **„Offline verfügbar"**. Die Datei liegt dann im Cache Storage; unter „Mehr" steht eine Liste mit Speicherverbrauch.
- Fotos nur, soweit sie schon einmal angesehen wurden (Vorschaubilder).

Der lokale Speicher ist pro Verein getrennt und wird **beim Abmelden gelöscht** (geteilte Familiengeräte).

### 9.3 Offline schreiben (Outbox)

Offline möglich: Antworten auf Umfragen, Eintragen in Helferlisten und Fahrgemeinschaften, Kommentare und Chatnachrichten. Alles Administrative (Mitglieder, Rechte, Threads und Module anlegen oder ändern, Uploads) geht nur online.

Übernommen aus HWYD (`outbox-policy.ts`), erweitert:

- Jeder Outbox-Eintrag trägt eine **vom Client erzeugte ID**; der Server behandelt Wiederholungen idempotent. Doppelte Kommentare oder Antworten entstehen so nicht.
- Netzfehler, Zeitüberschreitung (10 s) und 5xx → Eintrag bleibt, erneuter Versuch beim Start, beim `online`-Ereignis und auf Tippen.
- Fachliche Ablehnung → Eintrag wird entfernt, klare Meldung:
  - 409 „Liste voll"
  - 410 „Frist abgelaufen"
  - 403/404 „keine Berechtigung mehr"
- **Fristen entscheidet der Server** nach seiner Uhrzeit. Die Oberfläche warnt beim Offline-Antworten: „Wird gesendet, sobald Netz da ist – Frist endet heute 18:00".
- Die Kopfleiste zeigt, wie viele Einträge warten; Tippen startet einen erneuten Versuch.

### 9.4 Push

| Anlass | Empfänger |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Neuer Thread | Zielgruppe |
| Wichtige Änderung | Zielgruppe, nur wenn der Jugendleiter beim Speichern „Mitglieder benachrichtigen" anhakt |
| Frist läuft ab (2 Tage vorher) | wer noch nicht geantwortet hat; bei „pro Jungfischer" das Kind und seine Eltern |
| Termin am nächsten Tag | Zielgruppe des Threads (Eingrenzung auf Zusagende: siehe 15) |
| Kommentare und Chat | je nach Glocke des Threads |

- **Glocke pro Thread**: Alles / Nur Wichtiges (Vorgabe) / Stumm.
- Push-Anmeldungen hängen am Zugang, also am Verein. Der Benachrichtigungstitel nennt den Verein; ein Tipp öffnet den Deep Link.
- Tote Anmeldungen (404/410) werden gelöscht.
- Die App zeigt eine Installationsanleitung mit eigener Variante für iOS und Android, weil iOS Web-Push nur für installierte PWAs zustellt.

### 9.5 E-Mail als Ersatz

- Hat ein Zugang kein funktionierendes Push, landen seine Benachrichtigungen in der `MailWarteschlange`. Sie wird **höchstens stündlich** als eine Sammelmail mit Links in die Threads verschickt.
- Fällt SMTP aus, bleibt die Warteschlange stehen und wird später abgearbeitet. Die Verwaltung zeigt einen Hinweis.
- Jungfischer ohne E-Mail und ohne Push erhalten direkt nichts. Was ihre Teilnahme betrifft, geht ohnehin an die Eltern.

### 9.6 Zeitgesteuerte Aufgaben

`node-cron` im App-Prozess: Fristen-Erinnerungen, Termin-Erinnerungen, Archivierung (5.3), Versand der Mail-Warteschlange, Aufräumen abgelaufener Einladungen und Sessions.

---

## 10. Betrieb

### 10.1 Umgebungen

| Umgebung | Ort | Zweck |
| -------- | ------------------------------------------------------------------------------- | ----------------------------- |
| Test | `https://jufi-app.sideshow-systems.de`, bestehende Hetzner-VM (neben paperless, HWYD) | Entwurf, Entwicklung, Pilot |
| Live | `https://www.jufi-app.de`, **eigene Hetzner-VM** | Betrieb für alle Vereine |

- Domain, Basis-URL, `WEBAUTHN_RP_ID` und `WEBAUTHN_ORIGIN` kommen aus Umgebungsvariablen. Der Umzug ist damit reine Konfiguration.
- Passkeys aus der Testumgebung werden beim Umzug ungültig, weil sie an die Domain gebunden sind. Passwort-Zugänge bleiben.
- Auf der Test-VM bekommen App und Datenbank harte Speichergrenzen (`mem_limit`), wie HWYD dort, weil sich alle Dienste 3,7 GB ohne Swap teilen.

### 10.2 Auslieferung

Wie HWYD (`SPEZIFIKATION.md` Abschnitt 11): Image lokal für arm64 bauen, eigener Migrations-Dienst vor dem App-Start, Healthcheck prüft Node und Datenbank, Versionsnummer in `package.json`, Rollback auf den vorherigen Tag.

### 10.3 Sicherung

Täglich Datenbank-Dump **und** Upload-Volume per restic in ein zweites Hetzner-Konto, mit Wiederherstellungsprobe wie bei HWYD.

---

## 11. Teilprojekte

Jedes Teilprojekt bekommt eine eigene Spezifikation, einen eigenen Plan und eine eigene Umsetzung, in dieser Reihenfolge:

| # | Teilprojekt | Inhalt | Ergebnis |
| - | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1 | Klickbarer Entwurf | Nx-Grundgerüst; `apps/entwurf` mit Beispieldaten im Speicher, ohne Backend (12) | Durchklickbarer Entwurf auf der Testdomain |
| 2 | Fundament | Server, Datenbank, Mandanten, Plattform-Admin, Personen, Elternschaft, Untergruppen, Einladung und Anmeldung, Rechte, beide Hüllen, Docker, Deploy, Sicherung | Einladen, anmelden, Mitglieder pflegen |
| 3 | Thread-Kern | Threads, Zielgruppen, Modi, Verlauf; Module Info-Text, Termin, Umfrage; Dashboard, Thread-Liste, Kalender; Änderungszähler und WebSocket; Teilen und Link-Vorschau | Bowling-Szenario ohne Fahrgemeinschaft durchspielbar |
| 4 | Weitere Module und Medien | Helferliste, Fahrgemeinschaft, Kosten, Dateien, Fotos mit Upload-Verarbeitung; Medienbereich; globale Dokumente | Alle acht Kernmodule |
| 5 | Offline und Benachrichtigungen | Lokaler Speicher, Outbox, Dokumente offline; Push, E-Mail-Ersatz, Erinnerungen, Archivierung | Bereit für den Pilotbetrieb |
| 6 | Live-Gang | Eigene VM, `jufi-app.de`, Rechtstexte, AV-Vertrag, Umzug | Offen für weitere Vereine |
| 7 | Abrechnung | Tarife, Testzeitraum, Rechnungen, Sperre bei Nichtzahlung (16) | Vereine zahlen für die Nutzung |

Später: Packliste/Checkliste, digitale Einverständniserklärung, Capacitor-Apps.

---

## 12. Teilprojekt 1 im Überblick: Klickbarer Entwurf

Ziel ist, vor dem ersten Datenmodell zu prüfen, ob das Konzept für Eltern, Jungfischer und Jugendleiter trägt. Die Einzelheiten stehen in `2026-10-11-jufi-tp1-entwurf-design.md`. Kurz:

- Angular-App `apps/entwurf` im Nx-Workspace, statisch gebaut, ohne Backend; Beispieldaten im Browser.
- Drei Personen (Elternteil mit einem Kind mit und einem ohne Zugang, Jungfischerin, Jugendleiter mit eigenem Kind) mit **geführten Aufgaben**; Rückmeldung der Testpersonen als WhatsApp-Text.
- Mitglieder-Hülle am Handy **und** Verwaltung am Desktop.
- Der Code ist Wegwerfcode. Übernommen werden Gestaltung und die Erkenntnisse aus dem Durchklicken; sie fließen in die Spezifikationen der Teilprojekte 2 bis 4 ein.

---

## 13. Tests

- **`libs/domain` testgetrieben mit Vitest**: Rechte, Sichtbarkeit, Antwort-Einheiten, Fristen, Archiv-Regel. Das sind reine Funktionen und die häufigste Fehlerquelle.
- **API-Tests gegen eine Wegwerf-Postgres** (eigener Container, Port 5433).
- **Systematischer Mandanten-Test**: Für jede Route wird mit IDs aus einem fremden Verein und mit unsichtbaren Threads zugegriffen. Erwartet wird immer 404.
- **Wenige Ende-zu-Ende-Abläufe im Browser**: Einladung annehmen; Elternteil beantwortet eine Umfrage für zwei Kinder; offline antworten und später senden.
- Geprüft wird ausschließlich mit erfundenen Daten.

---

## 14. Konventionen

Wie HWYD (`../hwyd/CLAUDE.md`):

- Code-Kommentare, Commit-Nachrichten, Spezifikationen und Oberfläche auf Deutsch. Bezeichner gemischt (englische Fachbegriffe, deutsche Domänenwörter), der Umgebung folgend.
- Kommentare erklären **warum**; verworfene Alternativen stehen mit Grund im Kommentar.
- Commit-Nachrichten in ASCII (Umlaute umschrieben).
- Einrückung mit Tabs; Ausnahmen: YAML, `schema.prisma`, Markdown-Tabellen.
- Angular: Inline-Vorlagen und -Stile, keine Backticks in Kommentaren innerhalb von `template:`/`styles:`.
- Prisma 7: Client nur über die Fabrikfunktion aus `libs/db`; nach Schemaänderungen `prisma generate`; Migrationen mit Datenerhalt von Hand.
- Vor jedem Push `prettier --check`.

---

## 15. In den Teilprojekt-Spezifikationen zu klären

Diese Punkte sind bewusst nicht hier entschieden, sondern gehören in die genannte Spezifikation:

| Punkt | Teilprojekt |
| ---------------------------------------------------------------------------- | ----------- |
| Umgang mit Jungfischern, die volljährig werden oder die Gruppe verlassen | 2 |
| Kategorien der globalen Dokumente: fest vorgegeben oder vom Verein pflegbar | 4 |
| Länge des offline gehaltenen Verlaufs pro Thread | 5 |
| Termin-Erinnerung nur an Zusagende, wenn der Thread eine Teilnahme-Umfrage hat | 5 |

Die Gestaltung von Dashboard und Kalender, der Ablauf der Fahrgemeinschaft und das Kosten-Modul sind inzwischen entschieden (5.1.1, 6.4.1, 6.4.2); Feinheiten zeigen sich im Entwurf.

---

## 16. Geschäftsmodell (später)

Ziel: Sobald andere Vereine die App nutzen, zahlt jeder Verein für die Nutzung. Das wird **nicht vor dem Live-Gang** gebaut. Das passende Preismodell (pauschal, nach Mitgliederzahl, nach Speicher) lässt sich erst nach dem Pilotbetrieb sinnvoll festlegen.

Was schon jetzt dafür angelegt ist und nicht verbaut werden darf:

- Der Verein ist ein eigener Mandant mit Status (aktiv, gesperrt), den der Plattform-Admin setzt (3.1).
- Der Plattform-Admin sieht Kennzahlen pro Verein — Mitgliederzahl, Speicherverbrauch (8.3). Das sind die naheliegenden Größen für eine Preisstaffel.
- Vereine werden ausschließlich vom Plattform-Admin angelegt; eine Selbstregistrierung gibt es nicht.

Teilprojekt 7 „Abrechnung" ergänzt Tarif, Testzeitraum, Rechnungsstellung und eine Sperre bei Nichtzahlung. AGB, Rechnungsstellung, Umsatzsteuer und Gewerbe sind vorher organisatorisch und fachkundig zu klären.
