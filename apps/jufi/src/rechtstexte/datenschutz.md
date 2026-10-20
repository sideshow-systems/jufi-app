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

**Plattform-Admin**

Benutzername, Passwort-Hash, verschlüsselter zweiter Faktor mit gehashten Wiederherstellungscodes, Passkeys, Sitzungen mit Browserkennung und das Protokoll seiner Aktionen (siehe „Protokolle“).

**Verein**

Offizieller Name, Anzeigename, Vereinsfarbe, ein freier Kontakttext und das Vereinslogo. Das Logo wird beim Hochladen neu gespeichert: höchstens 1024 Pixel groß und ohne Metadaten, also etwa ohne den Aufnahmeort eines Handyfotos.

## Wer im Verein was sieht

- **Jugendleiter mit „Mitglieder verwalten“** sehen alle Personen des Vereins mit allen Angaben, auch E-Mail-Adressen, Einladungs- und Einwilligungsstand.
- **Übrige Jugendleiter** (etwa Betreuer) sehen alle Personen lesend mit Name, Geburtsdatum, Familie, Untergruppen, Rechten und Jugendsprecher-Merkmal sowie die Hinweise „ohne Familie“ und „volljährig“, aber keine E-Mail-Adressen.
- **Familien und Jungfischer** sehen sich selbst, die eigenen Jungfischer und deren Familie sowie die Namen aller Jugendleiter als Ansprechpartner. Den freien Kontakttext, den der Verein in seinen Einstellungen hinterlegt, sehen alle Angemeldeten auf der Startseite, auch Kinder. Ein Mitgliederverzeichnis gibt es für sie nicht.
- Entfernte Personen sieht niemand mehr.

## Zwecke

- **Stammdaten der Jungfischer und Familien:** Organisation der Jugendgruppe, Zuordnung der Kinder zu ihren Familien und Untergruppen, Ansprechpartner für den Verein.
- **Geburtsdatum:** Erkennen, ob ein Kind minderjährig ist und deshalb die Einwilligung der Erziehungsberechtigten braucht, und Hinweis an die Verwaltung, sobald ein Jungfischer volljährig wird.
- **Beziehung und Erziehungsberechtigung:** Festlegen, wer für ein Kind einwilligen, seinen Zugang erlauben oder entziehen und ihm einen Link erzeugen darf.
- **Rechte der Jugendleiter:** Steuern, wer im Verein Personen sehen und verwalten darf.
- **E-Mail-Adresse:** Anmeldung Erwachsener, Versand von Einladungen und Links zum Zurücksetzen des Zugangs.
- **Anmelde- und Sitzungsdaten:** sichere Anmeldung, Schutz vor fremden Zugriffen, Übersicht der eigenen Geräte und Sitzungen.
- **Einwilligungen:** Nachweis, wer wann in welcher Textfassung für ein Kind eingewilligt oder widerrufen hat.
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

## Cookies und lokale Speicherung

Die App setzt genau ein Cookie je Bereich:

| Name           | Zweck                          | gilt für                     | Lebensdauer                                                                         |
| -------------- | ------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------- |
| `jufi_sitzung` | Anmeldung im Verein            | nur den Bereich `/<verein>/` | 90 Tage, verlängert sich bei Nutzung (höchstens einmal am Tag); endet beim Abmelden |
| `jufi_admin`   | Anmeldung des Plattform-Admins | nur den Bereich `/admin/`    | 12 Stunden, ohne Verlängerung                                                       |

Beide Cookies sind für Skripte nicht lesbar (`HttpOnly`), werden nur verschlüsselt übertragen (`Secure`) und nicht an fremde Seiten mitgeschickt (`SameSite=Lax`).

Im Speicher Ihres Browsers (`localStorage`) legt die App unter `jufi:thema` nur Ihre Wahl der Darstellung ab (hell, dunkel oder wie das System). Sie bleibt, bis Sie sie im Browser löschen, und wird nicht an den Server übertragen.

**Kein Tracking:** Die App verwendet keine Analyse- oder Werbedienste, keine Zählpixel und keine Inhalte fremder Anbieter. Schriften und Symbole stammen aus der App selbst bzw. vom Gerät; der Browser darf laut Sicherheitsrichtlinie der App nur Inhalte vom eigenen Server laden.

## Protokolle

- **Protokoll des Plattform-Admins:** welcher Admin wann welche Aktion an welchem Verein ausgeführt hat (Verein angelegt, gesperrt, entsperrt, Adresse korrigiert, neuer Zugangslink für die Leitung, erste Einladung erneuert), beim Anlegen des Vereins, bei erneuerter erster Einladung und bei einem Zugangslink auch die interne Kennung der betroffenen Person, ohne Namen. Das Protokoll bleibt auch nach dem Löschen eines Vereins bestehen. [Aufbewahrungsdauer des Admin-Protokolls — liefert der Eigentümer; im Code ist keine Löschfrist festgelegt]
- **Betriebsprotokoll der App:** Die App schreibt keine Namen, E-Mail-Adressen oder Zugangslinks in ihr Protokoll. Beim Mailversand stehen dort nur eine interne Nummer der Mail und gegebenenfalls die Art des Fehlers, bei Programmfehlern Anfrageart, Pfad und die technische Fehlermeldung. Eine solche Meldung kann im Einzelfall Eingabewerte wiedergeben, etwa einen Namen. [Aufbewahrungsdauer des Betriebsprotokolls — liefert der Eigentümer]
- [Protokolle des Webservers bzw. Proxys und des Hosters (etwa IP-Adressen beim Seitenaufruf) und deren Aufbewahrungsdauer — liefert der Eigentümer]

