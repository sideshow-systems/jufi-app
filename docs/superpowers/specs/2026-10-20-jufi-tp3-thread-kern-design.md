# JuFi App — Teilprojekt 3: Thread-Kern

Stand: 20.10.2026 · Ergebnis des Brainstormings vom selben Tag · Status: zur Freigabe

Teilprojekt 3 bringt das, wofür die App gebaut wird: **Threads** mit Aushang und Verlauf, die Module **Info-Text, Termin und Umfrage**, das **Dashboard**, die **Thread-Liste**, den **Kalender**, den **Jugendsprecher-Austausch**, **Echtzeit** über Änderungszähler und WebSocket sowie **Teilen** mit Link-Vorschau (Rahmen-Spezifikation `2026-10-11-jufi-rahmen-design.md`, Abschnitt 11).

Die Rahmen-Spezifikation, die Spezifikation zu Familie, Jugendsprecher und Kalender (`2026-10-12-jufi-familie-jugendsprecher-kalender-design.md`) und die Fundament-Spezifikation (`2026-10-12-jufi-tp2-fundament-design.md`) gelten weiter. Diese Datei legt fest, was sie offen lassen oder worin sie sich widersprechen, und hält die Entscheidungen mit ihren verworfenen Alternativen fest. Wo sie abweicht, steht das in Abschnitt 11; die Rahmen-Spezifikation ist entsprechend nachgezogen.

Kürzel: **Rahmen** = Rahmen-Spezifikation, **FAM** = Familie/Jugendsprecher/Kalender, **TP2** = Fundament-Spezifikation, **Entwurf** = `apps/entwurf` (Wegwerfcode, Vorlage nur für Fachregeln).

---

## 1. Ausgangslage und Ziel

### 1.1 Ergebnis: das Bowling-Szenario

Die Rahmen-Spezifikation nennt als Ergebnis „Bowling-Szenario ohne Fahrgemeinschaft durchspielbar“, beschreibt es aber nicht. Hier ist es festgelegt; es ist zugleich der Ende-zu-Ende-Test (10.3).

1. **Thomas** (Leitung, Vater von Jonas) legt in der Verwaltung den Thread „🎳 Bowling“ an: Zielgruppe „Alle · Jungfischer + Familie“, Modus „Aushang + Kommentare“, Module Info-Text, Termin (Samstag 14:00–17:00, Bowlingcenter, Treffpunkt 13:30 am Vereinsheim) und Teilnahme-Umfrage „Kommst du mit?“ (pro Jungfischer, Frist Donnerstag, Ergebnisse für alle). Er speichert erst als Entwurf, prüft die Vorschau und veröffentlicht.
2. **Sandra** (Mutter von Lena, 13, mit Zugang, und Max, 10, ohne Zugang) öffnet die App. Start zeigt unter „Braucht deine Antwort“ „Lena: Bowling noch offen · bis Do“ und „Max: Bowling noch offen · bis Do“, unter „Als Nächstes“ den Termin und unter „Neu seit deinem letzten Besuch“ den Thread.
3. **Lena** sagt selbst zu. Bei Sandra verschwindet Lenas Zeile aus „Braucht deine Antwort“; im Thread steht bei Lena „Dabei“.
4. Sandra meldet **Max** an. Gespeichert wird „für Max, von Sandra“.
5. Thomas hat den Thread offen und sieht die Zusage von Max **ohne Neuladen**.
6. Sandra fragt im Verlauf „Wo genau ist der Treffpunkt?“, Thomas antwortet. Der Reiter „Verlauf“ zeigt bei den anderen einen Zähler.
7. Auf **Termine** steht das Bowling am Samstag; im Termin-Modul trägt Sandra es über „In Kalender eintragen“ in ihren Kalender ein.
8. Thomas trägt die telefonische Absage von Jonas’ Freund **Tim** nach („eingetragen von Thomas K.“).
9. Thomas **teilt den Stand** per WhatsApp. Der Link zeigt in WhatsApp den Thread-Titel und das Vereinslogo und führt nach der Anmeldung in den Thread.
10. Nach der Frist kann Sandra nicht mehr antworten; Thomas kann noch nachtragen.
11. Eine Woche nach dem Termin steht der Thread im **Archiv** und ist über die Suche zu finden.
12. Nebenher schreiben Lena (Jugendsprecherin) und die Jugendleiter im angepinnten **Jugendsprecher-Austausch**. Sandra sieht ihn nirgends; ein Link darauf ergibt „Nicht gefunden“.

### 1.2 Echte und erfundene Daten

Wie in TP2 1.2: Bis zum Pilotbetrieb (nach Teilprojekt 5) sind auf dem Testserver nur die drei Jugendleiter echt. Sie können nach Teilprojekt 3 echte Threads anlegen; Kinder und Familien bleiben erfunden. Geprüft wird im Browser ausschließlich mit erfundenen Daten.

### 1.3 Ansatz

Wie in TP2: **Regeln zuerst**. Jede fachliche Entscheidung ist eine reine Funktion in `libs/domain` mit `jetzt: Date` als Parameter, testgetrieben. Der Server ruft sie und entscheidet im Speicher (Muster `ladeUmfeld`, TP2 5.2); die Oberfläche blendet nur zusätzlich aus.

Die Regeln des Entwurfs (`apps/entwurf/src/app/regeln/`) sind Vorlage, werden aber nicht ungeprüft übernommen: Der Entwurf rechnet mit lokalen Zeitzeichenketten und einem eingefrorenen Bezugstag, kennt den Rollenfilter „Jugendleiter + Jugendsprecher“ nicht und spricht noch von „Eltern“ statt „Familie“ und „Bezugsperson“. Bauteile des Entwurfs werden neu gebaut (TP2 2.1).

### 1.4 Etappen

Jede Etappe ist für sich lauffähig, bekommt einen eigenen Plan und wird vom Eigentümer lokal abgenommen.

| #   | Etappe                      | Inhalt                                                                                                                                      | Abschnitte |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Regeln und Datenmodell      | Prisma-Modelle und Migration, Regeln in `libs/domain`, Jugendsprecher-Austausch beim Anlegen eines Vereins und per Migration für bestehende | 2, 3, 8    |
| 2   | Threads lesen und antworten | API und Thread-Seite (Übersicht, Verlauf), Module Info-Text, Termin, Umfrage, Antworten, Gelesen-Stand, „In Kalender eintragen“             | 4, 6.2–6.4 |
| 3   | Threads verwalten           | Editor mit Live-Vorschau, Entwurf und Veröffentlichen, Löschen, Archiv, Anpinnen, Antworten-Übersicht mit Nachtragen                        | 4, 6.6     |
| 4   | Start, Liste, Kalender      | Dashboard-Blöcke, Thread-Liste mit Suche und Archiv, Termine-Seite, untere Leiste                                                           | 6.1, 6.5   |
| 5   | Live                        | Bus, Sync, WebSocket mit Prüfung je Signal, Schließen bei ungültiger Sitzung, Client-Dienst `Echtzeit`                                      | 5          |
| 6   | Teilen und Abschluss        | Teilen-Text, Link-Vorschau, Demo mit Bowling, Ende-zu-Ende-Test, Datenauszug, Datenschutzerklärung, Doku                                    | 7, 9, 10   |

Nach Etappe 4 ist die App ohne Live-Aktualisierung benutzbar; Etappe 5 bringt die Echtzeit. Der Änderungszähler (2.6) entsteht trotzdem schon in Etappe 1 und wird ab Etappe 2 von jedem Schreibpfad gepflegt, damit Etappe 5 an den Thread-Routen nur noch die Meldung an den Bus (4.2 Schritt 3) ergänzen muss. Die TP2-Routen, die das Umfeld ändern, kommen erst mit Etappe 5 dazu (2.6).

### 1.5 Nicht in Teilprojekt 3

- **Teilprojekt 4**: Module Helfer- und Mitbringliste, Fahrgemeinschaft, Kosten, Dateien, Fotos; Medienbereich; globale Dokumente; Teilen-Zeilen für Fahrer und Kosten.
- **Teilprojekt 5**: Push (das Feld „Mitglieder benachrichtigen“ ist bis dahin sichtbar, aber gesperrt), E-Mail-Ersatz, Erinnerungen, Offline-Speicher und Outbox, Service Worker, Kalender-Abo.
- Bearbeiten eigener Nachrichten, Anhänge im Verlauf, Suche im Verlauf, Reaktionen.

---

## 2. Datenmodell

Alle Tabellen folgen TP2 3.1: Sie tragen `vereinId`, verweisen über zusammengesetzte Fremdschlüssel `(vereinId, id)` mit `onUpdate: NoAction` aufeinander und stehen in `VEREINS_MODELLE` (`libs/db`). Schlüssel sind `cuid()`.

### 2.1 Thread

| Feld                                          | Bedeutung                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `titel`                                       | 1–120 Zeichen                                                                                                  |
| `art`                                         | `NORMAL` oder `JUGENDSPRECHER_AUSTAUSCH`; ein Partial-Unique-Index erlaubt höchstens einen Austausch je Verein |
| `modus`                                       | `AUSHANG`, `KOMMENTARE`, `CHAT` (Rahmen 6.1)                                                                   |
| `rollenfilter`                                | `JUNGFISCHER_FAMILIE`, `NUR_FAMILIE`, `NUR_JUGENDLEITER`, `JUGENDLEITER_JUGENDSPRECHER` (Rahmen 6.2)           |
| `alleUntergruppen`                            | `true` = „Alle“; sonst gelten die Einträge in `ThreadUntergruppe`                                              |
| `angepinnt`                                   | oben in der Liste, nie automatisch archiviert                                                                  |
| `archivModus`                                 | `AUTOMATISCH` (Vorgabe), `ARCHIVIERT`, `AKTIV_HALTEN` (3.7)                                                    |
| `veroeffentlichtAm`                           | `null` = Entwurf (3.6)                                                                                         |
| `erstelltVonId`                               | Person; `null` nur beim Austausch, den das System anlegt                                                       |
| `letzteAktivitaetAm`, `letzteAktivitaetStand` | Zeitpunkt und Änderungsstand der letzten Aktivität (Sortierung der Liste, 3.9)                                 |
| `angelegtAm`, `geaendertAm`                   |                                                                                                                |
| `bearbeitetStand`                             | Änderungsstand des letzten `POST`/`PUT` des Editors; `PUT` schickt ihn als `version` mit (4.1)                 |

`ThreadUntergruppe (vereinId, threadId, untergruppeId)` hält die Auswahl. Wird eine Untergruppe gelöscht, fällt sie per Cascade aus der Auswahl. Bleibt bei `alleUntergruppen = false` keine übrig, sieht nur noch, wer Jugendleiter ist (3.1), und die Verwaltung zeigt am Thread „Keine Zielgruppe mehr“. Verworfen: das Löschen der Untergruppe verweigern, solange Threads sie nennen — eine aufgelöste Untergruppe würde sonst an alten, archivierten Threads hängen bleiben.

**`bearbeitetStand` verhindert verlorene Änderungen.** Der Editor lädt den Thread mit diesem Stand als `version`; `PUT` schickt ihn zurück, und ein anderer Wert ergibt 409 `VERALTET` (4.4). Verworfen: `geaendertAm` als Version — `mitAenderung` setzt bei jeder Antwort `letzteAktivitaet*` (4.2), `@updatedAt` zöge mit, und jede Antwort machte den offenen Editor veraltet. Verworfen: keine Prüfung — zwei Geräte desselben Jugendleiters überschrieben sich still.

### 2.2 Module

`ThreadModul (id, vereinId, threadId, typ, position, titel?)` mit `typ` `INFO`, `TERMIN`, `UMFRAGE`; Teilprojekt 4 ergänzt das Enum. Höchstens 20 Module je Thread, der Modultitel höchstens 80 Zeichen; `position` ist in der Datenbank **nicht** eindeutig, sortiert wird nach `(position, id)`. Verworfen: ein eindeutiger Index — Umsortieren in einer Transaktion verletzte ihn zeilenweise; die Reihenfolge prüft die Domäne (der Editor). Dasselbe gilt für die `position` der Optionen.

Je Typ eine eigene Tabelle mit derselben `id` (1:1, Cascade). Verworfen: ein JSON-Feld je Modul — Regeln wie „eine Antwort pro Kind“ sollen in der Datenbank abgesichert sein (Rahmen 7.3).

- **`InfoModul`**: `text` (Markdown-Teilmenge, 3.11), mindestens ein Zeichen, höchstens 10 000 Zeichen.
- **`TerminModul`**: `startDatum` und `endDatum?` als `@db.Date`; `beginn?` und `ende?` als Text `HH:MM`; `ort?`, `treffpunkt?` (je höchstens 200 Zeichen, per CHECK). Datum und Zeit sind **Wandzeit in Europe/Berlin** (FAM 3.1); der Verein hat kein Zeitzonenfeld, solange alle Vereine in Deutschland sind. CHECK-Constraints: `endDatum >= startDatum`; bei gleichem Tag (oder ohne Enddatum) und gesetzten `beginn` und `ende` gilt `ende > beginn`. Ein Ende ohne Beginn ist erlaubt („Fr 23.10. – So 25.10. 12:00“, im Entwurf „bis 12:00“). Verworfen: „`ende` nur mit `beginn`“ — es verböte diese Anzeige. Verworfen: Zeitpunkte (`timestamptz`) — ein ganztägiger Termin hat keinen Zeitpunkt, und die Anzeige rechnete bei jeder Zeitumstellung um.
- **`UmfrageModul`**: `frage`, `einheit` (`JUNGFISCHER`, `ERWACHSENER`, `PERSON`), `mehrfach`, `teilnahme`, `vielleicht`, `frist?` (Zeitpunkt; die Server-Uhr entscheidet, Rahmen 9.3), `ergebnisse` (`ALLE`, `SUMME`, `JUGENDLEITER`). Ein Partial-Unique-Index über `(threadId) WHERE teilnahme` erlaubt höchstens eine Teilnahme-Umfrage je Thread; dafür trägt `UmfrageModul` `threadId` mit.
- **`UmfrageOption`**: `umfrageId`, `text`, `position`, `schluessel`. Der Schlüssel bleibt beim Umbenennen und Umsortieren stabil, damit abgegebene Antworten an ihrer Option bleiben (Erkenntnis aus dem Entwurf). **Neue Optionen bekommen ihren Schlüssel vom Server** (`o` und acht Zeichen aus `[a-z0-9]`, Zufall aus `crypto`); bestehende behalten ihren. Verworfen: den Schlüssel aus dem Text ableiten — ein Umbenennen vor dem ersten Speichern ergäbe zwei Schreibweisen für dieselbe Option. Bei der Teilnahme-Umfrage sind Optionen und Schlüssel fest: `dabei`, `vielleicht` (nur mit `vielleicht = true`), `abgesagt`.

**Grenzen, die der Editor und `PUT`/`POST /threads` gemeinsam prüfen (Etappe 3).** Frage und Optionstext 1–200 Zeichen. Eine Umfrage ohne Teilnahme hat 2–20 Optionen mit verschiedenen Texten. Ein Datum muss ein Kalendertag sein (`2026-02-30` ist keins; verworfen: stilles Weiterrollen auf den 2. März). Eine Frist in der Vergangenheit ist erlaubt — nachgetragen wird auch nach einem Telefonat, und eine zu strenge Prüfung verböte genau das (3.3). Modultitel, Ort und Treffpunkt stehen auch als CHECKs in der Datenbank; verworfen: Grenzen nur im Client — die CHECKs halten auch, wenn ein Client sie umgeht.

### 2.3 Antworten

`UmfrageAntwort (id, vereinId, umfrageId, fuerId, vonId, abgegebenAm, clientId)` mit eindeutigem `(umfrageId, fuerId)`: Eine neue Antwort überschreibt die alte (Upsert), es gilt die zuletzt abgegebene (Rahmen 6.3). `clientId` ist je Verein eindeutig und macht die Anfrage wiederholbar (Teilprojekt 5 schickt aus der Outbox). Die gewählten Optionen stehen in `UmfrageAntwortOption (antwortId, optionId)`. Die Fremdschlüssel von der Antwort auf die Umfrage und von der gewählten Option auf die Option sind `NoAction`, nicht `Cascade`: Von Thread, Modul oder Umfrage führt kein Kaskadenweg zu den Antworten, jede Antwort — auch eine ohne gewählte Option — sperrt das Löschen der Umfrage, des Moduls und des Threads, und eine gewählte Option lässt sich nicht löschen (3.14). Antworten gehen so nie still verloren, unabhängig von der Reihenfolge, in der Postgres Kaskaden und Prüfungen abarbeitet.

