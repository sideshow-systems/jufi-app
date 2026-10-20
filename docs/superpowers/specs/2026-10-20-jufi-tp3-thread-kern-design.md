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
| 5   | Live                        | Änderungszähler, Sync, WebSocket, Neuberechnung und Schließen bei Rechteänderungen                                                          | 5          |
| 6   | Teilen und Abschluss        | Teilen-Text, Link-Vorschau, Demo mit Bowling, Ende-zu-Ende-Test, Datenauszug, Datenschutzerklärung, Doku                                    | 7, 9, 10   |

Nach Etappe 4 ist die App ohne Live-Aktualisierung benutzbar; Etappe 5 bringt die Echtzeit. Der Änderungszähler (2.6) entsteht trotzdem schon in Etappe 1 und wird ab Etappe 2 von jedem Schreibpfad gepflegt, damit Etappe 5 keine Schreibroute mehr anfassen muss.

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
- `Aenderung (id, vereinId, stand, threadId?, art, objektId, urheberId?, angelegtAm)` mit eigener `id` und einem Index auf `(vereinId, stand)`; mehrere Zeilen einer Transaktion teilen sich den Stand. Verworfen: ein eindeutiges `(vereinId, stand)` — ein Verlaufseintrag braucht seinen Stand beim Anlegen, seine ID entsteht erst dabei, also bekommt die Arbeit der Transaktion den Stand vorab (4.2). Lückenlos bleibt der Zähler: Jede committete schreibende Transaktion hat genau einen Stand. `threadId` und `objektId` sind bewusst keine Fremdschlüssel, damit das Löschen eines Threads als Änderung erhalten bleibt. `art` z. B. `THREAD`, `MODUL`, `ANTWORT`, `VERLAUF`, `SICHTBARKEIT`, `LISTE`, `GELOESCHT` (nicht für das Löschen einer Nachricht, 2.4). **`LISTE`** (Etappe 3) ist Anpinnen und Archivieren: Es steht wie `SICHTBARKEIT` und `GELOESCHT` in `OHNE_AKTIVITAET`, ist also keine Aktivität des Threads (4.2). Verworfen: `THREAD` — jedes Anpinnen schöbe den Thread in der Liste nach oben und hieße bei allen „Aushang geändert“. Das „Neu“-Kennzeichen (Etappe 4) lässt `LISTE` außen vor: `istNeu` bekommt die Änderungen ohne diese Art. Keine Inhalte, nur Kennungen.
- Einträge älter als 90 Tage werden beim Start und danach täglich im App-Prozess gelöscht (ein `setInterval`, kein Cron). Ein Sync, der älter einsteigt, bekommt „vollständig neu laden“ (5.2).

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

- `istNeu(thread, gelesenStand, person)`: Es gibt eine `Aenderung` des Threads mit `stand > gelesenBis` und `urheberId ≠ person` (nur fremde Aktivität, Erkenntnis aus dem Entwurf; Änderungen der Art `LISTE` zählen ab Etappe 4 nicht mit, 2.6). Ohne Gelesen-Stand ist ein Thread neu, wenn er nach dem Einrichten des eigenen Zugangs veröffentlicht wurde oder seither fremde Aktivität hatte.
- Zähler am Reiter „Verlauf“: fremde, nicht gelöschte Nachrichten (Art `NACHRICHT`, keine Systemeinträge) mit `stand > verlaufGelesenBis`. Verworfen: Systemeinträge mitzählen — ein verschobener Termin im Aushang hieße sonst „1 neuer Kommentar“, wo niemand kommentieren kann.
- „Neu seit deinem letzten Besuch“ (6.1): die neuen Threads mit einer Kurzangabe („Neuer Thread“, „2 neue Kommentare“, „Aushang geändert“).
- Öffnen eines Threads setzt `gelesenBis` auf den Stand, **den der Client geladen hat**, Öffnen des Verlaufs zusätzlich `verlaufGelesenBis` (4.1, 4.2). Die Thread-Seite meldet die Übersicht erst, wenn die Person sie sieht (wer direkt im Verlauf landet, hat die Module nicht gesehen). Nach dem Abgeben einer Antwort schickt die Seite **kein** neues PUT. Verworfen: den Stand aus der Antwort als gelesen melden — er könnte fremde Änderungen, die die Seite nie geladen hat, als gelesen markieren.

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
- Eine Teilnahme-Umfrage hat **nie Mehrfachauswahl**: „Dabei“, „Vielleicht“ und „Abgesagt“ schließen sich aus. Der Editor setzt `mehrfach: false` beim Einschalten der Teilnahme und blendet den Schalter aus; `entwurfAus` setzt es beim Lesen jedes Teilnahme-Moduls, denn ein verstecktes `true` würde unsichtbar als Mehrfachauswahl gespeichert. Verworfen: ein `true` bei Teilnahme abzulehnen — ein veralteter Client, der das Feld nicht kennt, soll daran nicht scheitern (wie bei den Optionen); gelesen wird der Wert trotzdem, damit ein Nicht-Wahrheitswert weiter ungültig ist.
- Eine neue Umfrage im Editor startet als Teilnahme-Umfrage „Kommst du mit?“, pro Jungfischer, Ergebnisse für alle (Entwurf).