## Speicherdauer und Löschung

- **Personen:** bleiben gespeichert, bis die Verwaltung sie aus der Gruppe entfernt. Beim Entfernen werden Name, Geburtsdatum, E-Mail-Adresse, Rechte und Jugendsprecher-Merkmal geleert; Zugang, Passwort, Passkeys, zweiter Faktor, Sitzungen, Einladungen, Familienzuordnungen und Untergruppen werden gelöscht. Es bleibt ein Datensatz ohne Namen und Kontaktdaten (unter anderem Art der Person sowie Zeitpunkt von Anlage und Entfernen), damit Einwilligungen und spätere Verweise als „ehemaliges Mitglied“ erhalten bleiben.
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
- Die App selbst gibt keine Daten an weitere Dienste weiter. [Übermittlung in Länder außerhalb der EU: Bestätigung für Hosting, Mailversand und Sicherung — liefert der Eigentümer]
- Innerhalb des Vereins sehen Jugendleiter und Familien Daten nur im Umfang von „Wer im Verein was sieht“.

## Ihre Rechte

[Aufzählung der Betroffenenrechte (Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch, Widerruf einer Einwilligung, Beschwerde bei einer Aufsichtsbehörde) und an wen sich Betroffene wenden — liefert der Eigentümer]

In der App gilt:

- **Auskunft:** Unter „Profil“ lädt „Meine Daten herunterladen“ eine Datei mit Ihren gespeicherten Angaben: Personendaten samt Rechten, ob ein Zugang erlaubt ist und wann die Volljährigkeit geprüft wurde; Zugang (Anmeldename, ob Passwort und zweiter Faktor gesetzt sind, Zeitpunkte); ob Wiederherstellungscodes eingerichtet sind und wie viele noch unbenutzt sind; noch gültige Einladungs- und Rücksetzlinks mit Erzeugung und Ablauf; Namen der Passkeys, Sitzungen, Familie (mit Zeitpunkt der Zuordnung), Untergruppen und Einwilligungen. Über andere Personen enthält die Datei nur Namen, Beziehung und Erziehungsberechtigung, bei Ihren Kindern zusätzlich, ob deren Zugang erlaubt ist. Nur bei minderjährigen Kindern, für die Sie erziehungsberechtigt sind, kommen hinzu, wann die Volljährigkeit geprüft wurde und welche Links für sie noch gültig sind (Art, Erzeugung, Ablauf). Passwort-Hash, die Wiederherstellungscodes selbst, Links, Geheimnisse und Schlüssel enthält sie nicht. Ebenfalls nicht enthalten sind technische Kennungen, die vollständige Browserkennung der Sitzungen, die Abschriften verschickter E-Mails in der Versandwarteschlange und Einladungen, die Sie für andere erzeugt haben, soweit sie nicht als noch gültige Links Ihrer Kinder aufgeführt sind. [Weg zur Auskunft über diese Angaben — liefert der Eigentümer] Für Kinder ohne eigenen Zugang gibt es keinen eigenen Auszug in der App. [Weg zur Auskunft für Personen ohne Zugang — liefert der Eigentümer]
- **Berichtigung:** Im Profil sind Name und Kennung nur lesbar. Namen, Geburtsdatum, E-Mail-Adresse, Untergruppen und Familienzuordnungen ändert die Verwaltung des Vereins (Recht „Mitglieder verwalten“); Angaben zu Jugendleitern ändert nur, wer „Jugendleiter & Rechte verwalten“ hat. Die E-Mail-Adresse eines Erwachsenen, der bereits einen Zugang eingerichtet hat, lässt sich in der App derzeit nicht ändern. Passwort, Passkeys und zweiten Faktor verwalten Sie selbst im Profil.
- **Erziehungsberechtigte** können unter „Meine Jungfischer“ den Zugang ihres Kindes erlauben oder entziehen, einen neuen Link erzeugen und ihre Einwilligung geben oder widerrufen. Namen und Zuordnungen ändern sie nicht; das bleibt beim Verein.
- **Löschung:** Ein Konto löscht man in der App nicht selbst; das Entfernen übernimmt die Verwaltung des Vereins (siehe „Speicherdauer und Löschung“).

## Datenschutzbeauftragter

[Datenschutzbeauftragter: Name und Kontakt, oder Hinweis, dass keiner benannt ist — liefert der Eigentümer]

## Aufsichtsbehörde

[Zuständige Aufsichtsbehörde mit Anschrift — liefert der Eigentümer]

## Kontakt

[Kontaktadresse für Fragen zum Datenschutz — liefert der Eigentümer]
