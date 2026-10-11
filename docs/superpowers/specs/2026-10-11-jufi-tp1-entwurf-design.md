# JuFi App — Teilprojekt 1: Klickbarer Entwurf

Stand: 11.10.2026 · Status: zur Prüfung · Rahmen: `2026-10-11-jufi-rahmen-design.md`

Der Entwurf ist eine durchklickbare JuFi App ohne Backend. Eltern, Jungfischer und Jugendleiter spielen damit vorgegebene Aufgaben durch und schicken ihre Rückmeldung per WhatsApp. Er beantwortet die Frage, ob das Konzept der Rahmen-Spezifikation für die Leute trägt, bevor ein Datenmodell entsteht.

Der Code von `apps/entwurf` ist **Wegwerfcode**. Erhalten bleiben das Workspace-Grundgerüst, die Gestaltung (Tokens, Hüllen, Bauteil-Optik) und die Erkenntnisse aus den Rückmeldungen.

---

## 1. Ziel und Abnahme

Teilprojekt 1 ist fertig, wenn:

1. alle 15 Aufgaben (Abschnitt 5.3) durchspielbar sind und ihre Prüfregeln greifen,
2. eine Rückmeldung als WhatsApp-Text bei der konfigurierten Nummer ankommt,
3. der Entwurf unter `https://jufi-app.sideshow-systems.de/entwurf/` erreichbar ist,
4. die Prüfung im Browser (Abschnitt 9) in hell und dunkel bestanden ist.

---

## 2. Zielgruppe und Verteilung

- Testpersonen sind die Jugendleiter **und ausgewählte Eltern und Jungfischer**. Der Entwurf muss ohne Erklärung funktionieren.
- Verteilt wird per Link in WhatsApp. Es gibt keine Anmeldung.
- Jede Testperson spielt im eigenen Browser; der Datenstand liegt nur dort (`localStorage`). Testpersonen sehen einander also nicht.

---

## 3. Beispieldaten

### 3.1 Datum