### 3.13 Braucht deine Antwort

`brauchtAntwort(person, threads, …, jetzt)`: je sichtbarem, veröffentlichtem, nicht archiviertem Thread jede eigene Antwortzeile ohne Antwort mit laufender Frist (oder ohne Frist), als „Lena: Bowling noch offen · bis Do“ beziehungsweise für sich selbst „Bowling noch offen“. Sortiert nach Frist, dann Titel. Ohne Rollenwort (FAM 1.6).

### 3.14 Änderungen an Umfragen mit Antworten

Liegen Antworten vor, verweigert der Server (409 mit Hinweis am Feld):

- eine Option zu entfernen, auf die jemand geantwortet hat;
- die Einheit oder den Teilnahme-Schalter zu ändern;
- „mehrfach“ abzuschalten, wenn eine Antwort mehrere Optionen hat.

Umbenennen und Umsortieren von Optionen, Frist und Ergebnis-Einstellung bleiben frei. Verworfen: Antworten bei solchen Änderungen still verwerfen.

Gemeint sind Antworten **mit gewählter Option**; eine Antwort ohne Option sperrt diese drei Änderungen nicht (3.2: sie gilt als keine Antwort). Wird „Vielleicht“ aus einer Teilnahme-Umfrage entfernt, obwohl jemand es gewählt hat, steht der Konflikt am Feld `module.N.optionen` (wie bei jeder entfernten Option); verworfen: `module.N.vielleicht` — die Feldliste des Editors kennt das Feld nicht, und die Meldung stünde ohne Anker.

**Der Editor zieht dieselben Grenzen wie der Server** (`umfrageSperre`): Einheit und Teilnahme sind erst gesperrt, wenn eine Antwort mit Option existiert; „Mehrfachauswahl“ erst, wenn sie genutzt wurde (eine Antwort mit mehreren Optionen); das Entfernen der ganzen Umfrage dagegen schon bei jeder Antwort, auch bei einer ohne Option, weil die Datenbank sie verweigert (unten). Verworfen: alles ab der ersten Antwort pauschal sperren — der Editor wäre strenger als der Server und verböte Änderungen, die dieser annähme.

Eine beantwortete Umfrage lässt sich auch **nicht als Ganzes** löschen, weder das Modul noch der Thread: Die Datenbank verweigert es (der Fremdschlüssel von der Antwort auf die Umfrage ist `NoAction`, es gibt keinen Kaskadenweg zu den Antworten, 2.3). Verworfen: die Kaskade von der Umfrage zur Antwort zu lassen und allein auf die Sperre über die gewählte Option zu bauen — ob zuerst die Sperre oder die Kaskade greift, hängt von der Reihenfolge der Prüftrigger in Postgres ab; und ein aufgeschobener Fremdschlüssel (`DEFERRABLE INITIALLY DEFERRED`) — er prüfte erst nach der Kaskade und ließe Antworten kommentarlos verschwinden. Folge für Etappe 3: `PUT /threads/:id` antwortet mit 409 `BEANTWORTET`, wenn es ein beantwortetes Umfrage-Modul entfernen würde (4.4); eine Antwort ohne Option zählt hier mit, damit die Datenbank nie mit P2003 (und damit 404) antwortet.

---

## 4. Server und API

### 4.1 Routen

Alle unter `/<slug>/api/v1`, in `vereinsApi`, mit `brauchtMitglied` und je einem Eintrag im Mandanten-Test (TP2 9). Wo eine Person etwas nicht sieht: 404.

