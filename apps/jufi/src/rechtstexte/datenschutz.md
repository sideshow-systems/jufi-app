# Datenschutzerklärung

> **Entwurf zur rechtlichen Prüfung — noch nicht gültig.** Angaben in eckigen Klammern fehlen noch und werden vom Betreiber ergänzt.

## Worum es geht

Die JuFi App unterstützt die Jugendarbeit von Fischereivereinen. Jeder Verein hat einen eigenen Bereich unter seiner eigenen Adresse (`/<vereinskürzel>/`). Die Daten eines Vereins sind von denen anderer Vereine getrennt; die Datenbank selbst verhindert Verknüpfungen über Vereinsgrenzen hinweg. Die Plattform als Ganzes betreibt [Plattformbetreiber — liefert der Eigentümer].

Die App verarbeitet vor allem Daten von Kindern und Jugendlichen (Jungfischer), ihren Familien und den Jugendleitern des Vereins.

## Verantwortlicher

[Verantwortlicher: Name und Anschrift des Plattformbetreibers — liefert der Eigentümer]

## Rolle der Vereine und der Plattform

[Rolle der Vereine: Ist der jeweilige Verein Verantwortlicher für die Daten seiner Mitglieder und die Plattform sein Auftragsverarbeiter, oder sind Verein und Plattform gemeinsam verantwortlich? Wer ist für welche Verarbeitung zuständig, und gibt es einen Vertrag zur Auftragsverarbeitung mit jedem Verein? — liefert der Eigentümer]

Technisch gilt:

- Die Personen eines Vereins legt der Verein selbst an und pflegt sie (Jugendleiter mit dem Recht „Mitglieder verwalten“). Einzige Ausnahme ist die erste Leitung: Sie erfasst der Plattform-Admin beim Anlegen des Vereins mit Vorname, Nachname und E-Mail-Adresse und schickt ihr die erste Einladung.
- Der Plattform-Admin legt Vereine an, sperrt und entsperrt sie und kann der Leitung eines Vereins einen neuen Zugangslink erzeugen. Er sieht dabei nur Kennzahlen (Anzahl der Jungfischer und Erwachsenen, eingerichtete Zugänge, offene Einladungen, Tag der letzten Anmeldung im Verein) sowie Name und E-Mail-Adresse der Ansprechpartner des Vereins. Namen von Kindern und Familien, Personenlisten und Inhalte sieht er nicht.
- Erzeugt der Plattform-Admin einen neuen Zugangslink für die Leitung, sieht der Verein das 30 Tage lang in seiner Verwaltung.

## Welche Daten verarbeitet werden

**Jungfischer**

- Vor- und Nachname, Geburtsdatum
- Untergruppen, denen das Kind zugeordnet ist
- ob das Kind Jugendsprecherin oder Jugendsprecher ist
- ob die Familie dem Kind einen eigenen Zugang erlaubt
- ob die Verwaltung den Hinweis auf die Volljährigkeit zur Kenntnis genommen hat (Zeitpunkt)
- freiwillig eine E-Mail-Adresse
- die Familienzuordnungen (siehe unten) und die Einwilligungen der Erziehungsberechtigten
- mit eigenem Zugang: ein selbst gewählter Anmeldename sowie die Anmeldedaten (siehe „Für alle mit Zugang“)

**Erwachsene, Eltern und andere Bezugspersonen**

- Vor- und Nachname
- E-Mail-Adresse; sie ist zugleich die Kennung bei der Anmeldung. Beim Anlegen durch den Verein ist sie freiwillig, beim Annehmen der Einladung Pflicht.
- je zugeordnetem Kind: die Beziehung (Mutter, Vater, Großmutter, Großvater, Tante, Onkel, Geschwister, Pflegeperson oder „andere“ mit einer kurzen Beschreibung) und ob die Person erziehungsberechtigt ist
- die von ihr erteilten und widerrufenen Einwilligungen (siehe „Einwilligung für Minderjährige“)

**Jugendleiter, Leitung und Betreuer**

Jugendleiter sind Erwachsene mit mindestens einem Recht im Verein. Zusätzlich zu den Angaben für Erwachsene werden gespeichert:

- ihre Rechte (zum Beispiel „Mitglieder verwalten“, „Jugendleiter & Rechte verwalten“, „Einstellungen“)
- auf Wunsch ein zweiter Anmeldefaktor (Einmalcodes aus einer Authenticator-App) mit zehn Wiederherstellungscodes

