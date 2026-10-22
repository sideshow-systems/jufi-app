# JuFi App — Teilprojekt 4: Weitere Module und Medien

Stand: 21.10.2026 · Ergebnis des Brainstormings vom selben Tag · Status: zur Freigabe

Teilprojekt 4 bringt die übrigen fünf Kernmodule **Helfer- und Mitbringliste, Fahrgemeinschaft, Kosten, Dateien und Fotos**, dazu die **Dateiablage** mit Upload-Verarbeitung, den **Medienbereich**, die **globalen Dokumente** und die **Foto-Einwilligung** (Rahmen-Spezifikation `2026-10-11-jufi-rahmen-design.md`, Abschnitt 11: „Alle acht Kernmodule“).

Die Rahmen-Spezifikation, die Spezifikation zu Familie, Jugendsprecher und Kalender (`2026-10-12-jufi-familie-jugendsprecher-kalender-design.md`), die Fundament-Spezifikation (`2026-10-12-jufi-tp2-fundament-design.md`) und die Thread-Kern-Spezifikation (`2026-10-20-jufi-tp3-thread-kern-design.md`) gelten weiter. Diese Datei legt fest, was sie offen lassen, und hält die Entscheidungen mit ihren verworfenen Alternativen fest. Wo sie abweicht, steht das in Abschnitt 14; die Rahmen-Spezifikation ist entsprechend nachgezogen.

Kürzel: **Rahmen**, **FAM**, **TP2**, **TP3** für die genannten Spezifikationen, **Entwurf** = `apps/entwurf` (Wegwerfcode, Vorlage nur für Fachregeln).

---

## 1. Ausgangslage und Ziel

### 1.1 Ergebnis: das Zeltlager-Szenario

Es ist zugleich der Ende-zu-Ende-Test (13.3). Personen wie in TP3 1.1.

1. **Thomas** (Leitung) legt den Thread „⛺ Zeltlager“ an: „Alle · Jungfischer + Familie“, Modus „Aushang + Kommentare“. Module: Termin Fr–So, Teilnahme-Umfrage, Kosten 45 € (für Max per Ausnahme 35 €), Helferliste mit „Kuchen 0/4“ und „Zeltaufbau Fr 16 Uhr 0/3“ (pro Erwachsenem), Fahrgemeinschaft (hin und zurück), Dateien (Packliste.pdf, Anmeldebogen.pdf), Fotos mit „Alle Leser laden hoch“. Er veröffentlicht.
2. **Sandra** sagt für Lena und Max zu. „Braucht deine Antwort“ zeigt „Lena: Zeltlager 45 € offen“ und „Max: Zeltlager 35 € offen“.
3. Sandra trägt sich bei „Kuchen“ mit der Notiz „Marmorkuchen“ ein; die Position zeigt 1/4.
4. Sandra bietet für die Hinfahrt ein Auto an (3 Plätze, Vereinsheim, 15:30) und setzt Lena und Max hinein. „Braucht noch Mitfahrt (hin)“ zeigt Mia. **Thomas** setzt Mia in Sandras Auto; Sandra sieht es ohne Neuladen.
5. Sandra kopiert den Verwendungszweck und tippt für beide Kinder „Habe bezahlt“ (gemeldet). Thomas bestätigt Lena (bezahlt).
6. Sandra öffnet die Packliste.
7. Thomas teilt den Stand; der Text enthält die Fahrerzeilen und „💶 45 € pro Kind“.
8. Nach dem Lager lädt Sandra drei Fotos hoch. Darüber steht „Von Tim S. dürfen keine Fotos gezeigt werden“. Die Fotos kommen verkleinert und ohne GPS-Daten an; Lena sieht sie ohne Neuladen; unter **Medien** erscheinen sie beim Thread.
9. Thomas löscht ein Foto; Sandra speichert eines.
10. Thomas lädt unter Verwaltung › Dokumente die „Jugendfischereiordnung.pdf“ in die Kategorie „Ordnungen“; Sandra findet sie unter Medien › Dokumente.

### 1.2 Echte und erfundene Daten

Wie TP3 1.2. Die Demo erzeugt ihre Fotos als Bilder aus Formen und Farben; es werden **nie echte Fotos** in Demo, Tests oder Browser-Prüfungen verwendet.

### 1.3 Ansatz

Wie TP3 1.3: Regeln als reine Funktionen in `libs/domain` mit `jetzt: Date`, testgetrieben; der Server entscheidet im Speicher nach `ladeUmfeld`, die Oberfläche blendet nur zusätzlich aus. Der Entwurf ist Vorlage für Fachregeln und Abläufe (Helferliste, Fahrgemeinschaft, Kosten, Medien, Dokumente), seine Bauteile werden neu gebaut.

Neue Module folgen dem Muster von TP3 2.2: Kopfzeile `ThreadModul` mit erweitertem `ModulTyp`, je Typ eine 1:1-Tabelle, Eintragungen in eigenen Tabellen mit Datenbank-Regeln. Eintragungen laufen über eigene Routen nach dem Muster der Umfrage-Antwort (TP3 4.2), nicht über das Ersetzen des Threads.

### 1.4 Etappen

Jede Etappe ist für sich lauffähig, bekommt einen eigenen Plan und wird vom Eigentümer lokal abgenommen.

| #   | Etappe                          | Inhalt                                                                                                                                                        | Abschnitte                 |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | Dateien-Grundlage und Dokumente | Speicher-Schnittstelle, Volume, Upload als Strom, Ausliefern, Kontingent, Löschliste und Aufräumer, Sicherung des Volumes, globale Dokumente, Leiste „Medien“ | 2 (ohne 2.4), 3.1, 9, 12.4 |
| 2   | Dateien, Fotos, Einwilligung    | Fotoverarbeitung, Module Dateien und Fotos, Foto-Einwilligung, Medienbereich „Fotos & Dateien“                                                                | 2.4, 3.2, 4                |
| 3   | Helfer- und Mitbringliste       | Modul, Eintragen mit Notiz, Antworten-Übersicht                                                                                                               | 5, 8                       |
| 4   | Fahrgemeinschaft                | Autos, Mitfahrten, „Braucht noch Mitfahrt“, Umsetzen durch die Leitung                                                                                        | 6, 8                       |
| 5   | Kosten                          | Betrag und Ausnahmen, offen → gemeldet → bezahlt, Verwendungszweck, „Braucht deine Antwort“                                                                   | 7, 8                       |
| 6   | Teilen und Abschluss            | Teilen-Zeilen, Datenauszug, Entfernen, Datenschutzerklärung, Demo-Zeltlager, Ende-zu-Ende-Test, Doku                                                          | 11, 12, 13                 |

Die Dateien-Grundlage kommt zuerst, weil dort das meiste Risiko liegt (Speicher im 256-MiB-Container, Volume und Sicherung brauchen einen Deploy).

**Fotoverarbeitung wandert in Etappe 2** (Plan zu Etappe 1, Entscheidung 1). Ohne Foto-Modul gäbe es in Etappe 1 keinen Weg, sie im laufenden Image zu prüfen, und die Speicherabnahme unter `mem_limit` (2.4) braucht genau diesen Weg. Etappe 1 baut die Typerkennung für Fotos schon mit (sie ist eine reine Regel), nimmt aber nur Dateien an; 2.4 und `img-src blob:` (2.5) gelten damit erst ab Etappe 2. Jede neue Schreibroute pflegt ab ihrer Etappe den Änderungszähler und meldet an `deps.bus`.

### 1.5 Nicht in Teilprojekt 4

- **Teilprojekt 5**: Dokumente offline, Push (etwa bei zurückgezogenem Auto), Erinnerungen an offene Kosten.
- Videos, ZIP-Download ganzer Galerien, Kommentare oder Reaktionen an Fotos, Gesichtserkennung.
- Anzahlungen, Teilbeträge, Erstattungen, Kassen-Export (Rahmen 6.4.2).
- Ersetzen einer Datei in einem Datei-Modul (löschen und neu hochladen); Dokumente lassen sich ersetzen (3.1).
- Object Storage (S3); die Schnittstelle (2.2) lässt ihn später zu.

---

## 2. Dateiablage

### 2.1 Datenmodell

`Datei (id, vereinId, art, modulId?, dokumentId?, name, typ, groesse, breite?, hoehe?, sha256, vonId, hochgeladenAm)`:

- `art`: `FOTO` oder `DATEI`.
- Genau einer der Verweise `modulId` (Foto- oder Datei-Modul) und `dokumentId` ist gesetzt (CHECK).
- `name`: Originalname bei Dateien (bereinigt, 1–120 Zeichen); bei Fotos leer.
- `typ`: MIME-Typ nach Erkennung am Inhalt (2.3), nicht nach Angabe des Clients.
- `groesse`: Bytes aller gespeicherten Fassungen (bei Fotos samt Vorschaubild); Grundlage des Kontingents (2.6).
- `sha256`: beim Schreiben berechnet; die Restore-Probe vergleicht damit (12.4).
- `vonId`: wer hochgeladen hat; Fremdschlüssel `NoAction` wie bei Antworten (TP3 2.3), angezeigt nach TP3 3.10.

`DateiLoeschung (schluessel, vereinId, geloeschtAm)`: die Löschliste (2.7). **`vereinId` ohne Fremdschlüssel auf `Verein`** (Plan, Entscheidung 6): Nur so darf ein Vereins-Pfad über `vereinDb` hineinschreiben; der Aufräumer liest plattformweit über den schlichten Client. Verworfen: die ursprünglich vorgesehene Tabelle ohne `vereinId` — sie ließe sich aus einer Vereins-Route nicht schreiben, ohne `vereinDb` zu umgehen.

**`Datei` verweist mit `NoAction` auf Modul und Dokument** (Entscheidung 5). Ein Kaskadenlöschen umginge die Löschliste (2.7), und die Bytes fielen erst später durch den Waisen-Schritt weg. So muss jeder Löschpfad `loescheDateien` rufen. Verworfen: `onDelete: Cascade` — bequemer, aber nach einer Wiederherstellung fehlten Bytes, deren Zeile der Dump noch kennt.

**`Verein.speicherGrenzeMb`** (`Int`, Megabyte, Vorgabe 5120; Entscheidung 3). Verworfen: Bytes als `BigInt` — das Schema meidet `BigInt` bewusst (er bricht `JSON.stringify`). Der Verbrauch ist eine Summe, die 2^31 übersteigt; er wird als `number` geführt (sicher bis 2^53). Der Plattform-Admin stellt 100 bis 1 048 576 MB ein.

Die neuen Tabellen stehen in `VEREINS_MODELLE` (`libs/db`), auch `DateiLoeschung` (wegen `vereinId`).

### 2.2 Speicher

Schnittstelle `DateiSpeicher` mit `schreibe(schluessel, quelle)`, `lies(schluessel)` (Strom), `loesche(schluessel)` und `liste()`. Version 1 ist ein Verzeichnis im Docker-Volume `jufi-dateien`, Pfad aus `DATEIEN_PFAD`. Schlüssel: `<vereinId>/<dateiId>` und `<vereinId>/<dateiId>.vorschau`; Temp-Dateien liegen unter `tmp/` im selben Volume, damit das Verschieben an den Zielort atomar ist.

