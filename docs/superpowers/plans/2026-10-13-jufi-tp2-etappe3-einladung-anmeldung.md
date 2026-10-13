# TP2 Etappe 3: Einladung und Anmeldung — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine eingeladene Person nimmt ihre Einladung an (Kennung, Passkey oder Passwort), meldet sich danach unter `/<slug>/anmelden` an (Passkey; Kennung und Passwort, mit TOTP), verwaltet ihre Anmeldewege im Profil, setzt ein verlorenes Passwort per Mail zurück, und die Mail-Warteschlange samt Arbeiter versendet die Mails — mit Backoff und Mandantentrennung durchgehend.

**Architecture:** Die Mitglieder-API unter `/:slug/api/v1` wird von einem statischen Router zu `vereinsApi(deps)` und bekommt Sitzung (`jufi_sitzung`, Pfad `/<slug>/`, 90 Tage mit Verlängerung), Einladung, Anmeldung, Zugang-verloren und Profil. Alle Vereinsdaten gehen über `vereinDb`; die Muster (Versuch reservieren, Einlösen mit bedingtem `updateMany`, Zwischenmarke, Challenges) kommen aus Etappe 2 (`server/admin/`). Der Mail-Arbeiter ist ein Plattformprozess (schlichter `PrismaClient`) im Serverprozess. Die Oberfläche ergänzt den Verein-Bereich um Anmelden, Einladung, Zugang verloren und ein schlichtes Profil.

**Tech Stack:** wie Etappe 2; neu `nodemailer` (+ `@types/nodemailer`).

**Spec:** `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md` (Etappe 3 aus 1.4; Abschnitte 4, dazu 3.4, 7.3, 8.4, 9). Vorlage für die Muster: `apps/jufi/src/server/admin/{anmeldung,passkeys,sitzung,versuche,asynchron}.ts` und `apps/jufi/src/app/admin/*` — lesen, übernehmen, anpassen; `../hwyd` nur noch für `routes/passkeys.ts`-Details.

## Entscheidungen, die die Spec nachziehen (Task 15 ändert die Spec mit)

1. **Sperrzähler statt `SELECT … FOR UPDATE`.** Einlösen, Erneuern, Notfall-Link und Slug-Korrektur entscheiden anhand von „erste Einladung angenommen?" und müssen sich gegenseitig ausschließen. `vereinDb` verbietet Rohabfragen, also steht das Sperren nicht dort. `Verein.sperrzaehler Int @default(0)`: Jede dieser Transaktionen beginnt mit `sperreVereinszeile(tx, vereinId)` (ein `update … increment`), das die Vereinszeile bis zum Ende der Transaktion sperrt. Verworfen: Roh-SQL mit einer Ausnahme in `vereinDb` (weicht die Sperre auf, die Etappe 1 gebaut hat), Isolation `Serializable` (Wiederholschleifen in jeder Route).
2. **Einwilligung (Spec 4.2 Schritt 2) bleibt Etappe 4, die Prüfung nicht.** Etappe 3 löst die Einladung eines Jungfischers nur ein, wenn eine nicht widerrufene `Einwilligung` (`DSGVO_ART8`) für ihn existiert; sonst 409 „Die Einwilligung der Familie fehlt noch". Die Oberfläche zum Erteilen entsteht mit den Familien in Etappe 4. Verworfen: Jungfischer-Einlösen ganz auf Etappe 4 verschieben — dann fehlte die Kennungsart Anmeldename in den Tests dieser Etappe.
3. **Passkey eines anderen Vereins.** Die Anmeldung schlägt den Passkey nur über `vereinDb` nach; ein Treffer in einem anderen Verein ist hier „nicht gefunden". Die Antwort ist in beiden Fällen „Dieser Passkey gehört nicht zu diesem Verein" (Spec 4.3). Verworfen: globales Nachschlagen mit dem schlichten Client, nur um zwischen „fremd" und „gelöscht" zu unterscheiden.
4. **Eigener Namensraum für Backoff-Schlüssel**, damit Admin und Mitglieder sich keine Zähler teilen: `m-ip:<ip>`, `m:<vereinId>:<kennung>`, `m-totp:<zugangId>`, `m-reset-ip:<ip>`, `m-reset:<vereinId>:<email>`, `m-passwort:<zugangId>`, `m-totp-einrichten:<zugangId>`. Die Kennung geht normalisiert (Kleinschreibung, ohne Rand) in den Schlüssel.
5. **„Passwort vergessen?" antwortet vor der Arbeit.** Die Route zählt den Versuch, antwortet sofort `{ ok: true }` und erledigt Suche, Einladung und Mail im `Nachlauf` (neues Bauteil, Task 9). Verworfen: erst arbeiten, dann antworten — die Antwortzeit verriete, ob es die Adresse gibt (Spec 3.4/4.4).
6. **Gesperrter Verein bei Erneuern und Notfall-Link: 409.** Der Link führte bis zum Entsperren ins Leere; eine Mail dorthin wäre schlimmer als ein Klick mehr. Kein Protokolleintrag, keine Einladung.
7. **Das Demo-Schutzkriterium (`demo.ts`)** wird neu gefasst: geschützt ist ein Verein `demo`, in dem eine Person eine Adresse hat, die nicht auf `@example.org` endet. Die erste Leitung eines echten Vereins hat immer eine echte Adresse; Zugänge und Sitzungen im Demo-Verein sind jetzt möglich und kein Merkmal mehr.

## Global Constraints

- Alle Constraints aus Etappe 1 und 2 gelten weiter (Sprache, Tabs, Angular-Regeln, `jetzt: Date` in Regeln, 404 statt 403 für Vereinsdaten, erfundene Daten, Testdatenbanken `jufi_test_<projekt>`, Fehler als `{ "fehler": "<Text>" }`, 100 KB JSON, `Origin`-Prüfung bei schreibenden Anfragen, Prettier vor Push, kein Push/Deploy ohne Ansage, nie `pnpm deploy`).
- Vereinsdaten nur über `vereinDb`; der schlichte `PrismaClient` nur für Plattformarbeit (Mail-Arbeiter, Wartung, Admin, CLI).
- Mitglieder-Cookie `jufi_sitzung` (`MITGLIEDER_COOKIE`), `Path=/<slug>/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=7776000` (90 Tage), `Secure` genau dann, wenn `req.secure`. Sitzung 90 Tage ab letzter Verlängerung; verlängert wird höchstens einmal je 24 Stunden (Schreiben in `Session` bei jeder Anfrage vermeiden). Nur der SHA-256-Hash des Tokens liegt in `Session.tokenHash`.
- Eine Sitzung gilt nur im Verein, in dem sie angelegt wurde. Ohne gültige Sitzung antworten geschützte Routen **401** `{ fehler: 'nicht angemeldet' }`.
- Einladungs- und Reset-Link: `<BASIS_URL>/<slug>/einladung#<token>`; Einladung **14 Tage**, Reset **1 Stunde**; Tokens aus `generateLinkToken()`, gespeichert nur `hashToken(token)`. Eingelöst wird erst beim Absenden, nicht beim Öffnen.
- Ungültiger, abgelaufener, benutzter oder fremder Link: **404** `{ fehler: 'Dieser Link gilt nicht mehr' }`.
- Passwortregel: mindestens **10 Zeichen**, Sperrliste (`pruefePasswort`). Passkey-Name `Sandra Huber · Jungfischer Glonntal`, `residentKey: 'required'`, `userVerification: 'required'`.
- Anmeldefehler immer `{ fehler: 'Anmeldung fehlgeschlagen' }` mit 401 (Ausnahme Passkey eines anderen Vereins, Entscheidung 3). Backoff wie hwyd (drei freie Versuche, dann verdoppelnd bis 15 Minuten), Antwort **429** `{ fehler: 'Zu viele Versuche', wartenSekunden }`. Der Versuch wird vor dem ersten `await` der Route reserviert (`reserviere`/`scheitere`).
- Einlösen, Anmelden mit Passkey, TOTP und alles, was ein Argon2-Passwort prüft, hält keine Datenbanktransaktion über Argon2 offen: erst hashen, dann Transaktion.
- Wer sich einer Person mit bestehendem Zugang über Reset-Link oder neue Einladung einlöst, verliert Passwort, alle Passkeys, TOTP, Wiederherstellungscodes und alle Sitzungen; Kennung und Zugang bleiben.
- Mail: Absender `app@jufi-app.de`, Antwortadresse `kontakt@jufi-app.de`, Betreff-Präfix `[Test] ` aus der Umgebung (beim Senden angewendet, nicht beim Einreihen). Logs enthalten **nie** Tokens, Adressen oder Namen. Lokal fängt Mailpit (1025/8025) alles ab.
- Mandanten-Test: Jede Route von `vereinsApi` hat einen Fall in `mandanten.spec.ts` (Spec 9).
- Messen im Browser mit erfundenen Daten bei 375 × 812, hell und dunkel.
- **Nicht in Etappe 3** (bewusst): Einwilligungs-Oberfläche und Familien (Etappe 4), Hüllen und PWA (Etappe 5), Deploy und echter Mail-Versand (Etappe 6), Re-Authentifizierung für neue Faktoren des Admins und TOTP-Replay-Schutz (vor einem zweiten Admin), TOTP deaktivieren.

## Review Focus