**Für alle mit Zugang**

- Zeitpunkt, an dem der Zugang eingerichtet wurde, und Zeitpunkt der letzten Anmeldung
- Passwort, nur als Hash (siehe „Anmeldung und Sicherheit“)
- Passkeys: öffentlicher Schlüssel, Kennung des Passkeys, Signaturzähler, die vom Gerät gemeldeten Übertragungswege (etwa USB oder intern), ein Name (zunächst aus dem Browser abgeleitet, etwa „iPhone“ oder „Mac“, im Profil frei änderbar), ob der Passkey zwischen Geräten synchronisiert wird, Zeitpunkt der Einrichtung und der letzten Nutzung
- für die Dauer einer Anmeldung oder Passkey-Einrichtung eine Prüfzahl (Challenge), bei der Einrichtung mit der internen Kennung der Person; sie verfällt nach zwei Minuten
- Sitzungen: Zeitpunkt der Anmeldung, zuletzt gesehen, Ablauf und die Browserkennung (User-Agent)
- Einladungs- und Zurücksetzen-Links: für wen und von wem sie erzeugt wurden, Ablauf und ob der Link eingelöst wurde; der Link selbst nur als Hash

**E-Mails**

Für Einladungen (auch die erste Einladung und neue Zugangslinks der Leitung durch den Plattform-Admin) und zum Zurücksetzen des Zugangs schreibt die App E-Mails mit Empfängeradresse, Betreff und Text in eine Warteschlange und versendet sie von dort.

**Threads**

Ein Thread ist ein Aushang des Vereins mit Verlauf, etwa für eine Veranstaltung. Dazu werden gespeichert:

- die Inhalte der Threads und ihrer Module: Titel, Zielgruppe (Untergruppen und wer ihn sehen darf), Info-Text, Termine (Datum, Zeit, Ort, Treffpunkt) und Umfragen mit Frage, Optionen und Frist, außerdem wer den Thread angelegt hat und wann
- Antworten auf Umfragen: für wen (Jungfischer oder Erwachsene), von wem sie eingetragen wurden, die gewählten Optionen und der Zeitpunkt. Eine Antwort für ein Kind kann das Kind, seine Familie oder ein Jugendleiter eingetragen haben, etwa nach einem Telefonat.
- Nachrichten im Verlauf eines Threads: Absender, Zeitpunkt und Text. Löscht jemand eine Nachricht, wird ihr Text geleert; die Zeile mit Absender und Zeitpunkt bleibt als „Nachricht gelöscht“ stehen.
- der Gelesen-Stand je Person und Thread: bis zu welchem Stand die Person den Thread und seinen Verlauf gesehen hat und wann, damit die App „neu“ und ungelesene Nachrichten anzeigen kann
- ein Änderungsprotokoll (`Aenderung`): je Änderung nur Kennungen, also der Stand, die Kennung des Threads und des geänderten Objekts, die Art der Änderung, die Kennung der handelnden Person und der Zeitpunkt; keine Inhalte

Der Jugendsprecher-Austausch ist ein solcher Thread, den jeder Verein von Anfang an hat. Er ist nur für Jugendleiter und Jungfischer mit dem Merkmal Jugendsprecher sichtbar.

**Plattform-Admin**

Benutzername, Passwort-Hash, verschlüsselter zweiter Faktor mit gehashten Wiederherstellungscodes, Passkeys, Sitzungen mit Browserkennung und das Protokoll seiner Aktionen (siehe „Protokolle“).

**Verein**

Offizieller Name, Anzeigename, Vereinsfarbe, ein freier Kontakttext und das Vereinslogo. Das Logo wird beim Hochladen neu gespeichert: höchstens 1024 Pixel groß und ohne Metadaten, also etwa ohne den Aufnahmeort eines Handyfotos.

## Wer im Verein was sieht

