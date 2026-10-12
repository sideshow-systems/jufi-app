# JuFi App — Familie, Jugendsprecher, Kalender

Stand: 12.10.2026 · Ergebnis des Brainstormings vom selben Tag · Status: zur Freigabe

Drei Ergänzungen aus den ersten Rückmeldungen zum klickbaren Entwurf. Sie ändern die Rahmen-Spezifikation (`2026-10-11-jufi-rahmen-design.md`); die Änderungen sind dort eingearbeitet. Diese Datei hält die Entscheidungen mit ihren verworfenen Alternativen fest und legt fest, was davon in den klickbaren Entwurf kommt.

**Umfang:**

| Teil                    | Rahmen-Spezifikation | Klickbarer Entwurf |
| ----------------------- | -------------------- | ------------------ |
| 1. Familie              | ja                   | nein               |
| 2. Jugendsprecher       | ja                   | nein               |
| 3. Termine und Kalender | ja                   | ja (Abschnitt 4)   |

Familie und Jugendsprecher sind vor allem Begriffs- und Rechtefragen, die sich im Gespräch klären ließen. Ob „In Kalender eintragen" auf iPhone und Android reibungslos klappt, zeigt sich dagegen erst auf echten Geräten; das lässt sich im Entwurf billig ausprobieren.

---

## 1. Familie

### 1.1 Anlass

„Eltern", „Vater" und „Mutter" sind zu eng. Zu einem Kind gehören auch nur ein Erziehungsberechtigter oder Verwandte wie der Opa, statt oder zusätzlich zu den Eltern.

### 1.2 Begriffe

- **Bezugsperson**: Erwachsener, dem mindestens ein Jungfischer zugeordnet ist. Ersetzt „Elternteil" in Spezifikation und Code.
- **Familie**: alle Bezugspersonen eines Jungfischers. Das ist das Wort der Oberfläche.

Verworfen: „Angehörige" (klingt nach Behördenbrief), „Bezugspersonen" als Wort der Oberfläche (sperrig für Jugendliche) und „Eltern" als Sammelbegriff, unter dem auch der Opa steht (genau das war zu eng).

### 1.3 Beziehung und Erziehungsberechtigung

Jede Zuordnung Bezugsperson ↔ Jungfischer trägt:

- **Beziehung** aus einer festen Liste: Mutter, Vater, Großmutter, Großvater, Tante, Onkel, Geschwister, Pflegeperson, Andere (mit Freitext).
- **erziehungsberechtigt** (ja/nein): bei Mutter, Vater und Pflegeperson vorbelegt, sonst nicht; immer änderbar, weil nicht jeder Vater sorgeberechtigt ist.

Verworfen: nur Freitext (uneinheitlich: „Mama", „Mutter", „Mutti"; das Häkchen müsste immer von Hand gesetzt werden) und gar keine Beziehung (der Vermerk „eingetragen von Opa Hans" ginge verloren).

### 1.4 Wer darf was

|                                                            | Erziehungsberechtigte | Weitere Bezugspersonen |
| ---------------------------------------------------------- | --------------------- | ---------------------- |
| Sehen, was das Kind sieht (Ausnahme: 2.3)                  | ✓                     | ✓                      |
| Für das Kind antworten, Fahrten eintragen, Kosten melden   | ✓                     | ✓                      |
| Einwilligung nach Art. 8 DSGVO beim Annehmen der Einladung | ✓                     | –                      |
| Foto-Einwilligung pflegen                                  | ✓                     | –                      |
| Zugang des Kindes erlauben, entziehen, neuen Link erzeugen | ✓                     | –                      |

Einwilligungen darf rechtlich nur geben, wer sorgeberechtigt ist; ein Opa ist das in der Regel nicht. Im Alltag merkt er keinen Unterschied zu den Eltern.

Verworfen: alle Bezugspersonen gleichgestellt (Einwilligungen von Nicht-Sorgeberechtigten wären rechtlich wackelig) und der Opa als bloßer Helfer ohne Kindbezug (er könnte nicht für das Kind antworten und sähe dessen Threads nicht).

### 1.5 Feste Regeln

- Bezugspersonen legt nur an, wer „Mitglieder verwalten" hat. Verworfen: Erziehungsberechtigte laden selbst ein, auch mit Freigabe durch einen Jugendleiter (Entscheidung des Eigentümers: die Pflege der Mitglieder bleibt beim Verein).
- Ein Jungfischer ohne erziehungsberechtigte Bezugsperson erscheint in der Verwaltung mit Warnhinweis.
- Eine Einladung für einen Jungfischer lässt sich erst erzeugen, wenn eine erziehungsberechtigte Bezugsperson ihre Einwilligung bestätigt hat. Sonst entstünde ein Kinderkonto ohne Einwilligung.