Verworfen: jede Antwort als neue Zeile mit Historie — niemand braucht frühere Antworten, und „wer hat noch nicht geantwortet“ würde zur Gruppierung.

Fällt eine Person aus der Zielgruppe (Zielgruppe oder Untergruppe geändert), bleibt ihre Antwort gespeichert, wird aber weder gezählt noch angezeigt, solange sie nicht gefragt ist (3.2). Kommt sie zurück, ist die Antwort wieder da.

### 2.4 Verlauf

`VerlaufEintrag (id, vereinId, threadId, art, autorId?, text?, systemArt?, systemDaten?, stand, angelegtAm, geloeschtAm?, geloeschtVonId?, clientId?)`:

- `art`: `NACHRICHT` oder `SYSTEM`.
- Nachrichten: 1–2000 Zeichen Klartext; Links werden in der Anzeige erkannt.
- Systemeinträge (`systemArt`): `VEROEFFENTLICHT`, `TERMIN_GEAENDERT`, `FRIST_GEAENDERT`, `MODUS_GEAENDERT`. `systemDaten` ist ein kleines JSON mit den Angaben für den Satz („Thomas K. hat den Termin auf Sa 24.10. verschoben“), `autorId` die handelnde Person. Die Sätze entstehen **beim Lesen** aus `systemArt` und `systemDaten`, nicht beim Schreiben (die Zeile speichert nur die Tatsache). Verworfen: den fertigen Satz speichern — Namen und Zeitangaben stünden dann für immer so, wie sie beim Schreiben waren, und der Wortlaut ließe sich nie ändern.
- Die Formen von `systemDaten` legt Etappe 2 fest, Etappe 3 schreibt sie: `VEROEFFENTLICHT` `{}`; `TERMIN_GEAENDERT` `{ termin: TerminDaten }`; `FRIST_GEAENDERT` `{ frage: string; frist: string | null }` (ISO-Zeitpunkt; `null` = Frist aufgehoben); `MODUS_GEAENDERT` `{ modus: ThreadModus }`. Der Leser prüft die Daten feldweise: Was sich nicht lesen lässt, ergibt „… hat den Thread geändert“ statt eines Fehlers, denn ein kaputter Eintrag darf den Thread nicht unlesbar machen. Verworfen: unlesbare Daten als Fehler zu werfen — ein einziger beschädigter Eintrag sperrte den ganzen Verlauf. Eine Frist steht im Satz immer in der vollen Form „Do 22.10. 18:00“, weil der Satz stehen bleibt (6.3).
- **Wann Etappe 3 sie schreibt:** nur bei **veröffentlichten** Threads, und je `PUT` höchstens ein `MODUS_GEAENDERT`; je bestehendem Termin-Modul mit geändertem `startDatum`, `endDatum`, `beginn` oder `ende` ein `TERMIN_GEAENDERT` mit dem **vollständigen** neuen `TerminDaten` (alle Felder, `null` ausgeschrieben); je bestehender Umfrage mit geänderter Frist ein `FRIST_GEAENDERT`. Neue oder entfernte Module erzeugen keinen. Verworfen: Einträge im Entwurf — niemand außer den Jugendleitern sieht ihn, und nach dem Veröffentlichen stünde eine Liste von Änderungen vor dem ersten Satz.
- Löschen leert `text` und setzt `geloeschtAm`/`geloeschtVonId`; die Zeile bleibt („Nachricht gelöscht“ bzw. „Von einem Jugendleiter entfernt“). Die Änderung hat die Art `VERLAUF` und zählt damit als Aktivität des Threads. Verworfen: `GELOESCHT` — diese Art bedeutet „Objekt weg“ (2.6, 4.2), die Zeile bleibt aber stehen.
- `stand` ist der Änderungsstand beim Anlegen (2.6) und trägt Zähler und „Neu“ (3.9).

### 2.5 Gelesen-Stand

`GelesenStand (vereinId, personId, threadId, gelesenBis, verlaufGelesenBis, gelesenAm)`, eindeutig je Person und Thread. `gelesenBis` ist der Änderungsstand, bis zu dem die Person den Thread gesehen hat (gleich welcher Reiter); `verlaufGelesenBis` der Stand, bis zu dem sie den Verlauf gesehen hat. Getrennt, damit der Zähler am Reiter „Verlauf“ nicht verschwindet, nur weil jemand die Übersicht geöffnet hat. Verworfen: Lesestand im Browser — auf jedem Gerät wäre alles wieder neu, und nach dem Abmelden ginge er verloren.

Die Zeile entsteht beim ersten Setzen. Kommt der erste Aufruf mit `bereich = uebersicht`, steht `verlaufGelesenBis` auf dem höchsten Stand der Verlaufseinträge, die vor dem Zugang der Person angelegt wurden (`angelegtAm < zugangSeit`), sonst auf 0; `uebersicht` fasst das Feld danach nie mehr an — wer nur die Karten gesehen hat, hat den Verlauf nicht gelesen. Verworfen: pauschal 0 — sobald die Zeile da ist, zählt der Zähler nach Stand statt nach Zugangszeit, und alte Nachrichten vor dem Zugang zählten sonst als ungelesen.

### 2.6 Änderungszähler

- `Verein.aenderungsstand` (`Int`, Vorgabe 0) zählt die schreibenden Transaktionen im Verein: **ein Stand je Transaktion**, nicht je Zeile. Verworfen: `BigInt` — 2,1 Milliarden Änderungen je Verein werden nie erreicht, und `BigInt` bräche `JSON.stringify` an jeder API-Grenze.
- `Aenderung (id, vereinId, stand, threadId?, art, objektId, urheberId?, angelegtAm)` mit eigener `id` und einem Index auf `(vereinId, stand)`; mehrere Zeilen einer Transaktion teilen sich den Stand. Verworfen: ein eindeutiges `(vereinId, stand)` — ein Verlaufseintrag braucht seinen Stand beim Anlegen, seine ID entsteht erst dabei, also bekommt die Arbeit der Transaktion den Stand vorab (4.2). Lückenlos bleibt der Zähler: Jede committete schreibende Transaktion hat genau einen Stand. `threadId` und `objektId` sind bewusst keine Fremdschlüssel, damit das Löschen eines Threads als Änderung erhalten bleibt. `art` z. B. `THREAD`, `MODUL`, `ANTWORT`, `VERLAUF`, `SICHTBARKEIT`, `LISTE`, `GELOESCHT` (nicht für das Löschen einer Nachricht, 2.4). **`LISTE`** (Etappe 3) ist Anpinnen und Archivieren: Es steht wie `SICHTBARKEIT` und `GELOESCHT` in `OHNE_AKTIVITAET`, ist also keine Aktivität des Threads (4.2). Verworfen: `THREAD` — jedes Anpinnen schöbe den Thread in der Liste nach oben und hieße bei allen „Aushang geändert“. Das „Neu“-Kennzeichen (Etappe 4) lässt `LISTE` außen vor: `istNeu` bekommt die Änderungen mit ihrer `art` und filtert selbst (3.9). Verworfen: die Abfrage des Servers filtern lassen — die Regel gehört zu `istNeu` und muss ohne Datenbank prüfbar sein. Keine Inhalte, nur Kennungen.
- **Änderungen ohne Thread (Etappe 5).** Die Routen aus TP2, die das Umfeld einer Person verändern (Personen, Zugang, Zuordnungen, Untergruppen, Rechte, Merkmale, Einwilligung), schreiben über `mitAenderung` eine `Aenderung` mit `threadId: null`, der Art `SICHTBARKEIT` und der Person beziehungsweise Untergruppe als `objektId` (`vermerkeUmfeld`, direkt nach `sperreVereinszeile`; wo ein Pfad ohne Wirkung enden kann, erst vor dem ersten Schreiben, damit keine Änderung ohne Wirkung entsteht). **`POST /personen` ist die Ausnahme:** Es hat keine `sperreVereinszeile`, denn über „angenommen oder nicht“ entscheidet dort allein der Unique-Index auf `(vereinId, email)`; die Doppelt-Prüfung davor (409 `DOPPELT`) ist nur ein Hinweis, und eine Sperre ließe die zweite Anfrage nur warten, nicht anders enden. `vermerkeUmfeld` steht dort als **erste schreibende Anweisung** der Transaktion und sperrt die Vereinszeile trotzdem bis zum Commit (`mitAenderung` erhöht den Stand), zwei gleichzeitige Anlagen stellen sich also dort an. Dafür vergibt die Route die ID der Person vorab (`randomUUID`), damit der Vermerk sie schon vor dem Anlegen nennen kann. Verworfen: den Vermerk nach dem Anlegen schreiben — dann kennt er die ID von selbst, steht aber hinter dem Schreiben der Person, und was vor der Zeile des Vereins geschrieben wird, kann mit einer Transaktion verklemmen, die sie schon hält. Welche Threads eine neue Untergruppe oder ein Recht berührt, rechnet niemand aus: Ein Sync, der eine solche Zeile sieht, antwortet `vollstaendig` (5.2), live geht ein Signal ohne Thread an alle Sockets des Vereins (5.1). Verworfen: je betroffenem Thread eine `SICHTBARKEIT` — jede TP2-Route müsste selbst ausrechnen, welche Threads sie berührt. Verworfen: nur ein Live-Signal ohne `Aenderung` — wer in dem Moment getrennt war, erführe es nie. `PATCH /einstellungen` schreibt keine solche Änderung: Es ändert nur Name und Farbe des Vereins, nichts, was `siehtThread` liest.
- Einträge älter als 90 Tage werden beim Start und danach alle 24 Stunden im App-Prozess gelöscht (ein `setInterval(…).unref()`, kein Cron), plattformweit über den schlichten `PrismaClient`, weil die Löschung über alle Vereine läuft. `unref`, damit der Zeitgeber den Prozess nicht am Beenden hindert. Ein Sync, der älter einsteigt, bekommt „vollständig neu laden“ (5.2).

---

## 3. Fachregeln

Alle Regeln sind reine Funktionen in `libs/domain/src/threads/` und `libs/domain/src/module/<typ>/` (Rahmen 7.2; der erste Modultyp legt die Ordnerkonvention fest). Sie bekommen ein **Umfeld** (Personen, Zuordnungen, Untergruppen-Mitgliedschaften, Merkmale) und den Thread-Kopf.

### 3.1 Sichtbarkeit

`siehtThread(person, thread, umfeld)`:

- **Jugendleiter** (wer irgendein Recht hat) sehen alle Threads, auch Entwürfe (Rahmen 4.2).
- Alle anderen sehen nur **veröffentlichte** Threads, und nur:
  - **Jungfischer + Familie**: die Jungfischer der Zielgruppe (`kinderImThread`) und deren Bezugspersonen.
  - **Nur Familie**: die Bezugspersonen dieser Jungfischer.
  - **Nur Jugendleiter**: niemand sonst. Untergruppen spielen keine Rolle.
  - **Jugendleiter + Jugendsprecher**: Jungfischer mit Merkmal `jugendsprecher`; Untergruppen werden ignoriert, die Familie sieht den Thread nicht (FAM 2.3).
- Volljährig gewordene Kinder behalten ihre Familie (TP2 5.6). Entfernte Personen sehen nichts.
- Wer einen Thread nicht sieht, bekommt überall **404**: in der API, im WebSocket, in der Link-Vorschau (7.2).

### 3.2 Wer gefragt ist

`gefragte(umfrage, thread, umfeld)` liefert die Personen, für die eine Antwort erwartet wird:

| Einheit         | Gefragt                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pro Jungfischer | die Kinder im Thread; bei „Jugendleiter + Jugendsprecher“ die Jugendsprecher; bei „Nur Familie“ und „Nur Jugendleiter“ niemand (der Editor bietet die Einheit dort nicht an) |
| Pro Erwachsenem | die Bezugspersonen der Kinder im Thread und alle Jugendleiter; bei „Nur Jugendleiter“ und „Jugendleiter + Jugendsprecher“ nur die Jugendleiter                               |
| Pro Person      | beide Gruppen zusammen; bei „Nur Familie“ ohne die Kinder                                                                                                                    |

Entfernte Personen sind nie gefragt; ihre Antworten zählen nicht. Eine Antwort ohne jede Option gilt als keine Antwort: Die Person steht unter „Offen“ und bleibt in „Braucht deine Antwort“. Der Server verweigert leere Antworten ab Etappe 2; bis dahin darf eine verirrte Zeile niemanden aus „Offen“ verschwinden lassen, weil die Person sonst weder gezählt noch als fehlend genannt würde.

`antwortZeilen(betrachter, umfrage, …)`: eine Zeile für sich selbst, wenn gefragt, und **eine Zeile je eigenem gefragten Kind**. Das gilt auch bei „pro Person“: Für ein Kind antwortet das Kind selbst oder seine Familie, unabhängig davon, ob es einen Zugang hat. Verworfen: „pro Person“ wörtlich als „jeder mit Zugang“ — Kinder ohne Zugang hätten dann keine Stimme.

Ist ein Jugendleiter zugleich Bezugsperson eines Jugendsprechers, bekommt er im Austausch auch die Zeile für dieses Kind, und das Kind erscheint bei ihm unter „Braucht deine Antwort“ (Entscheidung des Eigentümers, 20.10.2026). FAM 2.3 schließt die Familie aus; er sieht den Thread aber als Jugendleiter, und für ein Kind darf seine Familie antworten. Verworfen: die Kindzeile im Austausch unterdrücken — dann gäbe es dort eine Ausnahme von der Regel „eine Zeile je eigenem gefragten Kind“, ohne dass sie etwas schützt.

### 3.3 Wer antworten darf

`darfAntworten(person, fuer, umfrage, thread, jetzt)`:

1. Wer den Thread nicht sieht: 404.
2. Wer den Thread bearbeiten darf (3.5): für jede gefragte Person, **auch nach der Frist** — das Nachtragen telefonischer Zu- und Absagen.
3. Sonst nur bis zur Frist (danach 410; ab `jetzt >= frist` ist sie abgelaufen, „bis Do 18:00“ heißt: um 18:00:00 ist Schluss): für sich selbst, wenn gefragt, und als Bezugsperson für ein gefragtes Kind (`darfFuerKindHandeln`, unabhängig von Erziehungsberechtigung und Alter, TP2 5.6).

Gespeichert wird immer `fuer` und `von`. In den **eigenen Antwortzeilen** sieht man, wer für einen eingetragen hat („von dir eingetragen“, „eingetragen von Mutter Sandra“, „eingetragen von Thomas K.“).

### 3.4 Ergebnisse

`ergebnisAnsicht(betrachter, umfrage, thread)` ergibt `NAMEN`, `SUMME` oder `NICHTS`:

| Einstellung      | Mit „Antworten im Detail“ oder Bearbeitungsrecht | Andere Jugendleiter | Familien und Jungfischer |
| ---------------- | ------------------------------------------------ | ------------------- | ------------------------ |
| Für alle         | Namen                                            | Namen               | Namen                    |
| Nur als Summe    | Namen                                            | Summe               | Summe                    |
| Nur Jugendleiter | Namen                                            | Summe               | nichts                   |

- **Namen** heißt: je Option die Beantworteten als Vorname und Initiale des Nachnamens („Lena M.“), dazu „Offen“ mit den Gefragten ohne Antwort. Verworfen: volle Nachnamen für alle — TP2 5.2 lässt Familien bewusst kein Mitgliederverzeichnis sehen; die Initiale reicht in einer Gruppe zum Erkennen.
- Den Vermerk „eingetragen von …“ in der Ergebnisliste sehen nur Jugendleiter, und nur, wenn `von` ≠ `fuer`.
- Die eigene Antwort sieht jeder immer.
- Die Namen in den Ergebnissen sieht auch, wer den Thread bearbeiten darf (3.5), zusätzlich zu „Antworten im Detail“: Wer nachträgt (3.3), muss sehen, wer fehlt; die Verwaltung zeigt es ohnehin. Die Tabelle gilt entsprechend für diese Gruppe.

### 3.5 Rechte am Thread

`darfBearbeiten(person, thread)`: wer „Alle Threads bearbeiten“ hat, oder wer „Threads erstellen“ hat und den Thread erstellt hat. Den Austausch bearbeiten nur Inhaber von „Alle Threads bearbeiten“ (FAM 2.5).