- **Jugendleiter mit „Mitglieder verwalten“** sehen alle Personen des Vereins mit allen Angaben, auch E-Mail-Adressen, Einladungs- und Einwilligungsstand.
- **Übrige Jugendleiter** (etwa Betreuer) sehen alle Personen lesend mit Name, Geburtsdatum, Familie, Untergruppen, Rechten und Jugendsprecher-Merkmal sowie die Hinweise „ohne Familie“ und „volljährig“, aber keine E-Mail-Adressen.
- **Familien und Jungfischer** sehen sich selbst, die eigenen Jungfischer und deren Familie sowie die Namen aller Jugendleiter als Ansprechpartner. Den freien Kontakttext, den der Verein in seinen Einstellungen hinterlegt, sehen alle Angemeldeten auf der Startseite, auch Kinder. Ein Mitgliederverzeichnis gibt es für sie nicht.
- Entfernte Personen sieht niemand mehr.

**Threads**

- **Wer einen Thread sieht:** Jugendleiter sehen alle Threads, auch Entwürfe. Familien und Jungfischer sehen nur veröffentlichte Threads, deren Zielgruppe (Untergruppen und Rollenfilter) sie einschließt. Was jemand nicht sehen darf, ist für ihn „nicht gefunden“.
- **Namen in Threads:** Wer in einem Thread schreibt oder antwortet, erscheint für alle Leser des Threads mit Vorname und Initiale des Nachnamens („Lena M.“). Erwachsene Bezugspersonen stehen zusätzlich mit ihrer Rolle gegenüber den Kindern („Sandra M. (Mutter von Max)“), Jugendleiter mit dem Zusatz „Jugendleiter“. Damit ist für die Leser eines Threads erkennbar, welches Kind zu welchem Erwachsenen gehört. Entfernte Personen erscheinen als „ehemaliges Mitglied“.
- **Ergebnisse von Umfragen:** Je nach Einstellung des Threads sehen alle Leser die Namen der Antwortenden („für alle“), nur eine Summe („nur als Summe“) oder nur Jugendleiter etwas („nur Jugendleiter“). Die eigene Antwort sieht jeder immer. Jugendleiter mit dem Recht „Antworten im Detail“ und wer den Thread bearbeiten darf, sehen immer die Namen und wer noch nicht geantwortet hat.
- **„eingetragen von“:** Wer eine Antwort für eine andere Person eingetragen hat, sehen nur Jugendleiter in den Ergebnissen. In den eigenen Antwortzeilen sieht jeder, wer für ihn oder seine Kinder eingetragen hat.
- **Gelesen-Stand:** Er dient nur der Anzeige für die Person selbst („neu“, ungelesene Nachrichten). Andere sehen nicht, wer einen Thread gelesen hat.

## Zwecke

- **Stammdaten der Jungfischer und Familien:** Organisation der Jugendgruppe, Zuordnung der Kinder zu ihren Familien und Untergruppen, Ansprechpartner für den Verein.
- **Geburtsdatum:** Erkennen, ob ein Kind minderjährig ist und deshalb die Einwilligung der Erziehungsberechtigten braucht, und Hinweis an die Verwaltung, sobald ein Jungfischer volljährig wird.
- **Beziehung und Erziehungsberechtigung:** Festlegen, wer für ein Kind einwilligen, seinen Zugang erlauben oder entziehen und ihm einen Link erzeugen darf.
- **Rechte der Jugendleiter:** Steuern, wer im Verein Personen sehen und verwalten darf.
- **E-Mail-Adresse:** Anmeldung Erwachsener, Versand von Einladungen und Links zum Zurücksetzen des Zugangs.
- **Anmelde- und Sitzungsdaten:** sichere Anmeldung, Schutz vor fremden Zugriffen, Übersicht der eigenen Geräte und Sitzungen.
- **Einwilligungen:** Nachweis, wer wann in welcher Textfassung für ein Kind eingewilligt oder widerrufen hat.
- **Threads, Antworten und Verlauf:** Informationen und Termine an die Familien eines Vereins bringen, Zu- und Absagen einsammeln, Rückfragen im Verlauf beantworten. Der Gelesen-Stand zeigt, was für die Person neu ist; das Änderungsprotokoll hält die Anzeigen aller Geräte aktuell (Live-Verbindung, siehe „Cookies und lokale Speicherung“).
- **Protokoll des Plattform-Admins:** Nachweis, wer wann was an einem Verein getan hat.
- **Vereinsdaten und Logo:** Darstellung des Vereins in der App, auf dem Home-Bildschirm und in E-Mails.

## Rechtsgrundlagen