1. **Doppelklick auf „Zugang einrichten"** (zwei gleichzeitige Einlösungen mit demselben Token): genau eine gelingt und legt einen Zugang und eine Sitzung an, die andere bekommt 404. Test in Task 6.
2. **E-Mail beim Einlösen schon im Verein vergeben** (auch mit Großbuchstaben und Leerzeichen): 409, kein Zugang, die Einladung bleibt einlösbar. Test in Task 6.
3. **Kind tippt ` Lena` als Anmeldenamen**: Anmeldung klappt (Kleinschreibung, ohne Rand); der Vorschlag für ein zweites „Lena" ist `lena2`. Tests in Task 1 und Task 7.
4. **„Passwort vergessen?" für unbekannte Adresse, Jungfischer, Person ohne Zugang und bekannte Adresse**: identische Antwort, nur im letzten Fall entsteht eine Mail; der Backoff zählt unabhängig davon, ob es die Adresse gibt. Test in Task 9.
5. **Sitzungs-Cookie eines Vereins bei einem anderen Verein und bei gesperrtem Verein**: 401 bzw. 404; nach dem Entsperren gilt die Sitzung wieder. Test in Task 4.

---

## Dateistruktur

```
prisma/migrations/<ts>_sperrzaehler_letzte_anmeldung/   Verein.sperrzaehler, Zugang.letzteAnmeldungAm
libs/domain/src/kennung.ts              + pruefeAnmeldename, anmeldenameVorschlag, pruefeKennung
libs/db/src/lib/sperre.ts               sperreVereinszeile
libs/auth/src/lib/rate-limit.ts         Verfall und Obergrenze des AttemptTracker
libs/auth/src/lib/cookies.ts            + MITGLIEDER_SITZUNG_SEKUNDEN, mitgliederCookiePfad
apps/jufi/src/server/verein.ts          vereinsApi(deps) statt statischem Router
apps/jufi/src/server/mitglieder/sitzung.ts       Sitzung, Cookie, mitgliedAusSitzung, brauchtMitglied
apps/jufi/src/server/mitglieder/challenges.ts    speichereChallenge, nimmChallenge (je Verein)
apps/jufi/src/server/mitglieder/einladung.ts     Routen: pruefen, passkey-optionen, einloesen
apps/jufi/src/server/mitglieder/anmeldung.ts     Routen: anmelden, totp, passkey
apps/jufi/src/server/mitglieder/zugang-verloren.ts   Route + Nachlauf
apps/jufi/src/server/mitglieder/profil.ts        Routen: ich, abmelden, Passwort, Passkeys, TOTP
apps/jufi/src/server/mitglieder/test-mitglieder.ts   legeMitgliedAn, Anmeldehilfen
apps/jufi/src/server/nachlauf.ts        Nachlauf
apps/jufi/src/server/mail/{warteschlange,versand,arbeiter,texte}.ts
apps/jufi/src/app/gemeinsam/            ApiFehler, PasskeyBrowser, Formularhilfen, TotpEinrichtung (aus admin/)
apps/jufi/src/app/verein/…              MitgliederApi, Wächter, Anmelden, Einladung, Zugang verloren, Profil
```

---

### Task 1: Schema und Regeln — Sperrzähler, letzte Anmeldung, Anmeldename, Kennung

**Files:**

- Modify: `prisma/schema.prisma`, `libs/domain/src/kennung.ts`, `libs/domain/src/index.ts`
- Create: `prisma/migrations/<zeitstempel>_sperrzaehler_letzte_anmeldung/migration.sql` (über `pnpm prisma migrate dev --name sperrzaehler_letzte_anmeldung --create-only`), `libs/db/src/lib/sperre.ts`
- Test: `libs/domain/src/kennung.spec.ts`, `libs/db/src/sperre.spec.ts`

**Interfaces:**

- Produces: `Verein.sperrzaehler Int @default(0)`, `Zugang.letzteAnmeldungAm DateTime?`.
- Produces (`@jufi/db`): `sperreVereinszeile(tx: <Transaktions-Client, schlicht oder aus vereinDb>, vereinId: string): Promise<void>` — `verein.update({ where: { id }, data: { sperrzaehler: { increment: 1 } } })`; funktioniert mit dem Client aus `prisma.$transaction` und mit dem aus `vereinDb(...).$transaction`.
- Produces (`@jufi/domain`): `pruefeAnmeldename(s: string): boolean` (auf dem normalisierten Wert; dasselbe Muster wie `pruefeBenutzername`, dazu kein `@`); `anmeldenameVorschlag(vorname: string, vergeben: ReadonlySet<string>): string`; `pruefeKennung(art: 'ERWACHSENER' | 'JUNGFISCHER', roh: string): { ok: true; wert: string } | { ok: false; grund: 'ungueltig' }` — Erwachsene: `normalisiereEmail` + `pruefeEmail`, Jungfischer: `normalisiereBenutzername` + `pruefeAnmeldename`.

`anmeldenameVorschlag`: Vorname klein, Umlaute und ß umschreiben (`ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`), sonstige Akzente entfernen (NFD), alles außer `[a-z0-9]` streichen; ergibt das weniger als 3 Zeichen, mit `1` auffüllen bis 3; ist der Name vergeben, `name2`, `name3`, … bis ein freier gefunden ist.

- [ ] **Step 1: Tests schreiben**

`kennung.spec.ts` (neue Fälle):

- `Vorschlag nimmt den Vornamen` → `anmeldenameVorschlag('Lena', new Set())` ist `'lena'`.
- `Vorschlag zählt hoch, wenn vergeben` → mit `new Set(['lena'])` ist er `'lena2'`, mit `['lena','lena2']` `'lena3'`.
- `Vorschlag schreibt Umlaute um` → `'Jörg'` → `'joerg'`, `'Zoë'` → `'zoe'`.
- `Vorschlag füllt zu kurze Namen auf` → `'Jo'` → `'jo1'`.
- `Anmeldename: Groß, Rand, @ und Kürze` → `pruefeAnmeldename('Lena')` false, `pruefeAnmeldename('le')` false, `pruefeAnmeldename('a@b.de')` false, `pruefeAnmeldename('lena.k-2')` true.
- `Kennung Erwachsener ist die normalisierte E-Mail` → `pruefeKennung('ERWACHSENER', '  Thomas@Example.ORG ')` ist `{ ok: true, wert: 'thomas@example.org' }`; `'thomas'` ist `{ ok: false, grund: 'ungueltig' }`.
- `Kennung Jungfischer ist der normalisierte Anmeldename` → `pruefeKennung('JUNGFISCHER', '  Lena ')` ist `{ ok: true, wert: 'lena' }`; `'lena@x.de'` ist ungültig.

`sperre.spec.ts` (gegen Postgres, eigene Slugs): `Zweite Transaktion wartet auf die erste` — Transaktion A ruft `sperreVereinszeile`, Transaktion B startet danach dasselbe; B ist nach 200 ms noch nicht fertig (`Promise.race` gegen Timer), nach dem Commit von A fertig; `sperrzaehler` steht auf 2.

- [ ] **Step 2: Rot sehen**

Run: `pnpm run db:up && pnpm nx run-many -t test -p domain db --skip-nx-cache`
Expected: FAIL (Funktionen fehlen, Spalte `sperrzaehler` unbekannt).

- [ ] **Step 3: Implementieren**

Schema und Migration (Kommentar im Schema begründet den Zähler, Entscheidung 1; `pnpm run db:generate`), `sperre.ts`, `kennung.ts`-Ergänzungen, Exporte.

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma libs
git commit -m "Sperrzaehler und letzte Anmeldung im Schema, Anmeldename und Kennung in libs/domain"
```

---

### Task 2: Nachzüge Admin I — Sperre, gesperrter Verein, Notfall-Text, letzte Anmeldung

**Files:**

- Modify: `apps/jufi/src/server/admin/daten.ts`, `apps/jufi/src/server/admin/vereine.ts`, `apps/jufi/src/server/einladung.ts`, `apps/jufi/src/app/admin/einladung-anzeige.ts` (nur falls der Text dort zusammengesetzt wird)
- Test: `apps/jufi/src/server/admin/vereinsaktionen.spec.ts`, `apps/jufi/src/server/admin/vereine.spec.ts`, `apps/jufi/src/server/einladung.spec.ts`

**Interfaces:**

- Consumes: `sperreVereinszeile` (Task 1).
- Produces: `notfallLinkText(t: { vorname: string; anzeigename: string; link: string }): string`; die Admin-Antwort der Notfall-Route trägt diesen Text, die der Erneuern-Route weiter `leitungsEinladungsText`.
- Produces: `erneuereErsteEinladung`, `notfallLink`, `korrigiereSlug` in `adminDaten` beginnen ihre Transaktion mit `sperreVereinszeile(tx, id)` und lesen den Verein danach; `erneuereErsteEinladung` und `notfallLink` geben für einen gesperrten Verein `'gesperrt'` zurück, die Routen antworten 409 `{ fehler: 'Der Verein ist gesperrt – erst entsperren' }`.
- Produces: Kennzahl „letzte Anmeldung" in `kennzahlen` = höchstes `Zugang.letzteAnmeldungAm` des Vereins statt Ableitung aus `Session`.

`notfallLinkText` sagt in einem Satz, **warum** der Link kommt und was das Einlösen bewirkt („Altes Passwort, Passkeys und alle angemeldeten Geräte werden dabei gelöscht"), weil derselbe Link bei vorhandenem Zugang diese Löschung auslöst (Spec 4.4). Der Text nennt die 14 Tage wortgleich wie `leitungsEinladungsText`.

- [ ] **Step 1: Tests schreiben**

- `Slug-Korrektur wartet auf eine laufende Einlösung` (`vereinsaktionen.spec.ts`): Transaktion A sperrt die Vereinszeile und setzt `eingeloestAm` der Einladung, ohne zu committen; `korrigiereSlug` ist nach 200 ms nicht fertig; nach dem Commit liefert sie `'fest'`.
- `Erneuern wartet auf eine laufende Einlösung` — gleiche Anordnung, Ergebnis `'angenommen'`, keine neue Einladung, kein Protokolleintrag.
- `Notfall-Link bei gesperrtem Verein` → POST `…/notfall-link` für eine Leitung eines gesperrten Vereins: 409 mit obigem Text, `Einladung`- und `AdminProtokoll`-Zeilen unverändert; ebenso `…/einladung-erneuern`.
- `Notfall-Link trägt den eigenen Text` → Antwort enthält „angemeldeten Geräte" und den Link; `einladung-erneuern` enthält es nicht.
- `Kennzahl letzte Anmeldung kommt vom Zugang` (`vereine.spec.ts`): `Zugang.letzteAnmeldungAm = 2026-10-01T10:00:00Z` setzen → Vereinsliste meldet `2026-10-01`; Sitzungen allein ändern sie nicht.
- `notfallLinkText` in `einladung.spec.ts`: enthält Vorname, Anzeigename, Link, „14 Tage".

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache`
Expected: FAIL (Funktion fehlt, Rennen nicht gesperrt, 200 statt 409).