Verworfen: Bytes in Postgres wie beim Vereinslogo — bei 5 GB je Verein würde die Datenbank (384 MiB Speichergrenze) zum Dateiserver und der tägliche Dump wüchse auf Gigabytes, die restic schlecht dedupliziert. Verworfen: gleich Object Storage — eigenes Konto und Kosten schon im Testbetrieb, und ausgeliefert werden müsste trotzdem über die App (2.5).

### 2.3 Hochladen

Eine Datei je Anfrage, der Körper ist die Datei selbst (kein Multipart) mit `Content-Type: application/octet-stream` (Entscheidung 8): Der globale `express.json` lässt ihn so in Ruhe, und der Typ zählt ohnehin nur am Inhalt. Verworfen: Multipart mit mehreren Dateien — ein Fehler bei der zwölften Datei verwürfe die Anfrage, und Fortschritt und Wiederholung je Datei wären umständlicher. Der Logo-Upload (TP2) ist das Muster.

Ablauf:

1. **Vor dem Lesen des Körpers**: Sitzung, Recht und Sichtbarkeit (404), Rate-Limit (9.2), `Content-Length` vorhanden (sonst 411) und nicht über der Grenze (Foto 20 MB, Datei 25 MB; sonst 413 `GROESSE`), Kontingent mit `Content-Length` als Schätzung (sonst 413 `KONTINGENT`).
2. Der Körper fließt als Strom in eine Temp-Datei; dabei zählt der Server mit und bricht über der Grenze mit 413 ab, falls die Angabe in `Content-Length` gelogen war, und berechnet `sha256`.
3. **Typ am Inhalt** (`erkenneTyp(kopf, dateiname)` in `libs/domain`, rein):
   - Fotos: JPEG, PNG, WebP (an den Magic Bytes).
   - Dateien: PDF (`%PDF-`), JPEG, PNG; DOCX, XLSX, PPTX, ODT, ODS (ZIP-Signatur **und** passende Endung).
   - Alles andere: 415 `TYP`. HEIC ebenfalls mit eigener Meldung („Bitte als JPEG senden“): Die vorgefertigten `sharp`-Binärdateien lesen HEIC nicht, und Safari am iPhone wandelt bei `accept="image/*"` in JPEG um; die Etappe prüft das an einem echten Gerät. SVG ist ausgeschlossen (Skript in Bildern).
4. Fotos verarbeitet 2.4; Dateien bleiben, wie sie sind. Die fertigen Bytes werden **vor** dem Commit an ihren Zielort verschoben, damit keine Zeile je auf fehlende Bytes zeigt.
5. In `mitAenderung` unter der Vereinssperre: Kontingent mit der echten Größe prüfen, Zeile anlegen, Änderung schreiben; nach dem Commit Meldung an `deps.bus`. Scheitert die Prüfung oder der Commit, sind die Bytes verwaist und fallen nach 2.7 weg.

Der Dateiname kommt im Kopf `X-Dateiname` (Prozent-kodiertes UTF-8; Entscheidung 9). Bereinigt werden Pfadtrenner, Steuerzeichen, unsichtbare Formatzeichen (`\p{Cf}`, etwa U+202E, das die Leserichtung umdreht) und Länge. Der Titel eines neuen Dokuments ist der bereinigte Name ohne Endung.

**Die Endung passt zum erkannten Typ** (Plan zu Etappe 2, Entscheidung 9; Rückstand aus Etappe 1), bei Dateien im Modul wie bei Dokumenten: `x.pdf` mit PNG-Inhalt wird `x.png`, `Packliste` ohne Endung wird `Packliste.pdf`. Verworfen: die Endung des Clients behalten — dann öffnete ein Gerät die Datei mit dem falschen Programm, obwohl der Server den Typ kennt.

**Hochladen aus dem Browser** geht über `XMLHttpRequest` und nicht über `fetch`, **nur** wegen des Fortschrittsbalkens: `fetch` meldet den Fortschritt des Sendens nicht. Der Rest der Oberfläche bleibt bei `HttpClient`. Die Seite lädt die Dateien einzeln nacheinander hoch, über alle Kategorien hinweg.

### 2.4 Fotoverarbeitung

**Gilt ab Etappe 2** (1.4): Etappe 1 nimmt keine Fotos an.

Mit `sharp`, aus der Temp-Datei, nicht aus einem Puffer:

- Eingabe höchstens 50 Megapixel (`limitInputPixels`), sonst 413 `GROESSE`.
- EXIF-Ausrichtung anwenden (`rotate()`), dann verkleinern auf **2560 px lange Seite** (nie vergrößern), JPEG Qualität 82; **Vorschaubild 480 px** lange Seite, JPEG Qualität 75. Transparenz (PNG, WebP) wird auf Weiß gelegt.
- **Das Vorschaubild entsteht aus der fertigen 2560er-Fassung, nicht aus dem Original** (Plan zu Etappe 2, Entscheidung 3). Ein 48-MP-Bild wird so nur einmal dekodiert. Verworfen: beide Fassungen in einem Zug aus dem Original — das wäre der doppelte Speicherbedarf.
- Neu kodiert ohne Metadaten: **EXIF und GPS fallen weg** (Rahmen 7.7).
- **Das Original wird verworfen.** Verworfen: Original zusätzlich aufbewahren — 3–8 MB je Foto, die Sicherung wüchse entsprechend, und 2560 px reichen fürs Handy und für Abzüge bis etwa 20 × 30 cm.
- **Immer nur eine Verarbeitung gleichzeitig** je Prozess (`sharp.concurrency(1)`, Cache aus, eigene Warteschlange). Bis zu 8 Fotos warten; darüber **503 `BESCHAEFTIGT` mit `Retry-After: 2`** (Plan zu Etappe 2, Entscheidung 16). Der Client wiederholt bis zu dreimal von selbst und zeigt erst dann „Nochmal“: Voll ist die Schlange meist nur kurz, wenn mehrere zugleich hochladen, und ein Tippen je Foto wäre dafür zu viel.
- **`foto.ts` importiert nur `sharp` und `node:*` und nutzt nur löschbare TypeScript-Syntax** (keine `enum`, keine Parameter-Properties; Plan zu Etappe 2, Entscheidung 2). Nur so läuft genau diese Datei im gebauten Image ohne Bau (Abnahme unten): Node 22 entfernt die Typen beim Laden. Die Pixelprüfung steht deshalb dort noch einmal, statt aus `verein/logo.ts` zu kommen.

**Abnahme von Etappe 2:** Die teuersten bekannten Fotos, die die Upload-Route annimmt, werden im gebauten Image unter dem `mem_limit` von `jufi` verarbeitet, ohne dass der Kernel die App beendet; der Spitzenverbrauch steht im Bericht. Die Probe deckt ab: ein 48-MP-JPEG baseline (der Fall, den Handys liefern), dasselbe progressiv mit 4:2:0, mit 4:4:4 und in CMYK (der Dekoder hält alle Koeffizienten, bei CMYK von vier vollen Kanälen), ein interlaced PNG (Adam7) mit knapp 50 MP und Alphakanal in 8 und in 16 Bit je Kanal (wird ganz entpackt), ein 48-MP-WebP und ein knapp 20 MB großes PNG (Bytegrenze). CMYK und 16 Bit liefert kein Handy, aber Bildbearbeitungen und Druckvorlagen; der Eigentümer hat am 22.10.2026 entschieden, sie anzunehmen und die Grenze nach ihnen zu bemessen (verworfen: beide vor dem Dekodieren abweisen). Reicht der Speicher nicht, wird das Limit angehoben, nicht die Fotogrenze gesenkt.

**Die Abnahme ist ein dauerhaftes Tor im Rauchtest** (`tools/deploy.sh`, Tor 4; Plan zu Etappe 2, Entscheidung 1), keine einmalige Messung:

- Der Rauchtest-Container läuft mit derselben Speichergrenze wie `jufi` in `deploy/jufi-services.yml` (`--memory` und `--memory-swap` gleich, also ohne Swap wie auf dem Server). Fehlt dort `mem_limit`, bricht der Rauchtest ab.
- `tools/erzeuge-testbilder.mjs` erzeugt die Bilder auf dem Entwicklungsrechner und prüft, dass jedes unter 20 MB und 50 MP liegt. Im laufenden Container verarbeitet `tools/fotoprobe.mjs` sie mit genau der Datei `foto.ts` der App: erst jedes Bild in einem eigenen Prozess (Spitze je Bild), dann alle nacheinander in einem Prozess (wie im Betrieb). Danach liest das Tor `memory.peak` der cgroup und gibt „Fotoprobe: 8 Bilder bis 50 MP verarbeitet, Spitze <MiB> von <mem_limit>“ aus; die App muss danach weiter auf `/healthz` antworten.
- Gemessen werden App im Leerlauf und Probe zusammen. Das liegt über dem Betrieb, wo nur ein Node-Prozess läuft, und ist damit die vorsichtige Seite.
- Exit 137 oder ein beendeter App-Container brechen ab: „Speicher reicht nicht; mem_limit anheben“. Dann legt man dem Eigentümer die gemessenen Werte für einen neuen `mem_limit` vor.
- **Auch das Vereinslogo (`verein/logo.ts`) stellt sich in der Fotoschlange an** und bekommt bei voller Schlange dasselbe 503 `BESCHAEFTIGT`. sharp dekodiert es genauso, und das `mem_limit` deckt nur eine teure Verarbeitung zur Zeit.
- Verworfen: die Verarbeitung in einen Kindprozess auslagern. Er liefe in derselben cgroup, bräuchte also dieselbe Grenze und dazu eine zweite Node-Laufzeit, und machte nur die Folgen eines Abbruchs kleiner, nicht den Bedarf.
- Verworfen: eine kleinere Pixelgrenze je Kodierung (etwa für progressive JPEGs). Sie wiese Fotos ab, die Bildbearbeitungen so speichern, und senkte damit die Fotogrenze, statt das Limit anzuheben.
- Verworfen: die Messung über die echte Upload-Route. Sie bräuchte eine Mitgliedssitzung im Wegwerf-Verein, und Demo-Personen haben kein Passwort.
- Verworfen: einmal von Hand messen. Die nächste `sharp`-Version kann es kippen, ohne dass es jemand merkt.

Erste Messung (Probelauf vom 22.10.2026, `sharp` 0.35) nur mit dem baseline-JPEG und dem 20-MB-PNG: Spitze 170 MiB von 256m, die App allein im Leerlauf rund 79 MiB. Das baseline-JPEG dekodiert `sharp` beim Verkleinern gleich in geringerer Auflösung, das PNG liest es zeilenweise (`sequentialRead`). Das Gesamtreview hat gezeigt, dass das die günstigen Fälle sind.

Messung mit der erweiterten Probe (22.10.2026, `sharp` 0.35, Probe allein im Image, Spitze der cgroup): baseline-JPEG 79 MiB, 20-MB-PNG 86 MiB, WebP 96 MiB, progressives JPEG 4:2:0 218 MiB, Adam7-PNG 282 MiB, progressives JPEG 4:4:4 356 MiB, alle nacheinander in einem Prozess 362 MiB. Unter 256m beendete der Kernel die Probe am 4:4:4-JPEG. Im Rauchtest (App und Probe zusammen, `pnpm run deploy:app --dry-run`) lag die Spitze bei 471 MiB; daraus wurde zunächst ein `mem_limit` von 640m.