[Rechtsgrundlagen nach Art. 6, 8 und gegebenenfalls 9 DSGVO — liefert der Eigentümer nach rechtlicher Prüfung. Eine Rechtsgrundlage brauchen mindestens:

- die Verwaltung der Stammdaten von Jungfischern und Familien durch den Verein, auch schon bevor eine Einwilligung vorliegt
- der eigene Zugang eines Kindes, für den die App die Einwilligung der Erziehungsberechtigten verlangt
- die Verwaltung der Jugendleiter und ihrer Rechte
- Anmeldung, Sitzungen und Sicherheitsmaßnahmen
- der Versand von E-Mails
- die Aufbewahrung der Einwilligungen als Nachweis, auch nach dem Entfernen einer Person
- Threads, Antworten und Nachrichten, auch dass sie nach dem Entfernen einer Person bestehen bleiben (siehe „Speicherdauer und Löschung“)
- das Protokoll des Plattform-Admins
- die Sicherungskopien]

## Einwilligung für Minderjährige

- Die App verlangt für **jedes minderjährige Kind** die Einwilligung einer erziehungsberechtigten Person, unabhängig vom Alter. Ohne gültige Einwilligung bekommt das Kind keinen Einladungslink und keinen eigenen Zugang; die Familie handelt dann in seinem Namen.
- **Wer einwilligt:** Eine Bezugsperson, die der Verein als erziehungsberechtigt eingetragen hat. Sie willigt beim Annehmen ihrer eigenen Einladung ein (ein Häkchen je Kind, dazu die Frage, ob das Kind einen eigenen Zugang bekommen soll) oder später unter „Meine Jungfischer“.
- **Was gespeichert wird:** das Kind, wer eingewilligt hat, die Art der Einwilligung, die Fassung des Einwilligungstexts, die angezeigt wurde, und der Zeitpunkt. [Wortlaut des Einwilligungstexts, Fassung 1 — liefert der Eigentümer; der Text in der App ist bisher ein Platzhalter]
- **Widerruf:** Unter „Meine Jungfischer“ kann jede erziehungsberechtigte Person ihre eigene Einwilligung widerrufen. Der Datensatz bleibt mit dem Zeitpunkt des Widerrufs als Nachweis stehen. Hat das Kind danach keine gültige Einwilligung mehr, verliert es seinen Zugang: Zugang, Passkeys, Sitzungen und offene Einladungen werden gelöscht.
- **Wegfall ohne Widerruf:** Eine Einwilligung wirkt nur, solange ihre Erteilerin oder ihr Erteiler noch erziehungsberechtigt ist. Sie wirkt nicht mehr, wenn die Familienzuordnung gelöst, die Erziehungsberechtigung ausgetragen oder die Person entfernt wird, und auch nicht mehr, sobald das Kind 18 Jahre alt ist. Fehlt danach eine gültige Einwilligung, verliert ein minderjähriges Kind seinen Zugang ebenso.
- **Volljährigkeit:** Ab dem 18. Geburtstag dürfen Familienmitglieder nicht mehr für den Jungfischer einwilligen und seinen Zugang nicht mehr steuern; sie bleiben verknüpft. Die Verwaltung erhält einen Hinweis und entscheidet, ob die Familie verknüpft bleibt oder der Jungfischer die Gruppe verlässt.

## Anmeldung und Sicherheit

- **Passkeys:** Die App speichert nur den öffentlichen Schlüssel. Der geheime Schlüssel bleibt auf Ihrem Gerät oder in Ihrem Passwortmanager; Fingerabdruck oder Gesichtsbild erhält die App nicht. Der Passkey trägt auf Ihrem Gerät die Bezeichnung „Vorname Nachname · Name der Gruppe“.
- **Passwort:** Gespeichert wird nur ein Hash (Argon2id), nie das Passwort selbst.
- **Zweiter Faktor:** Das Geheimnis für die Einmalcodes wird verschlüsselt gespeichert (AES-256-GCM). Den QR-Code zur Einrichtung erzeugt die App selbst, ohne fremden Dienst. Die zehn Wiederherstellungscodes werden nur als Hash gespeichert.
- **Links:** Einladungs- und Zurücksetzen-Links werden in der Datenbank nur als Hash gespeichert. Ausnahme ist die E-Mail, die den Link überbringt: Bis zum Versand steht ihr Text mit dem Link in der Versandwarteschlange (siehe „Speicherdauer und Löschung“). Das Geheimnis im Link steht hinter einem `#` und wird deshalb beim Aufruf nicht an den Server übertragen. Eine Einladung gilt 14 Tage, ein Link zum Zurücksetzen eine Stunde.
- **Sitzungen:** In der Datenbank steht nur ein Hash des Sitzungstokens. Unter „Profil“ können Sie sich auf allen Geräten abmelden.
- **Fehlversuche:** Nach drei falschen Anmeldeversuchen wartet die App zunehmend länger (höchstens 15 Minuten). Dafür merkt sie sich Kennung und IP-Adresse nur im Arbeitsspeicher; der Eintrag zählt 15 Minuten nach dem letzten Fehlversuch nicht mehr und wird spätestens bei einem Neustart verworfen.
- Die Verbindung ist verschlüsselt (HTTPS).