- [ ] **Step 3: Implementieren** (Signaturen oben; die Routen unterscheiden `'gesperrt'` von `null` und `'angenommen'`)

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Admin: Vereinszeile sperren, gesperrter Verein 409, eigener Notfall-Link-Text, letzte Anmeldung am Zugang"
```

---

### Task 3: Nachzüge Admin II — Challenges getrennt, Backoff verfällt

**Files:**

- Modify: `apps/jufi/src/server/admin/passkeys.ts`, `libs/auth/src/lib/rate-limit.ts`
- Test: `apps/jufi/src/server/admin/passkeys.spec.ts`, `libs/auth/src/lib/rate-limit.spec.ts`

**Interfaces:**

- Produces: `speichereAdminChallenge` und `nimmAdminChallenge` räumen und nehmen **nur** Zeilen mit `adminId` ungleich `null`; Vereins-Challenges (`vereinId` gesetzt) bleiben unberührt, auch abgelaufene.
- Produces: `AttemptTracker` vergisst einen Schlüssel, dessen letzter Fehlversuch länger als `MAX_DELAY_MS` zurückliegt (der nächste Fehlversuch zählt dann wieder als erster), und hält höchstens `MAX_SCHLUESSEL = 10_000` Einträge (beim Überschreiten fliegt der älteste, Einfügereihenfolge der `Map`).

Begründung für den Kommentar: Anmeldenamen von Kindern sind erratbar; ohne Verfall sperrte ein Fehlversuch von letzter Woche die Kennung dauerhaft lang, und ein Angreifer könnte den Speicher mit erfundenen Kennungen füllen.

- [ ] **Step 1: Tests schreiben**

- `Admin-Code lässt Vereins-Challenges stehen` (`passkeys.spec.ts`): zwei Zeilen `WebauthnChallenge` mit `vereinId` (eine abgelaufen, eine gültig, jeweils `purpose: 'register'`) und eine Admin-Challenge; `nimmAdminChallenge` auf die Admin-Challenge liefert sie, beide Vereinszeilen existieren danach noch; `nimmAdminChallenge` mit dem Challenge-Wert einer Vereinszeile liefert `undefined`, und die Zeile bleibt.
- `Fehlversuche verfallen nach Ruhe` (`rate-limit.spec.ts`, mit fester Uhr): vier Fehlversuche (gesperrt), 16 Minuten später → `remaining` 0 und der nächste `fail` ergibt `failures: 1`.
- `Der Speicher ist begrenzt` → 10 001 verschiedene Schlüssel einmal `fail`: der erste ist vergessen (`remaining` 0 und kein Eintrag), der letzte bleibt.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run-many -t test test-server -p auth jufi --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src libs/auth
git commit -m "Admin-Challenges raeumen nur eigene Zeilen, Backoff verfaellt und ist begrenzt"
```

---

### Task 4: Mitglieder-Sitzung und Umbau von `vereinsApi`

**Files:**

- Modify: `apps/jufi/src/server/verein.ts`, `apps/jufi/src/server/app.ts`, `libs/auth/src/lib/cookies.ts`, `apps/jufi/src/server/mandanten.spec.ts`
- Create: `apps/jufi/src/server/mitglieder/sitzung.ts`, `apps/jufi/src/server/mitglieder/profil.ts` (zunächst nur `ich`, `abmelden`, `abmelden/alle`), `apps/jufi/src/server/mitglieder/test-mitglieder.ts`
- Test: `libs/auth/src/lib/cookies.spec.ts`, `apps/jufi/src/server/mitglieder/sitzung.spec.ts`

**Interfaces:**

- Produces (`@jufi/auth`): `MITGLIEDER_SITZUNG_SEKUNDEN = 90 * 24 * 60 * 60`; `mitgliederCookiePfad(slug: string): string` = `/${slug}/`.
- Produces (`verein.ts`): `vereinsApi(deps: VolleAppDeps): Router` (caseSensitive) hängt `GET /verein` und die Routen der folgenden Tasks direkt an diesen einen Router; `vereinsRouten(router: Router)` liest dessen Liste; `app.ts` mountet `vereinsApi(deps)` einmal. `mandanten.spec.ts` baut den Router für die Routenliste mit denselben Abhängigkeiten.
- Produces (`mitglieder/sitzung.ts`): `legeSitzungAn(db: <vereinDb oder Transaktions-Client daraus>, e: { zugangId: string; jetzt: Date; userAgent?: string }): Promise<string>` (Token; schreibt auch `Zugang.letzteAnmeldungAm`); `mitgliedAusSitzung(deps): RequestHandler` (nach `vereinAusSlug`; liest `jufi_sitzung`, sucht über `res.locals.db` nach `tokenHash`, verwirft und löscht abgelaufene Sitzungen, verlängert nach Regel der Global Constraints samt neuem Cookie, legt `{ person, zugang, sitzungId }` ab; eine entfernte Person (`entferntAm`) oder `zugangErlaubt=false` bei einem Jungfischer zählt als nicht angemeldet); `brauchtMitglied: RequestHandler` (401); `mitgliedKontext(res)`; `setzeMitgliederCookie(req, res, slug, token)`, `loescheMitgliederCookie(req, res, slug)`.
- Produces (`test-mitglieder.ts`): `legeMitgliedAn(prisma, verein: { id: string; slug: string }, e: { art: 'ERWACHSENER' | 'JUNGFISCHER'; vorname?: string; nachname?: string; email?: string; anmeldename?: string; passwort?: string; rechte?: Recht[] }): Promise<{ personId: string; zugangId: string; cookie: string }>` — legt Person, Zugang (Passwort gehasht, falls gegeben) und Sitzung direkt in der Datenbank an; `cookie` ist der fertige Header-Wert `jufi_sitzung=<token>`.
- Produces (`profil.ts`): `GET /ich` → 200 `{ person: { id, vorname, nachname, art, rechte }, kennung }` (Task 10 erweitert um die Anmeldewege); `POST /abmelden` löscht die Sitzung und das Cookie; `POST /abmelden/alle` löscht alle Sitzungen des Zugangs.

- [ ] **Step 1: Tests schreiben**

`cookies.spec.ts`: `mitgliederCookiePfad('glonntal')` ist `/glonntal/`; ein mit diesem Pfad und `MITGLIEDER_SITZUNG_SEKUNDEN` serialisiertes Cookie enthält `Path=/glonntal/`, `Max-Age=7776000`, `HttpOnly`, `SameSite=Lax`.

`sitzung.spec.ts` (Postgres, eigene Slugs):

- `GET /ich ohne Cookie` → 401 `{ fehler: 'nicht angemeldet' }`.
- `GET /ich mit Sitzung` → 200 mit Name und `kennung` (die E-Mail).
- `Sitzung gilt nur im eigenen Verein` — Cookie aus Verein A bei Verein B → 401 (Review Focus 5).
- `Gesperrter Verein: 404, nach Entsperren wieder gültig` — Verein sperren → `GET /ich` 404; entsperren → 200 mit derselben Sitzung.
- `Abgelaufene Sitzung` (feste Uhr) → 401, Zeile gelöscht.
- `Verlängerung höchstens einmal am Tag` — nach 2 h unverändert (`ablauf` und `Set-Cookie` fehlen), nach 25 h `ablauf` = jetzt + 90 Tage und ein `Set-Cookie` mit `Path=/<slug>/`.
- `Abmelden` → Cookie gelöscht (`Max-Age=0`), Sitzung weg, zweites `GET /ich` 401; `Überall abmelden` löscht auch die Sitzung eines zweiten Geräts desselben Zugangs, nicht die einer anderen Person.
- `Entfernte Person` (`entferntAm` gesetzt) → 401.
- `Admin-Cookie wird nicht gelesen` — gültiges Admin-Token in `jufi_sitzung` → 401.

`mandanten.spec.ts`: Fälle für `GET /ich`, `POST /abmelden`, `POST /abmelden/alle` — gegen den gesperrten Nachbarverein 404, und `GET /ich` mit Cookie aus `eigen` bei `fremd` 401.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run-many -t test test-server -p auth jufi --skip-nx-cache`
Expected: FAIL (Router statisch, Funktionen fehlen).

- [ ] **Step 3: Implementieren**

`Secure` nach `req.secure`, `append` statt `setHeader` wie bei `setzeAdminCookie`. `vereinsApi` wird zur Funktion; der Kommentar zum Mandanten-Test bleibt (jede Route direkt am Router, kein Unter-Router).

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src libs/auth
git commit -m "Mitglieder-Sitzung mit Cookie je Verein, vereinsApi als Funktion, Abmelden"
```

---

### Task 5: Einladung prüfen und Passkey-Optionen

**Files:**

- Create: `apps/jufi/src/server/mitglieder/challenges.ts`, `apps/jufi/src/server/mitglieder/einladung.ts`
- Modify: `apps/jufi/src/server/verein.ts` (Routen einhängen), `apps/jufi/src/server/mandanten.spec.ts`
- Test: `apps/jufi/src/server/mitglieder/einladung.spec.ts`