Bearbeiten umfasst: Inhalt und Module ändern, Zielgruppe, Modus, Anpinnen, Archivieren und Wiederherstellen, fremde Nachrichten entfernen, Antworten nachtragen. Verworfen: Modus, Archiv und Moderation nur mit „Alle Threads bearbeiten“ (Rahmen 4.2 wörtlich) — wer einen Termin anlegt, soll ihn nach der Veranstaltung auch selbst auf „Nur Aushang“ stellen können.

`darfLoeschen`: `darfBearbeiten`, der Thread ist nicht der Austausch, und es gibt weder Antworten noch nicht gelöschte Nachrichten (Systemeinträge zählen nicht, 3.6).

`darfSchreiben(person, thread)`: sieht den Thread, Modus „Kommentare“ oder „Chat“, Thread nicht im Archiv.

`darfLoeschenNachricht(person, eintrag)`: die eigene Nachricht immer; fremde mit `darfBearbeiten`.

Wer „Antworten im Detail“ hat oder den Thread bearbeiten darf, sieht in der Verwaltung die Antworten-Übersicht.

### 3.6 Lebenszyklus

- **Entwurf**: `veroeffentlichtAm = null`. Nur Jugendleiter sehen ihn; Liste und Editor kennzeichnen ihn mit „Entwurf“. Antworten und Nachrichten sind im Entwurf nicht möglich.
- **Veröffentlichen** setzt `veroeffentlichtAm`, schreibt den Systemeintrag `VEROEFFENTLICHT` und (ab Teilprojekt 5) löst den Push aus. Zurück in den Entwurf geht es nicht.
- **Löschen** nur nach 3.5; endgültig, samt Modulen. **Löschbar heißt: keine Antwort und keine nicht gelöschte Nachricht.** Eine gelöschte Nachricht hat keinen Text mehr (2.4); zählte sie, machte ein zurückgezogener Kommentar den Thread für immer unlöschbar. Antworten zählen auch ohne Option, weil die Datenbank sie beim Löschen ohnehin verweigerte (3.14).
- Verworfen: kein Entwurfszustand — ein halb fertiger Thread wäre sofort für alle sichtbar. Verworfen: Löschen auch mit Antworten — Familien verlören kommentarlos, was sie eingetragen haben; dafür gibt es das Archiv.

### 3.7 Archiv

`istArchiviert(thread, termine, jetzt)`:

1. `archivModus = ARCHIVIERT` → archiviert.
2. `archivModus = AKTIV_HALTEN` → aktiv.
3. Angepinnt oder Austausch → aktiv.
4. Thread ohne Termin → aktiv.
5. Sonst archiviert ab **00:00 Uhr (Berlin) am siebten Tag nach dem letzten Tag des letzten Termins**. Ein Termin am Samstag, 17.10., wandert also am Samstag, 24.10., ins Archiv.

Manuelles Archivieren setzt `ARCHIVIERT`, Wiederherstellen setzt `AKTIV_HALTEN` — sonst griffe die Datumsregel sofort wieder. Ein wiederhergestellter Thread bleibt aktiv, bis ihn jemand archiviert.

Die Regel wird zur Lesezeit berechnet; es gibt keinen Archiv-Cron. Verworfen: Archivierung erst mit Teilprojekt 5 per Cron (Rahmen 9.6, 11) — die Thread-Liste füllte sich bis dahin, und ein gespeichertes Flag müsste bei jeder Terminänderung nachgezogen werden.

Im Archiv lassen sich Threads lesen und durchsuchen; Antworten nach der Frist und Schreiben im Verlauf sind gesperrt. Wer bearbeiten darf, kann nachtragen.

### 3.8 Termine

Aus dem Entwurf übernommen und auf Europe/Berlin umgestellt (FAM 3.1, 3.2):

- `terminZeit(termin)`: die Anzeigeformen aus FAM 3.1.
- `terminFehler(termin)`: Ende vor Start, Endezeit vor Beginn am selben Tag. Eine Endezeit ohne Beginn ist erlaubt (2.2).
- Wandzeit nach Zeitpunkt (`berlinZeitpunkt`): In der doppelten Stunde im Herbst gilt der frühere Zeitpunkt (Sommerzeit), eine Uhrzeit in der übersprungenen Stunde im Frühjahr rückt um eine Stunde vor (wie Temporal „compatible“). Verworfen: eine solche Uhrzeit ablehnen — der Editor kann sie nicht kennen, und die Ablehnung wäre unfreundlicher.
- `naechsteTermine(termine, jetzt)`: laufende und künftige, sortiert nach Startdatum, dann Beginn, ganztägig zuerst; ein laufender mehrtägiger Termin bleibt bis zu seinem Ende.
- `termineImMonat(termine, jahr, monat)`: auch Termine, die über die Monatsgrenze reichen.
- Karten-Link für den Ort (`kartenLink(ort, geraet)`): auf iOS `maps://?q=`, auf Android `geo:0,0?q=`, sonst die Google-Maps-Suche. Das Gerät erkennt der Client am User-Agent; einen Fehlgriff fängt das ab, weil beide Handy-Schemata im Zweifel nichts tun und der Desktop-Link immer funktioniert. Nichts wird eingebettet; erst das Antippen überträgt den Ort.

### 3.9 Neu und Zähler

- `istNeu(eingabe)` (`NeuEingabe`: Person, Zugang, `gelesenBis`, Ersteller, `veroeffentlichtAm`, die Änderungen mit `stand`, `art`, `urheberId`, `angelegtAm` und `antwortenSichtbar`): Es gibt eine Änderung des Threads mit `stand > gelesenBis`, die fremd ist (`urheberId ≠ person`; nur fremde Aktivität, Erkenntnis aus dem Entwurf), nicht die Art `LISTE` hat (2.6) und, wenn sie die Art `ANTWORT` hat, nur bei `antwortenSichtbar` zählt (nächster Punkt). Eine Änderung ohne Urheber (Systemeintrag, der Austausch aus der Migration) ist fremd. Ohne Gelesen-Stand ist ein Thread neu, wenn ihn jemand anderes ab dem Einrichten des eigenen Zugangs veröffentlicht hat oder er seither fremde Änderungen hat (`angelegtAm >= zugangSeit`). Verworfen: ohne Gelesen-Stand alles als neu zu zählen — eine frisch eingeladene Familie fände die ganze Vereinsgeschichte als neu vor.
- **Eine fremde Antwort zählt nur, wenn die Person Ergebnisse sieht** (Etappe 4, nach dem Gesamtreview): `antwortenSichtbar` heißt, `ergebnisAnsicht` (3.4) ist für die Person in mindestens einer Umfrage des Threads nicht `NICHTS` (`siehtErgebnisse`; Liste und Start bauen die Eingabe gemeinsam über `neuEingabeFuer`). Das gilt für `istNeu`, den Punkt an „Threads“ und „Neue Antworten“ auf Start gleichermaßen. Bei „Ergebnisse: nur Jugendleiter“ sähe eine Familie nach dem Öffnen nichts Geändertes; der Punkt zeigte auf nichts und leuchtete mit jeder weiteren Antwort wieder auf. Verworfen: je Antwort genau zu prüfen, ob die Person deren Umfrage auswerten darf — dafür fehlt `NeuAenderung` der Weg von `objektId` zur Umfrage; Etappe 5 baut ihn nicht, er bleibt offen. Kosten: Die Antwort des anderen Elternteils für das eigene Kind in einer Nur-Jugendleiter-Umfrage macht den Thread nicht neu, und sieht die Person in einer anderen Umfrage desselben Threads Ergebnisse, zählt auch eine Antwort in der verborgenen.
- **Der Server lädt für „neu“ nur Kandidaten (Etappe 4).** Je Thread die Änderungen mit `stand > gelesenBis` (ohne Gelesen-Zeile: `angelegtAm >= zugangSeit`) und für Start ebenso die Nachrichten über `verlaufGelesenBis`, in **einer** Abfrage je Tabelle mit einer `OR`-Bedingung je Thread (`ladeNeuKandidaten`). Ob eine Änderung fremd ist und welche Art zählt, entscheidet allein die Domäne; die Grenzen der Abfrage sind nie enger als ihre. Verworfen: `urheberId: { not: ich }` in der Abfrage — `NULL <> x` ist in SQL nicht wahr, Systemänderungen ohne Urheber fielen still heraus, und die Regel stünde an zwei Stellen. Verworfen: alle Änderungen laden — sie wachsen bis zum Aufräumen nach 90 Tagen (2.6) mit jeder Antwort.
- **`ladeThreads(db, { threadIds?, mitAntworten? })` lädt nur, was die Seite braucht (Etappe 5).** Mit Echtzeit laden Start, Liste und Termine bei jedem Signal neu, und die Antworten aller Umfragen sind der teure Teil. Liste und Termine laden ohne Antworten, Start nur für die aktiven Threads; die Antworten werden einmal nach `umfrageId` gruppiert, statt je Umfrage die ganze Liste zu filtern. Verworfen: eigene schmale Abfragen je Route — die Abbildung der Module stünde dreimal im Code.
- **Archivierte Threads sind nie neu,** auch nicht für den Punkt an „Threads“ (6.1). Im Archiv kann nur noch nachgetragen werden (3.7); der Punkt zeigte sonst auf einen Thread im eingeklappten Archiv, den niemand findet. Verworfen: das Archiv mitzuzählen.
- Zähler am Reiter „Verlauf“ (`ungeleseneNachrichten`): fremde, nicht gelöschte Nachrichten (Art `NACHRICHT`, keine Systemeinträge) mit `stand > verlaufGelesenBis`, ohne Gelesen-Zeile die ab dem Zugang. Verworfen: Systemeinträge mitzählen — ein verschobener Termin im Aushang hieße sonst „1 neuer Kommentar“, wo niemand kommentieren kann.
- „Neu seit deinem letzten Besuch“ (6.1): die neuen Threads nach letzter Aktivität, neueste zuerst, höchstens fünf, je mit einer Kurzangabe aus `neuKurzangabe`. „Neuer Thread“ heißt: keine Gelesen-Zeile, und jemand anderes hat den Thread ab dem eigenen Zugang veröffentlicht; ein neuer Thread nennt nur sich, nicht noch die Kommentare darin. Sonst die ungelesenen Nachrichten („2 neue Kommentare“, im Chat „Nachrichten“), danach „Neue Antworten“, wenn unter den fremden Kandidaten eine zählende Änderung der Art `ANTWORT` ist (also nur mit sichtbaren Ergebnissen, s. o.), sonst „Aushang geändert“.
- Öffnen eines Threads setzt `gelesenBis` auf den Stand, **den der Client geladen hat**, Öffnen des Verlaufs zusätzlich `verlaufGelesenBis` (4.1, 4.2). Die Thread-Seite meldet die Übersicht erst, wenn die Person sie sieht (wer direkt im Verlauf landet, hat die Module nicht gesehen). Nach dem Abgeben einer Antwort schickt die Seite **kein** neues PUT. Verworfen: den Stand aus der Antwort als gelesen melden — er könnte fremde Änderungen, die die Seite nie geladen hat, als gelesen markieren.
- **Gelesen bei Live-Nachrichten (Etappe 5).** Wer den Verlauf offen hat, sieht eine neue Nachricht sofort und soll sie nicht als ungelesen zählen. Die Thread-Seite führt dafür `bekannterStand`: den Stand der zuletzt geladenen Ansicht, erhöht um den Stand einer Live-Nachricht dieses Threads, solange keine stille Aktualisierung aussteht (jede andere Änderung des Threads löst eine aus). Der Verlauf meldet `verlauf` bis `bekannterStand`, sobald dieser steigt und das Dokument sichtbar ist; die Übersicht meldet wie bisher den Stand der geladenen Ansicht, jetzt ebenfalls nur bei sichtbarem Dokument. So meldet die Seite nie etwas, das sie nicht hat. Verworfen: bis zum Stand der Nachricht melden, ohne auf ausstehende Aktualisierungen zu achten — eine Modul-Änderung desselben Augenblicks gälte als gelesen, bevor sie geladen ist.
  - Der Verlauf meldet erst, wenn sein Auffrischen (nach `sync`, `alles` oder einem Systemeintrag) gelungen ist. Sonst höbe die stille Aktualisierung `bekannterStand`, bevor die Zeilen da sind, und eine Nachricht aus der Zeit ohne Verbindung gälte ungezeigt als gelesen. Preis: Scheitert das Auffrischen, bleibt Gelesen aus, bis ein Auffrischen gelingt.
  - Scheitert eine stille Aktualisierung (außer mit 401 oder 404, die die Seite ohnehin beenden), bleibt sie ausstehend; Live-Nachrichten sammeln sich in `liveBis`, und nach dem nächsten Erfolg gilt `bekannterStand = max(ansicht.stand, liveBis)`. Verworfen: die Nachricht sofort als gelesen zu heben — sie könnte eine ungeladene Änderung überspringen. Preis: In einem reinen Chat ohne andere Änderung bleiben neue Nachrichten nach einem Serverfehler bis zum nächsten Abgleich ungelesen.

### 3.10 Namen in Threads

`absenderName(autor, umfeld)`:

- Jugendleiter: „Thomas K. (Jugendleiter)“.
- Bezugsperson: „Sandra M. (Mutter von Max)“; bei mehreren Kindern im Verein „(Mutter von Lena und Max)“, ab drei „(Mutter von Lena, Max und 1 weiteren)“; bei „Andere“ der Freitext. Ist sie zugleich Jugendleiter, gilt die Jugendleiter-Form.
- Jungfischer: „Lena M.“.
- Entfernte Person: „ehemaliges Mitglied“.

Alle Leser des Threads sehen diese Form. Damit gibt ein Thread preis, welches Kind zu welchem Erwachsenen gehört — das ist der Zweck, und es ist mit dem Eigentümer so entschieden. Verworfen: nur der Name ohne Rolle — Kinder und Eltern wüssten oft nicht, wer schreibt.

### 3.11 Info-Text

Eine kleine Markdown-Teilmenge: Absätze (ein einfacher Zeilenumbruch bleibt ein Umbruch), **fett**, _kursiv_, Listen, Links (`[Text](https://…)` und erkannte URLs; nur `https:`, `http:`, `mailto:`). Gerendert im Client mit dem vorhandenen `marked` und einem eigenen Renderer: Alles andere erscheint als Text, so wie es getippt wurde: HTML, Bilder, Überschriften, Code (Block und Inline), Zitate, Linien, Tabellen, nummerierte Listen, Durchgestrichenes, Aufgabenkästchen, Linkdefinitionen und Links mit anderem Schema oder ohne Schema (`javascript:`, `data:`, `/relativ`).

Angenommen wird, was `marked` für diese Elemente als solche erkennt, nicht nur die Schreibweise der Knopfleiste: fett auch als `__…__`, kursiv auch als `*…*`, Listen auch mit `*` und `+`. Verworfen: die Tokens der Knopfleiste allein zuzulassen — wer `*kursiv*` oder eine Liste mit `*` tippt, sähe die Zeichen statt der Formatierung, und die Ablehnung würde Autoren überraschen, obwohl sie nichts öffnet. Der Renderer beantwortet dafür jeden Token-Typ selbst, statt Tokenizer abzuschalten (`marked` fiele bei einem abgelehnten Tokenizer auf den eingebauten zurück, und eine neue Version könnte einen Weg zu HTML mitbringen). Angulars Sanitizer bei `[innerHTML]` bleibt der zweite Riegel.

Der Editor hat eine kleine Knopfleiste (B, I, Liste, Link). Verworfen: ein WYSIWYG-Editor (neue Abhängigkeit, am Handy hakelig); reiner Klartext (Listen und Hervorhebungen wurden im Entwurf vermisst).

### 3.12 Teilnahme-Umfrage