## Teilen, Kalender und Karten

Die App hat drei Wege, etwas aus einem Thread weiterzugeben. Keiner läuft von selbst; jeder beginnt mit einem Antippen.

- **Teilen:** „Stand teilen“ baut im eigenen Gerät einen Text aus dem Thread: Titel, Termin, die Zahlen und, soweit die Person sie sehen darf, die Namen aus den Ergebnissen (Vorname und Initiale), dazu den Link zum Thread. Am Handy öffnet das Gerät sein Teilen-Blatt, am Rechner kopiert die App den Text in die Zwischenablage. Wohin der Text geht, etwa in eine WhatsApp-Gruppe, entscheidet die Person; die App sendet nichts selbst an WhatsApp oder einen anderen Dienst. Mit dem Text verlassen die Namen die App: Ab dort gelten die Regeln des Dienstes und liegt es bei der Person, wem sie ihn schickt. Entwürfe lassen sich nicht teilen.
- **Kalender:** Unter „In Kalender eintragen“ erzeugt „Kalender des Telefons“ eine Datei im eigenen Gerät; dabei wird nichts übertragen. Der Weg „Google Kalender“ öffnet erst nach dem Antippen eine Adresse bei Google und überträgt damit Titel, Zeit, Ort, Treffpunkt und den Link zum Thread an Google. Die App kennt dabei keine Personennamen.
- **Karten:** Der Ort eines Termins ist ein Link. Erst nach dem Antippen wird er an den Kartenanbieter übertragen: je nach Gerät an die Karten-App des Geräts oder an die Suche von Google Maps. Eingebettet ist nichts.

**Link-Vorschau.** Wird ein Link zu einem Thread in einen Messenger eingefügt, ruft der Messenger die Adresse selbst ab, ohne Anmeldung, und liest daraus Titel und Bild für die Vorschau. Die App antwortet dort so:

- Bei einem **veröffentlichten Thread, der sich an Jungfischer und Familien oder nur an Familien richtet,** steht sein Titel in der Vorschau.
- Bei **allen anderen** Adressen, also bei Threads nur für Jugendleiter, bei Entwürfen, beim Jugendsprecher-Austausch und bei Adressen, die es nicht gibt, steht der Anzeigename des Vereins. Diese Antworten sind nicht zu unterscheiden; an der Vorschau lässt sich nicht erkennen, ob es einen Thread gibt.
- Das Bild ist immer das Vereins-Icon. Weitere Angaben enthält die Vorschau nicht. Die App verbietet das Zwischenspeichern der Antwort (`Cache-Control: no-store`); was ein Messenger von der Vorschau behält, entscheidet der Messenger.

Die Vorschau kennt die Person nicht, die den Link abruft, und prüft deshalb keine Untergruppen: Bei einem Thread für eine Untergruppe zeigt sie den Titel jedem, der den Link hat, auch Familien außerhalb der Untergruppe, die den Thread selbst nicht öffnen könnten. Die Adressen der Threads sind zufällig und nicht zu erraten. Den Thread selbst, seine Inhalte und Namen zeigt die Vorschau nie.

## Cookies und lokale Speicherung

Die App setzt genau ein Cookie je Bereich:

| Name           | Zweck                          | gilt für                     | Lebensdauer                                                                         |
| -------------- | ------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------- |
| `jufi_sitzung` | Anmeldung im Verein            | nur den Bereich `/<verein>/` | 90 Tage, verlängert sich bei Nutzung (höchstens einmal am Tag); endet beim Abmelden |
| `jufi_admin`   | Anmeldung des Plattform-Admins | nur den Bereich `/admin/`    | 12 Stunden, ohne Verlängerung                                                       |