**Interfaces:**

- Consumes: `vereinsKontext(res)`, `anmeldenameVorschlag`, `pruefeKennung` (Task 1), `registrationOptions`, `passkeyLabel`, `WEBAUTHN_CHALLENGE_TTL_MS` (`@jufi/auth`), `asynchron`, `text` (`admin/asynchron.ts`).
- Produces (`challenges.ts`): `speichereChallenge(db, e: { challenge: string; purpose: ChallengePurpose; personId?: string; jetzt: Date }): Promise<void>` (räumt vorher abgelaufene Zeilen dieses Vereins über `db`); `nimmChallenge(db, e: { challenge: string; purpose: ChallengePurpose; personId?: string; jetzt: Date }): Promise<boolean>` — löscht genau die Zeile mit diesem Wert, Zweck und Verein **zuerst** (`deleteMany`, Anzahl 1 entscheidet) und prüft danach Ablauf und, wenn angegeben, `personId`; eine Challenge eines anderen Vereins oder ohne `vereinId` ist unsichtbar. Beide gehen nur über `vereinDb`.
- Produces: `POST /einladung/pruefen` `{ token }` → 200 `{ vorname, art: 'EINLADUNG' | 'RESET', vereinsname: string, personArt: 'ERWACHSENER' | 'JUNGFISCHER', kennung: { fest: boolean; wert: string | null }, hatZugang: boolean, einwilligungFehlt: boolean }` — `kennung.wert` ist bei Erwachsenen die hinterlegte E-Mail (oder `null`), bei Jungfischern der Vorschlag aus `anmeldenameVorschlag` (gegen die Anmeldenamen des Vereins); `kennung.fest` ist `true`, wenn die Person schon einen Zugang hat (Reset oder neue Einladung: die Kennung bleibt). Verbraucht nichts, kein Backoff (das Token hat 256 Bit).
- Produces: `POST /einladung/passkey-optionen` `{ token }` → 200 `{ optionen }` (`registrationOptions` mit Passkey-Name `<Vorname> <Nachname> · <Anzeigename des Vereins>`, `residentKey`/`userVerification` `required`) und speichert die Challenge (`purpose: 'register'`, `personId`). Ungültiger Link → 404.

Beide Routen: Person entfernt (`entferntAm`) oder Jungfischer mit `zugangErlaubt=false` → 404 wie ein ungültiger Link.

- [ ] **Step 1: Tests schreiben**

- `pruefen: gültige Einladung eines Erwachsenen` → `{ vorname, art: 'EINLADUNG', personArt: 'ERWACHSENER', kennung: { fest: false, wert: 'thomas@example.org' }, hatZugang: false, einwilligungFehlt: false }`.
- `pruefen: Jungfischer bekommt Namensvorschlag` → `kennung.wert` ist `'lena'`; gibt es im Verein schon einen Zugang `lena`, ist er `'lena2'`; ohne `Einwilligung` ist `einwilligungFehlt` `true`.
- `pruefen: bestehender Zugang (Reset)` → `art: 'RESET'`, `kennung.fest` `true`, `hatZugang` `true`.
- `pruefen: ungültige Links` — unbekannt, abgelaufen (feste Uhr), eingelöst, Token eines anderen Vereins (an den Slug von `fremd` geschickt), entfernte Person: alle 404 `{ fehler: 'Dieser Link gilt nicht mehr' }`, und `pruefen` ändert nichts (`eingeloestAm` bleibt `null`).
- `pruefen: ohne Token im Body` → 404 (kein 500).
- `passkey-optionen` → 200, `optionen.user.name` ist `'Sandra Huber · Jungfischer Test'`, `authenticatorSelection.residentKey` `'required'`, `userVerification` `'required'`; es gibt genau eine `WebauthnChallenge` mit `vereinId`, `personId`, `purpose: 'register'`.
- `Challenge-Hilfen`: `nimmChallenge` liefert beim zweiten Mal `false`; abgelaufen `false` (Zeile trotzdem weg); `purpose` falsch `false`; die Challenge eines anderen Vereins ist für diesen unsichtbar (`false`, Zeile bleibt).

`mandanten.spec.ts`: Fälle für beide Routen — Token aus `eigen` an `fremd` und an `gesperrt` geschickt: 404, und `eigen`-Einladung bleibt unberührt.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache`
Expected: FAIL (Routen fehlen).

- [ ] **Step 3: Implementieren**

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Einladung pruefen und Passkey-Optionen, Challenges je Verein"
```

---

### Task 6: Einladung einlösen

**Files:**

- Modify: `apps/jufi/src/server/mitglieder/einladung.ts`, `apps/jufi/src/server/mandanten.spec.ts`
- Test: `apps/jufi/src/server/mitglieder/einloesen.spec.ts`

**Interfaces:**

- Consumes: `sperreVereinszeile`, `pruefeKennung`, `pruefePasswort`, `PASSWORT_HINWEIS`, `hashPassword`, `verifyRegistration` (über `deps.webauthn`), `challengeAusAntwort`, `nimmChallenge`, `legeSitzungAn`, `setzeMitgliederCookie`, `reserviere` nicht (siehe unten).
- Produces: `POST /einladung/einloesen` `{ token, kennung?: string, passwort?: string, passkey?: RegistrationResponseJSON }` → 200 `{ vorname }` mit Sitzungs-Cookie. Mindestens Passwort oder Passkey; beides zugleich ist erlaubt.

Ablauf (die Reihenfolge ist Teil des Vertrags):

1. Billige Vorprüfung ohne Schreiben: Link offen und gültig, sonst 404. Form von Passwort (400 mit `PASSWORT_HINWEIS`) und Kennung (400 `{ fehler, feld: 'kennung' }`) prüfen; weder Passwort noch Passkey → 400.
2. Passkey: `challengeAusAntwort` → `nimmChallenge(purpose 'register', personId)` → `verifyRegistration`; schlägt eines fehl, 400 `{ fehler: 'Der Passkey konnte nicht eingerichtet werden' }`, die Einladung bleibt einlösbar. Argon2 des Passworts ebenfalls **vor** der Transaktion.
3. Transaktion über `vereinDb`: `sperreVereinszeile`; Verein erneut lesen (Slug unverändert, `status` AKTIV, sonst 404); bedingtes `updateMany` auf die Einladung (`tokenHash`, `eingeloestAm: null`, `ablauf > jetzt`), Anzahl ungleich 1 → 404; Person laden; Jungfischer ohne gültige Einwilligung → 409 `{ fehler: 'Die Einwilligung der Familie fehlt noch' }`; **hat die Person schon einen Zugang**, werden dessen Passwort, TOTP (`totpGeheimnis`, `totpAktivAm`), alle `Passkey`, `RecoveryCode` und `Session` gelöscht und die Kennung nicht geändert (ein mitgeschicktes `kennung` wird ignoriert); sonst entsteht der `Zugang` mit der Kennung (Erwachsene: `Person.email` setzen; Jungfischer: `Zugang.anmeldename`); Passwort-Hash und Passkey (`label` aus `passkeyLabel(User-Agent)`) anlegen; Sitzung anlegen.
4. Eindeutigkeitsverletzung (E-Mail oder Anmeldename im Verein vergeben, Prisma `P2002`) → die Transaktion rollt zurück (die Einladung bleibt einlösbar), Antwort 409 `{ fehler: 'Diese Adresse ist hier schon vergeben', feld: 'kennung' }` bzw. `'Dieser Anmeldename ist schon vergeben'`.

Kein Backoff: Das Token hat 256 Bit; die billige Vorprüfung schützt vor Argon2-Last auf erfundenen Tokens (wie bei der Admin-Einrichtung). Ein Kommentar sagt das.

- [ ] **Step 1: Tests schreiben**

`einloesen.spec.ts` (Postgres, `deps.webauthn` durch einen Prüfer ersetzt, der eine feste Registrierung liefert; Hilfsfunktion legt Einladung + Challenge an):

- `Erwachsener löst mit Passwort ein` → 200, Cookie `jufi_sitzung` mit `Path=/<slug>/`; Zugang mit `passwortHash`, `Person.email` normalisiert; Einladung `eingeloestAm` gesetzt; `GET /ich` mit dem Cookie 200.
- `Erwachsener löst mit Passkey ein` → Passkey-Zeile mit `vereinId`, `zugangId`, `label`; Challenge verbraucht.
- `Jungfischer löst ein` mit Einwilligung → Zugang mit `anmeldename: 'lena'` aus `'  Lena '`; ohne Einwilligung 409, kein Zugang, Einladung offen.
- `Doppelklick` (Review Focus 1): zwei `einloesen` gleichzeitig (`Promise.all`) mit demselben Token → genau ein 200 und ein 404; ein Zugang, eine Sitzung.
- `E-Mail vergeben` (Review Focus 2): zweite Person im Verein hat `thomas@example.org`; Einlösen mit `'  Thomas@Example.ORG '` → 409, **kein** Zugang, `eingeloestAm` bleibt `null`; danach Einlösen mit freier Adresse klappt. Dieselbe Adresse in einem anderen Verein geht.
- `Anmeldename vergeben` → 409 mit `feld: 'kennung'`, Einladung offen.
- `Kennung ungültig` (`'kein-at'` bei Erwachsenen) → 400 mit `feld: 'kennung'`.
- `Passwort zu kurz / häufig` → 400 mit `PASSWORT_HINWEIS`; weder Passwort noch Passkey → 400.
- `Passkey-Fehler` (Prüfer wirft; Challenge fremd; Challenge abgelaufen) → 400, Einladung offen, kein Zugang.
- `Reset löscht alles` (Spec 4.4): Person mit Zugang, Passwort, zwei Passkeys, TOTP samt Wiederherstellungscodes und zwei Sitzungen; Reset-Einladung einlösen mit neuem Passwort → Passkeys, Recovery-Codes, Sitzungen (außer der neuen) weg, `totpGeheimnis` und `totpAktivAm` `null`, `passwortHash` neu, `email` unverändert; die alte Sitzung → 401.
- `Neue Einladung bei bestehendem Zugang` verhält sich wie Reset.
- `Fremdes Token` — Token aus `eigen` bei `fremd` eingelöst: 404, `eigen`-Einladung offen.
- `Gesperrter Verein` → 404. `Slug nach Korrektur`: Token mit dem alten Slug eingelöst → 404.
- `Doppelter Passkey` (dieselbe `credentialId` existiert) → 409, nichts angelegt.