Das Re-Review fand zwei teurere Fälle, die die Route annimmt: ein progressives CMYK-JPEG und ein 16-Bit-Adam7-PNG. Mit beiden in der Probe (22.10.2026, gleiche Fassungen): allein im Image CMYK-JPEG 457 MiB, 16-Bit-PNG 511 MiB, alle acht nacheinander in einem Prozess 521 MiB. Im Rauchtest lag die Spitze bei 576 MiB; der Probe-Prozess mit allen Bildern erreichte 556 MiB maxRSS. Das `mem_limit` von `jufi` steht deshalb auf **768m**: 576 MiB plus rund 25 % Reserve (720 MiB), auf 64m aufgerundet. Das ist zugleich die Obergrenze, die der gemeinsame Server zulässt; ein noch teurerer Fall bräuchte eine neue Entscheidung des Eigentümers.

### 2.5 Ausliefern

`GET /dateien/:id` und `GET /dateien/:id/vorschau` (nur Fotos), nur mit Sitzung und nur, wenn die Person die Datei sehen darf: Modul in einem sichtbaren Thread (TP3 3.1; im Entwurf nur für Jugendleiter, TP3 3.6) oder Dokument (alle Mitglieder). Sonst 404 (Rahmen 8.3).

Köpfe:

- `Content-Type` aus `Datei.typ`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'` auf der Datei.
- Fotos und PDF `inline`, alle anderen `attachment`; Dateiname über `filename*=UTF-8''…`. Mit `?herunterladen=1` immer `attachment` („Speichern“ am Rechner).
- `Cache-Control: private, max-age=31536000, immutable`: Eine ID ändert nie ihren Inhalt (Ersetzen erzeugt eine neue Datei, 3.1).
- **`Content-Length` kommt aus dem Speicher, nicht aus `Datei.groesse`** (Plan zu Etappe 2, Entscheidung 4): Bei Fotos zählt `groesse` beide Fassungen (2.1), ausgeliefert wird aber nur eine. `DateiSpeicher.lies` liefert dafür `{ strom, bytes }`.

Die CSP der App bekommt `img-src 'self' blob:`, damit ausgewählte Fotos vor dem Hochladen als Vorschau erscheinen. **Das kommt mit Etappe 2** (1.4): Ohne Foto-Modul gibt es keine Vorschau, die es brauchte.

### 2.6 Kontingent

Verbrauch = Summe von `Datei.groesse` des Vereins (Abfrage, kein Zähler; verworfen: ein mitgeführter Zähler — er liefe bei jedem Fehler im Löschpfad auseinander). Er ist eine `number` und kein `BigInt` (2.1): 100 Dateien zu je 25 MB sind genau `100 * 26214400`, ohne Überlauf.

**Beim Ersetzen eines Dokuments zählt das Kontingent netto**: Die alte Datei geht mit der neuen Zeile aus der Summe, sie wird nicht doppelt gezählt, obwohl ihre Bytes bis zum Aufräumen (2.7) noch auf der Platte liegen. Verworfen: beide zählen — ein Verein knapp unter der Grenze könnte dann sein Dokument nicht mehr durch eine gleich große Fassung ersetzen. Bei vollem Kontingent lehnt der Server mit 413 `KONTINGENT` ab; die Meldung nennt Verbrauch und Grenze und wen man fragt.

- Verwaltung › Einstellungen zeigt „1,2 von 5 GB belegt“, ab 90 % mit Hinweis. Größen schreibt `speicherText` in `@jufi/domain`: Basis 1024, ab 1 GB und ab 1 MB mit einer Nachkommastelle, **darunter in ganzen KB** (mindestens „1 KB“, damit eine nicht leere Datei nie wie eine leere aussieht); nur `0` heißt „0 MB“, nicht „0 KB“. Ein typisches Dokument ist ein paar Dutzend KB groß und stünde sonst als „0,0 MB“ in der Liste.
- Der Plattform-Admin sieht den Verbrauch je Verein (Rahmen 8.3) und ändert die Grenze. Später hängt sie am Tarif (Teilprojekt 7).

### 2.7 Löschen und Aufräumen

Das Löschen einer `Datei` (einzeln, mit ihrem Modul, Dokument oder Thread) entfernt in der Transaktion die Zeile und trägt ihre Schlüssel in `DateiLoeschung` ein. **Jeder Löschpfad ruft dafür `loescheDateien`**; die Datenbank löscht nie per Kaskade (2.1). Die Datei ist damit sofort unerreichbar (2.5).

**Ausnahme Vereinslöschung:** Löscht der Plattform-Admin einen ganzen Verein, fallen dessen `Datei`-Zeilen per Kaskade (`Datei.verein`), ohne Eintrag in der Löschliste; die Bytes fallen über den Waisen-Schritt (2) des Aufräumers weg, sobald sie älter als 24 Stunden sind (beim nächsten Lauf). Verworfen: auch hier über die Löschliste -- ein Verein hat Tausende Zeilen, und die Kaskade der Datenbank ist hier der einzige Weg, der keine Zeile vergisst. Folge: Nach einer versehentlichen Vereinslöschung braucht die Wiederherstellung neben dem Dump auch das Volume aus restic, und zwar bald, denn der nächste Lauf des Aufräumers löscht die Bytes ohne Zeile.

Der vorhandene Aufräumer (`threads/aufraeumen.ts`, beim Start und alle 24 h) bekommt zwei Schritte:

1. Schlüssel aus `DateiLoeschung`, die **mindestens 24 Stunden** alt sind: Bytes löschen, Zeile löschen.
2. Bytes im Speicher ohne `Datei`-Zeile und ohne Eintrag in der Löschliste, deren Änderungszeit älter als 24 Stunden ist (abgebrochene Uploads): löschen; Temp-Dateien älter als 1 Stunde: löschen. Eine `Datei`-Zeile ohne Bytes wird nur als Fehler protokolliert, nie gelöscht.

Der Abstand von 24 Stunden sorgt dafür, dass zwischen Datenbank-Dump und Sicherung des Volumes (12.4) keine Bytes verschwinden, deren Zeile im Dump noch steht. Verworfen: Bytes sofort nach dem Commit löschen — eine Wiederherstellung könnte dann Zeilen ohne Bytes enthalten. Verworfen: Löschen zu fester Nachtzeit — der Aufräumer läuft bewusst im Takt ab Prozessstart (`aufraeumen.ts`), und der Abstand hängt so nicht an der Uhrzeit der Sicherung.

---

## 3. Globale Dokumente und Medienbereich

### 3.1 Globale Dokumente

`DokumentKategorie (id, vereinId, name, position)`, Name 1–40 Zeichen, je Verein eindeutig. Neue Vereine (und per Migration die bestehenden) bekommen „Ordnungen“, „Merkblätter“, „Formulare“.

`Dokument (id, vereinId, kategorieId, titel, angelegtAm)` mit genau einer `Datei` (`art = DATEI`), Titel 1–120 Zeichen, vorbelegt mit dem Dateinamen ohne Endung. Titel und Kategorienamen mit Steuerzeichen oder unsichtbaren Formatzeichen (`\p{Cf}`, Plan zu Etappe 2, Entscheidung 9) lehnt der Server mit 400 ab.

**Dokumente stehen alphabetisch nach Titel** (`localeCompare` mit `'de'`; Plan, Entscheidung 4), nicht in Handreihenfolge: Das Dokument hat deshalb keine `position`. Verworfen: Handreihenfolge — sie bräuchte eine Sortier-Oberfläche je Kategorie, und alphabetisch findet man schneller. Kategorien behalten ihre Handreihenfolge.

Rechte: Pflegen nur mit „Globale Dokumente verwalten“ (`DOKUMENTE`, Rahmen 4.2): Kategorien anlegen, umbenennen, sortieren, löschen (nur leere); Dokumente hochladen, umbenennen, verschieben, **ersetzen** (neue `Datei`, die alte geht in die Löschliste) und löschen. Sehen: alle Mitglieder. **Leere Kategorien erscheinen auf der Seite Medien für niemanden**, auch nicht für Pfleger; diese sehen sie unter Verwaltung › Dokumente, wo sie sie befüllen. Verworfen: leere Kategorien für Pfleger auch unter Medien — eine Überschrift ohne Inhalt sagt dort nichts, und die Pflege hat ihren eigenen Ort. Ohne Dokument zeigt Medien „Noch keine Dokumente.“

Die Kategorien pflegt der Verein (Rahmen 15). Verworfen: feste Kategorien — jeder Verein ordnet anders („Für Eltern“, „Gewässer“). Verworfen: freies Kategorie-Feld je Dokument — Tippfehler ergäben zwei Kategorien.

Dokumente haben **keine Live-Aktualisierung**: Sie ändern sich selten und werden beim Öffnen geladen. Sie schreiben keine `Aenderung`.

### 3.2 Medienbereich

Untere Leiste: **Start · Threads · Termine · Medien · Mehr**. „Medien“ hat zwei Reiter:

- **Fotos & Dateien**: je sichtbarem, veröffentlichtem Thread mit mindestens einem Foto oder einer Datei ein Block, sortiert nach letzter Aktivität; ein Block zeigt bis zu 6 Vorschaubilder, die Zahl aller Fotos, die Dateien (höchstens 10, dann „und n weitere“) und „Zum Thread“. Archivierte Threads erscheinen mit. Keine eigenen Daten (Rahmen 6.5); `GET /medien` rechnet aus den Modulen.
- **Dokumente**: Kategorien in ihrer Reihenfolge, darin die Dokumente mit Titel, Typ und Größe; Antippen öffnet (PDF) oder lädt herunter.

**Der Reiter steht im Query-Parameter `reiter`** (`?reiter=dokumente`; Plan zu Etappe 2, Entscheidung 13), damit „Zurück“ aus einem Dokument oder Thread in den Reiter führt, aus dem man kam. Vorgabe ist „Fotos & Dateien“. Ohne Blöcke steht dort „Noch keine Fotos oder Dateien.“

---

## 4. Module Dateien und Fotos

### 4.1 Datei-Modul

`DateienModul (id)` ohne eigene Felder; die Dateien hängen über `Datei.modulId` daran, sortiert nach `hochgeladenAm`. Höchstens 20 je Modul; die einundzwanzigste ergibt 409 `VOLL` (9.3). Ohne Dateien steht „Noch keine Dateien.“

Hochladen, Umbenennen und Löschen: wer den Thread bearbeiten darf (TP3 3.5). Leser sehen Name, Typ und Größe. Umbenennen und einzelnes Löschen gibt es auf der Thread-Seite, nicht im Editor (4.3).

**Die Thread-Suche findet auch Dateinamen** in Datei-Modulen (Plan zu Etappe 2, Entscheidung 14), wie sie die Texte der übrigen Module findet. Wer „Packliste“ sucht, meint den Thread, in dem sie liegt.

### 4.2 Foto-Modul

`FotosModul (id, hochladen)` mit `hochladen` `JUGENDLEITER` (Vorgabe) oder `ALLE`. Höchstens 500 Fotos je Modul; darüber 409 `VOLL` (9.3). Ohne Fotos steht „Noch keine Fotos.“

**Fotos haben keinen Namen** (`Datei.name` leer, 2.1). Beim Speichern heißen sie `foto-<erste 8 Zeichen der ID>.jpg` (Plan zu Etappe 2, Entscheidung 12), also nie zwei gespeicherte Fotos gleich.