Beide Cookies sind für Skripte nicht lesbar (`HttpOnly`), werden nur verschlüsselt übertragen (`Secure`) und nicht an fremde Seiten mitgeschickt (`SameSite=Lax`).

Die Live-Verbindung (WebSocket) unter `/<verein>/ws` hält die Anzeige aktuell, solange die App offen ist. Sie nutzt das Sitzungscookie `jufi_sitzung`, setzt kein weiteres Cookie und überträgt keine zusätzlichen Daten: Der Server meldet nur Änderungen an Threads, die die Person ohnehin sehen darf, und neue Nachrichten im Verlauf. Nur die zufällige Kennung eines Threads, dessen Zielgruppe sich geändert hat oder der gelöscht wurde, geht ohne Prüfung an alle Verbindungen des Vereins, ohne Inhalt. Ebenso geht ein leeres Signal an alle Verbindungen des Vereins, wenn sich etwas ohne Thread ändert (Rechte, Familien, Untergruppen); es trägt keinen Inhalt. Endet die Sitzung, schließt der Server die Verbindung.

Im Speicher Ihres Browsers (`localStorage`) legt die App unter `jufi:thema` nur Ihre Wahl der Darstellung ab (hell, dunkel oder wie das System). Sie bleibt, bis Sie sie im Browser löschen, und wird nicht an den Server übertragen.

**Kein Tracking:** Die App verwendet keine Analyse- oder Werbedienste, keine Zählpixel und keine Inhalte fremder Anbieter. Schriften und Symbole stammen aus der App selbst bzw. vom Gerät; der Browser darf laut Sicherheitsrichtlinie der App nur Inhalte vom eigenen Server laden.

## Protokolle

- **Protokoll des Plattform-Admins:** welcher Admin wann welche Aktion an welchem Verein ausgeführt hat (Verein angelegt, gesperrt, entsperrt, Adresse korrigiert, neuer Zugangslink für die Leitung, erste Einladung erneuert), beim Anlegen des Vereins, bei erneuerter erster Einladung und bei einem Zugangslink auch die interne Kennung der betroffenen Person, ohne Namen. Das Protokoll bleibt auch nach dem Löschen eines Vereins bestehen. [Aufbewahrungsdauer des Admin-Protokolls — liefert der Eigentümer; im Code ist keine Löschfrist festgelegt]
- **Betriebsprotokoll der App:** Die App schreibt keine Namen, E-Mail-Adressen oder Zugangslinks in ihr Protokoll. Beim Mailversand stehen dort nur eine interne Nummer der Mail und gegebenenfalls die Art des Fehlers, bei Programmfehlern Anfrageart, Pfad und die technische Fehlermeldung. Eine solche Meldung kann im Einzelfall Eingabewerte wiedergeben, etwa einen Namen. [Aufbewahrungsdauer des Betriebsprotokolls — liefert der Eigentümer]
- [Protokolle des Webservers bzw. Proxys und des Hosters (etwa IP-Adressen beim Seitenaufruf) und deren Aufbewahrungsdauer — liefert der Eigentümer]

## Speicherdauer und Löschung