`mandanten.spec.ts`: Fall für `POST /einladung/einloesen` gegen `gesperrt` und `fremd` (404).

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Einladung einloesen: Zugang, Passkey oder Passwort, Reset loescht alte Wege"
```

---

### Task 7: Anmelden — Passwort, TOTP, Passkey

**Files:**

- Create: `apps/jufi/src/server/mitglieder/anmeldung.ts`
- Modify: `apps/jufi/src/server/verein.ts`, `apps/jufi/src/server/mandanten.spec.ts`
- Test: `apps/jufi/src/server/mitglieder/anmeldung.spec.ts`

**Interfaces:**

- Consumes: Muster aus `admin/anmeldung.ts` und `admin/passkeys.ts`; `reserviere`, `scheitere`, `zuVieleVersuche` (`admin/versuche.ts`); `signiereZwischenmarke`/`pruefeZwischenmarke`; `authenticationOptions`, `verifyAuthentication`; `speichereChallenge`/`nimmChallenge`; `legeSitzungAn`.
- Produces: `POST /anmelden` `{ kennung, passwort }` → 200 `{ schritt: 'fertig' }` mit Cookie, oder `{ schritt: 'totp', zwischenmarke }`. Kennung mit `@` → `Person.email`, sonst `Zugang.anmeldename`, beides normalisiert. Backoff-Schlüssel `m-ip:<ip>` und `m:<vereinId>:<kennung>`.
- Produces: `POST /anmelden/totp` `{ zwischenmarke, code?, wiederherstellungscode? }` → 200 `{ schritt: 'fertig', wiederherstellungscodesUebrig }`; Schlüssel `m-totp:<zugangId>`. Wiederherstellungscode wird mit bedingtem `updateMany` in der Transaktion der Sitzung verbraucht.
- Produces: `POST /anmelden/passkey-optionen` → 200 `{ optionen }` (ohne `allowCredentials`, Challenge mit `vereinId`, `purpose: 'authenticate'`); `POST /anmelden/passkey` `{ antwort }` → 200 `{ schritt: 'fertig' }`; Schlüssel `m-ip:<ip>`. Passkey nicht in diesem Verein → 401 `{ fehler: 'Dieser Passkey gehört nicht zu diesem Verein' }` (Entscheidung 3); jeder andere Fehler 401 „Anmeldung fehlgeschlagen". Zähler und `lastUsedAt` des Passkeys werden fortgeschrieben (Zähler 0 bei synchronisierten Schlüsseln ist kein Klon, siehe Kommentar am Schema).
- Jede erfolgreiche Anmeldung setzt `Zugang.letzteAnmeldungAm` (über `legeSitzungAn`) und löscht die Backoff-Zähler ihrer Schlüssel.
- Ein Zugang ohne Passwort, eine entfernte Person und ein Jungfischer mit `zugangErlaubt=false` scheitern wie ein falsches Passwort; der Platzhalter-Hash gleicht die Antwortzeit aus (wie `PLATZHALTER_HASH` im Admin; ein gemeinsamer Export statt Kopie, wenn die Datei es hergibt).

- [ ] **Step 1: Tests schreiben**

`anmeldung.spec.ts` (Postgres; `legeMitgliedAn` aus Task 4; fester `AttemptTracker` je Test):

- `Erwachsener meldet sich mit E-Mail und Passwort an` → 200 `fertig`, Cookie; `letzteAnmeldungAm` gesetzt.
- `Kind tippt Großschreibung und Rand` (Review Focus 3): Anmeldename `lena`, Eingabe `'  Lena '` → 200.
- `Falsches Passwort, unbekannte Kennung, Zugang ohne Passwort, entfernte Person, Jungfischer ohne Zugangserlaubnis` → alle 401 mit identischem Body `{ fehler: 'Anmeldung fehlgeschlagen' }`.
- `Backoff`: vier Fehlversuche gleicher Kennung → der vierte ist 429 mit `wartenSekunden`; ein fünfter Versuch mit **richtigem** Passwort ebenfalls 429; eine andere Kennung von derselben IP ist nach der IP-Sperre auch 429; eine andere Kennung von einer anderen IP geht. Erfolg setzt zurück. Zwei Vereine mit gleicher Kennung teilen den Zähler nicht.
- `TOTP`: Zugang mit TOTP → `{ schritt: 'totp', zwischenmarke }`, kein Cookie; richtiger Code → 200 und Cookie; falscher Code → 401; Wiederherstellungscode funktioniert genau einmal (zweimal gleichzeitig: ein 200, ein 401); abgelaufene oder verfälschte Zwischenmarke → 401; die Marke aus Verein A bei Verein B → 401.
- `Passkey-Anmeldung`: Optionen ohne `allowCredentials`; Antwort mit gestelltem Prüfer → 200, Cookie, `lastUsedAt` gesetzt; Challenge verbraucht (zweite Antwort 401); Challenge aus Verein A bei Verein B → 401.
- `Passkey eines anderen Vereins` → 401 mit dem Text „Dieser Passkey gehört nicht zu diesem Verein".
- `Gesperrter Verein` → 404 auf allen vier Routen.

`mandanten.spec.ts`: je ein Fall pro neue Route (404 bei gesperrtem Verein; `/anmelden/totp` mit einer Marke aus `eigen` bei `fremd` → 401).

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Anmelden mit Passwort, TOTP und Passkey, Backoff je Kennung und IP"
```

---

### Task 8: Mail — Warteschlange, Versand, Arbeiter

**Files:**

- Create: `apps/jufi/src/server/mail/warteschlange.ts`, `versand.ts`, `arbeiter.ts`, `texte.ts`
- Modify: `apps/jufi/src/server/umgebung.ts`, `apps/jufi/src/server/umgebung.spec.ts`, `apps/jufi/src/server/server.ts`, `apps/jufi/src/server/test-setup.ts` (`TEST_UMGEBUNG`), `package.json` (`nodemailer`, `@types/nodemailer`), `.env.example` (nur Kommentare, falls Namen fehlen)
- Test: `apps/jufi/src/server/mail/warteschlange.spec.ts`, `versand.spec.ts`, `arbeiter.spec.ts`, `texte.spec.ts`

**Interfaces:**

- Produces (`Umgebung`, neu): `smtp: { host: string; port: number; user?: string; pass?: string }`, `mailAbsender: string`, `mailAntwort: string`, `mailBetreffPraefix: string` aus `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_ABSENDER`, `MAIL_ANTWORT`, `MAIL_BETREFF_PRAEFIX`; `umgebungAusEnv` bricht ohne `SMTP_HOST`/`SMTP_PORT`/`MAIL_ABSENDER`/`MAIL_ANTWORT` mit Meldung ab (nie mit Werten); `TEST_UMGEBUNG` bekommt feste Testwerte.
- Produces (`warteschlange.ts`): `legeMailAn(tx: <Transaktions-Client, schlicht oder aus vereinDb>, m: { vereinId?: string; empfaenger: string; betreff: string; text: string; bezug?: string; jetzt: Date }): Promise<void>` — `vereinId` nur setzen, wenn der Aufrufer einen schlichten Client hat (mit `vereinDb` setzt der Client ihn selbst). Reiht ein, sendet nicht.
- Produces (`versand.ts`): `interface MailVersand { sende(m: { empfaenger: string; betreff: string; text: string }): Promise<void> }`; `nodemailerVersand(umgebung: Umgebung, transport?: Transporter): MailVersand` — Absender, `replyTo`, Betreff mit `mailBetreffPraefix` davor, `text` als Klartext; ohne `transport` ein SMTP-Transport nach `umgebung.smtp` (kein TLS-Zwang lokal; `secure` bei Port 465).
- Produces (`arbeiter.ts`): `MAIL_INTERVALL_MS = 30_000`, `MAIL_MAX_VERSUCHE = 10`; `naechsterAbstandMs(versuche: number): number` = `min(5 min · 2^(versuche − 1), 24 h)`; `starteMailArbeiter(e: { prisma: PrismaClient; versand: MailVersand; jetzt: () => Date; intervallMs?: number; log?: (zeile: string) => void }): { tick(): Promise<void>; stoppe(): Promise<void> }`. `tick` holt fällige Zeilen (`gesendetAm` leer, `versuche < MAX`, `naechsterVersuch <= jetzt`), **beansprucht** jede mit bedingtem `updateMany` (setzt `naechsterVersuch` in die Zukunft und erhöht `versuche`, Anzahl 1 entscheidet) bevor sie sendet — so sendet auch ein Absturz mitten im Versand höchstens verzögert wieder —, sendet, setzt bei Erfolg `gesendetAm`, bei Fehler `fehler` (nur Fehlerklasse und Kurztext, ohne Adresse). Dasselbe `tick` räumt abgelaufene `WebauthnChallenge` und abgelaufene `Session` (Wartung, plattformweit). `stoppe` wartet auf einen laufenden `tick`. `log` bekommt nie Adresse, Betreff, Text oder Token — nur die Mail-ID und die Fehlerklasse.
- Produces (`texte.ts`): `einladungsMail(t: { vorname: string; anzeigename: string; link: string; art: 'einladung' | 'notfall' }): { betreff: string; text: string }` (Text aus `leitungsEinladungsText` bzw. `notfallLinkText`), `resetMail(t: { vorname: string; anzeigename: string; link: string }): { betreff: string; text: string }` — nennt die **1 Stunde** und „Falls du das nicht warst, ignoriere diese Mail"; Fußzeile mit dem offiziellen Vereinsnamen entfällt in TP2.
- `server.ts` startet den Arbeiter nach dem Datenbankverbindungstest, ruft `stoppe()` bei SIGTERM/SIGINT vor dem Beenden.