- Ein Schalter am Umfrage-Modul, höchstens eine je Thread (2.2); die Einheit ist frei wählbar (3.2).
- Feste Optionen „Dabei“, „Vielleicht“ (abschaltbar), „Abgesagt“.
- **Nur „Dabei“ gilt als Teilnahme** — Grundlage für Mitfahrt und Zahlungspflicht in Teilprojekt 4 (Rahmen 6.4.1, 6.4.2) und für Termin-Erinnerungen in Teilprojekt 5. „Vielleicht“ gilt als beantwortet und erscheint nicht mehr unter „Braucht deine Antwort“.
- Eine Teilnahme-Umfrage hat **nie Mehrfachauswahl**: „Dabei“, „Vielleicht“ und „Abgesagt“ schließen sich aus. Der Editor setzt `mehrfach: false` beim Einschalten der Teilnahme und blendet den Schalter aus; `entwurfAus` setzt es beim Lesen jedes Teilnahme-Moduls, denn ein verstecktes `true` würde unsichtbar als Mehrfachauswahl gespeichert. Verworfen: ein `true` bei Teilnahme abzulehnen — ein veralteter Client, der das Feld nicht kennt, soll daran nicht scheitern (so wie `entwurfAus` auch die festen Optionen einer Teilnahme selbst setzt, statt abweichende abzulehnen); gelesen wird der Wert trotzdem, damit ein Nicht-Wahrheitswert weiter ungültig ist.
- Eine neue Umfrage im Editor startet als Teilnahme-Umfrage „Kommst du mit?“, pro Jungfischer, Ergebnisse für alle (Entwurf).

### 3.13 Braucht deine Antwort

`brauchtAntwort(person, threads, …, jetzt)`: je sichtbarem, veröffentlichtem, nicht archiviertem Thread jede eigene Antwortzeile ohne Antwort mit laufender Frist (oder ohne Frist), als „Lena: Bowling noch offen · bis Do“ beziehungsweise für sich selbst „Bowling noch offen“. Sortiert nach Frist, dann Titel. Ohne Rollenwort (FAM 1.6).

### 3.14 Änderungen an Umfragen mit Antworten

Liegen Antworten vor, verweigert der Server (409 mit Hinweis am Feld):

- eine Option zu entfernen, auf die jemand geantwortet hat;
- die Einheit oder den Teilnahme-Schalter zu ändern;
- „mehrfach“ abzuschalten, wenn eine Antwort mehrere Optionen hat.

Umbenennen und Umsortieren von Optionen, Frist und Ergebnis-Einstellung bleiben frei. Verworfen: Antworten bei solchen Änderungen still verwerfen.

Gemeint sind Antworten **mit gewählter Option**; eine Antwort ohne Option sperrt diese drei Änderungen nicht (3.2: sie gilt als keine Antwort). Wird „Vielleicht“ aus einer Teilnahme-Umfrage entfernt, obwohl jemand es gewählt hat, steht der Konflikt am Feld `module.N.optionen` (wie bei jeder entfernten Option); verworfen: `module.N.vielleicht` — die Feldliste des Editors kennt das Feld nicht, und die Meldung stünde ohne Anker. Der Editor zeigt `optionen` darum auch bei einer Teilnahme-Umfrage, unter „Vielleicht anbieten“.

**Der Editor zieht dieselben Grenzen wie der Server** (`umfrageSperre`): Einheit und Teilnahme sind erst gesperrt, wenn eine Antwort mit Option existiert; „Mehrfachauswahl“ erst, wenn sie genutzt wurde (eine Antwort mit mehreren Optionen); das Entfernen der ganzen Umfrage dagegen schon bei jeder Antwort, auch bei einer ohne Option, weil die Datenbank sie verweigert (unten). Verworfen: alles ab der ersten Antwort pauschal sperren — der Editor wäre strenger als der Server und verböte Änderungen, die dieser annähme.

Eine beantwortete Umfrage lässt sich auch **nicht als Ganzes** löschen, weder das Modul noch der Thread: Die Datenbank verweigert es (der Fremdschlüssel von der Antwort auf die Umfrage ist `NoAction`, es gibt keinen Kaskadenweg zu den Antworten, 2.3). Verworfen: die Kaskade von der Umfrage zur Antwort zu lassen und allein auf die Sperre über die gewählte Option zu bauen — ob zuerst die Sperre oder die Kaskade greift, hängt von der Reihenfolge der Prüftrigger in Postgres ab; und ein aufgeschobener Fremdschlüssel (`DEFERRABLE INITIALLY DEFERRED`) — er prüfte erst nach der Kaskade und ließe Antworten kommentarlos verschwinden. Folge für Etappe 3: `PUT /threads/:id` antwortet mit 409 `BEANTWORTET`, wenn es ein beantwortetes Umfrage-Modul entfernen würde (4.4); eine Antwort ohne Option zählt hier mit, damit die Datenbank nie mit P2003 (und damit 404) antwortet.

---

## 4. Server und API

### 4.1 Routen

Alle unter `/<slug>/api/v1`, in `vereinsApi`, mit `brauchtMitglied` und je einem Eintrag im Mandanten-Test (TP2 9). Wo eine Person etwas nicht sieht: 404.

| Methode und Pfad                                        | Zweck                                                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /threads?suche=&archiv=1`                          | Thread-Liste (Etappe 4): sichtbare Threads mit Neu-Kennzeichen und nächstem Termin; `suche` filtert Titel, Info-Texte und Orte (im Speicher, nicht per ILIKE); ohne `archiv=1` nur die Zahl der archivierten |
| `GET /threads/:id`                                      | Kopf, Module, eigene Antwortzeilen mit Antwortrecht, Ergebnisse nach 3.4, Schreibsperre, Zähler des Verlaufs (seit Etappe 3 mit `darfBearbeiten` und `darfArchivieren`)                                      |
| `GET /threads/:id/verlauf?vor=`                         | 50 Einträge je Seite, neueste zuerst; `vor` ist die ID eines Eintrags                                                                                                                                        |
| `POST /threads/:id/verlauf`                             | Nachricht schreiben (mit `clientId`)                                                                                                                                                                         |
| `DELETE /verlauf/:eintragId`                            | eigene oder (mit Recht) fremde Nachricht entfernen                                                                                                                                                           |
| `PUT /threads/:id/gelesen`                              | Gelesen-Stand setzen (Körper `{ bereich, bis }`, `bereich`: `uebersicht` oder `verlauf`)                                                                                                                     |
| `PUT /umfragen/:modulId/antworten/:fuerId`              | Antwort abgeben oder ändern (Upsert, `clientId`)                                                                                                                                                             |
| `GET /start`                                            | neu (Etappe 4; bisher gab es nur `/ansprechpartner`): „Braucht deine Antwort“, „Als Nächstes“, „Neu seit deinem letzten Besuch“ in einer Antwort                                                             |
| `GET /termine?monat=JJJJ-MM`                            | Termine veröffentlichter, sichtbarer Threads im Monat, auch archivierter (Etappe 4)                                                                                                                          |
| `POST /threads`, `PUT /threads/:id`                     | Thread samt Modulen anlegen oder ersetzen, in einer Transaktion                                                                                                                                              |
| `POST /threads/:id/veroeffentlichen`                    |                                                                                                                                                                                                              |
| `PUT /threads/:id/archiv`, `PUT /threads/:id/angepinnt` |                                                                                                                                                                                                              |
| `DELETE /threads/:id`                                   | nach 3.5                                                                                                                                                                                                     |
| `GET /threads/:id/antworten`                            | Antworten-Übersicht für die Verwaltung (wer was, wer fehlt)                                                                                                                                                  |
| `GET /verwaltung/threads`                               | Liste der Verwaltung (Etappe 3): alle Threads samt Entwürfen, Untergruppen, `darfErstellen`                                                                                                                  |
| `GET /threads/:id/bearbeitung`                          | der Thread in bearbeitbarer Form für den Editor (Etappe 3, `ThreadBearbeitung`)                                                                                                                              |
| `GET /sync?seit=`                                       | 5.2 (`seit` ungültig: 400)                                                                                                                                                                                   |

**Formen und Pfade der lesenden Routen (Etappe 2).** Die Antworttypen (`ThreadAnsicht`, `UmfrageAnsicht`, `VerlaufAnsicht`) stehen in `libs/domain` (`threads/ansicht.ts`, `threads/verlauf.ts`), und der Client nutzt dieselben. Verworfen: sie im Client nachzuschreiben (Muster `mitglieder-api.ts`) — bei einer Antwort dieser Größe liefen beide Seiten auseinander. Was eine Person sieht, baut dieselbe reine Funktion für alle Routen (`threadAnsicht`, `verlaufAnsicht`); der Server lädt nur.

- `GET /threads/:id` liefert die `ThreadAnsicht`: Kopf, Module, je Umfrage die eigenen Antwortzeilen (mit eigenem Antwortrecht je Zeile) und die Ergebnisse nach 3.4, `schreibSperre`, den Zähler des Verlaufs und `stand`. Das Antwortrecht und die Löschberechtigung stehen an der Zeile beziehungsweise am Eintrag, nicht in einem Block „Rechte“; Etappe 3 hat `darfBearbeiten` und `darfArchivieren` ergänzt (für „Bearbeiten“ und „Wiederherstellen“ im Kopf). Der `stand` ist der Vereinsstand, der **vor** den Thread-Daten gelesen wird: Unter READ COMMITTED ist, was danach geladen wird, mindestens so neu.
- `GET /threads/:id/verlauf?vor=` liefert `{ eintraege, weitere }`. `vor` ist die ID des ältesten gezeigten Eintrags, geordnet wird nach `(stand, id)`, damit Einträge eines Standes eine feste Reihenfolge haben und an der Seitengrenze keiner fehlt oder doppelt kommt. Verworfen: `vor` als Änderungsstand — mehrere Einträge einer Transaktion teilen sich einen Stand. Ein `vor` aus einem anderen Thread oder ein unbekanntes ist 404, sonst ließe sich fremder Verlauf an einem eigenen Thread abzählen.
- `POST /threads/:id/verlauf` antwortet `{ eintrag, stand }`, 201 beim Anlegen und 200 bei einer Wiederholung (4.2). `DELETE /verlauf/:eintragId` antwortet 204, auch beim zweiten Löschen derselben Nachricht (eine Wiederholung ist kein Verbot): Die Zeile bleibt, denn eine Nachricht wird weich gelöscht (`geloeschtAm`, CHECK `verlauf_geloescht`), und das zweite Löschen findet sie noch; wer nie löschen durfte, bekommt weiter 404 und erfährt nicht, dass die Nachricht schon weg ist. Die eigene Nachricht lässt sich auch im Archiv löschen.
- `PUT /umfragen/:modulId/antworten/:fuerId` antwortet 200 mit `{ modul, stand }`: die Umfrage so, wie die Person sie jetzt sieht, und der Stand, bis zu dem sie geladen ist. Ein Info- oder Termin-Modul unter dieser ID ist „unbekannt“ (404); eine andere Antwort verriete, dass es unter der ID ein Modul gibt. Der Körper ist `{ optionIds, clientId }`; geprüft wird die Form (nicht leer, höchstens 20, Zeichenketten, ohne Doppelte) vor dem Thread, die Zugehörigkeit zur Umfrage erst nach der 404.
- `PUT /threads/:id/gelesen` antwortet 204. Der Körper ist `{ bereich, bis }`, `bis` eine ganze Zahl ab 0 (ein Text wie `"5"` gilt nicht); sonst 400 ohne `feld`, geprüft vor dem Thread, damit die 400 über ihn nichts verrät. Der Client schickt den `stand` aus `GET /threads/:id` als `bis`; der Server speichert `max(alt, min(bis, aktueller Stand))`. Die Kappung auf den Vereinsstand verhindert, dass ein Client etwas als gelesen markiert, das es noch gar nicht gibt, der Höchstwert, dass ein langsames Gerät den Stand zurücksetzt. So markiert ein Öffnen nie etwas als gelesen, das der Client nicht geladen hat.

`PUT /threads/:id` vergleicht Module und Optionen über ihre IDs und Schlüssel: Unveränderte bleiben, neue entstehen, fehlende werden gelöscht (soweit 3.14 es erlaubt). Termin-, Frist- und Modusänderungen erzeugen Systemeinträge (2.4).

**Formen und Pfade der Verwaltungsrouten (Etappe 3).** Was ein Entwurf ist und was sich ändert, entscheiden `entwurf.ts` und `vergleich.ts` in `libs/domain`, die Antworttypen (`VerwaltungListe`, `ThreadBearbeitung`, `AntwortenUebersicht`) stehen in `threads/verwaltung.ts`; Client und Server nutzen dieselben.

- **Zwei lesende Routen, die die erste Fassung der Tabelle nicht nannte.** Der Editor braucht den Thread in bearbeitbarer Form (Untergruppen-IDs, Options-Schlüssel, Frist als ISO, Sperren durch Antworten), und die Liste der Verwaltung braucht alle Threads samt Entwürfen. Sie behält ihre eigene Route auch neben `GET /threads` (Etappe 4), weil sie Untergruppen und `darfErstellen` braucht, die nicht in die Liste eines Mitglieds gehören. Verworfen: `GET /threads/:id` erweitern — die Ansicht ist die eines Mitglieds, und Schlüssel und Sperren gehören nicht in jede Mitgliederantwort.
- `GET /verwaltung/threads` liefert `{ threads, untergruppen, darfErstellen }` für jeden Jugendleiter (sonst 404). Je Thread `VerwaltungThread`: Zielgruppe als Text, „Entwurf“, „Archiviert“, nächster Termin, `darfBearbeiten` und `darfAntwortenSehen` (`siehtAntworten`).
- `GET /threads/:id/bearbeitung` liefert die `ThreadBearbeitung`: `version` (2.1), `entwurf`, `sperren` je Umfrage-Modul (3.14), `darfLoeschen`, `darfArchivieren`, Untergruppen. Wer den Thread nicht bearbeiten darf, bekommt 404 wie bei Unsichtbarem.
- `POST /threads` (Körper `{ entwurf }`) antwortet 201, `PUT /threads/:id` (`{ version, entwurf }`), `POST …/veroeffentlichen`, `PUT …/archiv` (`{ archiviert }`) und `PUT …/angepinnt` (`{ angepinnt }`) antworten 200, jeweils mit der `ThreadBearbeitung` nach dem Schreiben; `DELETE /threads/:id` antwortet 204. Ist der gewünschte Zustand beim Veröffentlichen, Archivieren und Anpinnen schon da (Doppelklick, zweites Gerät), antwortet die Route wie nach einem Erfolg, ohne Stand und ohne `Aenderung`. Verworfen: 409 — ein Fehler, wo das Ergebnis stimmt. Ein zweites `DELETE` ist keine Wiederholung in diesem Sinn: Anders als eine Nachricht im Verlauf (204 beim zweiten Löschen, oben) wird der Thread hart gelöscht; es gibt nichts mehr, woran sich das erste Löschen erkennen ließe, die Antwort ist 404.
- `GET /threads/:id/antworten` liefert die `AntwortenUebersicht` (mit `darfNachtragen`) nur, wenn die Person sie sehen darf (3.5), sonst 404. `darfNachtragen` ist in einem Entwurf immer falsch: Dort nimmt der Server keine Antwort an (409 `ENTWURF`, 4.4), und ein „Eintragen“ scheiterte jedes Mal.

**Formen und Pfade von Liste, Start und Terminen (Etappe 4).** Liste und Start werden in der Domäne gebaut: `threadListe` (`threads/liste.ts`) und `startAnsicht` (`threads/start.ts`) bekommen die geladenen Threads, Gelesen-Stände und Kandidaten (3.9) und liefern die fertige Antwort; die Antworttypen (`ThreadListe`, `ThreadZeile`, `StartAnsicht`, `TerminZeile`) stehen dort, eine Frist darin als ISO-Zeichenkette. Beide prüfen die Sichtbarkeit selbst (`siehtThread`), auch wenn der Server schon vorauswählt. Verworfen: im Server zusammensetzen — die Neu-Regel und die Sichtbarkeit stünden dann neben `threadAnsicht` ein zweites Mal. Alle drei Routen sind rein lesend: kein Gelesen-Stand, keine `Aenderung`.

- `GET /threads?suche=&archiv=1` liefert `{ threads, archiv }`. Ohne `archiv=1` stehen in `threads` die nicht archivierten Threads und in `archiv` nur die **Zahl** der archivierten, mit `archiv=1` beide (`archiv` bleibt die Zahl). Bei einer Suche zählt `archiv` nur die archivierten Treffer: „Archiv · 3“ nennt, was beim Aufklappen kommt. Je `ThreadZeile`: ID, Titel, Segment, `angepinnt`, `archiviert`, `entwurf`, der nächste Termin als Text (Feld `naechsterTermin`, gebildet von `naechsterTerminText`, derselbe wie in der Verwaltung) und `neu`. Geordnet nach letzter Aktivität absteigend, dann ID; die Abschnitte bildet der Client (6.5). Er lädt das Archiv erst beim Aufklappen und schickt bei einer Suche immer `archiv=1` mit, damit ein archivierter Thread über die Suche zu finden ist (1.1, Schritt 11). Verworfen: das Archiv immer mitliefern — es wächst über die Jahre und wird eingeklappt kaum gelesen.
- **Suche im Speicher statt `ILIKE`.** `passtZuSuche` vergleicht Titel, Info-Texte und Orte nach `normalize('NFC')` und `toLocaleLowerCase('de')`; die Frage einer Umfrage zählt nicht, ein Treffer dort hätte in der Liste keinen sichtbaren Grund. `suche` wird getrimmt, leer heißt keine Suche. Mehr als 100 Zeichen sind 400 mit `feld: 'suche'` (ebenso ein wiederholter Parameter); gemessen wird nach dem Trimmen und in Code-Points wie bei der Nachricht (4.3), damit ein Leerzeichen am Rand einer Eingabe mit 100 Zeichen keine 400 ergibt. Verworfen: `ILIKE` (die erste Fassung der Tabelle) — `%`, `_` und `\` in der Eingabe müssten maskiert werden, und ob „ä“ „Ä“ findet, hinge an der Collation der Datenbank; die Threads sind für die Liste ohnehin geladen. Verworfen: Volltextsuche — Wortstämme helfen bei Namen und Orten nicht.
- `GET /start` liefert die `StartAnsicht` `{ brauchtAntwort, alsNaechstes, neu }`. Alle drei Blöcke kennen nur veröffentlichte, sichtbare, nicht archivierte Threads (6.1). `brauchtAntwort` nennt je offener Antwortzeile (3.13) Thread, Segment, Modul, `fuerId`, den Vornamen (`null` für die eigene Zeile) und die Frist als ISO-Zeitpunkt; den Fristtext rechnet der Client (6.3). `alsNaechstes` sind höchstens drei `TerminZeile`n (`naechsteTermine`), `neu` höchstens fünf Einträge mit Kurzangabe (3.9). Verworfen: drei Routen — jede lüde dieselben Threads.
- `GET /termine?monat=JJJJ-MM` liefert `{ termine: TerminZeile[] }`: je Termin, der den Monat berührt (`termineImMonat`, auch über die Monatsgrenze), Thread-ID, Segment, Titel und `TerminDaten`, sortiert wie „Als Nächstes“. Veröffentlichte, sichtbare Threads, auch archivierte — ein vergangener Monat soll seine Termine behalten —, aber keine Entwürfe, auch nicht für Jugendleiter (6.5). Ein fehlender, wiederholter oder ungültiger Monat (`^\d{4}-(0[1-9]|1[0-2])$`) ist 400 mit `feld: 'monat'`, geprüft vor dem Laden. Verworfen: ohne Monat den aktuellen nehmen — die Uhr des Servers träte an die Stelle der Adresse, die der Client geteilt und wieder geöffnet haben will. Verworfen: `TerminEintrag[]`, die Form, die `termineImMonat` selbst liefert (so noch im Plan) — der Client braucht das Segment für den Link in den Thread, und `TerminZeile` ist dieselbe Form wie in „Als Nächstes“.

### 4.2 Schreibpfad

Jede schreibende Route außer `gelesen` arbeitet in einer Transaktion über `mitAenderung(tx, vereinId, urheberId, jetzt, arbeit)`. Es muss die **erste schreibende Anweisung** der Transaktion sein und setzt READ COMMITTED voraus (Postgres-Vorgabe; unter REPEATABLE READ oder SERIALIZABLE scheiterten gleichzeitige Schreiber mit 40001, statt zu warten):

1. `aenderungsstand` um eins erhöhen; das UPDATE sperrt die Vereinszeile bis zum Commit (wie `sperreVereinszeile`, TP2; damit vergeben gleichzeitige Anfragen lückenlose, in Commit-Reihenfolge aufsteigende Stände, und eine zurückgerollte Transaktion verbraucht keinen). Der neue Stand geht an `arbeit(stand)`, **bevor** sie schreibt — ein Verlaufseintrag braucht seinen Stand beim Anlegen. Verworfen: eine Postgres-Sequenz — sie vergibt Nummern vor dem Commit, und eine später committete kleinere Nummer überholte ein Sync, der die größere schon gesehen hat.
2. `arbeit` schreibt die Daten und gibt Ergebnis und `aenderungen` zurück (je Eintrag `threadId`, `art`, `objektId`); `mitAenderung` schreibt je Eintrag eine `Aenderung` mit dem Stand und setzt `letzteAktivitaetAm` und `letzteAktivitaetStand` der betroffenen Threads, **nicht** für `GELOESCHT` (die Zeile ist weg), `SICHTBARKEIT` (eine neue Zielgruppe ist kein Beitrag, der den Thread in der Liste nach oben schieben soll) und `LISTE` (Anpinnen und Archivieren, 2.6); das sind die Arten in `OHNE_AKTIVITAET`.
3. Nach dem Commit das Ereignis an den Bus im Prozess melden (`deps.bus.melde`, 5.1). Die Routen kennen nur den Bus; der Hub abonniert ihn. Zwei Ereignisse: `aenderung` (Stand, Änderungen, betroffene Verlaufseinträge) und `pruefen` (die Sitzungen eines Vereins neu prüfen). Verworfen: Routen rufen den Hub direkt — ihre Tests bräuchten dann einen Hub, und unter `ng serve` lebt der Hub auf einem eigenen Port (5.1). Nach dem Commit, nie davor: Ein zurückgerollter Schreiber meldet nichts, und ein Signal darf keinen Stand nennen, den ein Sync noch nicht sieht. Der Bus liefert synchron, der Hub arbeitet darum asynchron und hält die Schreibroute nicht auf.

Jede Schreibroute prüft zuerst die Regeln aus Abschnitt 3 im Speicher.

**Entschieden wird unter der Sperre (Etappe 3).** Alles, was „angenommen oder nicht“ lautet, prüft die Route **in** der Arbeit von `mitAenderung`, wenn die Vereinszeile schon gesperrt ist: `PUT`, Veröffentlichen, Archiv, Anpinnen und Löschen laden den Thread dort und prüfen Version (2.1), 3.14 und die Löschbarkeit (3.6); die Prüfung vorab im Speicher spart nur den Weg zur 404. Ebenso prüfen `POST /threads/:id/verlauf` und `PUT /umfragen/…/antworten` Schreibsperre, Gefragtsein und Frist dort noch einmal: Der Editor kann Modus, Zielgruppe, Archiv und Frist zwischen Prüfung und Schreiben ändern. Verworfen: einmal vorab laden und darauf entscheiden — die Löschbarkeit liefe gegen einen Stand, den eine gleichzeitige Antwort schon überholt hat, und die Fremdschlüssel ohne Kaskade meldeten sie erst als P2003 (und damit als 404).

**Änderungsarten der Schreibrouten.** Verworfen: eine einzige Art `THREAD` für alles — Sync und „Neu“-Kennzeichen könnten dann nicht unterscheiden, ob Inhalt, Sichtbarkeit oder nur die Liste sich geändert hat.

| Route                         | Arten                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /threads`               | `THREAD`; je Modul `MODUL`                                                                                                                                                                    |
| `PUT /threads/:id`            | `THREAD`; je angelegtem, geändertem oder gelöschtem Modul `MODUL`; `SICHTBARKEIT`, wenn sich Rollenfilter oder Untergruppen eines veröffentlichten Threads ändern; je Systemeintrag `VERLAUF` |
| `POST …/veroeffentlichen`     | `THREAD`, `SICHTBARKEIT`, `VERLAUF` (Systemeintrag `VEROEFFENTLICHT`)                                                                                                                         |
| `PUT …/archiv`, `…/angepinnt` | `LISTE` (keine Aktivität, 2.6)                                                                                                                                                                |
| `DELETE /threads/:id`         | `GELOESCHT`                                                                                                                                                                                   |