- **Hochladen**: wer den Thread bearbeiten darf; bei `ALLE` außerdem jeder Leser, solange der Thread nicht im Archiv ist (wie Schreiben im Verlauf, TP3 3.5). Die Vorgabe „Nur Jugendleiter“ ist die vorsichtige; wer Fotos von allen will, stellt es bewusst um. Verworfen: feste Regel für alle Foto-Module (alle Leser, nur Erwachsene oder nur Leitung) — je nach Anlass passt etwas anderes.
- **Löschen**: eigene Fotos immer, alle Fotos mit Bearbeitungsrecht.
- **Ansicht**: Raster mit drei Spalten aus Vorschaubildern; Großansicht mit Wischen, Name des Hochladenden (TP3 3.10), „Speichern“ (am Handy Web Share mit der Datei, sonst Download) und „Löschen“, wo erlaubt.
- **Mehrfachauswahl**: Jedes Foto wird einzeln hochgeladen, mit eigenem Fortschritt und eigener Wiederholung.
- **Fehlende Rechte ergeben 404** beim Hochladen, Umbenennen und Löschen (Plan zu Etappe 2, Entscheidung 5; Rahmen 8.3), auch für Leser eines archivierten Threads mit „Alle Leser laden hoch“. Der Client zeigt den Knopf dort ohnehin nicht. Ein volles Modul ist dagegen kein Rechtefall und ergibt 409 `VOLL`.

### 4.3 Hochladen ist kein Teil des Entwurfs

Fotos und Dateien wirken sofort, auch in einem Thread im Entwurf. Im Editor erscheint der Upload erst, wenn das Modul gespeichert ist („Erst speichern, dann hochladen“). Verworfen: Uploads als Teil des Entwurfs — der Editor ersetzt den Thread als Ganzes (TP3 4.2), Bytes passen nicht in diesen Weg.

**Im Editor wird nur hochgeladen** (Plan zu Etappe 2, Entscheidung 10). Ein gespeichertes Datei- oder Foto-Modul zeigt dort die Zahl der Dateien bzw. Fotos und einen Upload; ein ungespeichertes zeigt „Erst speichern, dann hochladen“. Umbenennen und einzelnes Löschen gibt es auf der Thread-Seite. Verworfen: die volle Liste im Editor — sie stünde doppelt und bräuchte die Ansicht samt Rechten im Bearbeitungsweg.

Ein Modul oder Thread mit Fotos oder Dateien lässt sich löschen; die Bestätigung nennt die Zahl („löscht 23 Fotos von 5 Personen“). Verworfen: Sperre wie bei Antworten (TP3 3.6) — die Leitung darf ohnehin jedes Foto einzeln löschen, eine Sperre brächte nur Klickarbeit.

**Ein Modul mit Fotos oder Dateien zu entfernen fragt im Editor nach**, mit Zahlen: „Beim Speichern löscht das 23 Fotos von 5 Personen.“ (Plan zu Etappe 2, Entscheidung 11). Ein Modul ohne Medien wird weiter ohne Rückfrage entfernt; erst das Speichern löscht.

Hochladen und Löschen schreiben eine Änderung der Art `MODUL` (Live, „Neu“), aber **keinen Systemeintrag** im Verlauf; nach einem Zeltlager stünde er sonst voll davon.

### 4.4 Foto-Einwilligung

Zweite Art `FOTOS` im vorhandenen Modell `Einwilligung` (TP2: Zeitpunkt, `erteiltVon`, Widerruf, `textVersion`). Ohne Eintrag gilt **keine Einwilligung**.

- **Pflege** unter „Meine Jungfischer“ durch alle, die nach `darfEinwilligen` einwilligen dürfen; volljährige Jungfischer pflegen sie selbst im Profil, über die eigene Route `POST /ich/einwilligung`. Die Verwaltung zeigt sie bei der Person (Rahmen 6.6).
- **Volljährige willigen nur selbst ein** (Plan zu Etappe 2, Entscheidung 6). Die Foto-Einwilligung eines volljährigen Jungfischers gilt nur, wenn er sie selbst erteilt hat (`erteiltVon = jungfischerId`). Die Einwilligung der Eltern erlischt mit dem 18. Geburtstag; das folgt aus `darfEinwilligen` (TP2 Entscheidung 6) und gilt für die DSGVO-Einwilligung schon heute. Bis er selbst einwilligt, steht er im Hinweis. Gerechnet wird bei jeder Abfrage (`fotoEinwilligungGilt`), nicht gespeichert. Verworfen: die Elterneinwilligung über 18 hinaus gelten lassen — ein Erwachsener entscheidet über Fotos von sich selbst.
- **Eigener Wortlaut** (Plan zu Etappe 2, Entscheidung 8): `FOTO_EINWILLIGUNG_TEXT` für Eltern und `FOTO_EINWILLIGUNG_TEXT_SELBST` in der Ich-Form für Volljährige, Version `'1'`, als Platzhalter in `einwilligung.ts` neben dem DSGVO-Text; `tools/pruefe-texte.sh` findet sie dort. Die Foto-Einwilligung öffnet keinen Zugang, und der Widerruf der einen Art zieht die andere nicht mit.
- **Hinweis im Foto-Modul** für alle, die dort hochladen dürfen: „Von Tim S. und Mats K. dürfen keine Fotos gezeigt werden“. Gemeint sind die Jungfischer der Zielgruppe ohne gültige Foto-Einwilligung, bei einer Teilnahme-Umfrage nur die mit „Dabei“ (TP3 3.12); Namen nach TP3 3.10. Ohne solche Kinder entfällt der Hinweis.
- Kein Filter, keine Sperre (Rahmen 6.6). Der Hinweis zeigt Hochladenden außerhalb der Leitung, welche Kinder keine Einwilligung haben; das ist der Zweck und so entschieden.

Regel: `ohneFotoEinwilligung(thread, umfeld, jetzt)` in `libs/domain`.

---

## 5. Helfer- und Mitbringliste

### 5.1 Datenmodell

- `HelferModul (id, einheit, frist?)`: `einheit` wie bei Umfragen (`ERWACHSENER` als Vorgabe, `PERSON`, `JUNGFISCHER`; TP3 3.2), `frist` wie bei Umfragen (Zeitpunkt, Server-Uhr).
- `HelferPosition (id, vereinId, modulId, text, anzahl, position, schluessel)`: Text 1–80 Zeichen, Anzahl 1–99, Schlüssel stabil und vom Server vergeben wie bei Umfrage-Optionen (TP3 2.2). 1–30 Positionen je Modul, Texte verschieden.
- `HelferEintrag (id, vereinId, positionId, fuerId, vonId, notiz?, eingetragenAm, clientId)`, eindeutig je `(positionId, fuerId)`; Notiz höchstens 80 Zeichen. Fremdschlüssel zur Position `NoAction` (TP3 2.3).

Eine Person kann sich für mehrere Positionen eintragen, je Position einmal. Verworfen: eine Anzahl je Eintrag („2 Kuchen“) — selten, und die Notiz deckt es ab.

**Ein Eintrag ist ein Upsert je `(positionId, fuerId)`** (Plan zu Etappe 3, Entscheidung 5). Eine geänderte Notiz überschreibt `notiz`, `vonId` und `clientId`; `eingetragenAm` bleibt, die Reihenfolge in der Position ist die der Anmeldung. Wie bei der Umfrage-Antwort erkennt der Server eine Wiederholung nur, solange niemand die Zeile seither geändert hat.

**Jeder Eintrag belegt einen Platz und wird gezeigt, auch wenn die Person nicht mehr gefragt ist** (Plan zu Etappe 3, Entscheidung 1): Entfernte („ehemaliges Mitglied“, 12.2) ebenso wie Personen, die die Zielgruppe verlassen haben. Füllstand, `VOLL` und die Editor-Prüfung „Anzahl nicht unter den Eingetragenen“ zählen damit dieselben Zeilen, nämlich die der Datenbank. Verworfen: wie bei Umfragen ausblenden — ein ausgeblendeter Eintrag gäbe seinen Platz frei; käme die Person zurück, wäre die Position überbucht. Der Kuchen kommt ja trotzdem.

### 5.2 Regeln

- **Eintragen** (`PUT`, Upsert mit Notiz) und **Austragen** (`DELETE`): wer für `fuerId` antworten darf (TP3 3.3), vor der Frist und nicht im Archiv; danach nur, wer den Thread bearbeiten darf (Nachtragen, „eingetragen von“).
  - **Einen Eintrag einer Person, die nicht mehr gefragt ist, trägt nur aus, wer den Thread bearbeiten darf** (`darfAustragen`; Plan zu Etappe 3, Entscheidung 2). Für alle anderen ergibt das 404, wie jede Zeile, die sie nicht haben.
  - **Im Archiv** bekommt, wer den Thread nicht bearbeiten darf, 409 mit dem vorhandenen `ARCHIVIERT` (8: „nur noch Leitung“; Plan zu Etappe 3, Entscheidung 3). Geprüft wird nach 404 und Entwurf, vor der Frist (410). Der Umfrage-Antwort fehlt diese Prüfung bisher; das ist eine offene Frage an den Eigentümer.
- **Platz**: Der Server zählt die Einträge unter der Vereinssperre (`mitAenderung`); ist die Position voll, 409 `VOLL` (9.3). Eine Notiz ändern belegt keinen neuen Platz.
- **Anzeige**: Alle Leser sehen je Position Füllstand („Kuchen 1/4“) und die Eingetragenen mit Notiz („Sandra M. (Mutter von Lena und Max) – Marmorkuchen“). Eine Ergebnis-Einstellung wie bei Umfragen gibt es nicht; wer sich einträgt, will gesehen werden.
  - **„eingetragen von“ sieht nur, wen es angeht** (Plan zu Etappe 3, Entscheidung 11): Unter einem Eintrag steht es, wenn der Betrachter für diese Zeile antworten oder den Thread bearbeiten darf; der Satz kommt aus `eingetragenVon` (`namen.ts`). Fremde Leser sehen nur Name und Notiz.
  - **Thread-Seite**: je Position Füllstand `1/4`, bei voller Position zusätzlich `voll`, leer „Noch niemand eingetragen.“ Knöpfe „Eintragen“, „Austragen“ und „Notiz ändern“, für Kinder „Lena eintragen“ und „Lena austragen“. Das Formular hat das Feld „Notiz (optional)“ und den Knopf „Eintragen“, beim Ändern „Speichern“, dazu „Abbrechen“; bei Kindern steht darüber „Für Lena“.