- [ ] **Step 1: Tests schreiben**

- `warteschlange.spec.ts`: `legeMailAn` mit schlichtem Client legt Zeile mit `vereinId`, `versuche: 0`, `gesendetAm: null`, `bezug` an; mit `vereinDb(...).$transaction` landet die Zeile im richtigen Verein, auch ohne `vereinId` im Aufruf.
- `versand.spec.ts` (nodemailer `jsonTransport`): Absender `app@jufi-app.de`, `replyTo` `kontakt@jufi-app.de`, Betreff `[Test] Hallo`, Klartext unverändert; ohne Präfix keine Leerstelle davor.
- `arbeiter.spec.ts` (feste Uhr, Versand-Attrappe): `Fällige Mail wird gesendet` → `gesendetAm` gesetzt, `versuche` 1; `Nicht fällige bleibt`; `Fehler wird wiederholt mit wachsendem Abstand` (nach 1. Fehler `naechsterVersuch` = jetzt + 5 min, nach 2. + 10 min, `fehler` gesetzt und ohne die Adresse); `Nach 10 Versuchen Schluss` (wird nicht mehr geholt); `Zwei gleichzeitige tick-Aufrufe senden genau einmal`; `naechsterAbstandMs(20)` ist 24 h; `Log enthält keine Adresse` (Log-Zeilen gesammelt, `empfaenger` kommt in keiner vor); `Wartung`: abgelaufene Challenge und Sitzung weg, gültige bleiben; `stoppe` wartet auf einen hängenden Versand.
- `texte.spec.ts`: `resetMail` enthält Link, „1 Stunde" und den Vornamen; `einladungsMail` mit `'notfall'` enthält „angemeldeten Geräte".
- `umgebung.spec.ts`: fehlendes `SMTP_HOST` → Fehlermeldung nennt den Namen der Variable, nie einen Wert.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

`pnpm add nodemailer && pnpm add -D @types/nodemailer` (exakte Versionen wie die übrigen Abhängigkeiten, Lockfile mitcommitten).

- [ ] **Step 4: Grün sehen und lokal prüfen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS. Dazu von Hand: `pnpm run dev` startet ohne Fehler und der Arbeiter loggt beim Start eine Zeile ohne Adressen.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi package.json pnpm-lock.yaml .env.example
git commit -m "Mail-Warteschlange mit Arbeiter, nodemailer-Versand und Texten"
```

---

### Task 9: Zugang verloren und Mail an die Leitung

**Files:**

- Create: `apps/jufi/src/server/nachlauf.ts`, `apps/jufi/src/server/mitglieder/zugang-verloren.ts`
- Modify: `apps/jufi/src/server/abhaengigkeiten.ts`, `apps/jufi/src/server/admin/vereine.ts`, `apps/jufi/src/server/admin/daten.ts`, `apps/jufi/src/server/verein.ts`, `apps/jufi/src/server/mandanten.spec.ts`
- Test: `apps/jufi/src/server/nachlauf.spec.ts`, `apps/jufi/src/server/mitglieder/zugang-verloren.spec.ts`, `apps/jufi/src/server/admin/vereinsaktionen.spec.ts`

**Interfaces:**

- Produces (`nachlauf.ts`): `class Nachlauf { starte(arbeit: () => Promise<void>): void; warteAufAlle(): Promise<void> }` — fängt jeden Fehler der Arbeit und loggt nur „Nachlauf fehlgeschlagen" (kein `error.message`, das könnte Adressen enthalten); `AppDeps` bekommt `nachlauf?: Nachlauf`, `mitStandardwerten` einen eigenen; `server.ts` wartet beim Beenden auf `warteAufAlle()`.
- Produces: `POST /zugang-verloren` `{ email }` → immer 200 `{ ok: true }` (außer 429). Schlüssel `m-reset-ip:<ip>` und `m-reset:<vereinId>:<email normalisiert>`; **jeder** Aufruf zählt als Versuch und wird nie zurückgesetzt, ob es die Adresse gibt oder nicht. Im Nachlauf: Person mit dieser E-Mail, `art: 'ERWACHSENER'`, nicht entfernt, **mit** `Zugang` → in einer Transaktion `sperreVereinszeile`, `erzeugeEinladung` (`art: 'RESET'`, `erstelltVonPersonId: null`), `legeMailAn` mit `resetMail`, `bezug: 'reset:<einladungId>'`. Sonst nichts. Jungfischer bekommen nie eine Mail (die Oberfläche sagt „Frag deine Familie …").
- Produces (Admin): `POST /vereine`, `…/einladung-erneuern`, `…/notfall-link` nehmen `perMail?: boolean`; bei `true` und bekannter E-Mail der Person wird in derselben Transaktion eine Mail (`einladungsMail`, `art` `'einladung'` bzw. `'notfall'`, `bezug: 'einladung:<einladungId>'`) eingereiht; die Antwort trägt `mailEingereiht: boolean`. Hat die Person keine Adresse, 400 `{ fehler: 'Für diese Person ist keine E-Mail hinterlegt' }` ohne weitere Wirkung.

- [ ] **Step 1: Tests schreiben**

`nachlauf.spec.ts`: `warteAufAlle wartet auf laufende Arbeit`; `ein Fehler bricht nichts ab und steht nicht mit Text im Log`.

`zugang-verloren.spec.ts`:

- `Gleiche Antwort für alle Fälle` (Review Focus 4): bekannte Adresse, unbekannte, Adresse eines Jungfischers, Adresse einer Person ohne Zugang, ungültige Eingabe (`''`, `'kein-at'`, Zahl statt Text) → alle 200 `{ ok: true }` mit identischem Body.
- `Nur der bekannte Fall erzeugt Einladung und Mail`: nach `nachlauf.warteAufAlle()` genau eine offene `RESET`-Einladung (Ablauf jetzt + 1 h) und eine `MailWarteschlange`-Zeile an die normalisierte Adresse mit dem Link `…/<slug>/einladung#<token>`; in den anderen Fällen keine Zeile.
- `Der Link gilt`: Token aus dem Mailtext an `/einladung/pruefen` → `art: 'RESET'`.
- `Großschreibung und Rand` der Adresse → trifft dieselbe Person.
- `Zweiter Aufruf ersetzt den offenen Reset-Link` (nur eine offene `RESET`-Einladung).
- `Backoff zählt unabhängig vom Treffer`: vier Aufrufe mit unbekannter Adresse → der vierte 429; dieselbe Adresse in einem anderen Verein nicht betroffen.
- `Gesperrter Verein` → 404.

`vereinsaktionen.spec.ts`: `perMail: true` bei „Verein anlegen" → Mailzeile an die Leitung mit dem Link aus der Antwort, `mailEingereiht: true`; `perMail` ohne Adresse → 400, nichts angelegt bzw. nichts erzeugt; `perMail: false` → keine Zeile. Notfall-Link per Mail enthält den Notfall-Text.