- **Personen:** bleiben gespeichert, bis die Verwaltung sie aus der Gruppe entfernt. Beim Entfernen werden Name, Geburtsdatum, E-Mail-Adresse, Rechte und Jugendsprecher-Merkmal geleert; Zugang, Passwort, Passkeys, zweiter Faktor, Sitzungen, Einladungen, Familienzuordnungen und Untergruppen werden gelöscht. Es bleibt ein Datensatz ohne Namen und Kontaktdaten (unter anderem Art der Person sowie Zeitpunkt von Anlage und Entfernen), damit Einwilligungen und spätere Verweise als „ehemaliges Mitglied“ erhalten bleiben.
- **Threads, Antworten und Nachrichten:** bleiben stehen, bis der Verein den Thread löscht. Ein Thread mit Antworten oder nicht gelöschten Nachrichten lässt sich nicht löschen, er kommt ins Archiv und bleibt lesbar; ein Thread mit Termin kommt in der Regel sieben Tage nach seinem letzten Termin von selbst ins Archiv. Eine gelöschte Nachricht verliert ihren Text sofort.
- **Änderungsprotokoll (`Aenderung`):** Einträge werden nach 90 Tagen gelöscht, beim Start der App und danach alle 24 Stunden.
- **Gelesen-Stände:** werden gelöscht, wenn die Person entfernt wird.
- **Antworten und Nachrichten einer entfernten Person:** bleiben stehen, damit Ergebnisse und Verlauf der anderen verständlich bleiben, auch der Text der Nachrichten. Sie erscheinen als „ehemaliges Mitglied“, weil ihr Name beim Entfernen geleert wurde. [Ob Antworten und Nachrichten nach dem Entfernen einer Person so stehen bleiben dürfen, steht unter dem Vorbehalt der rechtlichen Prüfung — liefert der Eigentümer]
- **Einwilligungen:** werden nie gelöscht, nur widerrufen, und bleiben auch nach dem Entfernen der Person als Nachweis stehen.
- **Sitzungen:** enden 90 Tage nach der letzten Verlängerung oder beim Abmelden; abgelaufene Sitzungen löscht die App selbsttätig.
- **Einladungen:** Ein neuer Link ersetzt den alten derselben Art; eingelöste und abgelaufene, nie eingelöste Einladungen bleiben bis dahin oder bis zum Entfernen der Person stehen. [Löschfrist für abgelaufene Einladungen — liefert der Eigentümer; im Code ist keine festgelegt] Beim Einlösen eines neuen Links für einen bestehenden Zugang werden altes Passwort, Passkeys, zweiter Faktor und alle Sitzungen gelöscht.
- **E-Mails:** Nach dem Versand wird der Text der Mail sofort geleert; Empfänger und Betreff bleiben 30 Tage für Rückfragen stehen und werden dann gelöscht. Mails, die nicht zugestellt werden konnten, bleiben mit Text stehen, damit die Verwaltung den Hinweis „Einladungsmail nicht zustellbar“ sieht; wird der Zugang entzogen oder die Person entfernt, fällt eine noch nicht gesendete Mail mit weg. Ersetzt ein neuer Link den alten, bleibt eine noch nicht gesendete oder nicht zustellbare Mail mit dem alten Link stehen; der alte Link selbst gilt dann nicht mehr. [Frist für endgültig nicht zustellbare Mails — liefert der Eigentümer; im Code ist keine festgelegt]
- **Verein:** Wird ein Verein gelöscht (etwa nach einer Kündigung), entfernt der Betreiber ihn mit allen Daten; erhalten bleibt nur das Protokoll des Plattform-Admins.
- **Darstellungswahl im Browser:** bis Sie sie im Browser löschen.
- In den Sicherungskopien bleiben gelöschte Daten bis zum Ablauf der jeweiligen Kopie erhalten (siehe „Sicherung“).

## Sicherung

- Die Datenbank wird täglich gesichert, verschlüsselt und auf einen getrennten Speicher außer Haus übertragen (ein zweites Konto bei Hetzner, eigenes Passwort für die Sicherung).
- Auf dem Server selbst bleiben die täglichen Sicherungen zusätzlich 30 Tage liegen, lesbar nur für den Betreiber.
- Aufbewahrt werden 7 tägliche, 4 wöchentliche und 6 monatliche Stände. Eine Sicherung kann also bis zu etwa sechs Monate alt werden.
- Die Wiederherstellung wird regelmäßig geprobt, indem der letzte Stand in eine getrennte, danach verworfene Datenbank eingespielt und geprüft wird, zunächst bei der Inbetriebnahme, danach vierteljährlich.

## Auftragsverarbeiter und Empfänger

- **Hetzner** ([Firma und Anschrift der Hetzner-Gesellschaft, Standort des Rechenzentrums, Vertrag zur Auftragsverarbeitung — liefert der Eigentümer]): Server und Datenbank, Versand der E-Mails über den Mailserver von Hetzner und Speicher für die Sicherungskopien.
- **Keine Drittanbieter-Einbindungen:** Die App lädt keine Schriften, Skripte, Bilder oder sonstige Inhalte von fremden Servern und bindet keine Analyse-, Werbe- oder Social-Media-Dienste ein.
- Die App selbst gibt keine Daten an weitere Dienste weiter. Was die Person selbst über „Teilen“, „Google Kalender“ oder einen Karten-Link anstößt, steht unter „Teilen, Kalender und Karten“. [Übermittlung in Länder außerhalb der EU: Bestätigung für Hosting, Mailversand und Sicherung — liefert der Eigentümer]
- Innerhalb des Vereins sehen Jugendleiter und Familien Daten nur im Umfang von „Wer im Verein was sieht“.