Alle Termine und Fristen sind **relativ zum Tag des ersten Öffnens** angelegt (z. B. „Bowling am kommenden Samstag"). Der Entwurf bleibt so über Wochen glaubwürdig. Thread-Titel enthalten deshalb kein festes Datum. Der Bezugstag wird mit dem Datenstand gespeichert und beim Zurücksetzen neu gesetzt.

### 3.2 Verein

- Verein „Jungfischer Glonntal", Slug `glonntal`, Vereinsfarbe Blaugrün (`#0f766e`), Platzhalter-Logo.
- Alle Namen von Personen sind erfunden.

### 3.3 Personen

| Person | Rolle | Besonderheit |
| ------- | --------------------------------- | -------------------------------------------------------- |
| Sandra | Elternteil | Mutter von Lena und Max |
| Lena | Jungfischerin, 13, mit Zugang | Untergruppe „Zeltlager-Teilnehmer" |
| Max | Jungfischer, 10, **ohne Zugang** | Foto-Einwilligung: nein |
| Thomas | Jugendleiter, Vorlage „Leitung" | Vater von Jonas (12) |
| Katrin | Jugendleiterin, Vorlage „Jugendleiter" | — |
| Michael | Betreuer | — |

Dazu kommen rund 12 weitere Jungfischer mit Eltern, damit Listen und Summen realistisch aussehen. Untergruppen: „Ältere" (ab 14, ohne Lena, Max, Jonas) und „Zeltlager-Teilnehmer".

### 3.4 Threads

| Thread | Zielgruppe | Modus | Module | Zweck im Test |
| ----------------------------- | ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 📌 Wichtige Infos (angepinnt) | Alle · Jungfischer + Eltern | Nur Aushang | Info-Text, Termin „Nächste Gruppenstunde" (in 2 Tagen, Vereinsheim) | „Wann ist das nächste Treffen?" |
| 🎳 Bowling | Alle · Jungfischer + Eltern | Aushang + Kommentare | Termin (kommender Samstag), Umfrage „Kommst du mit?" pro Jungfischer (Frist in 3 Tagen), Fahrgemeinschaft, Kosten 12 €, Datei | Kern-Szenario |
| 🍂 Herbstfest – Helfer | Alle · Nur Eltern | Aushang + Kommentare | Info-Text, Helferliste (Kuchen 3/5, Salat 1/4, Aufbau Sa 2/4, Abbau 0/4), Termin (in 3 Wochen) | Pro Erwachsenem, Eltern-Thread |
| ⛺ Zeltlager 2027 | Zeltlager-Teilnehmer · JF + Eltern | Offener Chat | Info-Text, Termin Vortreffen (in 2 Wochen), Umfrage „Welche Pizza beim Vortreffen?" pro Person | Chat-Modus, Antwort pro Person |
| 🎣 Hegefischen | Alle · Jungfischer + Eltern | Aushang + Kommentare | Info-Text mit Ergebnissen, Fotos (Platzhalter), Termin (vor 5 Tagen) | Medien, bald im Archiv |
| 📝 Fischerprüfung 2027 | Ältere · Jungfischer + Eltern | Aushang + Kommentare | Info-Text, Datei | Sichtbarkeit: Sandra und Lena sehen ihn nicht |
| 🔧 Orga Jugendleiter | Nur Jugendleiter | Offener Chat | Info-Text | Nur Thomas sieht ihn |
| 🏆 Königsfischen 2026 (Archiv) | Alle · Jungfischer + Eltern | Nur Aushang | Termin (vor 6 Wochen), Fotos | Archiv |

Ausgangszustand im Bowling-Thread: Lena hat **selbst** zugesagt, Max und Jonas sind offen. Fahrgemeinschaft: Familie Maier (Hinfahrt, 3 Plätze, davon 2 belegt), Familie Huber (Hin- und Rückfahrt, 2 Plätze). Kosten: alle offen.

### 3.5 Globale Dokumente

Kategorien „Ordnungen" (Jugendfischereiordnung), „Merkblätter" (Mindestmaße und Schonzeiten, Verhalten am Wasser), „Formulare" (Fragebogen für Erziehungsberechtigte). Die Dateien sind Platzhalter-PDFs.

---

## 4. Bildschirme

### 4.1 Mitglieder-Hülle (Handy)

Untere Leiste: Start · Threads · Termine · Medien · Mehr. Am Desktop erscheint die Hülle als mittige Spalte in Handybreite.

| Bildschirm | Inhalt |
| ---------- | ------ |
| Start | Begrüßung; „Braucht deine Antwort" (pro Kind bzw. „Du"); „Als Nächstes" (nächste Termine); „Neu seit deinem letzten Besuch" |
| Threads | Angepinnt; Aktiv nach letzter Aktivität; Archiv als eigener Abschnitt |
| Thread | Kopf mit Titel, Zielgruppe und Teilen-Knopf; Reiter **Übersicht** (Module) und **Verlauf** (mit Zähler; entfällt im Modus „Nur Aushang") |
| Termine | Monatskalender mit Markierungen, darunter die Liste der Termine des Monats; Tippen führt zum Thread |
| Medien | Fotos und Dateien gruppiert nach Thread |
| Dokumente | Globale Dokumente nach Kategorie, mit Schalter „Offline verfügbar" (nur angedeutet) |
| Mehr | Profil; meine Kinder (Foto-Einwilligung, „Zugang für Kind erzeugen"); Benachrichtigungen (Glocke pro Thread); Darstellung Hell/Dunkel/System; offline gespeicherte Dokumente; Installationshinweis |

### 4.2 Module im Entwurf

| Modul | Im Entwurf |
| ---------------- | ---------- |
| Info-Text | Anzeige |
| Termin | Anzeige mit Karten-Link (öffnet echte Kartensuche) |
| Umfrage | **Bedienbar**: Antwort pro Kind / pro Person; „eingetragen von"; Ergebnisanzeige je nach Einstellung |
| Helferliste | **Bedienbar**: eintragen, austragen; volle Plätze gesperrt |
| Fahrgemeinschaft | **Bedienbar**: Auto anbieten, Kind eintragen, „Braucht noch Mitfahrt"; Jugendleiter verschiebt Kinder |
| Kosten | **Bedienbar**: „Habe bezahlt" (Eltern), bestätigen (Jugendleiter), Kopier-Knopf für Verwendungszweck |
| Dateien | Angedeutet: Tippen zeigt „Im Entwurf nicht herunterladbar" |
| Fotos | Galerie mit Platzhalterbildern, Großansicht; Hochladen angedeutet |
| Verlauf | **Bedienbar**: Kommentare bzw. Chatnachrichten schreiben |

**Teilen-Knopf**: erzeugt den WhatsApp-Text nach Rahmen-Spec 6.7, mit Deep Link in den Entwurf, und öffnet das Teilen-Menü bzw. kopiert.

### 4.3 Verwaltungs-Hülle (Desktop)

Nur für Thomas. Seitenleiste: Übersicht · Threads · Termine · Personen · Untergruppen · Jugendleiter & Rechte · Globale Dokumente · Einstellungen. Am Handy benutzbar, mit Hinweis „Am Desktop bequemer".

| Bildschirm | Umfang |
| --------------------- | ------ |
| Threads | Liste mit Filter (aktiv, Archiv); **Thread-Editor**: links Formular (Titel, Zielgruppe, Modus, „Mitglieder benachrichtigen", sortierbare Module, Modul hinzufügen), rechts Live-Vorschau am Handy mit Markierung des bearbeiteten Moduls. Voll bedienbar für Info-Text, Termin und Umfrage; die übrigen Module lassen sich hinzufügen, aber nur mit Grundeinstellungen. |
| Antworten | Pro Thread: wer hat was geantwortet, wer fehlt noch; Teilen des Stands |
| Personen | Liste, Detail, Eltern-Kind-Zuordnung, **Einladungslink erzeugen** mit WhatsApp-Text und Vorschau „So sieht die Einladung aus" (Willkommen → Passkey einrichten, simuliert → Einwilligung für Kinder → fertig) |
| Jugendleiter & Rechte | Rollen-Vorlage wählen, Häkchen anpassen; Schutz des letzten Rechte-Verwalters |
| Untergruppen, Termine, Globale Dokumente | Ansicht mit Beispieldaten, eingeschränkt bedienbar |
| Einstellungen | Vereinsname, Logo (Platzhalter), **Vereinsfarbe**: Änderung wirkt sofort in der ganzen App |

### 4.4 Nicht im Entwurf

Plattform-Admin, echte Anmeldung, Push, echtes Offline, echte Datei-Uploads und -Downloads, E-Mail.

---

## 5. Testmodus

### 5.1 Einstieg

1. Begrüßung: Das ist ein Entwurf, nichts ist echt, man kann nichts kaputt machen.
2. „Wer bist du heute?": drei Karten — Sandra, Lena, Thomas — mit je einem Satz Beschreibung.
3. „Mit Aufgaben" (Vorgabe) oder „Frei umsehen".

### 5.2 Testmodus-Knopf und Aufgabenband

- Ein schwebender Knopf über der unteren Leiste, farblich deutlich vom Entwurf abgesetzt (eigene Signalfarbe, nicht die Vereinsfarbe). Er öffnet: Person wechseln · Aufgabenliste · Rückmeldung senden · Rückmeldung zu dieser Seite · Entwurf zurücksetzen.
- Oben ein schmales Band mit der aktuellen Aufgabe („Aufgabe 2 von 6: …") und den Knöpfen **Ich komme nicht weiter** und **Überspringen**. Das Band verdeckt keine Bedienelemente; die Hülle rückt darunter.
- Personenwechsel behält den Datenstand. Was Sandra einträgt, sieht Thomas.

### 5.3 Aufgaben und Prüfregeln

Es gibt zwei Arten von Aufgaben:

- **Handlungsaufgaben** haben eine Prüfregel auf dem Datenstand. Sie wird nach jeder Änderung ausgewertet; ist sie erfüllt, gilt die Aufgabe als geschafft.
- **Suchaufgaben** („Finde heraus …") lassen sich nicht am Datenstand erkennen, weil die Antwort schon auf dem Dashboard stehen kann. Das Band bietet dafür „Ich hab's" an; danach wählt die Testperson aus drei Antworten. Richtig → geschafft; falsch → „Nicht ganz, schau nochmal", die Fehlversuche werden gezählt.

**Sandra**

| # | Aufgabe | Prüfregel |
| - | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1 | Melde Max fürs Bowling an. | Umfrage Bowling: Max = Ja |
| 2 | Trag dich fürs Herbstfest für einen Kuchen ein. | Helferliste Herbstfest, Platz „Kuchen": Sandra eingetragen |
| 3 | Such Max einen Platz für die Hinfahrt zum Bowling. | Fahrgemeinschaft Bowling, Hinfahrt: Max sitzt in einem Auto |
| 4 | Melde, dass du die 12 € für Lena überwiesen hast. | Kosten Bowling: Lena = gemeldet oder bezahlt |
| 5 | Finde heraus, wann und wo das nächste Treffen ist. | Suchaufgabe: Wochentag, Uhrzeit und Ort der nächsten Gruppenstunde |
| 6 | Finde die Jugendfischereiordnung. | Dokument „Jugendfischereiordnung" wurde geöffnet |

**Lena**

| # | Aufgabe | Prüfregel |
| - | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1 | Wähl deine Pizza fürs Zeltlager-Vortreffen. | Umfrage Pizza: Lena hat geantwortet |
| 2 | Finde heraus, mit wem du zum Bowling fährst. | Suchaufgabe: Familie des Fahrers |
| 3 | Schau dir die Fotos vom Hegefischen an. | Ein Foto aus „Hegefischen" wurde groß geöffnet |
| 4 | Stell eine Frage im Thread „Zeltlager 2027". | Neue Nachricht von Lena im Verlauf „Zeltlager 2027" |

Für Aufgabe 2 sitzt Lena im Ausgangszustand bereits im Auto der Familie Maier.

**Thomas**

| # | Aufgabe | Prüfregel |
| - | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1 | Leg den Thread „Weihnachtsfeier" mit Termin und Teilnahme-Umfrage an. | Veröffentlichter Thread, Titel enthält „Weihnachtsfeier", mit Termin- und Umfrage-Modul |
| 2 | Finde heraus, wer beim Bowling noch nicht geantwortet hat, und teile den Stand per WhatsApp. | Teilen des Bowling-Stands wurde ausgelöst (aus dem Thread oder aus der Antwort-Übersicht der Verwaltung) |
| 3 | Bestätige die Zahlung für Lena. | Kosten Bowling: Lena = bezahlt |
| 4 | Lade einen neuen Elternteil ein. | Neue erwachsene Person angelegt und Einladungslink erzeugt |
| 5 | Setz Max in ein anderes Auto, weil Familie Maier ausfällt. | Max sitzt in einem Auto, das nicht Familie Maier gehört |

Die Reihenfolge innerhalb einer Person ist fest. Aufgaben, deren Voraussetzung fehlt (z. B. Thomas 3, bevor Sandra „gemeldet" hat), funktionieren trotzdem: Thomas kann direkt auf „bezahlt" setzen.

### 5.4 Nach jeder Aufgabe

„Geschafft! Wie leicht war das?" mit 😀 😐 😟 und optionalem Feld „Was war unklar?". Gemessen wird die Dauer von der Anzeige der Aufgabe bis zum Erfüllen der Prüfregel. „Ich komme nicht weiter" und „Überspringen" werden mit Dauer vermerkt; „Ich komme nicht weiter" fragt optional „Wo hängst du?".

### 5.5 Rückmeldung

- Jederzeit über den Testmodus-Knopf; nach der letzten Aufgabe einer Person automatisch angeboten, mit freiem Feld „Was würdest du dir noch wünschen?".
- „Rückmeldung zu dieser Seite" hängt den aktuellen Pfad an.
- Format:

```
📝 *JuFi-Entwurf – Rückmeldung*
Gerät: iPhone · Safari · dunkel
*Sandra*
1 ✅ 😀 0:42 Max fürs Bowling
2 ✅ 😐 1:55 Kuchen eintragen – „Hab das Herbstfest erst nicht gefunden"
3 ❌ nicht weiter 2:10 Fahrgemeinschaft – „Wo ist die Hinfahrt?"
4 ⏭ übersprungen 0:20 Bezahlt melden
…
📍 /glonntal/t/2-bowling: „Der Teilen-Knopf ist schwer zu finden"
💬 Sonst noch: „Dunkler Modus top!"
```

- Gerätezeile: Gerätetyp und Browser grob aus dem User-Agent, Hell/Dunkel. Keine weiteren Gerätedaten.
- Versand über `https://wa.me/<Nummer>?text=…`. Ist die Nummer nicht konfiguriert oder schlägt der Aufruf fehl: Web Share API, sonst Kopieren mit Hinweis.
- Die Nummer kommt aus der Umgebungsvariable `JUFI_ENTWURF_WHATSAPP` beim Bau und steht nicht im Repo. Sie ist im ausgelieferten JavaScript lesbar; das ist für einen Entwurf, dessen Link per WhatsApp verteilt wird, hingenommen.

### 5.6 Speicherung und Zurücksetzen

- Ein Schlüssel `jufi-entwurf:v<n>` in `localStorage` hält Datenstand, Bezugstag, Testmodus-Fortschritt und Rückmeldungen. Steigt `<n>` mit einer neuen Version des Entwurfs, beginnt der Stand neu.
- Ist `localStorage` nicht verfügbar (privater Modus), läuft der Entwurf im Speicher weiter und verliert den Stand beim Neuladen.
- „Entwurf zurücksetzen" fragt nach und stellt die Beispieldaten und den Bezugstag neu her.

---

## 6. Regeln

Die fachlichen Regeln sind reine Funktionen in `apps/entwurf/src/app/regeln/`, ohne Angular-Abhängigkeit. Sie sind so geschrieben, dass sie in den Teilprojekten 2 und 3 als Ausgangspunkt für `libs/domain` dienen können; eine Verbindung zu `libs/domain` besteht im Entwurf nicht.

| Regel | Aufgabe |
| -------------------------- | ------- |
| `siehtThread` | Sichtbarkeit nach Rahmen-Spec 6.2 |
| `antwortZeilen` | Welche Zeilen eine Person bei einem Antwort-Modul sieht (pro Kind, „Du", pro Person) |
| `brauchtAntwort` | Inhalt von „Braucht deine Antwort" |
| `naechsteTermine` | „Als Nächstes" und Kalender |
| `istArchiviert` | Archiv-Regel (eine Woche nach dem letzten Termin oder manuell) |
| `mitfahrtOffen` | „Braucht noch Mitfahrt" |
| `kostenStatus`, `zahlungspflichtig` | Kosten nach Rahmen-Spec 6.4.2 |
| `darf` | Einzelrechte nach Rahmen-Spec 4.2 |
| `teilenText` | WhatsApp-Text des Thread-Stands |
| `vereinsfarben` | Ableitung der Akzentfarben aus der Vereinsfarbe, Kontrastprüfung |

---

## 7. Gestaltung

Diese Abschnitte werden in die echte App übernommen.

- **Stil „Am Wasser"** (Rahmen-Spec 5.1.1): helle, leicht blaugrüne Fläche, weiße Karten mit 14 px Radius, Knöpfe als Pillen, Abschnittstitel in kleinen Versalien.
- **Tokens** als CSS-Variablen auf `:root`: Flächen, Karten, Text, gedämpfter Text, Linien, Akzent, Akzentfläche, Text auf Akzent, Erfolg, Warnung, Fehler, Abstände, Radien, Schriftgrößen.
- **Vereinsfarbe**: ein Eingabewert. `vereinsfarben` leitet Akzent, Akzentfläche, Text auf Akzent und die Varianten für den dunklen Modus ab und dunkelt bzw. hellt nach, bis Text auf Akzent und Akzent auf Fläche WCAG AA erreichen.
- **Dunkler Modus**: Token-Werte unter `@media (prefers-color-scheme: dark)` und unter `[data-theme="dark"]`; Wahl Hell/Dunkel/System unter „Mehr" bzw. in den Einstellungen.
- **Schrift**: Systemschrift.
- **Symbole**: Lucide, wie in HWYD.
- **Mobil**: sichere Bereiche (`env(safe-area-inset-*)`), `touch-action: manipulation`, Tippflächen mindestens 44 × 44 px, keine waagrechte Scrollbarkeit.
- Die Signalfarbe des Testmodus ist kein Token der App und lebt nur im Ordner `testmodus/`.

---

## 8. Technik

### 8.1 Workspace-Grundgerüst

Bleibt für die folgenden Teilprojekte:

- pnpm (Version gepinnt über `packageManager`), Nx 23, Angular 22, TypeScript, Vitest, Prettier.
- `.editorconfig` (Tabs), `.prettierrc`, `.prettierignore`, `tsconfig.base.json`, `pnpm-workspace.yaml` (mit `ignoredBuiltDependencies` wie HWYD), `.gitignore` (inklusive `.superpowers/`).
- `CLAUDE.md` mit den Projektregeln aus Rahmen-Spec Abschnitt 14 und den übertragbaren Erfahrungen aus `../hwyd/CLAUDE.md`.
- `package.json`-Skripte: `dev:entwurf`, `build:entwurf`, `test`, `format`, `format:check`, `image:entwurf`, `deploy:entwurf`.

### 8.2 `apps/entwurf`

```
apps/entwurf/src/
	app/
		daten/       Beispieldaten, Bezugstag, Store (Signale), Speicherung
		regeln/      reine Funktionen (Abschnitt 6) mit Tests
		gestaltung/  Tokens, Vereinsfarben, Hell/Dunkel
		mitglieder/  Hülle und Bildschirme der Mitglieder-Ansicht
		module/      ein Ordner je Modultyp (Anzeige + Bedienung)
		verwaltung/  Hülle und Bildschirme der Verwaltung
		testmodus/   Einstieg, Band, Knopf, Aufgaben, Prüfregeln, Rückmeldung
```

- Angular mit Standalone-Bauteilen, Signalen, `OnPush`, Inline-Vorlagen und -Stilen, `@if`/`@for`.
- **Routen folgen dem echten URL-Schema** unter `base href="/entwurf/"`, z. B. `/entwurf/glonntal/t/2-bowling`, `/entwurf/glonntal/verwaltung/threads/neu`. Deep Links und Teilen werden so realistisch mitgetestet.
- Ein Store mit Signalen hält den gesamten Datenstand; Bildschirme lesen über berechnete Signale, die die Regeln aus `regeln/` anwenden. Die „angemeldete" Person ist ein Signal des Testmodus.
- Kein Service Worker, kein Manifest — beides ist im Entwurf nicht Gegenstand der Prüfung.

### 8.3 Auslieferung

- `pnpm nx build entwurf` erzeugt statische Dateien.
- Image `sideshowsystems/jufi-entwurf` auf Basis `nginx:alpine`, lokal für arm64 gebaut. Die nginx-Konfiguration liefert für unbekannte Pfade unter `/entwurf/` die `index.html` aus (Deep Links), setzt `no-cache` für `index.html` und lange Cache-Zeiten für Dateien mit Hash.
- Dienst `jufi-entwurf` als Block in der bestehenden Compose-Datei auf dem Server, versioniert im Repo unter `deploy/jufi-entwurf.yml`: Traefik-Regel `Host(jufi-app.sideshow-systems.de) && PathPrefix(/entwurf)`, TLS über den vorhandenen certresolver, `mem_limit: 32m`, kein `ports:`.
- Ein Skript `tools/deploy-entwurf.sh` baut, testet, baut das Image, überträgt es und startet nur diesen Dienst neu (`docker compose up -d jufi-entwurf`, nie ein blankes `up -d`).
- Der Wurzelpfad `/` der Testdomain leitet bis Teilprojekt 2 auf `/entwurf/` weiter.

---

## 9. Tests und Prüfung

- **Vitest** für `regeln/`, die Prüfregeln und Suchaufgaben-Antworten aus `testmodus/` (die richtige Antwort ergibt sich aus den Beispieldaten und dem Bezugstag, nicht aus festem Text), den Rückmeldetext und den Teilen-Text. Die Regeln werden testgetrieben geschrieben.
- **Prüfung im Browser** mit den Beispieldaten:
  - Mitglieder-Hülle bei 375 × 812 in hell und dunkel, für alle drei Personen;
  - Verwaltung bei 1280 × 800;
  - alle 15 Aufgaben einmal vollständig durchgespielt;
  - Rückmeldung einmal tatsächlich an die konfigurierte Nummer geschickt;
  - Messungen statt Augenmaß: keine waagrechte Scrollbarkeit, Tippflächen ≥ 44 px, Band verdeckt nichts (`getBoundingClientRect`).
- Keine Ende-zu-Ende-Tests: der Code ist Wegwerfcode.

---

## 10. Nach dem Test

Die eingehenden Rückmeldungen werden gesammelt ausgewertet. Was sich am Konzept ändert, wird in die Rahmen-Spezifikation übernommen, bevor die Spezifikation von Teilprojekt 2 entsteht.