- **„Neu“**: In einem Thread mit Helferliste sieht jeder Leser Einträge (keine Ergebnis-Einstellung, siehe oben). Deshalb ist `antwortenSichtbar` dort für Nicht-Entfernte immer `true` (Plan zu Etappe 3, Entscheidung 7).
- **„Braucht deine Antwort“** (Rahmen 5.2; Plan zu Etappe 3, Entscheidung 8) nennt eine Helferliste je eigener Zeile ohne einen einzigen Eintrag im Modul — wer Kuchen bringt, muss nicht auch noch fahren. Das gilt nur, solange die Liste eine Frist hat, die noch läuft, und mindestens eine Position einen freien Platz hat. Verworfen: auch ohne Frist — Familien, die nicht helfen können, würden sonst ohne Ende gemahnt.
- **Editor**: Eine Anzahl unter der Zahl der Eingetragenen lehnt er ab; eine Position mit Einträgen lässt sich nicht löschen; umbenennen und umsortieren geht (Schlüssel bleibt). Der Server antwortet mit 409 und dem Satz am Feld: „Für „Kuchen“ hat sich schon jemand eingetragen.“ bzw. „Für „Kuchen“ sind schon 3 eingetragen.“; eine Helferliste mit Einträgen lässt sich nicht entfernen („Die Helferliste „Mitbringen“ hat schon Einträge und lässt sich nicht entfernen.“).
  - **Die Einheit lässt sich nach dem ersten Eintrag nicht mehr ändern** (409 „Die Einheit lässt sich nach den ersten Einträgen nicht mehr ändern.“, analog TP3 3.14; Plan zu Etappe 3, Entscheidung 9). Sonst stünden Einträge von Personen da, die nach der neuen Einheit gar nicht gefragt wären.
  - **Eine Friständerung schreibt `FRIST_GEAENDERT`** wie bei der Umfrage (Plan zu Etappe 3, Entscheidung 10). `frage` ist dabei der Modultitel, ohne Titel „Helferliste“.
- **Suche**: Die Thread-Suche findet keine Positionstexte, wie sie keine Umfrage-Fragen findet (`liste.ts`; Plan zu Etappe 3, Entscheidung 12).
- Die Antworten-Übersicht der Verwaltung zeigt die Helferliste mit Nachtragen.
  - **Die Verwaltungsliste verlinkt sie auch bei einer Helferliste** (Plan zu Etappe 3, Entscheidung 13). `VerwaltungThread.hatUmfrage` heißt dafür `hatAntwortModul`; der Link im Editor folgt derselben Angabe.
  - Je Helferliste ein Block: Titel oder „Helferliste“, Frist und „<n> ohne Eintrag“ — **auch bei 0**, denn die 0 sagt, dass sich alle gemeldet haben. Je Position Füllstand, die Eingetragenen mit Notiz, „eingetragen von …“ und „Austragen“.
  - **Je nicht voller Position steht das Formular zum Nachtragen immer offen** (Person, „Notiz (optional)“, „Eintragen“). Die Leitung arbeitet dort Listen ab; ein Aufklappen kostete je Eintrag einen Klick. Verworfen: das Formular erst auf Knopfdruck zu zeigen.

---

## 6. Fahrgemeinschaft

### 6.1 Datenmodell

- `FahrtModul (id, threadId, hin, rueck)`: welche Richtungen es gibt (mindestens eine, Vorgabe beide).
  - **Höchstens eine Fahrgemeinschaft je Thread über einen gewöhnlichen Unique-Index `(vereinId, threadId)`** (Plan zu Etappe 4, Entscheidung 9). Ein Partial-Unique-Index wie bei der Teilnahme-Umfrage braucht eine Bedingung; hier ist jede Zeile eine Fahrgemeinschaft. Der Editor meldet eine zweite mit „Es gibt schon eine Fahrgemeinschaft.“ (409 `DOPPELTE_FAHRT`, `konflikt: true`), und „Modul hinzufügen“ bietet keine zweite an.
- `Auto (id, vereinId, modulId, fahrerId, richtung, plaetze, abfahrtTag?, abfahrtZeit?, ort?, notiz?, angelegtAm, clientId)`: `richtung` `HIN` oder `RUECK`; `plaetze` 1–8 („Plätze für Kinder“, eigene Kinder mitgezählt); Tag als `@db.Date`, Zeit als `HH:MM` (Wandzeit wie TP3 2.2); Ort und Notiz höchstens 200 Zeichen (Codepunkte nach `trim`, ohne Steuer- und Formatzeichen). Eindeutig je `(modulId, fahrerId, richtung)`; höchstens 30 Autos je Richtung. Die Grenzen stehen in `GRENZEN` (`plaetze: 8`, `autosJeRichtung: 30`, `autoText: 200`) und als CHECKs im Schema.
  - **Ein Auto trägt eine `clientId`** (je Verein eindeutig; Plan zu Etappe 4, Entscheidung 1), damit `POST /fahrten/:modulId/autos` eine Wiederholung erkennt (8). Ohne sie bekäme die wiederholte Anfrage 409 `AUTO_SCHON_DA`, weil das Auto aus der ersten schon steht.
- `Mitfahrt (id, vereinId, modulId, richtung, kindId, autoId?, vonId, eingetragenAm, clientId)`, eindeutig je `(modulId, richtung, kindId)`. **`autoId = null` heißt „kommt selbst“.** Ein zusammengesetzter Fremdschlüssel sichert, dass Auto, Modul und Richtung zusammenpassen.

Ohne „kommt selbst“ stünde jedes Kind, das die Familie selbst bringt, für immer unter „Braucht noch Mitfahrt“.

**Autos und Mitfahrten hängen mit `NoAction` an Modul, Auto und Personen** (wie Helfer-Einträge, 5.1): Sie sperren das Löschen von Modul und Thread (`loeschZaehler`, 8). Das Zurückziehen eines Autos löscht seine Mitfahrten ausdrücklich in der Route, nie per Kaskade, damit der Systemeintrag (6.2) entsteht. Verworfen: Kaskade vom Auto auf die Mitfahrten, die die Kinder still mitnähme.

**Eine Mitfahrt ist ein Upsert je `(modulId, richtung, kindId)`** (Plan zu Etappe 4, Entscheidung 5). Wechselt `autoId`, werden `autoId`, `vonId`, `clientId` und `eingetragenAm` (= jetzt) überschrieben; die Reihenfolge im Auto ist die des Einsteigens. Bleibt `autoId` gleich, antwortet die Route 200 und schreibt nichts.

### 6.2 Regeln

„Leitung“ heißt hier: darf den Thread bearbeiten (`darfBearbeiten`), wie bei der Helferliste.

- **Wer betrachtet wird** (`betrachteteKinder`): die Jungfischer der Zielgruppe, bei einer Teilnahme-Umfrage nur die mit „Dabei“ (Rahmen 6.4.1).
  - **Die Fahrgemeinschaft ist in jedem Rollenfilter erlaubt** (Plan zu Etappe 4, Entscheidung 14; vom Eigentümer noch zu bestätigen). Die Spezifikation schränkt nur Kosten ein. In einem Thread ohne Jungfischer bleibt „Braucht noch Mitfahrt“ leer.
- **Auto anbieten**: Erwachsene, die den Thread sehen, je Richtung eines (409 `AUTO_SCHON_DA`) und höchstens 30 je Richtung (409 `VOLL`). Der Fahrer ändert sein Auto; die Plätze nicht unter die Zahl der Mitfahrer (409 `PLAETZE`).
  - **Ein Auto bietet jede Person nur für sich selbst an** (Plan zu Etappe 4, Entscheidung 8), auch die Leitung. Verworfen: Autos im Namen anderer, denn wer fährt, soll das selbst zusagen.
  - **Vorbelegung des Abfahrtstags** (Plan zu Etappe 4, Entscheidung 15): Die Ansicht liefert je Richtung `vorschlagTag`, hin den Starttag, rück den letzten Tag (`letzterTag`) des ersten Termins in Modulreihenfolge, ohne Termin `null`. Nur der Tag, keine Uhrzeit.
- **Kind einsetzen** (in ein Auto oder auf „kommt selbst“): Das Kind gehört zum Thread, und die Person ist das Kind selbst oder darf für es handeln (`darfFuerKindHandeln`: sie ist ihm zugeordnet). Die Leitung darf immer.
  - **Nicht `darfAntworten`**: Das hängt an `gefragte`, und die ist bei „Nur Familie“ für Kinder leer. Dort dürfte sonst nur die Leitung einsetzen, obwohl die Fahrgemeinschaft in jedem Rollenfilter erlaubt ist.
  - **Eingesetzt werden nur betrachtete Kinder** (Plan zu Etappe 4, Entscheidung 7): sonst 409 `NICHT_DABEI`, für Autos und für „kommt selbst“, auch für die Leitung; ein „Vielleicht“ reserviert keinen Platz. Erst kommt das Recht: Wer ein Kind nicht einsetzen darf, bekommt 404 und erfährt nicht, ob es zugesagt hat. Ein Kind, das nicht zum Thread gehört, und eine erwachsene Person sind für alle 404, auch für die Leitung.
  - Freie Plätze prüft der Server unter der Vereinssperre (409 `VOLL`). Wer schon im Auto sitzt, darf bleiben, auch im vollen Auto.
  - **`fahrtAnsicht.kinder` sind die betrachteten Kinder, für die die Person das Einsetzen selbst darf.** Für die Leitung sind das nur ihre eigenen; andere Kinder setzt sie über „Umsetzen“ (6.3). Verworfen: alle Kinder als Knöpfe der Leitung, dann stünde am Handy jedes Kind des Vereins neben ihrem.
- **Kind herausnehmen**: die Leitung, der Fahrer aus seinem eigenen Auto und wer für das Kind handeln darf. **Herausnehmen geht immer**, auch für ein Kind, das nicht mehr betrachtet wird oder inzwischen aus der Zielgruppe gefallen ist; sonst bliebe ein Platz belegt, den niemand mehr freigeben dürfte.
- **Leitung**: verschiebt jedes betrachtete Kind („Umsetzen“ in ein Auto mit freiem Platz oder auf „kommt selbst“), ändert Plätze und löscht Autos.
  - **Die Umsetzen-Ziele rechnet die Ansicht je Kind mit den Regeln des Servers** (`umsetzenZiele`, Feld `umsetzen` an jedem Kind der Ansicht): ein Auto der Richtung, wenn `darfEinsetzen` erlaubt und Platz ist (ohne das, in dem das Kind sitzt), „kommt selbst“, wenn `darfEinsetzen` erlaubt und das Kind nicht schon dort steht; beides schickt der Client als `PUT`. Ohne Ziel kein Knopf. Ein Kind ohne Zusage, ein Thread im Entwurf und ein Kind außerhalb der Zielgruppe haben darum kein Umsetzen, Herausnehmen bleibt. Verworfen: Umsetzen an der Rolle allein — der Knopf stand dann an Kindern, für die der Server jedes Ziel ablehnte.
- **Auto zurückziehen** (Fahrer oder Leitung): erlaubt, auch mit Kindern darin; deren Mitfahrten werden gelöscht, sie stehen wieder unter „Braucht noch Mitfahrt“. Der Verlauf bekommt den Systemeintrag `AUTO_ZURUECKGEZOGEN`: „Auto von Sandra M. (Hinfahrt) zurückgezogen – Lena M. und Max M. brauchen wieder eine Mitfahrt.“, bei einem Kind „braucht wieder eine Mitfahrt.“ Ab Teilprojekt 5 folgt ein Push.
  - **Der Systemeintrag entsteht nur, wenn Kinder im Auto saßen** (Plan zu Etappe 4, Entscheidung 4). Er speichert `{ fahrerId, richtung, kindIds }` (Kinder in der Reihenfolge des Einsteigens); die Namen entstehen beim Lesen wie bei allen Systemsätzen (`verlauf.ts`), `systemSatz` bekommt dafür das `Umfeld` als vierten Parameter. Unbekannte Personen heißen „ehemaliges Mitglied“. Verworfen: die Namen zu speichern, denn dann stünde ein später entferntes Kind weiter mit Namen im Verlauf.
  - **Der Fahrer steht mit Kurznamen** („Sandra M.“), nicht mit `absenderName`: Dessen Klammer („Mutter von …“) stünde neben der Klammer mit der Richtung.