**Ausnahme `PUT /threads/:id/gelesen`:** Es läuft ohne `mitAenderung`, ohne Änderungsstand und ohne `Aenderung`. Verworfen: es über `mitAenderung` zu schicken — jedes Öffnen schöbe den Thread in der Liste nach oben (`letzteAktivitaetAm`) und machte ihn für alle anderen „neu“ (3.9). Die Monotonie sichern bedingte Updates: `updateMany` mit `gelesenBis < neu` setzt nur hoch, zwei gleichzeitige Aufrufe enden beim größeren Wert, ohne zu lesen und zu schreiben. Die Zeile legt der erste Aufruf per `upsert` an; laufen zwei erste Aufrufe in den Unique-Index, genügt ein zweiter Durchlauf.

**Wiederholungen.** Antworten und Nachrichten sind über `clientId` idempotent: Eine Wiederholung liefert das vorhandene Ergebnis (200 statt 201), ohne einen Stand zu verbrauchen.

- Erkannt wird sie **unter der Sperre**: Die Arbeit in `mitAenderung` sucht die `clientId` erneut; ist sie schon da, wirft sie `Wiederholung` und rollt damit auch den eben vergebenen Stand zurück. Die Suche vor der Transaktion spart nur Sperre und Stand bei der häufigsten Wiederholung (das Netz brach nach dem Commit ab). Verworfen: die `clientId` nur vor der Transaktion suchen — zwei gleichzeitige Anfragen liefen beide an der Suche vorbei. Ein Unique-Verstoß (P2002) von einem Schreiber ohne Sperre wird genauso beurteilt.
- Gehört die `clientId` einer anderen Person, einem anderen Thread oder einer anderen Antwortzeile: 409 `CLIENT_ID_VERGEBEN` mit dem nichtssagenden Text „Ungültige Anfrage“, ohne etwas preiszugeben. Verworfen: einen Hinweis, wem die `clientId` gehört — der Anfragende darf nicht erfahren, dass es sie gibt und wer sie benutzt.
- **Reihenfolge der Prüfungen:** Rate-Limit, Form des Körpers (400), Thread laden und Sichtbarkeit beziehungsweise Gefragtsein (404), **dann die Suche nach der `clientId`**, erst danach die Sperren des Threads (Entwurf, „Nur Aushang“, archiviert: 409; Frist: 410) und die Zugehörigkeit der Optionen. Die Suche steht nach der 404, damit eine fremde `clientId` nichts über einen unsichtbaren Thread verrät, aber vor 409 und 410: Eine gespeicherte Nachricht oder Antwort, deren Rückmeldung unterwegs verloren ging, wäre sonst nach dem Archivieren oder nach der Frist eine Fehlermeldung, wenn die Outbox (Teilprojekt 5) sie wiederholt, und der Client hielte sie für gescheitert. Verworfen: die Suche erst hinter die 409/410 zu setzen — dann scheiterte genau die Wiederholung, für die es die `clientId` gibt.
- Bei Antworten hängt die `clientId` an der Zeile und wird bei jeder Änderung überschrieben; eine Wiederholung erkennt der Server nur, solange niemand die Zeile seither geändert hat. Verworfen: alle `clientId`s einer Zeile aufzuheben — eine eigene Tabelle für den seltenen Fall, dass die Outbox wiederholt, nachdem jemand anderes für dasselbe Kind neu geantwortet hat.

### 4.3 Grenzen

- Nachricht 1–2000 Zeichen, Info-Text 10 000, Titel 120, höchstens 20 Module und 20 Optionen. Die Nachricht wird ohne Leerraum an den Enden gespeichert und in Code-Points gezählt (wie `char_length` im CHECK); ein einzelnes Surrogat ohne Partner (JSON erlaubt `"\ud800"`) ist keine gültige Nachricht, weil es beim Schreiben als UTF-8 still zu U+FFFD würde. Verworfen: `text.length` — ein Emoji zählte doppelt, und die Grenze läge anders als die der Datenbank.
- Etappe 3: Modultitel 80, Ort und Treffpunkt je 200 Zeichen, Frage und Optionstext 1–200, Info-Text mindestens 1 Zeichen; weitere Grenzen in 2.2.
- `clientId` passt auf `^[A-Za-z0-9-]{1,100}$` (deckt `randomUUID` und `cuid`). Verworfen: jede Zeichenkette — sie landet im Unique-Index und in Fehlerberichten.
- Höchstens 30 Nachrichten und 60 Antworten pro Minute und Person (Rate-Limit im Speicher wie bei der Anmeldung).
- Anfragen höchstens 100 KB (TP2 8.5).

### 4.4 Fehler

- 404 für alles Unsichtbare, Unbekannte und Nicht-Gefragte, nie 403 (Rahmen 8.3); die Antwort ist in allen Fällen byte-gleich, sonst verriete jede Abweichung, dass es das Objekt gibt. Der Client zeigt dazu „Nicht gefunden oder keine Berechtigung“.
- 409 bei Konflikten aus 3.14 und doppelter Teilnahme-Umfrage, mit `feld`.
- **Fehlerformen der Verwaltung (Etappe 3).** Ein ungültiger Entwurf ist 400 `{ fehler: <Satz>, feld }` mit dem **ersten** Fehler; der Client prüft vorher mit derselben Funktion (`entwurfFehler`) und zeigt alle. Verworfen: dass der Server alle Fehler meldet — er ist nur das Netz für veraltete oder fremde Clients, und eine Liste wäre doppelte Arbeit ohne Leser. Konflikte sind 409 mit `code` und `feld`:
  - `BEANTWORTET`: 3.14 und das Entfernen einer beantworteten Umfrage;
  - `DOPPELTE_TEILNAHME`: eine zweite Teilnahme-Umfrage im Thread;
  - `VERALTET`: `version` stimmt nicht mit `bearbeitetStand` überein (2.1);
  - `AUSTAUSCH`: Zielgruppe, Module, Archiv oder Löschen am Austausch (8);
  - `NICHT_LOESCHBAR`: 3.6;
  - `KEINE_ZIELGRUPPE`: Veröffentlichen ohne Zielgruppe.

  Wer den Thread nicht bearbeiten darf: 404 wie bei Unsichtbarem.

- Schreiben in einem Entwurf, einem archivierten Thread oder im Modus „Nur Aushang“: 409 mit `code` `ENTWURF`, `ARCHIVIERT` beziehungsweise `NUR_AUSHANG`. Eine `clientId` einer fremden Zeile: 409 `CLIENT_ID_VERGEBEN` (4.2).
- 410 `FRIST_ABGELAUFEN` („Frist abgelaufen“); nur für Antworten, die nicht nachtragen dürfen (3.3).
- 400 mit `feld`. Vor dem Laden des Threads, aus dem Körper allein: leere, doppelte oder mehr als 20 Optionen, oder Einträge, die keine Zeichenkette sind → `feld: 'optionen'`; leere, zu lange oder ungültige Nachricht → `feld: 'text'`; fehlende oder unpassende `clientId` → `feld: 'clientId'`. Erst nach der 404, der Wiederholungssuche und den Sperren 409/410, weil sie die Umfrage brauchen: Optionen, die nicht zur Umfrage gehören (auch „Vielleicht“ bei abgeschaltetem Vielleicht), und mehrere Optionen bei `mehrfach = false` → ebenfalls `feld: 'optionen'` (sonst verriete die 400 die Optionen einer unsichtbaren Umfrage). `feld` heißt wie das Feld der Oberfläche (`optionen`, nicht `optionIds`): Der Client markiert damit die Auswahl, nicht ein Datenfeld.
- 429 mit `wartenSekunden` beim Rate-Limit (4.3).
- `fehler.ts` loggt nur noch Name und Code eines Fehlers, nicht das ganze Objekt (Rückstand aus Etappe 6: Prisma-Meldungen können Eingabewerte enthalten).

---

## 5. Echtzeit

### 5.1 WebSocket