### 1.6 Oberfläche

- Rollenfilter: „Jungfischer + Familie", „Nur Familie".
- Antwortvermerk: Beziehung plus Vorname, „eingetragen von Opa Hans"; bei „Andere" der Freitext.
- Unter „Mehr" heißt der Bereich **„Meine Jungfischer"** statt „Meine Kinder", weil der Opa keine „Kinder" in der Gruppe hat.
- Dashboard: „… wartet auf dich" ohne Rollenwort.

---

## 2. Jugendsprecher

### 2.1 Anlass

Jugendsprecher sind Jungfischer, die von den übrigen Jungfischern gewählt werden. Sie sind Bindeglied zwischen Jugendleitern und Jungfischern und brauchen einen Austausch, an dem nur diese beiden Gruppen teilnehmen.

### 2.2 Merkmal

- `jugendsprecher` ist ein Merkmal am Jungfischer. Setzen und entfernen darf, wer „Mitglieder verwalten" hat.
- Die Wahl findet außerhalb der App statt. Eine Amtszeit wird nicht gespeichert; wer nicht mehr Jugendsprecher ist, verliert das Häkchen.

### 2.3 Sichtbarkeit

- Neuer Rollenfilter **„Jugendleiter + Jugendsprecher"**. Ein Thread damit ist sichtbar für alle Jugendleiter und für die Jungfischer, die gerade Jugendsprecher sind.
- **Untergruppen werden bei diesem Filter ignoriert.** Jugendsprecher sprechen für die ganze Gruppe; eine Auswahl wäre nur eine Fehlerquelle.
- **Die Familie sieht diese Threads nicht.** Die feste Regel „Bezugspersonen sehen alles, was ihre Kinder sehen" bekommt hier ihre einzige Ausnahme. Der Zweck, dass Jugendliche offen für die Gruppe sprechen, braucht einen Raum ohne Eltern.
- Wer kein Jugendsprecher mehr ist, für den sind diese Threads samt Verlauf „nicht gefunden" (404).

Verworfen: die Familie liest mit, schreibt aber nicht (Jugendsprecher reden dann vorsichtiger, und dafür ist der Kanal da), und die Familie sieht alles wie sonst (dann ist es kein Austausch nur zwischen den beiden Gruppen).

### 2.4 Schutzregeln

Sie entsprechen dem, was Kinderschutzkonzepte in Vereinen verlangen:

1. **Gruppe statt Zweiergespräch.** Es gibt nur Gruppen-Threads; Einzelgespräche zwischen einem Erwachsenen und einem Kind sieht die App nirgends vor.
2. **Mehrere Erwachsene.** Alle Jugendleiter sehen diese Threads.
3. **Für die Familie erkennbar.** Unter „Meine Jungfischer" steht: „Lena ist Jugendsprecherin und nimmt am Austausch mit den Jugendleitern teil."

### 2.5 Ständiger Austausch und Themen-Threads

- Jeder Verein hat einen angepinnten Thread **„Jugendsprecher-Austausch"** im Modus „Offener Chat" mit diesem Rollenfilter. Er entsteht beim Anlegen des Vereins, wird nie automatisch archiviert und lässt sich nicht löschen. Titel und Modus ändert, wer „Alle Threads bearbeiten" hat.
- Jugendleiter legen weitere Threads mit diesem Filter über den normalen Editor an, etwa „Planung Zeltlager" mit Umfrage.
- Jugendsprecher bekommen **keine** Rechte zum Anlegen. Für „ich will etwas ansprechen" reicht der ständige Chat.

Verworfen: ein eingeschränktes Recht „Threads erstellen" für Jugendsprecher (erstes Recht für Jungfischer, Sonderfall in Rechtemodell und Editor) und nur der Rollenfilter ohne ständigen Thread (Jugendsprecher könnten kein eigenes Thema anstoßen).

### 2.6 Antworten

In Threads mit diesem Filter antworten Jugendsprecher bei „pro Jungfischer" selbst; die Familie sieht den Thread nicht und kann nicht für sie antworten. „Pro Erwachsenem" betrifft nur die Jugendleiter.

---

## 3. Termine und Kalender

### 3.1 Form eines Termins