- **Abgesagt, aber im Auto**: Ein Kind, das nicht mehr betrachtet wird (Absage, Zielgruppe geändert), bleibt im Auto und belegt den Platz; Karte und Leitung zeigen es mit „nicht mehr dabei“. Verworfen: automatisch herausnehmen — eine versehentliche Absage kostete den Platz.
- **Archiv**: nur die Leitung ändert noch. Die Fahrgemeinschaft hat keine Frist; 410 gibt es hier nicht.
- Die Fahrgemeinschaft zählt **nicht** zu „Braucht deine Antwort“. Verworfen: jedes Kind ohne Mitfahrt als offene Aufgabe — Familien, die selbst fahren, müssten erst „kommt selbst“ tippen, damit die Meldung verschwindet.
- **„Neu“** (Plan zu Etappe 4, Entscheidung 11): Alle Leser sehen die Fahrgemeinschaft. Deshalb ist `antwortenSichtbar` mit Fahrgemeinschaft für Nicht-Entfernte immer `true`, wie bei der Helferliste.
- **Editor** (Plan zu Etappe 4, Entscheidung 10; `fahrtSperre`, `pruefeFahrtAenderung`): Ohne Richtung meldet er „Bitte mindestens eine Richtung.“
  - Eine Richtung mit Autos oder Mitfahrten (auch „kommt selbst“) lässt sich nicht abschalten: 409 `FAHRT_BELEGT` „Für die Hinfahrt gibt es schon Autos oder Mitfahrten.“ bzw. „Für die Rückfahrt …“. Der Editor sperrt das Kästchen vorher mit dem Satz „Hat schon Autos oder Mitfahrten.“ daneben. Verworfen: die Einträge dabei still zu löschen, denn dann stünde eine Familie ohne Nachricht nicht mehr in ihrem Auto.
  - Eine Fahrgemeinschaft mit Autos oder Mitfahrten lässt sich nicht entfernen: 409 `FAHRT_BELEGT` „Die Fahrgemeinschaft hat schon Einträge und lässt sich nicht entfernen.“
  - Die Codes `DOPPELTE_FAHRT` und `FAHRT_BELEGT` sind eigene, nicht `DOPPELTE_TEILNAHME` und `BEANTWORTET` der Umfrage: Die Domain markiert diese Konflikte (`Feldfehler.fahrt`). Der Client verzweigt auf keinen davon.
- **Antworten-Übersicht** (Plan zu Etappe 4, Entscheidung 17): Sie zeigt die Fahrgemeinschaft als `jf-fahrt-modul` mit der Ansicht der Leitung (`AntwortenUebersicht.fahrt`). Verworfen: eine eigene Tabelle; Umsetzen braucht dieselben Bedienelemente wie auf der Thread-Seite.

### 6.3 Anzeige

Umschalter „Hin“/„Rück“ (nur bei beiden Richtungen), darunter die Richtung als Überschrift („Hinfahrt“, „Rückfahrt“). Je Auto eine Karte: Fahrer (`absenderName`, TP3 3.10), Abfahrt (`tagKurz(abfahrtTag)` und Zeit, wie vorhanden), Ort, Notiz, „2 frei“ bzw. „voll“, Mitfahrer („Lena M., Max M.“), ein nicht betrachtetes Kind mit dem Zusatz „nicht mehr dabei“. Darunter „Braucht noch Mitfahrt“ (leer: „Alle haben eine Mitfahrt.“) und „Kommt selbst“. Alle Leser sehen alles davon. **Keine Telefonnummern**; abgestimmt wird im Verlauf (Rahmen 6.4.1).

Kinder erscheinen als „Lena M.“ nach TP3 3.10, nicht nur mit Vornamen wie in Rahmen 6.4.1: Zwei Lenas wären sonst nicht zu unterscheiden.

**Reihenfolge** (Plan zu Etappe 4, Entscheidung 16): Autos nach `angelegtAm`, dann `id`; Mitfahrer nach `eingetragenAm`; „Braucht noch Mitfahrt“ und „Kommt selbst“ nach Kurzname (`localeCompare` mit `'de'`).

- **Knöpfe**: „Auto anbieten“, „Auto ändern“, „Auto zurückziehen“, am Auto „Einsteigen“ (für Kinder „Lena einsteigen“), „Kommt selbst“ (für Kinder „Lena kommt selbst“), „Herausnehmen“, für die Leitung „Umsetzen“ (Auswahl aus den Zielen der Ansicht, 6.2). „Einsteigen“ steht an jedem Auto gleich; der zugängliche Name nennt den Fahrer wie die Karte und beginnt mit dem sichtbaren Text („Lena einsteigen bei Sandra M. (Mutter von Lena)“, WCAG 2.5.3).
- **Formular „Auto anbieten“**: „Plätze für Kinder“ (1–8), „Abfahrt am“, „Uhrzeit“, „Treffpunkt“ (Feld `ort`), „Notiz (optional)“, Knöpfe „Anbieten“ bzw. „Speichern“ und „Abbrechen“.
- **Rückfrage beim Zurückziehen mit Kindern** (`jf-bestaetigung`): „Lena M. und Max M. brauchen dann wieder eine Mitfahrt.“ Ohne Kinder zieht der Knopf das Auto ohne Rückfrage zurück.

Regeln in `libs/domain/src/module/fahrt/fahrt.ts`: `fahrtAnsicht(ich, modul, daten, umfeld, jetzt)` (`ich` die betrachtende Person, `daten` die `ThreadDaten` mit Kopf, Terminen und Umfragen), `brauchtMitfahrt(fahrt, richtung, betrachtete)`, `betrachteteKinder`, die Rechte `darfAnbieten`, `darfAutoAendern`, `darfEinsetzen`, `darfHerausnehmen`, `umsetzenZiele`, dazu `pruefeAuto`, `fahrtSperre` und `pruefeFahrtAenderung`.

---

## 7. Kosten

### 7.1 Datenmodell

- `KostenModul (id, threadId, betragCent, hinweis?, empfaenger?, iban?, paypal?)`: Betrag 0–100 000 Cent; Hinweis höchstens 500 Zeichen; Empfänger höchstens 100; IBAN mit Prüfziffer (`pruefeIban` in `libs/domain`), gespeichert ohne Leerzeichen; PayPal nur als `https://`-Link, höchstens 200 Zeichen. Höchstens ein Kosten-Modul je Thread (Partial-Unique-Index).
- `KostenPosten (id, vereinId, modulId, kindId, betragCent?, status, gemeldetVonId?, gemeldetAm?, bestaetigtVonId?, bestaetigtAm?, clientId)`, eindeutig je `(modulId, kindId)`; `status` `OFFEN`, `GEMELDET`, `BEZAHLT`.

Eine Zeile entsteht erst, wenn etwas vom Normalfall abweicht; ohne Zeile gilt „offen zum Modulbetrag“. **Ein Ausnahmebetrag von 0 heißt „befreit“.**

Der Editor belegt Empfänger, IBAN und PayPal mit denen des zuletzt angelegten Kosten-Moduls im Verein vor. Verworfen: Bankdaten als Vereinseinstellung — je Veranstaltung kann das Konto ein anderes sein (Vereinskasse, Jugendkonto); die Vorbelegung spart das Abtippen trotzdem.

### 7.2 Regeln

- **Nur in Familien-Threads**: Ein Kosten-Modul ist nur bei Rollenfilter „Jungfischer + Familie“ oder „Nur Familie“ erlaubt; sonst Fehler im Editor (auch beim späteren Ändern der Zielgruppe). In den anderen Filtern gibt es keine Familie, die zahlt.
- **Zahlungspflichtig**: bei einer Teilnahme-Umfrage die Kinder mit „Dabei“, sonst alle Jungfischer der Zielgruppe (Rahmen 6.4.2); Befreite nie.
- **„Habe bezahlt“** (offen → gemeldet) und Zurücknehmen (gemeldet → offen): Bezugspersonen, die für das Kind antworten dürfen; nicht nach „bezahlt“. Jungfischer melden nicht selbst.
- **Leitung** (Thread bearbeiten): bestätigen (→ bezahlt), Status direkt setzen (Barzahlung), zurücksetzen, Ausnahmebetrag setzen oder entfernen.
- **Liste aller Kinder**: wer den Thread bearbeiten darf oder „Antworten im Detail“ hat (Rahmen 6.4.2). Bezugspersonen sehen nur ihre eigenen Kinder; andere Leser sehen nur Betrag und Bezahlhinweise.
- **Nicht mehr zahlungspflichtig, aber bezahlt** (Absage nach Zahlung): Die Leitung sieht „bezahlt, nicht mehr dabei“; erstattet wird außerhalb der App.
- **Betrag ändern** mit gemeldeten oder bezahlten Posten: Der Editor warnt; bestehende Stände bleiben.
- **„Braucht deine Antwort“**: „Lena: Zeltlager 45 € offen“, solange das Kind zahlungspflichtig ist, der Betrag über 0 liegt und der Status „offen“ ist (Rahmen 5.2). Der Eintrag gilt der Bezugsperson, nicht dem Kind.

### 7.3 Anzeige

- **Familie**: je eigenem Kind Betrag, Status-Pille und „Habe bezahlt“; Verwendungszweck mit Kopier-Knopf; Empfänger und IBAN mit Kopier-Knopf; PayPal-Link; Hinweis.
- **Verwendungszweck** (`verwendungszweck(thread, termin, kind)`): Thread-Titel **ohne Emojis**, Datum des ersten Termins als `TT.MM.` (ohne Termin entfällt es), „–“, Vor- und Nachname des Kindes; höchstens 140 Zeichen (SEPA), gekürzt wird der Titel. Beispiel „Zeltlager 23.10. – Lena Müller“. Voller Nachname, weil die Bank ihn braucht; er erscheint nur bei den eigenen Kindern.
- **Leitung**: „12/18 bezahlt · 3 gemeldet“, aufklappbar mit Liste, Bestätigen, Ausnahmebetrag; die Antworten-Übersicht der Verwaltung zeigt dasselbe.

---

## 8. Gemeinsame Regeln der Antwort-Module

Helfer-Einträge, Autos, Mitfahrten und Kostenposten heißen hier **Eintragungen**.