- Ein Socket je Client und Verein unter `/<slug>/ws` (Bibliothek `ws`). Im Betrieb hängt sich der Hub an den `http.Server` aus `app.listen`. Beim Upgrade antwortet der Server **403** bei falschem `Origin` (gegen `BASIS_URL`, wie `pruefeUrsprung` der REST-Routen), **404** bei unbekanntem oder gesperrtem Verein, **401** ohne gültige Sitzung und **429** ab dem elften Socket einer Person. Verworfen: 401/404 auch für den Origin — die REST-Prüfung antwortet 403, und der Unterschied verrät nichts.
- **Signale ohne Abo je Thread, geprüft gegen das frische Umfeld.** Der Socket bekommt Signale zu allen Threads, die die Person sieht. Je Ereignis lädt der Hub die Köpfe der betroffenen Threads in einer Abfrage (`ladeKoepfe`) und prüft jedes Signal im Speicher mit `siehtThread`; das Umfeld des Vereins kommt aus einem Cache, den jede Umfeld-Änderung verwirft. Verworfen: Abos je Thread (Rahmen 7.5) — Liste, Start und Neu-Punkt brauchen ohnehin alle sichtbaren Threads.
- Signal: `{stand, threadId, art, objektId}`. Ein Signal ohne Thread trägt eine leere `objektId` (nach dem Gesamtreview): Es geht an alle Sockets des Vereins, und die ID der Person verriete jeder Familie, bei welchem Kind sich wann Rechte, Einwilligung oder Familie geändert haben; der Client lädt darauf ohnehin alles neu. **Nachrichten** gehen mit Inhalt (Absendername nach 3.10). Der Client lädt alles andere per REST nach; damit gibt es eine Datenquelle und keine zweite Rechteprüfung für Inhalte.
- **`SICHTBARKEIT` und `GELOESCHT` gehen an alle Sockets des Vereins, ohne Prüfung** (ebenso ein Signal ohne Thread, 2.6). Wer einen Thread gerade verloren hat, bestünde die Prüfung gegen den neuen Kopf nicht mehr, und ein gelöschter hat keinen Kopf. Live zeigt die Thread-Seite bei `GELOESCHT` sofort „Nicht gefunden“; bei `SICHTBARKEIT` fragt sie still über REST nach und bekommt 404 (5.3), und Liste und Start laden neu. `unsichtbar` (5.2) kommt erst aus dem Sync nach einem Abbruch. Kosten: Eine Familie erfährt die zufällige ID eines Threads, der seine Zielgruppe geändert hat oder gelöscht wurde; das verrät `unsichtbar` ohnehin. Verworfen: den Kopf von vorher durch das Ereignis reichen — jede Route bräuchte ihn, und der Gewinn ist eine ID, die nichts sagt.
- **Kein Schließen bei Rechteänderung** (weicht vom ersten Entwurf dieser Spec ab). Der Socket hält kein Umfeld; der Hub prüft jedes Signal gegen das aktuelle, und auf ein Signal ohne Thread laden alle Seiten nach (5.3). Geschlossen wird nur, wenn die **Sitzung** nicht mehr gilt: Abmelden, Zugang entzogen, Person entfernt, Sitzung abgelaufen, Verein gesperrt (und wenn der Hub selbst scheitert, siehe Schließcodes). Dafür prüft der Hub bei jedem Umfeld-Ereignis und bei `pruefen` die Sitzungen aller Sockets des Vereins neu (dieselbe Regel wie die Middleware, `sitzungGilt`) und bei jedem Ping die Sockets, deren gespeicherter Ablauf vorbei ist. Verworfen: jede TP2-Route nennt die Personen, deren Zugang endete — `entzieheZugangWennUngueltig` und `entferne` stecken in sieben Routen, und eine vergessene ließe einen Socket offen. Verworfen (aus dem ersten Entwurf): bei Rechteänderungen schließen und neu verbinden lassen.
- **Schließcodes:** 4401, wenn die Sitzung oder der Verein nicht mehr gilt; 1012 beim Herunterfahren (SIGTERM, Etappe 6, „gleich zurück“); 1011, wenn der Hub selbst scheitert (nach dem Gesamtreview): Scheitert das Verteilen eines Ereignisses (etwa die Datenbank beim Laden von Umfeld oder Köpfen), schließt er alle Sockets des Vereins; scheitert die Prüfung der Sitzungen, die geprüften Sockets. Der Client gleicht danach ab seinem alten Stand ab (5.3), und der Upgrade prüft die Sitzung frisch. Verworfen: nur loggen und offen lassen — Lücken erkennt der Client nur am Abbruch (5.2), das nächste gelungene Signal höbe seinen Stand über das verlorene, und ein abgemeldetes Gerät bekäme bei gescheiterter Prüfung weiter Nachrichten. 1000, wenn der Client selbst schließt. Der Client kennt den Grund eines abgewiesenen Upgrades nicht (der Browser meldet nur 1006) und fragt darum `GET /sync` (5.3).
- Ping alle 30 Sekunden; ohne Antwort wird der Socket geschlossen.
- Speicher: Bei höchstens einigen Dutzend gleichzeitigen Verbindungen je Verein ist der Bedarf gegen die 256 MB der App zu vernachlässigen (seit TP4 Etappe 2 hat sie mehr, siehe `deploy/jufi-services.yml`); der Hub begrenzt trotzdem auf 10 Sockets je Person.
- **Lokale Entwicklung**: Unter `ng serve` gibt es keinen eigenen `http.Server`. Dort lauscht der Hub auf `JUFI_WS_DEV_PORT` (Vorgabe 4201), und `apps/jufi/proxy.conf.json` leitet `^/[^/]+/ws$` mit `ws: true` dorthin. Lädt Vite `server.ts` neu, schließt der neue Hub den alten (Griff auf `globalThis`); sonst hinge der alte am alten Bus und bekäme nie ein Ereignis. Das geschieht in `betriebsApp()`, nie beim Bau (CLAUDE.md, „Was nachweislich stolpert“). Der Dev-Hub hat einen eigenen Server, weil der Upgrade-Handler nach dem Schließen der Sockets am Server hängen bliebe und weitere Upgrades zerstörte.
- Traefik reicht Upgrades von selbst durch; `tools/pruefe-betrieb.sh` prüft den Upgrade auf der Testdomain.

### 5.2 Sync

`GET /sync?seit=n` liefert `SyncAntwort {stand, geaendert: threadId[], unsichtbar: threadId[], vollstaendig}`:

- `geaendert`: sichtbare Threads mit einer `Aenderung` nach `n`.
- `unsichtbar`: Threads mit Änderung nach `n`, die die Person nicht (mehr) sieht. Die Kennungen allein verraten nichts, weil sie zufällig sind; der Client wirft solche Threads aus Liste und Ansicht.
- `vollstaendig: true`, dann sind beide Listen leer und der Client lädt alles neu. Das gilt, wenn `seit` fehlt, wenn `seit` größer ist als der Stand (die Datenbank stammt aus einer Sicherung), wenn `seit` vor dem ältesten aufbewahrten Stand liegt (`seit < aeltester - 1`, ohne Zeilen `seit < stand`) oder wenn nach `seit` eine Änderung ohne Thread kommt (2.6). Ein leerer Stand (eine Transaktion ohne `Aenderung`) kann so ein unnötiges „alles neu“ auslösen, nie ein verpasstes. Verworfen: den Aufräum-Stand im Verein speichern — eine Spalte für ein gelegentlich überflüssiges Neuladen.
- `seit` über 2147483647 (INT4) ist 400 (`feld: 'seit'`), statt es auf den Höchstwert zu klemmen: Kein echter Client hat so einen Stand, und die Spalte ist `Int`.

**Der erste Sync nach dem Start der Hülle hat kein `seit`** und lädt darum einmal alles neu. Kosten: Liste und Start werden beim Öffnen der App zweimal geladen. Verworfen: den ersten Stand ungeprüft zu übernehmen — eine Änderung zwischen dem Laden der Seite und dem Verbinden fehlte bis zur nächsten Navigation.

Der Client ruft Sync nach dem Öffnen jedes Sockets, nach jedem Abbruch und beim Zurückkehren in den Vordergrund. Er erkennt Lücken **nicht** an fehlenden Nummern in den Signalen — die gefilterten Signale haben immer Lücken —, sondern am Abbruch der Verbindung. Verworfen: Lückenerkennung über fortlaufende Nummern (Rahmen 9.1) — mit einem Zähler je Verein und gefilterten Signalen fehlen stets Nummern.

### 5.3 Client

- Ein Dienst `Echtzeit` je Mitglieder-Hülle hält den Socket und meldet Ereignisse (`Signal`, `sync`, `alles`) an die Seiten. Er startet mit dem Slug der Hülle und endet mit ihrem Abbau (Schließcode 1000).
- **Verbunden heißt: erster Abgleich über den offenen Socket gelungen.** Erst dann setzt der Client `verbunden`, löscht den Hinweis und setzt den Backoff zurück; ein gelungener Abgleich nach einem Abbruch (ohne Socket) tut das nicht. Verworfen: alles schon beim Öffnen — bei gesundem Upgrade und kaputtem REST öffnete der Client sonst jede Sekunde neu, und der Hinweis käme nie. Scheitert der Abgleich bei offenem Socket (Netz, 5xx), schließt der Client ihn und verbindet mit Backoff neu; Signale heben den Stand erst wieder, wenn ein Abgleich gelungen ist, damit der nächste nicht ab einem Stand fragt, dessen Vorgänger nie ankam.
- **Nach `vollstaendig` übernimmt der Client den Stand des Servers, auch wenn er niedriger ist.** Nach einer Wiederherstellung aus der Sicherung läge `seit` sonst über dem Server-Stand, und sobald der ihn überholt, übersähe der Abgleich die Änderungen dazwischen. Sonst gilt das Maximum aus Signalen und Abgleichen. Verworfen: immer das Maximum.
- **Neuverbinden:** Backoff 1 Sekunde, verdoppelt bis 30 Sekunden, ±20 % Zufall. Nach jedem Abbruch außer 1012 fragt der Client `GET /sync`: 401 meldet die abgelaufene Sitzung und er gibt auf, 404 gibt auf, jeder andere Fehler wendet nichts an und verbindet mit Backoff neu; nach 1012 verbindet er mit Backoff neu, ohne vorher zu fragen (der Abgleich folgt nach dem Öffnen). Beim Zurückkehren in den Vordergrund gleicht ein verbundener Client ab, ein wartender verbindet sofort.
- **Hinweis:** „Nicht verbunden – Inhalte evtl. veraltet“ steht dezent im Kopf, aber erst nach 2 Sekunden ohne `verbunden` (kein Socket oder kein gelungener Abgleich), damit ein kurzes Wiederverbinden nicht aufblitzt.
- **Vor dem Abmelden hält `Echtzeit` an** (beide Wege: „Abmelden“ und „Überall abmelden“) und verbindet sich neu, wenn das Abmelden scheitert. Sonst schlösse der Hub den Socket mit 4401, der Abgleich bekäme 401 und schickte mit `weiter=` zur Anmeldung, bevor das Abmelden selbst dorthin navigiert hat. Die Meldung kommt von `MitgliedSitzung.abmelden` (Ereignis `abmeldung`), das beide Wege durchlaufen; `Echtzeit` abonniert es selbst. Verworfen: Mehr und Profil halten `Echtzeit` selbst an — jede neue Stelle zum Abmelden müsste daran denken. Verworfen: im Abgleich nur das 401 während des Abmeldens nicht weiterleiten — Abgleich und Neuverbinden liefen dann mit einer Sitzung weiter, die gleich endet.
- **Seiten laden auf Ereignisse nach, über einen Nachlader:** Kommt ein Anlass, während die Ressource lädt, lädt sie danach genau einmal neu; Anlässe binnen 250 ms werden zusammengefasst. Verworfen: `reload()` direkt — es ist während einer Anfrage wirkungslos, und ein Signal ginge verloren.
  - Start lädt bei jedem Ereignis neu, Termine bei jedem außer `VERLAUF` und `ANTWORT`, die Thread-Liste nur im erweiterten Zustand (Suche, Archiv); ihren Grundzustand lädt die Hülle (6.1).
  - Die Thread-Seite lädt still nach, ohne die Karten zu leeren: `GELOESCHT` oder `unsichtbar` zeigt „Nicht gefunden“ ohne Anfrage, eine Nachricht im offenen Verlauf wird eingefügt, alles andere löst die stille Aktualisierung aus (Gelesen: 3.9); bei `SICHTBARKEIT` und einem Signal ohne Thread antwortet der Server darauf 404, und die Seite zeigt dann „Nicht gefunden“. Bei `sync` und `alles` frischt auch der Verlauf auf. Eine gelöschte Fassung einer Nachricht gewinnt beim Mischen gegen eine ungelöschte: Löschen ist endgültig, und am Stand ist die neuere nicht zu erkennen, beide tragen den der Nachricht. Verworfen: die neuere Fassung am Stand erkennen. Der Verlauf scrollt bei einer neuen Nachricht nur ans Ende, wenn die Person schon unten war.
- **Grenze:** Dass ein Kind über die Uhr volljährig wird, löst kein Signal aus; erst die nächste Prüfung gilt mit dem neuen Tag.

---

## 6. Oberflächen

### 6.1 Mitglieder-Hülle und Start

- Untere Leiste: **Start · Threads · Termine · Mehr** (Medien folgt mit Teilprojekt 4). „Threads“ bleibt auch in einem Thread (`/<slug>/t/…`) markiert. Ein Punkt an „Threads“ zeigt, dass ein nicht archivierter Thread neu ist (3.9).
- **Der Punkt lädt mit der Liste.** Ein Dienst der Hülle (`ThreadUebersicht`) lädt `GET /threads` beim Öffnen und nach jeder Navigation innerhalb der Hülle, die den Pfad wechselt; die Thread-Liste nutzt dieselbe Ressource für ihren Grundzustand (ohne Suche, Archiv zu). Dazu fragt die Thread-Seite nach einem angekommenen Gelesen-Stand der Übersicht selbst neu (`ThreadUebersicht.neuLaden`), weil die Anfrage zum Pfadwechsel ihn überholen kann (wer gleich nach dem Öffnen „Zurück“ tippt). Mit Etappe 5 lädt die Hülle bei einer Navigation nur noch ohne Verbindung neu; mit Verbindung kommen die Änderungen als Signale (5.3). Der Punkt nach dem Lesen bleibt bei der Thread-Seite: `PUT gelesen` schreibt keine `Aenderung` und löst darum kein Signal aus. Verworfen: eine eigene Route für den Punkt — sie rechnete dasselbe wie die Liste. Verworfen: den Punkt nur aus der zuletzt geladenen Seite setzen — wer direkt in einen Thread springt, sähe nie einen.
- Eine Navigation, die nur die Parameter der Adresse ändert (Suche, `?reiter=`), lädt den Punkt nicht neu: Ein Gelesen-Stand ohne Pfadwechsel (vom Verlauf zur Übersicht) kommt über die Thread-Seite (oben), und jede Suchtaste als Anfrage wäre Last ohne Nutzen. Verworfen: nach jeder Navigation neu laden, auch bei reinem Parameterwechsel.
- Start zeigt oben die drei Blöcke aus Rahmen 5.2 als **einen Abschnitt** aus `GET /start` (4.1) mit einem gemeinsamen Fehlerzustand; Begrüßung und Karten darunter bleiben von ihm unberührt. Ein Block erscheint nur mit Inhalt. Während des Ladens und wenn alle drei leer sind, steht dort nichts, auch keine leere Karte: Die Startseite soll an einem ruhigen Tag ruhig sein. Verworfen: ein „Wird geladen“, das bei jedem Besuch kurz aufblitzte und meist gleich wieder wegfiele. Verworfen: je Block ein eigener Fehlerzustand — die drei kommen aus einer Antwort.
  - **Braucht deine Antwort** (3.13), etwa „Lena: Bowling noch offen · bis Do 18:00“ (ohne Frist ohne „· …“); Tippen springt zur Umfrage (`/<slug>/t/<id>/m/<modulId>`).
  - **Als Nächstes**: höchstens drei Termine mit Zeit, Ort und Thread; Tippen springt ins Termin-Modul. Der Ort steht als Text ohne Karten-Link: Die Zeile ist schon ein Link ins Termin-Modul, ein Link im Link ist ungültiges Markup, und der Karten-Link steht im Modul (6.3). Verworfen: `kartenLink` in der Zeile — der Preis ist ein Tipp mehr bis zur Karte.
  - **Neu seit deinem letzten Besuch**: höchstens fünf Threads mit Kurzangabe (3.9); Tippen öffnet den Thread.
- Darunter bleibt alles aus TP2 6.2: Begrüßung, Jungfischer-Karten, Ansprechpartner mit Kontakttext, „In der Verwaltung warten“.

### 6.2 Thread-Seite