`mandanten.spec.ts`: Fall für `POST /zugang-verloren` gegen `gesperrt` (404) und: Adresse aus `eigen` bei `fremd` → 200, aber keine Einladung in `eigen`.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Zugang verloren per Mail mit Nachlauf, Einladung der Leitung optional per Mail"
```

---

### Task 10: Profil-API — Passwort, Passkeys, TOTP

**Files:**

- Modify: `apps/jufi/src/server/mitglieder/profil.ts`, `apps/jufi/src/server/verein.ts`, `apps/jufi/src/server/mandanten.spec.ts`
- Test: `apps/jufi/src/server/mitglieder/profil.spec.ts`

**Interfaces:**

- Consumes: Muster aus `admin/passkeys.ts` (Optionen/Registrieren/Umbenennen/Löschen) und `admin/anmeldung.ts` (`totp/start`/`bestaetigen` mit verschlüsselter Zwischenmarke), `mitgliedKontext`, `brauchtMitglied`.
- Produces: `GET /ich` erweitert um `passkeys: { id, label, erstelltAm, zuletztGenutztAm }[]`, `hatPasswort: boolean`, `totp: { moeglich: boolean; aktiv: boolean; wiederherstellungscodesUebrig: number }` — `moeglich` genau für Erwachsene mit mindestens einem Recht (Spec 4.7).
- Produces: `POST /profil/passwort` `{ neu, alt? }` → 200. Hat der Zugang schon ein Passwort, ist `alt` Pflicht und wird mit Backoff `m-passwort:<zugangId>` geprüft (falsch → 401 „Anmeldung fehlgeschlagen"); `neu` nach `pruefePasswort` (400 mit Hinweis). Alle **anderen** Sitzungen des Zugangs werden beendet, die laufende bleibt.
- Produces: `POST /profil/passkeys/optionen` → `{ optionen }` (Challenge `register`, `personId`); `POST /profil/passkeys` `{ antwort, name? }` → 201 `{ id, label }`; `PATCH /profil/passkeys/:id` `{ label }` → 200 (1–40 Zeichen getrimmt); `DELETE /profil/passkeys/:id` → 200, aber 409 `{ fehler: 'Das ist dein letzter Anmeldeweg' }`, wenn danach weder Passkey noch Passwort bliebe. Eine fremde oder unbekannte Id ist 404.
- Produces: `POST /profil/totp/start` → 200 `{ uri, geheimnis, wiederherstellungscodes, marke }` (nur wenn `moeglich` und noch nicht aktiv, sonst 409); `POST /profil/totp/bestaetigen` `{ marke, code }` → 200 speichert verschlüsselt Geheimnis, `totpAktivAm`, die gehashten Wiederherstellungscodes; Backoff `m-totp-einrichten:<zugangId>`. Nicht `moeglich` → 403 `{ fehler: 'Dafür fehlen die Rechte' }` (der Zugang gehört der Person selbst, hier ist 403 keine Information über Fremdes).

- [ ] **Step 1: Tests schreiben**

`profil.spec.ts`: `ich` listet Passkeys ohne `publicKey`/`credentialId`; `Passwort setzen ohne vorhandenes` → 200; `Passwort ändern verlangt das alte` (ohne `alt` 400/401, falsches `alt` 401 und Backoff nach vier Versuchen 429); `andere Sitzungen enden` (zweites Gerät 401, laufendes bleibt); `Passkey hinzufügen` (Attrappen-Prüfer) → in `ich`; `umbenennen`; `letzten Anmeldeweg nicht löschen` (nur ein Passkey und kein Passwort → 409; mit Passwort geht es; mit zwei Passkeys geht es); `Passkey eines anderen Zugangs im selben Verein` → 404 und unverändert; `TOTP einrichten` als Erwachsener mit Recht → start liefert 10 Codes, bestätigen mit richtigem Code setzt `totpAktivAm`, `ich.totp.aktiv` true; falscher Code 401; als Jungfischer und als Erwachsener ohne Rechte 403; bereits aktiv → 409; danach verlangt `POST /anmelden` den TOTP-Schritt (Querverweis auf Task 7).

`mandanten.spec.ts`: Fälle für alle neuen Routen; die mit `:id` rufen mit der Passkey-Id eines Zugangs aus `fremd` auf — Mitglied aus `eigen` — und erwarten 404 und einen unveränderten Datensatz in `fremd`.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Profil-API: Passwort, Passkeys, TOTP, Anmeldewege in /ich"
```

---

### Task 11: Frontend-Grundlage — gemeinsame Bausteine, Mitglieder-API, Wächter

**Files:**

- Move (`git mv`, Importe nachziehen): `apps/jufi/src/app/admin/passkey-browser.ts`, `formular.ts`, `totp-einrichtung.ts` (samt Spec) nach `apps/jufi/src/app/gemeinsam/`; der Fehlertyp aus `admin-api.ts` wird `ApiFehler`/`alsApiFehler`/`istApiFehler`/`fehlertext` in `gemeinsam/api-fehler.ts`
- Create: `apps/jufi/src/app/verein/mitglieder-api.ts`, `apps/jufi/src/app/verein/mitglied-waechter.ts`
- Modify: `apps/jufi/src/app/app.routes.ts`, `apps/jufi/src/app/seiten/verein-start.ts` (+ Spec), `apps/jufi/src/app/admin/*` (nur Importe und `TotpEinrichtung`-Eingaben)
- Test: `apps/jufi/src/app/verein/mitglieder-api.spec.ts`, `mitglied-waechter.spec.ts`, bestehende Specs

**Interfaces:**

- Produces: `MitgliederApi` (`providedIn: 'root'`) mit je einer Methode pro Endpunkt aus den Tasks 4–10 (`ich`, `abmelden`, `abmeldenAlle`, `einladungPruefen`, `einladungPasskeyOptionen`, `einladungEinloesen`, `anmelden`, `anmeldenTotp`, `passkeyOptionen`, `anmeldenPasskey`, `zugangVerloren`, Profil-Methoden), jede nimmt den Slug als ersten Parameter und gibt ein `Observable`; Fehler laufen durch `alsApiFehler`.
- Produces: `TotpEinrichtungComponent` bekommt statt `AdminApi` zwei Eingaben `starten: () => Observable<TotpStart>` und `bestaetigen: (marke: string, code: string) => Observable<unknown>` (die Admin-Seiten übergeben ihre Aufrufe; Verhalten und Texte bleiben).
- Produces: `mitgliedAngemeldet: CanActivateFn` — fragt `GET /<slug>/api/v1/ich`; 401 → Umleitung auf `/<slug>/anmelden`; 404 → Umleitung auf die Nicht-gefunden-Seite; andere Fehler → Navigation scheitert sichtbar (wie `adminAngemeldet`).
- Produces: Routen unter `:slug` als Kinder: `''` (Start, `mitgliedAngemeldet`), `anmelden`, `einladung`, `zugang-verloren`, `profil` (`mitgliedAngemeldet`); `anmelden`, `einladung`, `zugang-verloren`, `profil` laden die Seiten der Tasks 12–14 nach (`loadComponent`), bis dahin ein Platzhalter-Bauteil je Pfad.

- [ ] **Step 1: Tests schreiben**

- `mitglied-waechter.spec.ts`: 200 → durch; 401 → `UrlTree` nach `/glonntal/anmelden`; 404 → Nicht-gefunden; 500 → Fehler wird weitergereicht.
- `mitglieder-api.spec.ts` (`HttpTestingController`): `anmelden('glonntal', …)` ruft `POST /glonntal/api/v1/anmelden` mit dem Body auf; ein 429-Body kommt als `ApiFehler` mit `wartenSekunden` an.
- `verein-start.spec.ts`: bisher `/demo` ohne Anmeldung — jetzt mit gestelltem `ich` (200) zeigt die Seite „Willkommen {anzeigename}", mit 401 leitet der Wächter nach `/demo/anmelden`.
- Alle bisherigen Specs unter `admin/` bleiben grün (nur Importpfade geändert).

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test --skip-nx-cache`
Expected: FAIL (Dateien und Wächter fehlen).

- [ ] **Step 3: Verschieben und implementieren**

`git mv` zuerst, damit die Historie bleibt; keine Verhaltensänderung an den Admin-Seiten.

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck build --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Frontend: gemeinsame Bausteine, Mitglieder-API, Waechter, Routen unter dem Vereins-Slug"
```

---

### Task 12: Seiten Anmelden und Zugang verloren

**Files:**

- Create: `apps/jufi/src/app/verein/anmelden.ts`, `apps/jufi/src/app/verein/zugang-verloren.ts` (+ je `.spec.ts`)
- Modify: `apps/jufi/src/app/app.routes.ts` (Platzhalter ersetzen)

**Interfaces:**

- Consumes: `MitgliederApi`, `PasskeyBrowser`, `wertVon`, `fehlertext`, `VereinApi.lade(slug)` (Titel, Vereinsfarbe).
- Produces: `AnmeldenComponent` — Kennungsfeld mit `autocomplete="username webauthn"`, Passwortfeld, Knopf „Mit Passkey anmelden" (ruft Optionen, `PasskeyBrowser.anmelden`, dann `anmeldenPasskey`), bei Schritt `totp` ein Feld für den Code mit Umschalter auf Wiederherstellungscode; „Passwort vergessen?" führt nach `zugang-verloren`; Antwort `fertig` navigiert zu `/<slug>/`. Fehlertexte: 401 „Anmeldung fehlgeschlagen", 429 „Zu viele Versuche – bitte in {n} Sekunden erneut", Passkey abgebrochen ohne Fehlermeldung. Wo der Browser keine Passkeys kann, fehlt der Passkey-Knopf. `ZugangVerlorenComponent` — Erwachsene: Feld E-Mail, Antwort „Falls die Adresse bekannt ist, kommt eine Mail." (immer, außer 429); darunter der Absatz für Jungfischer: „Du bist Jungfischer? Frag deine Familie oder einen Jugendleiter nach einem neuen Link."

- [ ] **Step 1: Tests schreiben**

- `anmelden.spec.ts`: Absenden schickt die Feldwerte unverändert (der Server normalisiert); `fertig` → Navigation; `totp` → Codefeld erscheint, Passwortfeld verschwindet; 401 → „Anmeldung fehlgeschlagen" sichtbar und Fokus bleibt im Formular; 429 → Wartezeit im Text; ohne `window.PublicKeyCredential` kein Passkey-Knopf; abgebrochener Passkey-Dialog zeigt keinen Fehlertext.
- `zugang-verloren.spec.ts`: Absenden zeigt die feste Antwort, egal was der Server mit 200 liefert; leere Eingabe wird nicht abgeschickt; 429 zeigt Wartehinweis.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren** (Inline-Vorlagen, `@if`/`@for`, Signale, OnPush; Gestaltung wie die Admin-Anmeldung, aber für Handy: ein Einspaltenformular, Knöpfe mindestens 44 px hoch; keine Backticks in Kommentaren der Vorlagen)

- [ ] **Step 4: Grün sehen und messen**