- **Löschen**: Eintragungen zählen wie Antworten (TP3 3.6, 3.14): Ein Modul oder Thread mit Eintragungen lässt sich nicht löschen; die Fremdschlüssel sind `NoAction`, `loeschZaehler` zählt Helfer-Einträge, Autos und Mitfahrten. Ausnahme: Autos lassen sich zurückziehen (6.2); die Route löscht dabei die Mitfahrten des Autos ausdrücklich, nie per Kaskade.
- **Entwurf**: keine Eintragungen (TP3 3.6).
- **Archiv**: nur noch Leitung (TP3 3.7).
- **Wiederholbarkeit**: Jede Eintragungs-Route nimmt eine `clientId` (je Verein eindeutig) wie die Umfrage-Antwort (TP3 2.3).
  - **Ausnahme Austragen**: `DELETE /helfer/:positionId/eintraege/:fuerId` nimmt keine `clientId` und ist idempotent (Plan zu Etappe 3, Entscheidung 4). Ein fehlender Eintrag ergibt 200 mit der frischen Ansicht und schreibt nichts. Nach dem Löschen gibt es keine Zeile mehr, an der eine `clientId` hängen könnte; die Wiederholung erkennt der Server am fehlenden Eintrag. Verworfen: eine eigene Tabelle für gelöschte `clientId`s.
  - **Ausnahme Herausnehmen**: `DELETE /fahrten/:modulId/:richtung/:kindId` nimmt ebenso keine `clientId` und ist idempotent (Plan zu Etappe 4, Entscheidung 6): ohne Mitfahrt 200 mit frischer Ansicht, ohne Schreiben. Zwei Fälle weichen ab (9.1).
  - **Auto anbieten** (`POST /fahrten/:modulId/autos`) nimmt eine `clientId` (6.1). **`PUT /autos/:id` nimmt keine** (Plan zu Etappe 4, Entscheidung 2): Es setzt Werte, eine Wiederholung setzt dieselben. Ändert sich nichts, antwortet die Route 200 und schreibt nichts.
  - **`DELETE /autos/:id` eines unbekannten Autos ergibt 404** (Plan zu Etappe 4, Entscheidung 3): Nach dem Löschen gibt es keine Zeile mehr, die ein wiederholtes Zurückziehen von einem fremden Auto unterschiede. Der Client behandelt 404 wie bei der Helferliste: Satz am Modul und still neu laden.
  - **Einsetzen** (`PUT /fahrten/:modulId/:richtung/:kindId`) ist ein Upsert (6.1): Bleibt das Auto dasselbe, antwortet die Route 200 und schreibt nichts.
- **Schreibpfad** wie TP3 4.2: Form (400), Ort des Moduls, Sichtbarkeit und Recht (404), Wiederholung über `clientId`, Entwurf/Frist/Archiv (409/410), dann `mitAenderung` mit Neuprüfung unter der Sperre, nach dem Commit `deps.bus`, Antwort mit frischer Ansicht des Moduls. Vor allem steht das Ratenfenster (`antwortenFenster`, 9.2). Bei der Fahrgemeinschaft sind die 409er `ENTWURF`, `ARCHIVIERT`, `NICHT_DABEI`, `VOLL`, `AUTO_SCHON_DA` und `PLAETZE` (9.3).
- **Änderungsart**: Eintragungen schreiben `ANTWORT` mit `objektId` = Modul-ID (Plan zu Etappe 3, Entscheidung 6); Autos und Mitfahrten ebenso (Plan zu Etappe 4, Entscheidung 12). Das Zurückziehen eines Autos mit Kindern schreibt zusätzlich `VERLAUF` mit der ID des Systemeintrags. Die Umfrage schreibt dort weiter die ID der Antwort. Ansichten werden je Person neu berechnet; kein Zahlstand erreicht Fremde.
- **„Neu“**: Eintragungen zählen wie Antworten (TP3 3.9).
- **Gefragte und Antwortrecht** nutzen die vorhandene Logik aus `threads/antworten.ts` (`gefragte`, `antwortZeilen`, `darfAntworten`); sie ist dafür von `UmfrageDaten` gelöst und nimmt den schmalen Typ `AntwortRegel` (`einheit`, `frist`). Umfrage und Helferliste fragen so dieselbe Logik.

---

## 9. Server und API

### 9.1 Routen

Alle unter `/<slug>/api/v1`, mit `brauchtMitglied` und je einem Eintrag im Mandanten-Test (TP2 9). Wo eine Person etwas nicht sieht: 404.

| Methode und Pfad                                             | Zweck                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `POST /module/:modulId/fotos`                                | Foto hochladen (2.3, 4.2)                                             |
| `POST /module/:modulId/dateien`                              | Datei hochladen (Kopf `X-Dateiname`)                                  |
| `PUT /dateien/:id`                                           | Datei umbenennen (Datei-Modul, Leitung)                               |
| `DELETE /dateien/:id`                                        | Foto oder Datei löschen (2.7)                                         |
| `GET /dateien/:id`, `GET /dateien/:id/vorschau`              | ausliefern (2.5)                                                      |
| `GET /medien`                                                | Medienbereich (3.2)                                                   |
| `GET /dokumente`                                             | Kategorien und Dokumente                                              |
| `POST /dokumente?kategorie=`                                 | Dokument hochladen (Körper ist die Datei)                             |
| `PUT /dokumente/:id`, `PUT /dokumente/:id/datei`             | Titel, Kategorie, Position ändern; Datei ersetzen                     |
| `DELETE /dokumente/:id`                                      |                                                                       |
| `POST /dokument-kategorien`, `PUT …/:id`, `DELETE …/:id`     | Kategorien pflegen; `PUT /dokument-kategorien/reihenfolge` sortiert   |
| `PUT /helfer/:positionId/eintraege/:fuerId`, `DELETE` ebenso | eintragen (`{ notiz \| null, clientId }`), austragen (ohne Körper, 8) |
| `POST /fahrten/:modulId/autos`, `PUT /autos/:id`, `DELETE`   | Auto anbieten, ändern, zurückziehen                                   |
| `PUT /fahrten/:modulId/:richtung/:kindId`, `DELETE` ebenso   | Kind einsetzen (`{ autoId \| null, clientId }`), herausnehmen         |
| `PUT /kosten/:modulId/:kindId/meldung`                       | Familie: `{ gemeldet: boolean, clientId }`                            |
| `PUT /kosten/:modulId/:kindId`                               | Leitung: `{ status?, betragCent? \| null }`                           |
| vorhandene Einwilligungs-Route der Jungfischer               | nimmt `art` optional (`DSGVO_ART8` Vorgabe, `FOTOS`), 4.4             |
| `POST /ich/einwilligung`                                     | Foto-Einwilligung eines Volljährigen für sich selbst (4.4)            |
| Plattform-Admin                                              | Verbrauch je Verein in der Vereinsliste, Speichergrenze ändern        |

**`art` ist optional, Vorgabe `DSGVO_ART8`** (Plan zu Etappe 2, Entscheidung 7): So bleiben Client und Tests der DSGVO-Einwilligung unverändert.

**Die Helfer-Routen antworten mit `{ modul, stand }`** wie die Umfrage-Antwort: der frischen Ansicht der Helferliste für die anfragende Person und dem Stand der Änderung (Plan zu Etappe 3). Eine Notiz mit Steuer- oder Formatzeichen (`\p{Cc}`, `\p{Cf}`) oder über 80 Zeichen ergibt 400 am Feld `notiz`. Das Austragen ist idempotent (8).

**Die Fahrt-Routen antworten ebenso mit `{ modul, stand }`**, `modul` die `FahrtModulAnsicht` der anfragenden Person (Plan zu Etappe 4).

- **Körper**: `POST /fahrten/:modulId/autos` nimmt `{ richtung: 'HIN' | 'RUECK', plaetze, abfahrtTag, abfahrtZeit, ort, notiz, clientId }` (Tag, Zeit, Ort und Notiz jeweils `null` erlaubt); `PUT /autos/:id` dieselben Felder ohne `richtung` und `clientId`; `DELETE /autos/:id` und das Herausnehmen sind ohne Körper.
- **`:richtung` steht klein in der Adresse** (`hin`, `rueck`); jeder andere Wert ergibt 404.
- **Wiederholung des Herausnehmens** (8), zwei Abweichungen vom idempotenten 200:
  - **Ein zweites `DELETE` der Fahrerin für ein fremdes Kind ergibt 404**: Ohne Mitfahrt ist nicht mehr erkennbar, dass sie die Fahrerin war (wie beim Zurückziehen, 8). Der Client lädt dann still neu.
  - **`DELETE` ohne Mitfahrt im Archiv bleibt 409 `ARCHIVIERT`**: Der Schreibpfad prüft das Archiv vor der Wiederholung, anders als beim Austragen aus der Helferliste. Ein Wiederholen über die Archivgrenze ist selten; der Client lädt neu.

Module selbst (Typ, Titel, Felder, Positionen, Fahrtrichtungen, Foto-Schalter, Kostenbetrag und Bankdaten) laufen weiter über `POST /threads` und `PUT /threads/:id` (TP3 4.1); `ModulTyp` bekommt `HELFER`, `FAHRT`, `KOSTEN`, `DATEIEN`, `FOTOS`.

### 9.2 Grenzen

- Uploads: 60 je 10 Minuten je Person (Fensterzähler wie TP3 4.3); Foto 20 MB, Datei 25 MB; Kontingent 2.6.
- Eintragungen: wie Antworten, 60 je Minute je Person.
- Der globale JSON-Parser (100 KB) bleibt; Upload-Routen lesen den Körper selbst als Strom.

### 9.3 Fehler

Wie TP3 4.4. **Jeder Fehler der Dateien-Routen trägt neben dem Klartext ein Feld `code`**: `{ fehler: '<Text>', code: 'GROESSE' | 'KONTINGENT' | 'TYP' | 'HEIC' | 'BESCHAEFTIGT' | 'VOLL' }` (Plan zu Etappe 1, Entscheidung 2; `BESCHAEFTIGT` und `VOLL` mit Etappe 2). Die API antwortet sonst nur mit `{ fehler }`; verworfen: Codes statt Text — der Client zeigt den Text überall direkt an, und Tests und Skripte prüfen den Code. Zusätzlich: 411 ohne `Content-Length`; 413 mit `GROESSE` oder `KONTINGENT`; 415 `TYP` (mit Sonderfall HEIC); 503 `BESCHAEFTIGT` mit `Retry-After: 2` (Warteschlange voll, 2.4); 409 `VOLL` (Datei-Modul mit 20 Dateien, Foto-Modul mit 500 Fotos, Helfer-Position ohne freien Platz, Auto ohne freien Platz, Richtung mit 30 Autos). Fehlende Rechte beim Hochladen, Umbenennen und Löschen ergeben 404, nicht 403 (4.2; Plan zu Etappe 2, Entscheidung 5). Der Client zeigt je Code eine eigene Meldung; ein gescheitertes Foto bleibt mit „Nochmal“ in der Liste.

`GROESSE` und `TYP` haben je Art einen eigenen Text: „Das Foto ist zu groß (höchstens 20 MB)“ und „Die Datei ist zu groß (höchstens 25 MB)“, bei zu vielen Pixeln „Das Foto hat zu viele Pixel (höchstens 50 Megapixel)“; für Fotos „Diese Bildart geht nicht. Erlaubt sind JPEG, PNG und WebP.“ `VOLL` heißt „Hier passen höchstens 20 Dateien hinein“ bzw. „Hier passen höchstens 500 Fotos hinein“, an der Helfer-Position `{ fehler: 'Hier sind schon alle Plätze vergeben.', code: 'VOLL' }` (Etappe 3; eine Notiz ändern belegt keinen Platz und endet nie so), `BESCHAEFTIGT` „Gerade werden viele Fotos verarbeitet. Bitte gleich noch einmal versuchen.“

**Die Fahrgemeinschaft** (Etappe 4) antwortet bei Konflikten mit 409 und diesen Körpern:

- `{ fehler: 'In diesem Auto ist kein Platz mehr frei.', code: 'VOLL' }` am Auto;
- `{ fehler: 'Für diese Fahrt gibt es schon 30 Autos.', code: 'VOLL' }` an der Richtung;
- `{ fehler: 'Du bietest für diese Fahrt schon ein Auto an.', code: 'AUTO_SCHON_DA' }`;
- `{ fehler: 'Es fahren schon <n> Kinder mit.', code: 'PLAETZE' }`, bei einem Kind `Es fährt schon 1 Kind mit.` (Plätze unter die Zahl der Mitfahrer);
- `{ fehler: 'Mitfahren kann nur, wer zugesagt hat.', code: 'NICHT_DABEI' }` (6.2).

Eine ungültige Eingabe ergibt 400 `{ fehler: 'Ungültige Anfrage', feld }` (`ungueltigesFeld`) mit `feld` aus `plaetze`, `abfahrtTag`, `abfahrtZeit`, `ort`, `notiz`, `richtung` (`POST /fahrten/:modulId/autos` ohne gültige Richtung im Körper), `autoId` und `clientId`. Ort und Notiz mit Steuer- oder Formatzeichen (`\p{Cc}`, `\p{Cf}`) sind ungültig.

---

## 10. Oberflächen

- **Leiste**: fünf Einträge (3.2); gemessen bei 375 px ohne Umbruch und ohne Überlauf.
- **Thread-Seite**: je Modultyp eine Komponente wie in TP3 6.3; Foto-Großansicht als Overlay (Escape, Wischen, Pfeiltasten).
- **Editor**: neue Modultypen in „Modul hinzufügen“; Felder je Typ; Upload in gespeicherten Datei- und Foto-Modulen (4.3); Vorschau zeigt die neuen Module. `editor.ts` und `modul-felder.ts` sind schon groß (TP3-Rückstand): Die Felder der neuen Typen entstehen in eigenen Komponenten statt in `modul-felder.ts`.
- **Verwaltung › Dokumente**: Kategorien und Dokumente pflegen (3.1).
- **Verwaltung › Einstellungen**: Speicherverbrauch (2.6).
- **Antworten-Übersicht**: Helferliste, Fahrgemeinschaft (Ansicht der Leitung mit Einsetzen, Herausnehmen und Umsetzen wie auf der Thread-Seite, 6.2), Kosten.
- **Meine Jungfischer**: Foto-Einwilligung (4.4).
- Gemessen wie TP3 6.7: 375 × 812 und 1280 × 800, hell und dunkel.

---

## 11. Teilen

Der Teilen-Text (TP3 7.1) bekommt Zeilen, jeweils nur mit dem, was der Teilende sehen darf:

- Fahrgemeinschaft, je Richtung: „🚗 Hin: Sandra M. (3 Plätze, 1 frei), Thomas K. (2)“ und, falls jemand fehlt, „🚗 Braucht noch Mitfahrt (hin): Mia S.“.
- Helferliste: „🙋 Kuchen 1/4 · Zeltaufbau 0/3“, nur Zahlen.
- Kosten: „💶 45 € pro Kind“, **ohne Zahlstände und Namen** — eine WhatsApp-Gruppe ist zu breit dafür.
- Fotos und Dateien: keine Zeile (Rahmen 6.7: Fotos nie öffentlich teilbar).

---

## 12. Datenschutz und Betrieb

### 12.1 Datenauszug

Zusätzlich zu TP3 9.1: eigene Helfer-Einträge, eigene Autos, Mitfahrten der eigenen Person und der eigenen Kinder, Kostenposten der eigenen Kinder, Foto-Einwilligungen, Metadaten der selbst hochgeladenen Fotos und Dateien (ohne Bytes; die bleiben in der App erreichbar).

### 12.2 Entfernen einer Person

Wie Rahmen 8.4: Helfer-Einträge, Kostenposten und hochgeladene Fotos und Dateien bleiben, als „ehemaliges Mitglied“. **Autos und Mitfahrten der entfernten Person werden gelöscht**: Sie fährt nicht mehr und fährt nicht mehr mit. Für gelöschte Autos mit Kindern entsteht der Systemeintrag aus 6.2.

**Das Löschen kommt mit Etappe 6** (Plan zu Etappe 4, Entscheidung 13; vom Eigentümer noch zu bestätigen), wie das Entfernen aus 1.4. Bis dahin bleibt das Auto einer entfernten Person stehen; Fahrer und Kinder heißen „ehemaliges Mitglied“, und die Leitung kann das Auto löschen.

### 12.3 Datenschutzerklärung

Ergänzt um: Fotos (verkleinert, ohne EXIF und GPS, im Volume gespeichert, Bytes gelöschter Fotos nach 24 Stunden entfernt, in der Sicherung bis zu deren Aufbewahrungsende), Dateien und Dokumente, Zahlstände, Bankdaten des Vereins (können Daten eines Kassiers sein), Foto-Einwilligung, Fahrgemeinschaft (Namen der Mitfahrer für alle Leser).

### 12.4 Betrieb

- Volume `jufi-dateien` in `deploy/jufi-services.yml`, im Image ein Verzeichnis mit Besitzer `node`; `DATEIEN_PFAD` in der Umgebung.
- `tools/backup.sh` sichert nach dem Dump das Volume mit restic (Tag `jufi-dateien`, ohne `tmp/`); `restore-test.sh --dateien` stellt eine Stichprobe von bis zu 20 Dateien wieder her und prüft sie gegen `sha256`. Das Volume heißt fest `jufi-dateien` (`name:` in der Compose-Datei), damit `backup.sh` es ohne den Projektnamen findet.
- `tools/pruefe-betrieb.sh` bekommt einen Abschnitt „Dateien“ (`--slug`), **ohne Sitzung** (Entscheidung 7): `GET /<slug>/api/v1/dateien/x` und `GET /<slug>/api/v1/dokumente` ergeben je 401. Ein 404 für eine unbekannte ID gibt es erst mit Sitzung; das Skript hat bewusst keine Anmeldung.
- CLAUDE.md: Stolpersteine zu Volume und Löschliste. Die Speicher-Abnahme unter `mem_limit` (2.4) gehört zu Etappe 2.

---

## 13. Tests und Demo

### 13.1 Regeln

Testgetrieben in `libs/domain`: `erkenneTyp`, `ohneFotoEinwilligung`, Helfer-Plätze, `fahrtAnsicht`, `brauchtMitfahrt`, Zahlungspflicht, `verwendungszweck`, `pruefeIban`, „Braucht deine Antwort“ mit Kosten, Editor-Prüfungen der neuen Module, Teilen-Zeilen.

### 13.2 Server

Gegen die Testdatenbank: zwei gleichzeitige Einträge auf den letzten Platz (genau einer gewinnt), 411/413/415/503, Kontingent (auch zwei gleichzeitige Uploads an der Grenze), 404 bei fremdem Verein und unsichtbarem Thread, `Content-Security-Policy: sandbox` und `nosniff` an Dateien, Fotos ohne EXIF/GPS (Testbild mit GPS-Daten), Löschliste und Aufräumer (Bytes erst nach 24 Stunden weg), Entfernen einer Person mit Auto.

### 13.3 Ende-zu-Ende

Das Zeltlager-Szenario (1.1) mit erzeugten Testbildern; dazu die Leiste mit fünf Einträgen im Layout-Test.

**Bis dahin spielt der Ablauf Schritt 4 verkleinert auf Bowling** (Etappe 4): Die Leitung fügt im Editor eine Fahrgemeinschaft nur für die Hinfahrt hinzu; die Mutter bietet ein Auto an (2 Plätze, Vereinsheim, 15:30) und setzt ihr Kind hinein, das Kind sieht sich ohne Neuladen darin; die Leitung setzt ein zweites Kind aus „Braucht noch Mitfahrt“ dazu, die Mutter sieht das volle Auto ohne Neuladen; die Mutter zieht das Auto zurück, beide Kinder stehen wieder unter „Braucht noch Mitfahrt“, und der Verlauf nennt es.

### 13.4 Demo

`pnpm run demo` baut das Zeltlager mit allen Modulen auf: erzeugte Fotos, zwei Dateien, Helfer-Einträge, zwei Autos, Kostenposten in allen drei Zuständen und eine Befreiung; Tim ohne Foto-Einwilligung; Dokumente in den drei Kategorien.

**Bis dahin hat Bowling eine Helferliste** (Plan zu Etappe 3, Entscheidung 14), damit es zur lokalen Abnahme von Etappe 3 etwas gibt: als letztes Modul „Mitbringen und fahren“, pro Erwachsener, Frist fünf Tage nach dem Einspielen um 18:00, Positionen „Fahrer“ (2) und „Snacks“ (3); Sandra ist bei „Snacks“ eingetragen, mit der Notiz „Gemüsesticks“. Das Zeltlager mit allen Modulen bleibt in Etappe 6.

**Dazu bekommt Bowling eine Fahrgemeinschaft** (Plan zu Etappe 4, Entscheidung 18), hin und rück, nach der Helferliste. Sandra bietet die Hinfahrt an (3 Plätze, Abfahrt am Tag des Termins um 13:00, vor dem Treffpunkt um 13:30; Treffpunkt der Fahrt Vereinsheim), Lena sitzt darin. Lena und Max haben in der Teilnahme-Umfrage zugesagt (für Max die Mutter); ohne Zusage zeigte die Karte Lena als „nicht mehr dabei“. Max hat keine Mitfahrt und steht unter „Braucht noch Mitfahrt“.

**Demo-Fotos kommen mit Etappe 6** (Plan zu Etappe 2, Entscheidung 15). Für die lokale Abnahme von Etappe 2 erzeugt `node tools/erzeuge-testbilder.mjs <verzeichnis> --bunt <n>` bunte Testbilder aus Kreisen und Rechtecken (1600 × 1200, mit Nummer); dasselbe Skript erzeugt die acht Bilder der Fotoprobe (2.4).

---

## 14. Abweichungen von der Rahmen-Spezifikation

Die Rahmen-Spezifikation ist an diesen Stellen nachgezogen:

| Stelle           | Rahmen bisher                             | Jetzt                                                                                              |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 6.4 Fotos        | Hochladen durch alle Leser                | je Modul schaltbar, Vorgabe „Nur Jugendleiter“ (4.2)                                               |
| 6.4.1 Namen      | Kinder nur mit Vornamen                   | „Lena M.“ nach TP3 3.10 (6.3); dazu „kommt selbst“ (6.1)                                           |
| 6.4.2 Kosten     | Betrag pro Kind                           | Ausnahmebetrag je Kind, 0 heißt befreit; nur in Familien-Threads (7)                               |
| 6.6 Einwilligung | Warnhinweis für Jugendleiter              | zusätzlich Hinweis für alle, die im Modul hochladen dürfen (4.4)                                   |
| 7.7 Dateien      | Verkleinern, Vorschaubild, EXIF entfernen | 2560/480 px, Original verworfen, HEIC und SVG abgelehnt, Bytes nach 24 Stunden gelöscht (2.4, 2.7) |
| 15 Kategorien    | in TP4 zu klären                          | vom Verein pflegbar (3.1)                                                                          |
| neu              | —                                         | Speichergrenze je Verein (2.6), Medien als fünfter Eintrag der Leiste (3.2)                        |