Ein Termin hatte bisher immer einen Tag mit Uhrzeit. Ein Zeltlager von Freitag bis Sonntag oder ein ganztägiger Arbeitseinsatz ließ sich damit nicht anlegen.

- **Pflicht:** Startdatum.
- **Optional:** Enddatum (mehrtägig), Beginnzeit, Endezeit.
- Alle Zeiten gelten in der Zeitzone des Vereins (Europe/Berlin).

| Eingabe                | Anzeige                           |
| ---------------------- | --------------------------------- |
| nur Datum              | Sa 17.10. · ganztägig             |
| Datum, Beginn und Ende | Sa 17.10. · 14:00–17:00           |
| Datum und Beginn       | Sa 17.10. · 14:00                 |
| von–bis ohne Zeiten    | Fr 23.10. – So 25.10.             |
| von–bis mit Zeiten     | Fr 23.10. 17:00 – So 25.10. 12:00 |

Fehlt bei „von–bis" eine der beiden Zeiten, entfällt sie in der Anzeige („Fr 23.10. – So 25.10. 12:00").

Ungültig und vom Editor abgelehnt: Enddatum vor dem Startdatum; am selben Tag Endezeit vor der Beginnzeit.

Verworfen: Uhrzeit bleibt Pflicht, nur ein Enddatum kommt hinzu (keine ganztägigen Termine), und Mehrtägiges als mehrere Termin-Module (Anreise, Abreise), weil dann im Kalender kein zusammenhängender Eintrag entsteht.

### 3.2 Folgen für die übrigen Regeln

- **Archiv-Regel**: eine Woche nach dem **letzten Tag** des letzten Termins.
- **„Als Nächstes"** zeigt einen laufenden mehrtägigen Termin bis zu seinem Ende.
- **Sortierung** nach Startdatum, dann Beginnzeit; ganztägige Termine eines Tages vor denen mit Uhrzeit.
- **Termin-Erinnerung** (Teilprojekt 5) am Vortag des Startdatums.

### 3.3 Kalendereintrag

Eine reine Funktion leitet aus Termin und Thread den Kalendereintrag ab: Beginn, Ende, ganztägig ja/nein, Titel, Ort, Beschreibung.

| Termin                           | Kalendereintrag                                                   |
| -------------------------------- | ----------------------------------------------------------------- |
| ohne Beginnzeit                  | ganztägig über alle Tage; eine Endezeit steht in der Beschreibung |
| mit Beginn und Ende              | von Beginn bis Ende                                               |
| mit Beginn, ohne Ende, eintägig  | eine Stunde lang; Beschreibung „Ende offen"                       |
| mit Beginn, ohne Ende, mehrtägig | bis zum Ende des letzten Tages (24:00)                            |

Ein Eintrag ohne Beginnzeit ab Mitternacht wäre irreführend, daher ganztägig. Eine Stunde ist auch die Vorgabe der Kalender-Apps selbst.