- URL `/<slug>/t/<id>-<titel-slug>`; maßgeblich ist die ID, ein umbenannter Thread bleibt erreichbar (Rahmen 5.4); die Seite schreibt ein veraltetes Segment ohne neuen Eintrag in der Browser-Historie (`replaceUrl`) auf den aktuellen Titel um. Verworfen: den Titel nie umschreiben — er stünde sonst in jeder Adresse, die jemand aus der Leiste kopiert, falsch da. Deep Links `?reiter=verlauf` und `/<slug>/t/<id>/m/<modulId>` scrollen zur Stelle und heben sie hervor.
- **Die ID kennt zwei Formen:** `cuid` (vom Code) und `gen_random_uuid()` (der Austausch aus der Migration, mit Bindestrichen). `idAusSegment` erkennt zuerst die UUID-Form, sonst gilt alles bis zum ersten Bindestrich. Verworfen: immer bis zum ersten Bindestrich — die UUID des Austauschs würde nach ihrem ersten Block abgeschnitten, und der Austausch wäre über seine Adresse nie zu öffnen. Verworfen: den Slug mitprüfen und bei einem umbenannten Thread umleiten — jeder alte Link geht über die ID ohnehin auf. Ein Segment ohne lesbare ID ergibt ohne Anfrage dieselbe Seite wie ein 404.
- Kopf: Titel, „Teilen“ (7.1), für Berechtigte „Bearbeiten“ (öffnet den Editor in der Verwaltung). Unter 480 px zeigt „Bearbeiten“ nur den Stift (der Text bleibt für Screenreader): Der Teilen-Knopf nimmt dem Titel Platz, und Bearbeiter sähen bei einem langen Titel sonst eine Wortsäule. Verworfen: „Bearbeiten“ mit Text lassen — der Teilen-Knopf nimmt dem Titel 52 px, und bei 375 px blieben ihm mit langem Titel 114 px (sieben Zeilen). Der Zurück-Pfeil führt seit Etappe 4 zur Thread-Liste (`/<slug>/threads`, 6.5); bis dahin führte er zur Startseite, weil es die Liste noch nicht gab. Verworfen: Browser-Zurück — ein geteilter Link hat keine Seite davor.
- Geöffnet wird immer die **Übersicht**, auch bei Threads im Modus „Offener Chat“ (kein Start-Reiter je Modus); Entscheidung des Eigentümers vom 21.10.2026. Verworfen: den Reiter nach Modus wählen — `?reiter=verlauf` genügt für Links, die in den Chat führen sollen.
- Reiter **Übersicht** und **Verlauf** (mit Zähler). Der Reiter Verlauf fehlt nur bei „Nur Aushang“ ohne Nachrichten; bei „Nur Aushang“ mit Nachrichten bleibt er lesbar, ohne Eingabefeld. Der Zähler `verlauf.eintraege` der Ansicht zählt nur Nachrichten (gelöschte eingeschlossen), keine Systemeinträge. Verworfen: den Verlauf bei „Nur Aushang“ ausblenden (Rahmen 6.1 wörtlich) — nach der Veranstaltung verschwände das Gespräch. Verworfen: alle Einträge zählen — jedes Veröffentlichen schreibt ab Etappe 3 einen Systemeintrag (3.6), der Reiter erschiene dann bei jedem veröffentlichten Aushang, mit dem einen Satz „veröffentlicht“.
- Archivierte Threads tragen oben den Hinweis „Archiviert“; für Berechtigte mit „Wiederherstellen“.

### 6.3 Module

- **Info-Text**: gerendertes Markdown (3.11).
- **Termin**: Zeitangabe (3.8), Ort mit Karten-Link, Treffpunkt, Knopf „In Kalender eintragen“ mit „Kalender des Telefons“ (.ics) und „Google Kalender“ (FAM 3.3, 3.4).
- **Umfrage**: Frage, Frist (Fristtext, s. u.), je Antwortzeile Pillen („✓ Dabei“, „? Vielleicht“, „✗ Abgesagt“ beziehungsweise die Optionen) oder bei Mehrfachauswahl Haken und „Antworten“; daneben „eingetragen von …“ (3.3). Darunter die Ergebnisse nach 3.4.

**Fristtext** (`fristText(frist, jetzt)`): „bis Do 18:00“, wenn die Frist in den nächsten sechs Berliner Kalendertagen liegt, sonst „bis Do 29.10. 18:00“, damit derselbe Wochentag nicht auch die Woche darauf meinen kann; ab `jetzt >= frist` „Frist abgelaufen“ (passend zum Server, der in der Fristsekunde 410 antwortet). Gerechnet wird in Kalendertagen, nicht in 24-Stunden-Spannen. Im Systemsatz des Verlaufs steht dagegen immer die volle Form „Do 22.10. 18:00“ (`fristZeitpunkt`), weil der Satz stehen bleibt und „Do“ dort in einer Woche nicht mehr eindeutig wäre. `UmfrageAnsicht.frist` ist ein ISO-Zeitpunkt oder `null`; der Client rechnet den Fristtext mit der aktuellen Uhrzeit selbst. Verworfen: den fertigen Text vom Server schicken — er veraltete bei offener Seite, und Zeiten gehen überall als ISO über die Leitung. Die Zeitzone bleibt Berlin, weil beide Seiten dieselbe Domänenfunktion nutzen, nie die des Browsers.

### 6.4 Verlauf

Eingabefeld fest über der unteren Leiste, Absender nach 3.10, Systemeinträge gedämpft, „Frühere laden“ am oberen Ende, Menü an eigenen (und für Berechtigte an fremden) Nachrichten mit „Löschen“. Erkannte Links werden klickbar; sonst Klartext.

### 6.5 Threads und Termine

Beide Seiten liegen in der Mitglieder-Hülle (6.1) und tragen ihren Zustand in der Adresse, damit ein geteilter Link und das Zurück des Browsers aus einem Thread an dieselbe Stelle führen.

- **Threads** unter `/<slug>/threads` (`?suche=`): Suchfeld „Threads durchsuchen“, Abschnitte „Angepinnt“, „Aktiv“ (nach letzter Aktivität), „Archiv · N“ (eingeklappt, lädt erst beim Aufklappen, 4.1). Je Zeile Titel, nächster Termin, Neu-Punkt; Jugendleiter sehen Entwürfe mit „· Entwurf“. Jugendsprecher sehen den Austausch unter „Angepinnt“. Die Suche schreibt sich ohne eigenen Verlaufseintrag in die Adresse (sonst führte Zurück durch das Wort statt von der Seite weg) und klappt das Archiv auf, damit archivierte Treffer nicht dahinter liegen. Leer: „Noch keine Threads.“, mit Suche „Keine Treffer.“
- **Termine** unter `/<slug>/termine` (`?monat=JJJJ-MM`; ohne gültigen Monat der aktuelle Berliner Monat): Monatsraster ab Montag mit Markierungen, darunter die Termine des Monats („Keine Termine in diesem Monat.“); mehrtägige Termine markieren jeden Tag, auch über die Monatsgrenze; Tippen auf eine Zeile führt ins Termin-Modul des Threads (Entwurf, FAM 4). Die Felder des Rasters tun nichts: Ein Tipp auf einen Tag führte bei mehreren Terminen oder keinem ins Leere. „Voriger Monat“ und „Nächster Monat“ blättern mit eigenem Verlaufseintrag. Der Monat steht in der Adresse, damit Zurück aus einem Thread in denselben Monat führt.
- **Das Raster hat immer 6 × 7 Felder** ab Montag, Tage außerhalb des Monats bleiben leer (`monatsRaster`). Verworfen: so viele Wochen wie nötig — die Liste darunter spränge beim Blättern um eine Zeile.
- **Entwürfe stehen nicht im Kalender,** auch nicht für Jugendleiter; archivierte Threads schon (4.1). Verworfen: Entwürfe im Kalender der Jugendleiter — Start und Kalender zeigen, was stattfindet; Geplantes steht in der Verwaltung.

### 6.6 Verwaltung

- Neuer Punkt **Threads** in der Seitenleiste für alle Jugendleiter. Ohne „Threads erstellen“ und „Alle Threads bearbeiten“ ist die Liste nur lesbar. Der Link „Antworten“ in der Liste erscheint nur mit dem Recht, die Antworten zu sehen (`darfAntwortenSehen` über `siehtAntworten`, 3.5); verworfen: ihn für jeden Thread mit Umfrage zu zeigen — wer nicht darf, landete auf einer 404-Seite.
- **Editor** (Rahmen 5.1):
  - Links das Formular: Titel, Zielgruppe (Untergruppen „Alle“ oder Auswahl, Rollenfilter), Modus, „Mitglieder benachrichtigen“ (bis Teilprojekt 5 gesperrt mit Hinweis), Modulliste mit „Hoch“, „Runter“, „Entfernen“, „Modul hinzufügen“.
  - Rechts die Live-Vorschau im Handyrahmen mit hervorgehobenem Modul; unter 1024 px Breite umschaltbar statt daneben.
  - Knöpfe „Entwurf speichern“, „Veröffentlichen“ beziehungsweise „Speichern“, „Löschen“ (nur nach 3.5).
  - Fehler am Feld; eine leere Zielgruppe (Auswahl ohne Untergruppe) lässt sich nicht speichern. Ein Feldfehler des Servers bleibt an seinem Modul, auch wenn es danach verschoben wird. Nennt der Server ein Feld, das der Editor für Typ und Modus dieses Moduls nicht zeigt (`zeigtModulFeld`), steht der Satz unter den Knöpfen statt an einer unsichtbaren Stelle.
  - Der Editor bietet nur Einheiten an, die beim gewählten Rollenfilter jemanden fragen (3.2). Beim Hinzufügen einer Umfrage und beim Wechsel des Rollenfilters stellt der Editor die Einheit einer **ungesperrten** Umfrage sofort auf die erste passende um (`einheitenFuer`), damit kein Fehler an einem Feld entsteht, das niemand angefasst hat. Verworfen: die Einheit stehen lassen und den Fehler erst beim Speichern zeigen.
  - Welche Felder gesperrt sind, wenn Antworten vorliegen, steht in 3.14; Teilnahme-Umfragen ohne „Vielleicht“ und ohne Mehrfachauswahl in 3.12.
- **Antworten-Übersicht** je Umfrage: je Option die Namen, „Noch offen“ mit Namen, je Zeile „Eintragen“ (Nachtragen). „Stand teilen“ steht seit Etappe 6 im Kopf der Thread-Seite (7.1), nicht in dieser Übersicht; verworfen (Etappe 3): einen vorläufigen Text bauen, den Etappe 6 ersetzt.
  - **Nachtragen bei Mehrfachauswahl:** „Eintragen“ klappt die Optionen als Umschalter auf, vorbelegt mit der bisherigen Auswahl. Jeder Tipp speichert die **ganze neue Menge**; die letzte gewählte Option lässt sich nicht abwählen (eine Antwort ohne Option gilt als keine, 3.2). Verworfen: eine Option ersetzt die Auswahl — gespeicherte Antworten gingen dann still verloren. Verworfen: „Eintragen“ nur für offene Zeilen — eine Mehrfach-Antwort ließe sich dann nicht mehr ändern. Ohne Mehrfachauswahl ersetzt eine Option die bisherige.
- Im Austausch-Thread sind Zielgruppe, Module, Löschen und Archivieren gesperrt (8).

### 6.7 Gestaltung und Messung

Tokens und Bauteile aus TP2. Gemessen bei 375 × 812 und 1280 × 800, hell und dunkel, mit 44-px-Tippflächen und ohne horizontales Scrollen (CLAUDE.md).

### 6.8 Fehler im Client

- 401: `beiAbgelaufenerSitzung` (TP2), zurück über `weiter=`.
- 404 oder Signal „unsichtbar“: „Nicht gefunden oder keine Berechtigung“.
- 410 an der Umfrage: „Frist abgelaufen“.
- Ein globaler Router-Fehlerhandler lädt die Seite einmal neu, wenn nach einem Deployment ein Lazy-Chunk fehlt (Rückstand aus Etappe 5; mit den neuen Seiten wird er dringlicher).

---

## 7. Teilen und Link-Vorschau

### 7.1 Teilen

`teilenText({ ansicht, basisUrl, slug, jetzt })` (`libs/domain/src/threads/teilen.ts`) erzeugt WhatsApp-tauglichen Text (Rahmen 6.7), **mit dem, was der Teilende selbst sehen darf** (3.4):

```
🎳 *Bowling* – Stand Fr 18:30
📅 Sa 24.10. · 14:00–17:00 · Bowlingcenter
✅ Dabei (9): Lena M., Max M., Tim S., …
🤔 Vielleicht (1): Mia K.
❌ Abgesagt (3): …
❓ Offen (4): Jonas K., …
👉 Antworten: https://test.jufi-app.de/glonntal/t/ck…-bowling
```

- Nur Summe: „✅ Dabei: 9“ usw.; „nichts“: die Umfrage entfällt im Text.
- Weitere Umfragen als „📊 Frage“ und „• Option (n)“ mit Namen nach 3.4.
- Bis zehn Namen, dann „, …“; WhatsApp-Formatzeichen in fremdem Text werden durch gleich aussehende Zeichen ersetzt; das Emoji des Titels steht außerhalb der Sternchen (Entwurf).
- Stand-Zeit in Berlin (`<Wt> <HH:MM>`).
- Teilen kann jeder Leser; Teilprojekt 4 ergänzt Zeilen für Fahrer und Kosten.

**Der Text entsteht im Client aus der `ThreadAnsicht`.** Die Ansicht ist schon je Betrachter gerechnet (die `auswertung` nach 3.4), also steht im Text nur, was der Teilende ohnehin auf dem Bildschirm sieht: Sieht eine Familie eine Umfrage nur als Summe, steht dort „✅ Dabei: 3“ ohne Namen, und bei „nur Jugendleiter“ fehlt die Umfrage ganz. Verworfen: eine Route `GET /threads/:id/teilen` — Safari verlangt `navigator.share` innerhalb der Nutzergeste, und eine Anfrage davor verbraucht sie, das Teilen ginge dann am iPhone nicht.

**Der Link nimmt `location.origin`, nicht `BASIS_URL`.** Die App ist nur unter `BASIS_URL` erreichbar (`security.allowedHosts` lässt keinen anderen Host zu, der Proxy leitet um), beides ist also dasselbe. Verworfen: `BASIS_URL` an den Client ausliefern — ein Feld nur für diesen Zweck. (Das Bild der Link-Vorschau, 7.2, nimmt dagegen `BASIS_URL`, denn der Server hat keinen `location`.)

**Teilen oder Kopieren entscheidet der Zeiger** (`teile` in `apps/jufi/src/app/verein/threads/teilen.ts`):

- Bei `(pointer: coarse)` und vorhandenem `navigator.share` öffnet die App das Teilen-Blatt, sonst kopiert sie in die Zwischenablage und zeigt „Kopiert“.
- Schließt die Person das Blatt (`AbortError`), passiert nichts, auch kein Kopieren: Sie hat sich entschieden. Scheitert das Teilen anders, wird kopiert. Ein zweiter Tipp, während das Blatt offen ist, wird ignoriert.
- Scheitert das Kopieren (unsicherer Kontext, verweigert), erscheint der Text in einem schreibgeschützten Feld zum Markieren, wie bei `einladung-anzeige.ts`.
- Verworfen: immer `navigator.share`, wenn vorhanden — Chrome unter Windows öffnet dann den Systemdialog, obwohl die Person am Rechner „Kopieren“ erwartet. Der grobe Zeiger trennt Handy und Rechner, ohne den Gerätetyp zu raten.

**Kein Teilen bei Entwürfen:** Der Knopf fehlt dort. Den Link öffnet außer den Bearbeitern niemand (3.1), also hätte das Teilen keinen Empfänger. Verworfen: der Knopf auch im Entwurf — er teilte einen Link ohne Empfänger.

Die „Kopiert“-Meldung (`<jf-meldung />`) sitzt seit Etappe 6 einmal in der Wurzel der App (`app.ts`); vorher stand sie nur im Rahmen des Plattform-Admins (`admin-rahmen.ts`), und weder „Kopiert“ auf der Thread-Seite noch „Gespeichert“ in den Einstellungen war zu sehen. Verworfen: je Hülle eine eigene — die nächste Hülle hätte sie wieder vergessen.

### 7.2 Link-Vorschau

Eine Express-Route vor dem Angular-Handler (`vorschauRouten`, `GET /<slug>/t/:segment`) beantwortet die Adresse mit der Seite, die Angular sonst ausliefert, und setzt Open-Graph-Tags in deren Kopf (Rahmen 7.6). Ein Messenger holt die Seite ohne Cookie und liest nur den Kopf.