Run: `pnpm nx run-many -t test build --skip-nx-cache`
Expected: PASS. Dazu im Browser (Dev-Server, erfundene Daten, lokaler Verein aus der Admin-Oberfläche): `/<slug>/anmelden` bei 375 × 812 hell und dunkel — `scrollWidth <= clientWidth`, Knopfhöhen ≥ 44 px, Kontrast lesbar.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Seiten Anmelden und Zugang verloren"
```

---

### Task 13: Seite Einladung annehmen

**Files:**

- Create: `apps/jufi/src/app/verein/einladung.ts` (+ `.spec.ts`)
- Modify: `apps/jufi/src/app/app.routes.ts`

**Interfaces:**

- Consumes: `MitgliederApi.einladungPruefen/einladungPasskeyOptionen/einladungEinloesen`, `PasskeyBrowser.registrieren`.
- Produces: `EinladungComponent` — liest das Token aus `location.hash` und entfernt es sofort aus der Adresszeile (`history.replaceState`), hält es nur im Signal. Schritte (Spec 4.2): **Begrüßung** („Hallo Sandra, willkommen bei {Vereinsname}."; ungültiger Link: „Dieser Link gilt nicht mehr – frag nach einem neuen."; `einwilligungFehlt`: „Eine erziehungsberechtigte Person muss erst einwilligen." ohne Formular), **Kennung** (Erwachsene: E-Mail vorbelegt und änderbar; Jungfischer: Anmeldename mit Vorschlag; `kennung.fest`: Schritt entfällt und die Kennung steht nur zur Anzeige), **Zugang einrichten** (Passkey vorne, wenn der Browser ihn kann; Passwort mit dem Mindestlängenhinweis; beides zugleich geht; bei `art: 'RESET'` der Satz „Alte Anmeldewege werden dabei gelöscht."), **Fertig** (Hinweis: Home-Bildschirm, und dass man sich dort noch einmal anmeldet; Knopf „Zur App"). Gesendet wird erst beim Absenden des Schritts „Zugang einrichten". Der Einwilligungsschritt (Spec 4.2 Nr. 2) fehlt bewusst (Etappe 4).

- [ ] **Step 1: Tests schreiben**

- `Token wird aus der Adresse entfernt`: nach dem Laden ist `location.hash` leer, `einladungPruefen` wurde mit dem Token aufgerufen.
- `Begrüßung mit Namen und Vereinsnamen`; `404 → Dieser Link gilt nicht mehr` ohne Formular.
- `einwilligungFehlt → Hinweis statt Formular`.
- `Erwachsener: E-Mail vorbelegt`, Änderung wird beim Einlösen mitgeschickt; `kennung.fest` blendet das Feld aus (kein `kennung` im Body).
- `Jungfischer: Vorschlag lena2 vorbelegt`.
- `Passkey-Weg`: Optionen werden geholt, `registrieren` aufgerufen, die Antwort als `passkey` im Body; `Passwort-Weg`: zu kurzes Passwort wird vor dem Absenden mit dem Hinweis abgelehnt (Server-Regel gespiegelt über `pruefePasswort` aus `@jufi/domain`); Server-409 zeigt den Text am Kennungsfeld und springt zurück zum Schritt Kennung.
- `Erfolg → Schritt Fertig mit Home-Bildschirm-Hinweis`.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

- [ ] **Step 4: Grün sehen und messen**

Run: `pnpm nx run-many -t test build --skip-nx-cache`
Expected: PASS. Im Browser: Verein über `/admin` anlegen (erfundene Daten), Link aus der Admin-Seite öffnen und alle Schritte durchgehen — Passwort-Weg, danach Anmelden; bei 375 × 812 hell und dunkel `scrollWidth <= clientWidth` je Schritt.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Seite Einladung annehmen"
```

---

### Task 14: Profil-Seite, Start mit Abmelden, Admin-Oberfläche für Mail und Notfall

**Files:**

- Create: `apps/jufi/src/app/verein/profil.ts` (+ `.spec.ts`)
- Modify: `apps/jufi/src/app/seiten/verein-start.ts`, `apps/jufi/src/app/app.routes.ts`, `apps/jufi/src/app/admin/verein-neu.ts`, `apps/jufi/src/app/admin/verein-seite.ts`, `apps/jufi/src/app/admin/admin-api.ts` (+ die zugehörigen Specs)

**Interfaces:**

- Produces: `ProfilComponent` (schlicht; Etappe 5 baut die Hülle): Name und Kennung nur lesend; Passkeys hinzufügen, umbenennen, löschen (Fehlertext des 409); Passwort setzen oder ändern (altes Passwort nur, wenn eines existiert); TOTP einrichten mit der `TotpEinrichtungComponent` (nur wenn `totp.moeglich`); „Abmelden" und „Überall abmelden" (danach `/<slug>/anmelden`).
- Produces: `VereinStartComponent` bekommt einen Link „Profil" und „Abmelden".
- Produces (Admin): Kontrollkästchen „Zusätzlich per Mail senden" bei „Verein anlegen", „Einladung erneuern" und „Notfall-Link" (sendet `perMail`); Anzeige „Mail ist eingereiht" nach `mailEingereiht`; bei 409 „gesperrt" die Meldung des Servers statt eines allgemeinen Fehlers; der Notfall-Text kommt aus der Serverantwort (schon durch Task 2).

- [ ] **Step 1: Tests schreiben**

- `profil.spec.ts`: listet Passkeys und Passwortstatus aus `ich`; „letzter Anmeldeweg"-409 erscheint als Text an der Zeile; Passwortfeld „altes Passwort" nur bei `hatPasswort`; TOTP-Abschnitt fehlt, wenn `moeglich` falsch; „Überall abmelden" ruft die API und navigiert zur Anmeldung.
- `verein-start.spec.ts`: „Abmelden" ruft `abmelden` und navigiert.
- Admin-Specs: `perMail` wird mit `true` gesendet, wenn das Kästchen gesetzt ist, und fehlt sonst; `mailEingereiht` zeigt den Hinweis; 409 „gesperrt" zeigt den Servertext.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

- [ ] **Step 4: Grün sehen und messen**

Run: `pnpm nx run-many -t test build --skip-nx-cache`
Expected: PASS. Im Browser: Profil bei 375 × 812 hell und dunkel (`scrollWidth`, Knopfhöhen); Admin-Seiten bei 1280 × 800 mit dem neuen Kästchen; Mailpit (http://localhost:8025) zeigt die Mail aus „Verein anlegen" mit Präfix `[Test] ` und funktionierendem Link.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi/src
git commit -m "Profil-Seite, Abmelden im Start, Mail-Option und Sperrhinweis in der Admin-Oberflaeche"
```

---

### Task 15: Demo-Kriterium, Ende-zu-Ende von Hand, Doku

**Files:**

- Modify: `apps/cli/src/demo.ts`, `apps/cli/src/demo.spec.ts`, `README.md`, `CLAUDE.md`, `.env.example` (nur Kommentare), `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md`
- Test: `apps/cli/src/demo.spec.ts`

**Interfaces:**

- Produces: `DemoGeschuetztFehler` meldet jetzt die Zahl der Personen mit echter Adresse (Konstruktor `(personenMitEchterAdresse: number)`); `demoEinspielen` wirft, wenn im vorhandenen Verein `demo` mindestens eine `Person.email` nicht auf `@example.org` endet (Entscheidung 7), und löscht sonst wie bisher — auch wenn es dort Zugänge und Sitzungen gibt.

- [ ] **Step 1: Tests schreiben**

`demo.spec.ts`: `Demo mit Zugang und Sitzung wird neu eingespielt` (Zugang, Sitzung in einem Demo-Verein mit nur `example.org`-Adressen → kein Fehler, Zugang weg); `Verein demo mit echter Adresse ist geschützt` (eine Person `leitung@verein.de` → `DemoGeschuetztFehler`, nichts gelöscht); der alte Test auf „Zugänge und Sitzungen" entfällt.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run cli:test --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Implementieren, Doku und Spec nachziehen**

- `demo.ts`: Kriterium und Kommentar ersetzen, die verworfene Alternative (Kennzeichen am Verein) bleibt im Kommentar.
- Spec: Abschnitt 4.2 Schritt 2 bekommt den Hinweis „Die Oberfläche folgt mit Etappe 4; Etappe 3 prüft nur das Vorhandensein einer gültigen Einwilligung beim Einlösen"; 4.3 den Satz zur Passkey-Meldung (Entscheidung 3); 3.4 `Zugang.letzteAnmeldungAm` und `Verein.sperrzaehler` in 3.2 (Entscheidung 1); 7.3 „bei gesperrtem Verein sind Erneuern und Notfall-Link nicht möglich" (Entscheidung 6); die Zeilen zur Einladungsmail (Spec 4.1 „Verteilung", 6.3 „Mitglieder", 8.4 „Mails in TP2") bleiben stimmig — sie meinen die Mail an Mitglieder (Etappe 4); in 1.4 bei Etappe 3 „Mail-Arbeiter" ergänzen; Kopfzeile `Stand`.
- `README.md`: Abschnitt Mail (`SMTP_*`, `MAIL_*`, Mailpit unter http://localhost:8025) und ein Absatz „Einladung lokal ausprobieren": `pnpm run db:up`, `pnpm run dev`, im Admin einen Verein anlegen, Link öffnen.
- `CLAUDE.md`: unter „Stand" den Satz zu Etappe 3 (Anmeldung der Mitglieder, Mailpit), unter „Was nachweislich stolpert" eine Zeile: Vereinsdaten-Entscheidungen „angenommen oder nicht" beginnen mit `sperreVereinszeile`.

- [ ] **Step 4: Alles prüfen**

Run: `pnpm exec prettier --check . && pnpm nx run-many -t test test-server typecheck build lint --skip-nx-cache`
Expected: PASS. Von Hand (Abnahme-Vorlauf, erfundene Daten): Verein anlegen mit „per Mail" → Mailpit → Link → Einrichten mit Passkey (virtueller Authenticator in Chrome-DevTools) → abmelden → anmelden → Profil: Passwort setzen, TOTP einrichten → abmelden → Anmeldung verlangt Code → „Passwort vergessen?" → Mail in Mailpit → Reset-Link löscht TOTP und Passkeys → Notfall-Link im Admin für gesperrten Verein zeigt 409. Ergebnis kurz in der Abschlussnachricht festhalten.

- [ ] **Step 5: Commit**

```bash
git add apps/cli README.md CLAUDE.md .env.example docs/superpowers/specs
git commit -m "Demo-Schutzkriterium neu gefasst, Doku und Spec zu Etappe 3 nachgezogen"
```