- **Titel**: Thread-Titel, ergänzt um den Modultitel („Zeltlager 2027 · Vortreffen").
- **Ort**: der Ort des Termins.
- **Beschreibung**: Treffpunkt, Hinweise zur Endezeit, Link zum Termin in der App (`/<slug>/t/<id>/m/<modulId>`).
- **Keine Personennamen.**

### 3.4 „In Kalender eintragen"

Am Termin-Modul im Thread steht der Knopf **„In Kalender eintragen"**. Die Termine-Seite verlinkt ohnehin dorthin. Er klappt zwei Wege auf:

1. **„Kalender des Telefons"**: Die App erzeugt eine .ics-Datei (RFC 5545) im Browser und lädt sie herunter. iPhone, Samsung-Kalender und Desktop-Kalender öffnen sie. Die UID ist pro Termin-Modul fest, damit erneutes Eintragen den Eintrag möglichst aktualisiert statt ihn zu verdoppeln.
2. **„Google Kalender"**: öffnet `https://calendar.google.com/calendar/render?action=TEMPLATE&…` mit `ctz=Europe/Berlin` in einem neuen Tab, auf Android meist direkt in der Kalender-App. Der Google-Kalender auf Android kann .ics-Dateien nicht direkt importieren; dafür ist dieser Weg da.

Verworfen: nur .ics (auf Android mit Google-Kalender eine Sackgasse) und Geräteerkennung, die direkt einen Weg wählt (falsch bei Android mit Samsung-Kalender oder iPhone mit Google-Kalender; die Erkennung bricht bei Browser-Updates).

**Datenschutz**: Beim Google-Weg gehen Titel, Zeit, Ort und Beschreibung an Google, aber nur, wenn die Person ihn selbst antippt, und nur in ihren eigenen Kalender. Personennamen sind nicht enthalten (3.3).

### 3.5 Kalender-Abo (Teilprojekt 5)

Später bekommt jede Person auf Wunsch eine persönliche Abo-Adresse (webcal), über die alle ihre Termine von selbst im Telefon erscheinen und Änderungen nachkommen:

- freiwillig und abschaltbar;
- die Adresse ist ein geheimer Link und neu erzeugbar; die alte wird damit ungültig;
- sie enthält nur Termine aus Threads, die die Person sieht, ohne Personennamen.

Das Abo braucht einen Server und gehört zu den Benachrichtigungen, weil es denselben Zweck erfüllt: Änderungen erreichen die Person, ohne dass sie die App öffnet.

---

## 4. Umsetzung im klickbaren Entwurf

Nur Teil 3 kommt in den Entwurf.

### 4.1 Datenmodell und Beispieldaten

- `TerminModul` bekommt `von`, `bis?`, `beginnZeit?` und `endeZeit?` statt `beginn` und `ende?`. Datum als `JJJJ-MM-TT`, Zeit als `HH:MM`.
- Der Speicherschlüssel steigt auf `jufi-entwurf:v2`; jeder gespeicherte Stand beginnt neu. Das ist der vorgesehene Weg bei Änderungen am Datenmodell (Kommentar in `daten/speicher.ts`). Wer schon getestet hat, verliert seinen Fortschritt; die Rückmeldungen liegen bereits vor.
- Die bestehenden Termine bekommen die neue Form. Neu: ein Termin **„Zeltlager"** von Freitag 17:00 bis Sonntag 12:00 im Zeltlager-Thread (sichtbar für Lena und damit für Sandra) und ein ganztägiger Termin **„Aufbau"** am Vortag im Herbstfest-Thread. Damit kommen ganztägige, mehrtägige und zeitlich begrenzte Termine in den Beispieldaten vor.

### 4.2 Regeln

Reine Funktionen ohne Angular-Abhängigkeit, testgetrieben:

- `terminZeit(termin)`: Anzeige nach 3.1, für Termin-Modul, Termine-Seite, Dashboard und Verwaltung.
- `kalenderEintrag(termin, thread, link)`: nach 3.3.
- `alsIcs(eintrag, uid, jetzt)`: Dateitext mit CRLF, Maskierung von Komma, Semikolon, Backslash und Zeilenumbruch, Zeilenfaltung nach 75 Bytes, Zeiten in UTC, ganztägig als `VALUE=DATE` mit exklusivem Enddatum, `DTSTAMP` aus `jetzt`.
- `googleLink(eintrag)`: Template-URL nach 3.4.
- Archiv-Regel, „Als Nächstes" und Sortierung nach 3.2; die bestehenden Tests werden auf die neue Form umgestellt.

### 4.3 Oberfläche

- Termin-Modul: Knopf „In Kalender eintragen" mit Aufklapp-Auswahl der beiden Wege.
- Thread-Editor: Felder Startdatum, Enddatum (optional), Beginn (optional), Ende (optional); Speichern verweigert ungültige Kombinationen (3.1) mit Hinweis am Feld.

### 4.4 Testmodus

- Neue Aufgabe für **Sandra** und **Lena**: „Trag das Zeltlager in deinen Kalender ein."
- Neues Testereignis `kalenderEingetragen` mit dem gewählten Weg (`ics` oder `google`). Die Aufgabe gilt als erledigt, sobald es eintrifft.
- Ob der Eintrag auf dem Telefon wirklich angekommen ist, kann der Browser nicht wissen. Das sagt die Testperson in der Bewertung (Smiley und Notiz).
- Die Rückmeldung nennt den gewählten Weg.

### 4.5 Prüfen

- Unit-Tests für alle Regeln aus 4.2, Seitentests für Knopf, Aufklapp-Auswahl und Editor.
- Die erzeugte .ics-Datei wird zusätzlich mit einem Validator geprüft.
- Im Browser gemessen bei 375 × 812, hell und dunkel: Aufklapp-Auswahl ohne horizontales Scrollen, Tippflächen mindestens 44 px.
- Den Test auf echten Geräten (iPhone in Safari und als Home-Bildschirm-App, Android mit Google-Kalender) machen der Eigentümer und die Testpersonen.