- **Die Seite kommt aus `deps.seitenHtml(req)`.** In `server.ts` ist das `angularApp.handle(req)` und dann `htmlAusAntwort` (`verein/html-antwort.ts`: nur 2xx mit `text/html` gilt als Seite, sonst `null`, damit etwa die 400-Antwort der Host-Prüfung nicht zu einem 200 wird), in Tests ein festes Gerüst. So kommen die Tags unter `ng serve` und im Image in dieselbe `index.html` samt aktuellen Skript-Hashes. Liefert Angular nichts oder keine Seite, reicht die Route weiter. Verworfen: `index.csr.html` aus `dist` lesen — unter `ng serve` gibt es die Datei nicht. Verworfen: eine eigene HTML-Vorlage in Express — sie liefe dem Angular-Bau hinterher. `angularApp` steht in `server.ts` außerhalb von `betriebsApp()`, `seitenHtml` wird erst bei einer Anfrage gerufen, denn die Datei läuft auch beim Bau.
- **Unbekannter oder gesperrter Verein: die Route reicht weiter** (`next()`). Angular antwortet dann wie bisher, ohne Tags. „404 wie bisher“ heißt also: Nichts ändert sich, auch keine Datenbankauskunft. Verworfen: `vereinAusSlug` vorschalten — es antwortet mit JSON-404, und ein Mensch mit einem Tippfehler im Link sähe statt der Seite JSON.
- **Tags**, alle Werte HTML-maskiert (`& < > " '`): `og:type` = `website`, `og:site_name` = Anzeigename des Vereins, `og:title` = Thread-Titel oder Anzeigename, `og:image` = `<BASIS_URL>/<slug>/icon-512.png` (immer das Vereins-Icon in 512 px) mit `og:image:width` und `og:image:height` = `512`. Sonst nichts, auch keine Beschreibung („keine weiteren Daten“). Der Titel ist fremder Text; die Maskierung setzt ihn nie als Markup in den Kopf, und er wird ohne Regex-Ersetzung eingesetzt, damit `$&` darin nichts auswertet.
- **Titel** nur, wenn der Thread veröffentlicht ist und seine Zielgruppe Familien einschließt (`JUNGFISCHER_FAMILIE`, `NUR_FAMILIE`; `vorschauTitel` in `@jufi/domain`). Für alle anderen Threads, Entwürfe, den Austausch, Threads eines anderen Vereins unter diesem Slug und unbekannte IDs: dieselbe neutrale Vorschau mit dem Vereinsnamen, **byte-gleich**. Ein Segment ohne lesbare ID gilt als unbekannte ID. Verworfen: je Fall eine eigene Antwort — jeder Unterschied verriete, dass es den Thread gibt.
- Die IDs sind zufällig (`cuid`), damit niemand Titel durch Ausprobieren findet. Verworfen: fortlaufende Nummern je Verein (Entwurf) — erratbar.
- `Cache-Control: no-store`; keine weiteren Daten. Eine Vorschau, die den Titel eines inzwischen zurückgezogenen Threads zeigt, wäre genau das Leck, das es nicht geben soll.
- Verworfen: immer den Titel zeigen (Rahmen 6.7 wörtlich) — Titel von Jugendleiter-Threads wären für jeden mit dem Link lesbar. Verworfen: nie einen Titel — in WhatsApp sähe jeder Link gleich aus.

**Bekannte, angenommene Folge: Untergruppen zählen nicht.** Ist ein Familien-Thread auf Untergruppen beschränkt, zeigt die Vorschau den Titel trotzdem jedem, der den (nicht erratbaren) Link hat, auch Familien außerhalb der Untergruppe, die den Thread selbst nicht öffnen könnten (3.1). Die Regel fragt nur nach Veröffentlichung und Rollenfilter. Die Alternative, die Sichtbarkeit für Untergruppen zu prüfen, geht nicht: Ein Vorschau-Abruf trägt keinen Cookie und damit keine Person, gegen die sich `siehtThread` rechnen ließe. Wer einen solchen Link weitergibt, gibt auch den Titel weiter; der Titel eines Untergruppen-Threads sollte darum nichts enthalten, was nur diese Untergruppe wissen darf. Die Datenschutzerklärung sagt es so (9.3).

---

## 8. Jugendsprecher-Austausch

- Ein Thread mit `art = JUGENDSPRECHER_AUSTAUSCH`, Titel „Jugendsprecher-Austausch“, Modus „Offener Chat“, Rollenfilter „Jugendleiter + Jugendsprecher“, angepinnt, `erstelltVonId = null`, sofort veröffentlicht (Rahmen 3.5, FAM 2).
- Entsteht beim Anlegen jedes Vereins (Admin, CLI, Test-Hilfen) in derselben Transaktion; bestehende Vereine bekommen ihn per Migration.
- Titel, Modus und Anpinnen ändert, wer „Alle Threads bearbeiten“ hat; Module bekommt der Austausch nicht. Zielgruppe, Archivieren und Löschen sind gesperrt. Auch ohne Pin wird er nie automatisch archiviert (3.7). Verworfen: Archivieren erlauben (Rahmen 4.2 macht keine Ausnahme) — der Austausch ist eine Dauereinrichtung, und ein archivierter Austausch nähme den Jugendsprechern das Schreiben.
- Verliert ein Jungfischer das Merkmal, sieht er den Thread nicht mehr (404); seine Nachrichten bleiben mit seinem Namen stehen.
- Der Hinweis unter „Meine Jungfischer“ besteht seit TP2.

---

## 9. Datenschutz und Betrieb

### 9.1 Datenauszug

Der Datenauszug im Profil („Meine Daten herunterladen“) ergänzt drei Felder (`datenauszug.ts`):

- `antworten`: Thread-Titel, Frage, gewählte Optionen, für wen, von wem, wann. Darin stehen die Antworten, deren `fuer` die Person selbst oder eines ihrer **zugeordneten** Kinder ist, auch wenn ein anderer sie eingetragen hat (etwa die Leitung nach einem Telefonat).
- `nachrichten`: die eigenen Nachrichten (Thread-Titel, Zeit, Text); bei gelöschten ist `text` `null`.
- `gelesen`: der Gelesen-Stand je Thread (Titel, Zeit).

Threads selbst und Nachrichten anderer gehören nicht dazu.

- **„Zugeordnet“ heißt jedes nicht entfernte Kind**, nicht nur bei Erziehungsberechtigung: Wer zugeordnet ist, darf für das Kind antworten (`darfFuerKindHandeln`, 3.3). Verworfen: nur, was die Person selbst abgegeben hat — dann fehlte die Antwort für das eigene Kind, wenn die Leitung sie nachgetragen hat, obwohl die Person dafür hätte antworten dürfen.
- **Nicht darin:** Antworten, die die Person für fremde Kinder nachgetragen hat. Das wären deren Daten. Antworten für ein entferntes Kind stehen auch nicht darin, denn die Zuordnung ist mit dem Entfernen gelöscht (9.2).
- Personen heißen wie im übrigen Auszug: `'ich'` oder der volle Name, bei entfernten Personen „(entfernte Person)“. Ids und `clientId`s stehen nicht darin.

### 9.2 Entfernen einer Person

Ergänzend zu TP2 5.8: Gelesen-Stände werden gelöscht. Antworten und Nachrichten bleiben und erscheinen als „ehemaliges Mitglied“; **der Text der Nachrichten bleibt**, sonst würde der Verlauf unverständlich. Diese Festlegung steht unter Vorbehalt der rechtlichen Prüfung (TP2 8.6). Antworten für ein entferntes Kind zählen nicht mehr (3.2). In `Aenderung` bleiben Kennungen höchstens 90 Tage.

### 9.3 Datenschutzerklärung

Seit Etappe 6 in `apps/jufi/src/rechtstexte/datenschutz.md` nachgetragen:

- **Welche Daten:** Block „Threads“ (Inhalte der Threads und Module, Antworten, Nachrichten, Gelesen-Stand, Änderungsprotokoll).
- **Wer was sieht:** Namen in Threads (3.10), Ergebnisse je Einstellung (3.4), „eingetragen von“ nur für Jugendleiter.
- **Teilen, Kalender und Karten** (eigener Abschnitt): Teilen nach WhatsApp nur durch eigenes Antippen; der Google-Kalender-Weg und der Karten-Link übertragen erst nach dem Antippen Titel, Zeit, Ort an Google bzw. den Kartenanbieter; die Link-Vorschau mit Titel nur bei veröffentlichten Familien-Threads, sonst mit dem Vereinsnamen, samt der angenommenen Folge für Untergruppen (7.2).
- **Cookies:** WebSocket (Sitzungscookie, keine zusätzlichen Daten).
- **Speicherdauer:** `Aenderung` 90 Tage (2.6), Gelesen-Stände beim Entfernen gelöscht, Antworten und Nachrichten bleiben als „ehemaliges Mitglied“ (9.2), mit dem Vorbehalt der rechtlichen Prüfung im Platzhalter-Vermerk, den `tools/pruefe-texte.sh` findet.
- **Ihre Rechte:** der Datenauszug nennt Antworten, Nachrichten und Gelesen-Stände (9.1).

Die Texte bleiben ein Entwurf zur rechtlichen Prüfung; offen sind sie bis zur Einladung der Jugendleiter (TP2 1.2, README „Rechtstexte“).

### 9.4 Betrieb

- Neue Abhängigkeit: `ws`.
- Das Aufräumen von `Aenderung` (2.6) läuft im App-Prozess; der SIGTERM-Ablauf wartet darauf und auf das Schließen der Sockets, damit eine laufende Löschung nicht mit dem Prozess abbricht.
- `tools/pruefe-betrieb.sh` prüft zusätzlich den WebSocket-Upgrade (Abschnitt 7) und die Link-Vorschau einer unbekannten ID (Abschnitt 8, nur mit `--slug`: 200, `no-store`, `og:image` mit der `BASIS_URL`); die Mail-DNS-Prüfung ist dadurch Abschnitt 9.

---

## 10. Tests und Demo

### 10.1 Regeln

Jede Funktion aus Abschnitt 3 testgetrieben mit Grenzfällen: Fristsekunde, Archivgrenze um Mitternacht, Zeitumstellung, Termin über die Monatsgrenze, volljährig gewordenes Kind, Bezugsperson mit Kindern in verschiedenen Untergruppen, Bezugsperson, die zugleich Jugendleiter ist, Merkmal Jugendsprecher entzogen, entfernte Person, gelöschte Untergruppe.

### 10.2 Server

- Mandanten-Test: jede neue Route mit fremder Vereins-ID und mit unsichtbarem Thread (404), dazu der WebSocket (kein Signal aus fremdem Verein oder unsichtbarem Thread).
- Gegen die Testdatenbank: zwei gleichzeitige Antworten auf dieselbe Zeile, Lückenlosigkeit der Stände bei parallelen Schreibvorgängen, Idempotenz über `clientId`, 409/410-Fälle, Sync mit `unsichtbar` und `vollstaendig`, Link-Vorschau identisch für unbekannte und Jugendleiter-Threads.

### 10.3 Ende-zu-Ende

Playwright (`apps/jufi-e2e`): das Bowling-Szenario aus 1.1 mit zwei Browser-Kontexten (Thomas und Sandra), darunter die Antwort für zwei Kinder (Rahmen 13), die Live-Aktualisierung, der Austausch mit 404 für die Mutter und der Teilen-Text (Kopieren über die Zwischenablage, nicht das Teilen-Blatt). Etappe 6 ergänzt ein zweites Kind der Mutter (sie antwortet für Mia und Mats) und das Fristende (die Mutter kann nicht mehr antworten, die Leitung trägt nach), die Link-Vorschau mit Titel für Familien und neutral für alles andere sowie die Layout-Messung des Thread-Kopfs mit langem Titel. Dazu Layout-Messungen der neuen Seiten.

### 10.4 Demo

`pnpm run demo` bringt zusätzlich fünf Threads in dieser Reihenfolge:

1. „Wichtige Infos“ (angepinnt, Nur Aushang, Info-Text, Termin „Nächste Gruppenstunde“),
2. „Bowling“ im Ausgangszustand aus 1.1,
3. `Zeltlager <Jahr>` (Chat, Untergruppe „Ältere“, Pizza-Umfrage pro Person),
4. „🎣 Fischerfest“ (archiviert),
5. den Austausch mit einigen Nachrichten.

Dazu kommt **Tim Schmid** (11, Jungfischer ohne Familie und ohne Einwilligung, Untergruppe „Jüngere“), damit Thomas in 1.1 Schritt 8 jemanden zum Nachtragen hat.

- **Das Zeltlager trägt das Jahr seines Termins:** 2. bis 8. August des Folgejahres (Berliner Jahr von `jetzt` plus 1), Titel `Zeltlager <Jahr>`, eingespielt 2026 also „Zeltlager 2027“. Verworfen: das Jahr von `jetzt` — ab August wäre der Termin vergangen, und die Demo zeigte ein abgelaufenes Lager.
- **Das Fischerfest ist archiviert durch die Zeitregel, nicht durch einen Knopf:** `archivModus: AUTOMATISCH`, Termin vor 14 Tagen, also nach der Karenz von sieben Tagen (3.7). Verworfen: es von Hand zu archivieren (`ARCHIVIERT`) — die Demo soll die Regel zeigen, nicht einen Knopfdruck.
- **Jeder angelegte Thread schreibt je Modul eine `MODUL`-Änderung** im Stand des Threads, wie `POST /threads` (4.2). Verworfen: nur die `THREAD`-Änderung (so bis Etappe 5) — die Demo erzeugte dann einen Stand, den kein echter Schreibpfad erzeugt. Die `THREAD`-Änderung des Austauschs hat `urheberId: null`, denn den Thread hat das System angelegt (`erstelltVonId` ist `null`, 8).

**Teilweise vorgezogen (Etappe 2), erledigt in Etappe 6:** Etappe 2 spielte schon „Wichtige Infos“, „Bowling“ (ohne Antworten, Frist der Donnerstag davor 18:00) und zwei Nachrichten im Austausch ein und gab die Thread-Adressen aus, damit der Eigentümer vor Etappe 4 etwas abzunehmen hatte; eine Thread-Liste gab es noch nicht. „Zeltlager <Jahr>“, „Fischerfest“ und Tim sind mit Etappe 6 dazugekommen. Verworfen: die ganze Demo bis Etappe 6 aufzuschieben.

---

## 11. Abweichungen von der Rahmen-Spezifikation

Die Rahmen-Spezifikation ist an diesen Stellen nachgezogen:

| Stelle              | Rahmen bisher                                          | Jetzt                                                                                          |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 4.2 Rechte          | Modus, Archiv, Kommentare löschen nur „Alle Threads“   | Ersteller mit „Threads erstellen“ verwaltet eigene Threads ganz (3.5)                          |
| 5.3, 9.6, 11 Archiv | Archivierung per Cron in Teilprojekt 5                 | Regel zur Lesezeit in Teilprojekt 3, mit „aktiv halten“ (3.7)                                  |
| 6.1 Nur Aushang     | Reiter Verlauf entfällt                                | Verlauf bleibt lesbar, nur Schreiben endet (6.2)                                               |
| 6.3 Pro Person      | jeder mit Zugang                                       | jedes Kind (über Familie) und jeder Erwachsene (3.2)                                           |
| 6.3, 6.4 Ergebnisse | „für alle / Summe / nur Jugendleiter“ ohne Namensregel | Namensregel nach 3.4, Namen auch mit Bearbeitungsrecht; „eingetragen von“ nur für Jugendleiter |
| 6.4 Umfrage         | Teilnahme-Umfrage nicht definiert                      | 3.12                                                                                           |
| 6.7, 7.6 Vorschau   | immer Thread-Titel                                     | Titel nur bei veröffentlichten Familien-Threads (7.2)                                          |
| 7.5, 9.1 Echtzeit   | Abo je Thread, Lücken über Zählernummern               | Abo je Verein mit Prüfung je Signal, Lückenschluss nach Abbruch (5)                            |
| 3.5 Austausch       | nicht automatisch archiviert, nicht löschbar           | zusätzlich nicht manuell archivierbar, Zielgruppe fest (8)                                     |
| neu                 | —                                                      | Entwurfszustand, Löschen nur ohne Antworten (3.6), Gelesen-Stand (2.5), Suche (6.5)            |

Der Entwurf bildet die UID eines Kalendereintrags (FAM 3.4) als `<slug>-<modulId>@jufi-app.de`; die echte App nimmt `<modulId>@jufi-app.de`, damit eine Slug-Korrektur (TP2) keine doppelten Einträge im Kalender erzeugt.