| Methode und Pfad                                        | Zweck                                                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /threads?suche=&archiv=`                           | Liste der sichtbaren Threads mit Neu-Kennzeichen und nächstem Termin; `suche` filtert Titel, Info-Text, Ort (ILIKE)                                                     |
| `GET /threads/:id`                                      | Kopf, Module, eigene Antwortzeilen mit Antwortrecht, Ergebnisse nach 3.4, Schreibsperre, Zähler des Verlaufs (seit Etappe 3 mit `darfBearbeiten` und `darfArchivieren`) |
| `GET /threads/:id/verlauf?vor=`                         | 50 Einträge je Seite, neueste zuerst; `vor` ist die ID eines Eintrags                                                                                                   |
| `POST /threads/:id/verlauf`                             | Nachricht schreiben (mit `clientId`)                                                                                                                                    |
| `DELETE /verlauf/:eintragId`                            | eigene oder (mit Recht) fremde Nachricht entfernen                                                                                                                      |
| `PUT /threads/:id/gelesen`                              | Gelesen-Stand setzen (Körper `{ bereich, bis }`, `bereich`: `uebersicht` oder `verlauf`)                                                                                |
| `PUT /umfragen/:modulId/antworten/:fuerId`              | Antwort abgeben oder ändern (Upsert, `clientId`)                                                                                                                        |
| `GET /start`                                            | um „Braucht deine Antwort“, „Als Nächstes“, „Neu seit deinem letzten Besuch“ erweitert                                                                                  |
| `GET /termine?monat=JJJJ-MM`                            | Termine sichtbarer Threads im Monat                                                                                                                                     |
| `POST /threads`, `PUT /threads/:id`                     | Thread samt Modulen anlegen oder ersetzen, in einer Transaktion                                                                                                         |
| `POST /threads/:id/veroeffentlichen`                    |                                                                                                                                                                         |
| `PUT /threads/:id/archiv`, `PUT /threads/:id/angepinnt` |                                                                                                                                                                         |
| `DELETE /threads/:id`                                   | nach 3.5                                                                                                                                                                |
| `GET /threads/:id/antworten`                            | Antworten-Übersicht für die Verwaltung (wer was, wer fehlt)                                                                                                             |
| `GET /verwaltung/threads`                               | Liste der Verwaltung (Etappe 3): alle Threads samt Entwürfen, Untergruppen, `darfErstellen`                                                                             |
| `GET /threads/:id/bearbeitung`                          | der Thread in bearbeitbarer Form für den Editor (Etappe 3, `ThreadBearbeitung`)                                                                                         |
| `GET /sync?seit=`                                       | 5.2                                                                                                                                                                     |

**Formen und Pfade der lesenden Routen (Etappe 2).** Die Antworttypen (`ThreadAnsicht`, `UmfrageAnsicht`, `VerlaufAnsicht`) stehen in `libs/domain` (`threads/ansicht.ts`, `threads/verlauf.ts`), und der Client nutzt dieselben. Verworfen: sie im Client nachzuschreiben (Muster `mitglieder-api.ts`) — bei einer Antwort dieser Größe liefen beide Seiten auseinander. Was eine Person sieht, baut dieselbe reine Funktion für alle Routen (`threadAnsicht`, `verlaufAnsicht`); der Server lädt nur.

- `GET /threads/:id` liefert die `ThreadAnsicht`: Kopf, Module, je Umfrage die eigenen Antwortzeilen (mit eigenem Antwortrecht je Zeile) und die Ergebnisse nach 3.4, `schreibSperre`, den Zähler des Verlaufs und `stand`. Das Antwortrecht und die Löschberechtigung stehen an der Zeile beziehungsweise am Eintrag, nicht in einem Block „Rechte“; Etappe 3 hat `darfBearbeiten` und `darfArchivieren` ergänzt (für „Bearbeiten“ und „Wiederherstellen“ im Kopf). Der `stand` ist der Vereinsstand, der **vor** den Thread-Daten gelesen wird: Unter READ COMMITTED ist, was danach geladen wird, mindestens so neu.
- `GET /threads/:id/verlauf?vor=` liefert `{ eintraege, weitere }`. `vor` ist die ID des ältesten gezeigten Eintrags, geordnet wird nach `(stand, id)`, damit Einträge eines Standes eine feste Reihenfolge haben und an der Seitengrenze keiner fehlt oder doppelt kommt. Verworfen: `vor` als Änderungsstand — mehrere Einträge einer Transaktion teilen sich einen Stand. Ein `vor` aus einem anderen Thread oder ein unbekanntes ist 404, sonst ließe sich fremder Verlauf an einem eigenen Thread abzählen.
- `POST /threads/:id/verlauf` antwortet `{ eintrag, stand }`, 201 beim Anlegen und 200 bei einer Wiederholung (4.2). `DELETE /verlauf/:eintragId` antwortet 204, auch beim zweiten Löschen derselben Nachricht (eine Wiederholung ist kein Verbot); wer nie löschen durfte, bekommt weiter 404 und erfährt nicht, dass die Nachricht schon weg ist. Die eigene Nachricht lässt sich auch im Archiv löschen.
- `PUT /umfragen/:modulId/antworten/:fuerId` antwortet 200 mit `{ modul, stand }`: die Umfrage so, wie die Person sie jetzt sieht, und der Stand, bis zu dem sie geladen ist. Ein Info- oder Termin-Modul unter dieser ID ist „unbekannt“ (404); eine andere Antwort verriete, dass es unter der ID ein Modul gibt. Der Körper ist `{ optionIds, clientId }`; geprüft wird die Form (nicht leer, höchstens 20, Zeichenketten, ohne Doppelte) vor dem Thread, die Zugehörigkeit zur Umfrage erst nach der 404.
- `PUT /threads/:id/gelesen` antwortet 204. Der Körper ist `{ bereich, bis }`, `bis` eine ganze Zahl ab 0 (ein Text wie `"5"` gilt nicht); sonst 400 ohne `feld`, geprüft vor dem Thread, damit die 400 über ihn nichts verrät. Der Client schickt den `stand` aus `GET /threads/:id` als `bis`; der Server speichert `max(alt, min(bis, aktueller Stand))`. Die Kappung auf den Vereinsstand verhindert, dass ein Client etwas als gelesen markiert, das es noch gar nicht gibt, der Höchstwert, dass ein langsames Gerät den Stand zurücksetzt. So markiert ein Öffnen nie etwas als gelesen, das der Client nicht geladen hat.

`PUT /threads/:id` vergleicht Module und Optionen über ihre IDs und Schlüssel: Unveränderte bleiben, neue entstehen, fehlende werden gelöscht (soweit 3.14 es erlaubt). Termin-, Frist- und Modusänderungen erzeugen Systemeinträge (2.4).

**Formen und Pfade der Verwaltungsrouten (Etappe 3).** Was ein Entwurf ist und was sich ändert, entscheiden `entwurf.ts` und `vergleich.ts` in `libs/domain`, die Antworttypen (`VerwaltungListe`, `ThreadBearbeitung`, `AntwortenUebersicht`) stehen in `threads/verwaltung.ts`; Client und Server nutzen dieselben.

- **Zwei lesende Routen, die die erste Fassung der Tabelle nicht nannte.** Der Editor braucht den Thread in bearbeitbarer Form (Untergruppen-IDs, Options-Schlüssel, Frist als ISO, Sperren durch Antworten), und die Liste der Verwaltung braucht alle Threads samt Entwürfen, solange es `GET /threads` noch nicht gibt (Etappe 4). Verworfen: `GET /threads/:id` erweitern — die Ansicht ist die eines Mitglieds, und Schlüssel und Sperren gehören nicht in jede Mitgliederantwort.
- `GET /verwaltung/threads` liefert `{ threads, untergruppen, darfErstellen }` für jeden Jugendleiter (sonst 404). Je Thread `VerwaltungThread`: Zielgruppe als Text, „Entwurf“, „Archiviert“, nächster Termin, `darfBearbeiten` und `darfAntwortenSehen` (`siehtAntworten`).
- `GET /threads/:id/bearbeitung` liefert die `ThreadBearbeitung`: `version` (2.1), `entwurf`, `sperren` je Umfrage-Modul (3.14), `darfLoeschen`, `darfArchivieren`, Untergruppen. Wer den Thread nicht bearbeiten darf, bekommt 404 wie bei Unsichtbarem.
- `POST /threads` (Körper `{ entwurf }`) antwortet 201, `PUT /threads/:id` (`{ version, entwurf }`), `POST …/veroeffentlichen`, `PUT …/archiv` (`{ archiviert }`) und `PUT …/angepinnt` (`{ angepinnt }`) antworten 200, jeweils mit der `ThreadBearbeitung` nach dem Schreiben; `DELETE /threads/:id` antwortet 204. Ist der gewünschte Zustand beim Veröffentlichen, Archivieren und Anpinnen schon da (Doppelklick, zweites Gerät), antwortet die Route wie nach einem Erfolg, ohne Stand und ohne `Aenderung`. Verworfen: 409 — ein Fehler, wo das Ergebnis stimmt. Ein zweites `DELETE` ist keine Wiederholung in diesem Sinn: Der Thread ist weg, die Antwort ist 404.
- `GET /threads/:id/antworten` liefert die `AntwortenUebersicht` (mit `darfNachtragen`) nur, wenn die Person sie sehen darf (3.5), sonst 404.

### 4.2 Schreibpfad

Jede schreibende Route außer `gelesen` arbeitet in einer Transaktion über `mitAenderung(tx, vereinId, urheberId, jetzt, arbeit)`. Es muss die **erste schreibende Anweisung** der Transaktion sein und setzt READ COMMITTED voraus (Postgres-Vorgabe; unter REPEATABLE READ oder SERIALIZABLE scheiterten gleichzeitige Schreiber mit 40001, statt zu warten):

1. `aenderungsstand` um eins erhöhen; das UPDATE sperrt die Vereinszeile bis zum Commit (wie `sperreVereinszeile`, TP2; damit vergeben gleichzeitige Anfragen lückenlose, in Commit-Reihenfolge aufsteigende Stände, und eine zurückgerollte Transaktion verbraucht keinen). Der neue Stand geht an `arbeit(stand)`, **bevor** sie schreibt — ein Verlaufseintrag braucht seinen Stand beim Anlegen. Verworfen: eine Postgres-Sequenz — sie vergibt Nummern vor dem Commit, und eine später committete kleinere Nummer überholte ein Sync, der die größere schon gesehen hat.
2. `arbeit` schreibt die Daten und gibt Ergebnis und `aenderungen` zurück (je Eintrag `threadId`, `art`, `objektId`); `mitAenderung` schreibt je Eintrag eine `Aenderung` mit dem Stand und setzt `letzteAktivitaetAm` und `letzteAktivitaetStand` der betroffenen Threads, **nicht** für `GELOESCHT` (die Zeile ist weg), `SICHTBARKEIT` (eine neue Zielgruppe ist kein Beitrag, der den Thread in der Liste nach oben schieben soll) und `LISTE` (Anpinnen und Archivieren, 2.6); das sind die Arten in `OHNE_AKTIVITAET`.
3. Nach dem Commit das Ereignis an den Bus im Prozess melden (5.1).

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

- Ein Socket je Client und Verein unter `/<slug>/ws` (Bibliothek `ws`), am `http.Server` aus `app.listen`. Beim Upgrade prüft der Server Origin, Verein und Status, Sitzung und Zugang; sonst 401/404 und Abbruch.
- **Abo je Verein**: Der Socket bekommt Signale zu allen Threads, die die Person sieht. Der Server prüft je Signal im Speicher (`siehtThread` mit gecachtem Umfeld je Verein, das bei Personen-, Zuordnungs-, Rechte-, Untergruppen- und Merkmalsänderungen verworfen wird). Verworfen: Abos je Thread (Rahmen 7.5) — Liste, Start und Neu-Punkt brauchen ohnehin alle sichtbaren Threads.
- Signal: `{stand, threadId, art, objektId}`. **Nachrichten** gehen mit Inhalt (Absendername nach 3.10). Der Client lädt alles andere per REST nach; damit gibt es eine Datenquelle und keine zweite Rechteprüfung für Inhalte.
- Ändert sich, was eine Person an einem Thread sehen darf (Zielgruppe, Untergruppe, Merkmal, Veröffentlichung), bekommt sie ein Signal `SICHTBARKEIT` und gleicht per Sync ab.
- Bei Abmelden, Zugangsentzug, Rechteänderung, Entfernen und Sperre des Vereins schließt der Server alle Sockets der Person bzw. des Vereins. Der Client verbindet neu, und der Upgrade prüft mit dem neuen Stand. Verworfen: bei Rechteänderungen nur ein Signal — der Socket hielte dann ein veraltetes Umfeld.
- Ping alle 30 Sekunden; ohne Antwort wird der Socket geschlossen. Beim Herunterfahren (SIGTERM, Etappe 6) schließt der Hub alle Sockets mit Code 1012 („gleich zurück“).
- Speicher: Bei höchstens einigen Dutzend gleichzeitigen Verbindungen je Verein ist der Bedarf gegen die 384 MB der App zu vernachlässigen; der Hub begrenzt trotzdem auf 10 Sockets je Person.
- **Lokale Entwicklung**: Unter `ng serve` gibt es keinen eigenen `http.Server`. Dort startet der Hub auf einem eigenen Port, und der Dev-Proxy von Angular leitet `/*/ws` dorthin (Proxy mit `ws: true`). Das geschieht in `betriebsApp()`, nie beim Bau (CLAUDE.md, „Was nachweislich stolpert“).
- Traefik reicht Upgrades von selbst durch; `tools/pruefe-betrieb.sh` prüft den Upgrade auf der Testdomain.

### 5.2 Sync

`GET /sync?seit=n` liefert `{stand, geaendert: threadId[], unsichtbar: threadId[], vollstaendig}`:

- `geaendert`: sichtbare Threads mit einer `Aenderung` nach `n`.
- `unsichtbar`: Threads mit Änderung nach `n`, die die Person nicht (mehr) sieht. Die Kennungen allein verraten nichts, weil sie zufällig sind; der Client wirft solche Threads aus Liste und Ansicht.
- `vollstaendig: true`, wenn `n` vor dem ältesten aufbewahrten Eintrag liegt oder fehlt; der Client lädt dann alles neu.

Der Client ruft Sync beim Start, nach jedem Wiederverbinden und beim Zurückkehren in den Vordergrund. Er erkennt Lücken **nicht** an fehlenden Nummern in den Signalen — die gefilterten Signale haben immer Lücken —, sondern am Abbruch der Verbindung. Verworfen: Lückenerkennung über fortlaufende Nummern (Rahmen 9.1) — mit einem Zähler je Verein und gefilterten Signalen fehlen stets Nummern.

### 5.3 Client

- Ein Dienst `Echtzeit` hält den Socket, verbindet mit Backoff 1–30 Sekunden neu und ruft danach Sync.
- Seiten melden, welche Threads sie zeigen; auf ein passendes Signal laden sie gezielt nach.
- Ohne Verbindung zeigt der Kopf dezent „Nicht verbunden – Inhalte evtl. veraltet“.

---

## 6. Oberflächen

### 6.1 Mitglieder-Hülle und Start

- Untere Leiste: **Start · Threads · Termine · Mehr** (Medien folgt mit Teilprojekt 4). Ein Punkt an „Threads“ zeigt Neues.
- Start zeigt oben die drei Blöcke aus Rahmen 5.2, jeweils nur mit Inhalt:
  - **Braucht deine Antwort** (3.13); Tippen springt zur Umfrage (`/<slug>/t/<id>/m/<modulId>`).
  - **Als Nächstes**: höchstens drei Termine mit Zeit, Ort und Thread.
  - **Neu seit deinem letzten Besuch**: höchstens fünf Threads mit Kurzangabe (3.9).
- Darunter bleibt alles aus TP2 6.2: Begrüßung, Jungfischer-Karten, Ansprechpartner mit Kontakttext, „In der Verwaltung warten“.

### 6.2 Thread-Seite

- URL `/<slug>/t/<id>-<titel-slug>`; maßgeblich ist die ID, ein umbenannter Thread bleibt erreichbar (Rahmen 5.4); die Seite schreibt ein veraltetes Segment ohne neuen Eintrag in der Browser-Historie (`replaceUrl`) auf den aktuellen Titel um. Verworfen: den Titel nie umschreiben — er stünde sonst in jeder Adresse, die jemand aus der Leiste kopiert, falsch da. Deep Links `?reiter=verlauf` und `/<slug>/t/<id>/m/<modulId>` scrollen zur Stelle und heben sie hervor.
- **Die ID kennt zwei Formen:** `cuid` (vom Code) und `gen_random_uuid()` (der Austausch aus der Migration, mit Bindestrichen). `idAusSegment` erkennt zuerst die UUID-Form, sonst gilt alles bis zum ersten Bindestrich. Verworfen: immer bis zum ersten Bindestrich — die UUID des Austauschs würde nach ihrem ersten Block abgeschnitten, und der Austausch wäre über seine Adresse nie zu öffnen. Verworfen: den Slug mitprüfen und bei einem umbenannten Thread umleiten — jeder alte Link geht über die ID ohnehin auf. Ein Segment ohne lesbare ID ergibt ohne Anfrage dieselbe Seite wie ein 404.
- Kopf: Titel, „Teilen“, für Berechtigte „Bearbeiten“ (öffnet den Editor in der Verwaltung). Der Zurück-Pfeil führt **bis Etappe 4** zur Startseite des Vereins. Verworfen: ein Link auf die Thread-Liste — es gibt sie erst mit Etappe 4 (6.5); bis dahin führen Demo und Ende-zu-Ende-Test direkt in Threads.
- Geöffnet wird immer die **Übersicht**, auch bei Threads im Modus „Offener Chat“ (kein Start-Reiter je Modus). _Vorläufig; offene Frage an den Eigentümer:_ ob ein Chat besser im Verlauf beginnt. Verworfen (vorläufig): den Reiter nach Modus wählen — die Entscheidung gehört dem Eigentümer, und `?reiter=verlauf` genügt für Links, die in den Chat führen sollen.
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

- **Threads**: Suchfeld, Abschnitte „Angepinnt“, „Aktiv“ (nach letzter Aktivität), „Archiv“ (eingeklappt). Je Zeile Titel, nächster Termin, Neu-Punkt; Jugendleiter sehen Entwürfe mit „· Entwurf“. Jugendsprecher sehen den Austausch unter „Angepinnt“.
- **Termine**: Monatsraster ab Montag mit Markierungen, darunter die Termine des Monats; mehrtägige Termine markieren jeden Tag; Tippen führt in den Thread (Entwurf, FAM 4).

### 6.6 Verwaltung

- Neuer Punkt **Threads** in der Seitenleiste für alle Jugendleiter. Ohne „Threads erstellen“ und „Alle Threads bearbeiten“ ist die Liste nur lesbar. Der Link „Antworten“ in der Liste erscheint nur mit dem Recht, die Antworten zu sehen (`darfAntwortenSehen` über `siehtAntworten`, 3.5); verworfen: ihn für jeden Thread mit Umfrage zu zeigen — wer nicht darf, landete auf einer 404-Seite.
- **Editor** (Rahmen 5.1):
  - Links das Formular: Titel, Zielgruppe (Untergruppen „Alle“ oder Auswahl, Rollenfilter), Modus, „Mitglieder benachrichtigen“ (bis Teilprojekt 5 gesperrt mit Hinweis), Modulliste mit „Hoch“, „Runter“, „Entfernen“, „Modul hinzufügen“.
  - Rechts die Live-Vorschau im Handyrahmen mit hervorgehobenem Modul; unter 1024 px Breite umschaltbar statt daneben.
  - Knöpfe „Entwurf speichern“, „Veröffentlichen“ beziehungsweise „Speichern“, „Löschen“ (nur nach 3.5).
  - Fehler am Feld; eine leere Zielgruppe (Auswahl ohne Untergruppe) lässt sich nicht speichern.
  - Der Editor bietet nur Einheiten an, die beim gewählten Rollenfilter jemanden fragen (3.2). Beim Hinzufügen einer Umfrage und beim Wechsel des Rollenfilters stellt der Editor die Einheit einer **ungesperrten** Umfrage sofort auf die erste passende um (`einheitenFuer`), damit kein Fehler an einem Feld entsteht, das niemand angefasst hat. Verworfen: die Einheit stehen lassen und den Fehler erst beim Speichern zeigen.
  - Welche Felder gesperrt sind, wenn Antworten vorliegen, steht in 3.14; Teilnahme-Umfragen ohne „Vielleicht“ und ohne Mehrfachauswahl in 3.12.
- **Antworten-Übersicht** je Umfrage: je Option die Namen, „Noch offen“ mit Namen, je Zeile „Eintragen“ (Nachtragen). „Stand teilen“ folgt mit Etappe 6 (Teilen-Text, 7.1); verworfen: einen vorläufigen Text bauen, den Etappe 6 ersetzt.
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

`teilenText(betrachter, thread, …, jetzt)` erzeugt WhatsApp-tauglichen Text (Rahmen 6.7), **mit dem, was der Teilende selbst sehen darf** (3.4):

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
- Bis zehn Namen, dann „…“; WhatsApp-Formatzeichen in fremdem Text werden durch gleich aussehende Zeichen ersetzt; das Emoji des Titels steht außerhalb der Sternchen (Entwurf).
- Stand-Zeit in Berlin; Link über `BASIS_URL`.
- Am Handy über die Web Share API, am Rechner „Kopieren“ mit Bestätigung. Teilen kann jeder Leser; Teilprojekt 4 ergänzt Zeilen für Fahrer und Kosten.

### 7.2 Link-Vorschau

- Eine Express-Route vor dem Angular-Handler beantwortet `GET /<slug>/t/:id…` mit der `index.html`, in die sie Open-Graph-Tags einsetzt (Rahmen 7.6).
- **Titel** nur, wenn der Thread veröffentlicht ist und seine Zielgruppe Familien einschließt (`JUNGFISCHER_FAMILIE`, `NUR_FAMILIE`). Für alle anderen Threads, Entwürfe und unbekannte IDs: dieselbe neutrale Vorschau mit dem Vereinsnamen. Bild ist immer das Vereins-Icon in 512 px. Unbekannter oder gesperrter Verein: 404 wie bisher.
- Die IDs sind zufällig (`cuid`), damit niemand Titel durch Ausprobieren findet. Verworfen: fortlaufende Nummern je Verein (Entwurf) — erratbar.
- `Cache-Control: no-store`; keine weiteren Daten.
- Verworfen: immer den Titel zeigen (Rahmen 6.7 wörtlich) — Titel von Jugendleiter-Threads wären für jeden mit dem Link lesbar. Verworfen: nie einen Titel — in WhatsApp sähe jeder Link gleich aus.

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

Der Datenauszug im Profil („Meine Daten herunterladen“) ergänzt:

- eigene Antworten und Antworten für die eigenen Kinder (Thread-Titel, Frage, gewählte Optionen, für wen, von wem, wann);
- eigene Nachrichten (Thread-Titel, Zeit, Text; gelöschte ohne Text);
- Gelesen-Stand je Thread (Titel, Zeit).

Threads selbst und Nachrichten anderer gehören nicht dazu.

### 9.2 Entfernen einer Person

Ergänzend zu TP2 5.8: Gelesen-Stände werden gelöscht. Antworten und Nachrichten bleiben und erscheinen als „ehemaliges Mitglied“; **der Text der Nachrichten bleibt**, sonst würde der Verlauf unverständlich. Diese Festlegung steht unter Vorbehalt der rechtlichen Prüfung (TP2 8.6). Antworten für ein entferntes Kind zählen nicht mehr (3.2). In `Aenderung` bleiben Kennungen höchstens 90 Tage.

### 9.3 Datenschutzerklärung

Nachzutragen: Threads, Antworten und Verlauf; wer welche Namen sieht (3.4, 3.10); Gelesen-Stand; WebSocket (keine zusätzlichen Daten, Sitzungscookie); Teilen nach WhatsApp nur durch eigenes Antippen; der Google-Kalender-Weg und der Karten-Link (übertragen erst nach Antippen Titel, Zeit, Ort an Google bzw. den Kartenanbieter); die Link-Vorschau mit Titel bei Familien-Threads; Löschfristen aus 2.6 und 9.2.

### 9.4 Betrieb

- Neue Abhängigkeit: `ws`.
- Das Aufräumen von `Aenderung` (2.6) läuft im App-Prozess; der SIGTERM-Ablauf wartet darauf und auf das Schließen der Sockets.
- `tools/pruefe-betrieb.sh` prüft zusätzlich den WebSocket-Upgrade und die Link-Vorschau einer unbekannten ID.

---

## 10. Tests und Demo

### 10.1 Regeln

Jede Funktion aus Abschnitt 3 testgetrieben mit Grenzfällen: Fristsekunde, Archivgrenze um Mitternacht, Zeitumstellung, Termin über die Monatsgrenze, volljährig gewordenes Kind, Bezugsperson mit Kindern in verschiedenen Untergruppen, Bezugsperson, die zugleich Jugendleiter ist, Merkmal Jugendsprecher entzogen, entfernte Person, gelöschte Untergruppe.

### 10.2 Server

- Mandanten-Test: jede neue Route mit fremder Vereins-ID und mit unsichtbarem Thread (404), dazu der WebSocket (kein Signal aus fremdem Verein oder unsichtbarem Thread).
- Gegen die Testdatenbank: zwei gleichzeitige Antworten auf dieselbe Zeile, Lückenlosigkeit der Stände bei parallelen Schreibvorgängen, Idempotenz über `clientId`, 409/410-Fälle, Sync mit `unsichtbar` und `vollstaendig`, Link-Vorschau identisch für unbekannte und Jugendleiter-Threads.

### 10.3 Ende-zu-Ende

Playwright (`apps/jufi-e2e`): das Bowling-Szenario aus 1.1 mit zwei Browser-Kontexten (Thomas und Sandra), darunter die Antwort für zwei Kinder (Rahmen 13), die Live-Aktualisierung, der Austausch mit 404 für Sandra und der Teilen-Text. Dazu Layout-Messungen der neuen Seiten.

### 10.4 Demo

`pnpm run demo` bringt zusätzlich: „Wichtige Infos“ (angepinnt, Nur Aushang, Info-Text, Termin „Nächste Gruppenstunde“), „Bowling“ im Ausgangszustand aus 1.1, „Zeltlager 2027“ (Chat, Untergruppe, Pizza-Umfrage pro Person), einen archivierten Thread und den Austausch mit einigen Nachrichten.

**Teilweise vorgezogen (Etappe 2):** Die Demo spielt schon jetzt „Wichtige Infos“, „Bowling“ (ohne Antworten, Frist der Donnerstag davor 18:00) und zwei Nachrichten im Austausch ein und gibt die Thread-Adressen aus. Ohne das hätte der Eigentümer vor Etappe 4 nichts abzunehmen, denn eine Thread-Liste gibt es noch nicht. „Zeltlager 2027“ und der archivierte Thread folgen in Etappe 6. Verworfen: die ganze Demo bis Etappe 6 aufzuschieben.

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