## Ihre Rechte

[Aufzählung der Betroffenenrechte (Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch, Widerruf einer Einwilligung, Beschwerde bei einer Aufsichtsbehörde) und an wen sich Betroffene wenden — liefert der Eigentümer]

In der App gilt:

- **Auskunft:** Unter „Profil“ lädt „Meine Daten herunterladen“ eine Datei mit Ihren gespeicherten Angaben: Personendaten samt Rechten, ob ein Zugang erlaubt ist und wann die Volljährigkeit geprüft wurde; Zugang (Anmeldename, ob Passwort und zweiter Faktor gesetzt sind, Zeitpunkte); ob Wiederherstellungscodes eingerichtet sind und wie viele noch unbenutzt sind; noch gültige Einladungs- und Rücksetzlinks mit Erzeugung und Ablauf; Namen der Passkeys, Sitzungen, Familie (mit Zeitpunkt der Zuordnung), Untergruppen und Einwilligungen. Zu den Threads enthält sie Ihre Antworten und die Antworten für Ihre zugeordneten Kinder, auch wenn jemand anderes sie eingetragen hat (Thread, Frage, gewählte Optionen, für wen, von wem, wann; die Namen stehen wie bei den übrigen Angaben als „ich“ oder mit vollem Namen), Ihre eigenen Nachrichten im Verlauf (Thread, Zeitpunkt, Text; bei gelöschten Nachrichten ohne Text) und Ihre Gelesen-Stände (Thread, Zeitpunkt). Über andere Personen enthält die Datei nur Namen, Beziehung und Erziehungsberechtigung, bei Ihren Kindern zusätzlich, ob deren Zugang erlaubt ist. Nur bei minderjährigen Kindern, für die Sie erziehungsberechtigt sind, kommen hinzu, wann die Volljährigkeit geprüft wurde und welche Links für sie noch gültig sind (Art, Erzeugung, Ablauf). Passwort-Hash, die Wiederherstellungscodes selbst, Links, Geheimnisse und Schlüssel enthält sie nicht. Ebenfalls nicht enthalten sind die Threads selbst, Nachrichten anderer, Antworten, die Sie für Kinder anderer Familien nachgetragen haben, technische Kennungen, die vollständige Browserkennung der Sitzungen, die Abschriften verschickter E-Mails in der Versandwarteschlange und Einladungen, die Sie für andere erzeugt haben, soweit sie nicht als noch gültige Links Ihrer Kinder aufgeführt sind. [Weg zur Auskunft über diese Angaben — liefert der Eigentümer] Für Kinder ohne eigenen Zugang gibt es keinen eigenen Auszug in der App. [Weg zur Auskunft für Personen ohne Zugang — liefert der Eigentümer]
- **Berichtigung:** Im Profil sind Name und Kennung nur lesbar. Namen, Geburtsdatum, E-Mail-Adresse, Untergruppen und Familienzuordnungen ändert die Verwaltung des Vereins (Recht „Mitglieder verwalten“); Angaben zu Jugendleitern ändert nur, wer „Jugendleiter & Rechte verwalten“ hat. Die E-Mail-Adresse eines Erwachsenen, der bereits einen Zugang eingerichtet hat, lässt sich in der App derzeit nicht ändern. Passwort, Passkeys und zweiten Faktor verwalten Sie selbst im Profil.
- **Erziehungsberechtigte** können unter „Meine Jungfischer“ den Zugang ihres Kindes erlauben oder entziehen, einen neuen Link erzeugen und ihre Einwilligung geben oder widerrufen. Namen und Zuordnungen ändern sie nicht; das bleibt beim Verein.
- **Löschung:** Ein Konto löscht man in der App nicht selbst; das Entfernen übernimmt die Verwaltung des Vereins (siehe „Speicherdauer und Löschung“).

## Datenschutzbeauftragter

[Datenschutzbeauftragter: Name und Kontakt, oder Hinweis, dass keiner benannt ist — liefert der Eigentümer]

## Aufsichtsbehörde

[Zuständige Aufsichtsbehörde mit Anschrift — liefert der Eigentümer]

## Kontakt

[Kontaktadresse für Fragen zum Datenschutz — liefert der Eigentümer]
