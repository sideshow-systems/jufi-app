# TP2 Etappe 2: Plattform-Admin — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Plattform-Admin entsteht über die Kommandozeile, richtet sich über einen Einmal-Link mit Passwort, TOTP und Passkey ein, meldet sich unter `/admin/` an, legt Vereine mit erster Leitung an, sperrt sie, korrigiert den Slug, erzeugt Einladungs- und Notfall-Links — und jede dieser Handlungen steht im Protokoll.

**Architecture:** Eine eigene Admin-API unter `/admin/api/v1` mit eigener Sitzung (`jufi_admin`, Pfad `/admin/`, 12 Stunden) und einer eigenen Datenschicht (`adminDaten`), die aus Vereinen nur Kennzahlen und Ansprechpartner liest. Die Anmeldung folgt hwyd (Passwort → signierte Zwischenmarke → TOTP; Passkey ersetzt beide), die Kryptografie liegt in `libs/auth`, die Regeln in `libs/domain`. Die Oberfläche ist ein nachgeladener Angular-Bereich unter `/admin`.

**Tech Stack:** wie Etappe 1; dazu `@simplewebauthn/server` und `@simplewebauthn/browser` (schon installiert), neu `qrcode` (QR-Code für TOTP im Browser).

**Spec:** `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md` (Etappe 2 aus 1.4; Abschnitte 7, dazu 2.2, 3.2, 4.1, 4.5, 4.7, 8.5, 9). Vorlage: `../hwyd/libs/auth/src/lib/webauthn.ts`, `../hwyd/apps/hwyd/src/server/routes/{auth,totp,passkeys}.ts`, `../hwyd/apps/hwyd/src/app/core/passkeys.ts`, `../hwyd/apps/hwyd/src/app/features/settings/settings.ts` (QR) — lesen, kopieren, anpassen, nie dorthin schreiben.

## Entscheidungen, die die Spec nachziehen (Task 1 ändert die Spec mit)

1. **E-Mail an der Person statt am Zugang.** Die Spec legt `email` an den `Zugang`, der erst beim Einlösen der Einladung entsteht (3.4). Die erste Leitung, die Ansprechpartner (7.3) und jeder Erwachsene, der beim Anlegen eine Adresse bekommt (5.3), brauchen sie aber vorher. `Person.email` wird die einzige Stelle; `Zugang.email` entfällt, `Zugang` behält `anmeldename`. Verworfen: eine zweite Kopie an der Person — zwei Adressen liefen auseinander. Preis: Der CHECK `zugang_kennung` (E-Mail oder Anmeldename am Zugang) lässt sich über zwei Tabellen nicht ausdrücken und entfällt; Etappe 3 prüft die Kennung beim Einlösen in `libs/domain`.
2. **Logo erst mit den Vereinseinstellungen (Etappe 5).** Das Logo braucht Upload jenseits der 100-KB-Grenze, `sharp` für die Icons und das Manifest — alles Etappe 5. Der Verein lädt es dort selbst hoch.
3. **Einladung per Mail erst in Etappe 3.** Der Mail-Arbeiter entsteht mit dem Zurücksetzen per Mail; bis dahin zeigt die Admin-Seite Link und fertigen Text zum Kopieren.

## Global Constraints

- Alle Constraints aus Etappe 1 gelten weiter (Sprache, Tabs, Angular-Regeln, `jetzt: Date` in Regeln, 404 statt 403 für Vereinsdaten, erfundene Daten, Testdatenbanken `jufi_test_<projekt>`, Fehler als `{ "fehler": "<Text>" }`, 100 KB, Prettier vor Push, kein Push/Deploy ohne Ansage, nie `pnpm deploy`).
- Admin-API unter `/admin/api/v1`; ohne gültige Admin-Sitzung **401** `{ fehler: 'nicht angemeldet' }` (der Admin-Bereich ist kein Geheimnis; 404-statt-403 gilt für Vereinsdaten).
- Cookie `jufi_admin` (`ADMIN_COOKIE`), `Path=/admin/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=43200`, `Secure` genau dann, wenn die Anfrage über https kam (`req.secure` hinter `trust proxy 1`).
- Admin-Sitzung **12 Stunden ab Anmeldung, ohne Verlängerung**; nur der SHA-256-Hash des Tokens in `AdminSession.tokenHash`.
- Einrichtungslink: `<BASIS_URL>/admin/einrichten#<token>`, **1 Stunde**, einmal. Einladungslink: `<BASIS_URL>/<slug>/einladung#<token>`, **14 Tage**. Tokens aus `generateLinkToken()`, gespeichert nur `hashToken(token)`.
- Ein neuer Einladungslink löscht die offenen (nicht eingelösten) Einladungen derselben Art für dieselbe Person in derselben Transaktion.
- Passwortregel: mindestens **10 Zeichen** (Code-Points), keine Zusammensetzungsregeln, Sperrliste häufiger Passwörter.
- Backoff wie hwyd (`AttemptTracker`: drei freie Versuche, dann verdoppelnd bis 15 Minuten), Schlüssel `ip:<req.ip>`, `admin:<benutzername>`, `totp:<adminId>`, `totp-einrichten:<adminId>`; Antwort **429** `{ fehler: 'Zu viele Versuche', wartenSekunden }`.
- Anmeldefehler immer `{ fehler: 'Anmeldung fehlgeschlagen' }` mit 401, egal ob Name, Passwort, Code oder Passkey falsch war.
- Schreibende Anfragen (alles außer GET/HEAD/OPTIONS) nur mit `Origin` gleich dem Ursprung aus `BASIS_URL`, sonst **403** `{ fehler: 'Ursprung nicht erlaubt' }` (Spec 4.5).
- Admin-Endpunkte liefern aus Vereinen **nur** Kennzahlen und Ansprechpartner (Vorname, Nachname, E-Mail der Inhaber von `JUGENDLEITER_RECHTE`), nie Kinder, Familien oder Personenlisten (Spec 7.4). Nur `admin/daten.ts` liest Vereinstabellen für den Admin.
- Jede Admin-Handlung an einem Verein schreibt in **derselben Transaktion** einen `AdminProtokoll`-Eintrag (Spec 7.5).
- Der Slug `demo` ist für neue Vereine und für Slug-Korrekturen gesperrt (`pruefeNeuenSlug`), bleibt aber erreichbar (`pruefeSlug` unverändert).
- Express-Routing groß-/kleinschreibungsgenau (`case sensitive routing`, `Router({ caseSensitive: true })`): `/ADMIN/…` ist nicht `/admin/…`.
- Admin-Oberfläche ist Desktop: gemessen bei 1280 × 800, hell und dunkel.

## Review Focus

1. **Doppelklick auf „Einrichtung abschließen"** (zwei gleichzeitige Anfragen mit demselben Token): genau eine gelingt, die zweite bekommt 404 „Dieser Link gilt nicht mehr"; es entsteht nur eine Sitzung. Test in Task 5.
2. **Zwei Vereine gleichzeitig mit demselben Slug angelegt**: einer 201, der andere 409 „Dieser Slug ist vergeben", kein 500. Test in Task 8.
3. **E-Mail mit Großbuchstaben und Leerzeichen** (`'  Thomas@Example.ORG '`): gespeichert als `thomas@example.org`; dieselbe Adresse in zwei Vereinen geht, im selben nicht. Tests in Task 1 und Task 8.
4. **Admin-Sitzung nach 12 Stunden**: 401, Zeile gelöscht; Nutzung verlängert nichts. Test in Task 4.
5. **Notfall-Link für eine Person, die kein Ansprechpartner ist** (Kind, Elternteil, entfernte Person, Person eines anderen Vereins) und **Slug-Korrektur nach angenommener Einladung**: 404 bzw. 409, keine Einladung, kein Protokolleintrag. Tests in Task 9.

---

## Dateistruktur

```
prisma/migrations/<ts>_email_an_person/   Person.email, Zugang.email weg, CHECKs farbe/email, rechte NOT NULL
libs/domain/src/passwort.ts               pruefePasswort (+ haeufige-passwoerter.ts)
libs/domain/src/kennung.ts                normalisiereBenutzername, pruefeBenutzername, normalisiereEmail, pruefeEmail
libs/domain/src/verein.ts                 DEMO_SLUG, pruefeNeuenSlug, slugVorschlag, Farbe, Name, Anzeigename
libs/domain/src/einladung.ts              Gueltigkeiten, einladungsAblauf
libs/auth/src/lib/webauthn.ts             aus hwyd, ohne Datenbank
libs/auth/src/lib/zwischenmarke.ts        signierte Marke zwischen Passwort und TOTP
apps/jufi/src/server/umgebung.ts          Umgebung, umgebungAusEnv
apps/jufi/src/server/ursprung.ts          Origin-Pruefung
apps/jufi/src/server/einladung.ts         erzeugeEinladung, einladungsLink, leitungsEinladungsText
apps/jufi/src/server/admin/sitzung.ts     Admin-Sitzung und Cookie
apps/jufi/src/server/admin/api.ts         adminApi(deps), adminRouten(router)
apps/jufi/src/server/admin/anmeldung.ts   Einrichtung, Passwort, TOTP (Routen)
apps/jufi/src/server/admin/passkeys.ts    Passkey-Routen und Challenges
apps/jufi/src/server/admin/daten.ts       adminDaten(prisma): Kennzahlen, Ansprechpartner, Aktionen
apps/jufi/src/server/admin/vereine.ts     Vereins-Routen
apps/cli/src/admin.ts                     adminAnlegen, adminZuruecksetzen
apps/cli/src/verein-loeschen.ts           vereinLoeschen
apps/jufi/src/app/admin/…                 Bereich /admin (nachgeladen)
```

---

### Task 1: Datenmodell nachziehen — E-Mail an der Person, offene CHECKs

**Files:**

- Modify: `prisma/schema.prisma`, `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md`, `apps/cli/src/demo.ts`
- Create: `prisma/migrations/<zeitstempel>_email_an_person/migration.sql` (über `pnpm prisma migrate dev --name email_an_person --create-only`, dann von Hand ergänzt)
- Test: `libs/db/src/schema.spec.ts`, `libs/db/src/verein-db.spec.ts`, `apps/cli/src/demo.spec.ts`

**Interfaces:**

- Produces: `Person.email String?` mit `@@unique([vereinId, email])`; `Zugang` ohne `email`.
- Produces: CHECKs `person_email` (`email IS NULL OR (email = lower(email) AND email = btrim(email) AND email <> '')`), `verein_farbe` (`farbe ~ '^#[0-9a-f]{6}$'`), `zugang_kleinschreibung` neu als `anmeldename = lower(anmeldename)`; `zugang_kennung` entfällt; `Person.rechte` `SET NOT NULL`.
- Produces: Demo-Erwachsene mit erfundenen Adressen `<vorname>.<nachname>@example.org` (kleingeschrieben).

Die Migration läuft **ohne** `migrate reset` gegen die Entwicklungsdatenbank (die Demo-Daten haben keinen Zugang; Werte für `farbe` erfüllen den CHECK). Kommentare in der Migration erklären jeden CHECK und den Wegfall von `zugang_kennung` (Entscheidung 1 oben).

Spec ändern: 3.3 Tabelle `Person` bekommt die Zeile `email` (alle; kleingeschrieben, eindeutig je Verein; für Erwachsene die Kennung, beim Anlegen freiwillig, spätestens beim Annehmen der Einladung Pflicht; für Jungfischer freiwillig, Benachrichtigungen ab TP5) mit der Begründung aus Entscheidung 1; 3.4 Tabelle `Zugang` ohne `email`, Satz „Die Kennung Erwachsener ist `Person.email`"; 7.3 „Logo (optional)" → „Logo kommt mit den Vereinseinstellungen (Etappe 5)" und „optional geht er per Mail raus" → „per Mail ab Etappe 3". Kopfzeile der Spec: `Stand: 13.10.2026`.

- [ ] **Step 1: Tests schreiben**

`schema.spec.ts` (bestehende Fälle mit `zugang.create({ … email … })` auf Zugang ohne E-Mail bzw. mit `anmeldename` umstellen; den Fall `zugang_kennung` streichen):

- `E-Mail der Person nur kleingeschrieben und ohne Rand` → `person.create({ … email: 'Sandra@Example.org' })` wirft `/person_email/`; `' sandra@example.org'` ebenso.
- `E-Mail ist je Verein eindeutig, nicht vereinsübergreifend` → zweite Person im selben Verein mit derselben Adresse wirft P2002; im anderen Verein gelingt.
- `Vereinsfarbe nur als kleingeschriebenes Hex` → `'#0F766E'`, `'0f766e'`, `'#0f766'` werfen `/verein_farbe/`; `'#0f766e'` gelingt.
- `Rechte sind nie NULL` → `prisma.$executeRaw` mit `UPDATE "Person" SET rechte = NULL WHERE id = …` wirft (not-null).
- `Anmeldename nur kleingeschrieben` → `zugang.create({ … anmeldename: 'Lena' })` wirft `/zugang_kleinschreibung/`.

`demo.spec.ts`: `Erwachsene haben erfundene Adressen unter example.org` → alle `ERWACHSENER` haben `email` auf `@example.org`, kleingeschrieben.

- [ ] **Step 2: Rot sehen**

Run: `pnpm run db:up && pnpm nx run-many -t test -p db cli --skip-nx-cache`
Expected: FAIL (unbekanntes Feld `email` an `Person`, CHECKs fehlen).

- [ ] **Step 3: Schema, Migration, Demo und Spec ändern; `pnpm prisma migrate dev` und `pnpm run db:generate` ausführen**

- [ ] **Step 4: Grün sehen**

Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache`
Expected: PASS (auch `jufi:test-server` — `verein-db.spec.ts` ggf. auf `Person.email` umstellen).

- [ ] **Step 5: Commit**

```bash
git add prisma apps/cli/src libs/db/src docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md
git commit -m "E-Mail an der Person statt am Zugang, CHECK fuer Farbe und E-Mail, rechte NOT NULL"
```

---

### Task 2: Regeln in `libs/domain`

**Files:**

- Create: `libs/domain/src/passwort.ts`, `libs/domain/src/haeufige-passwoerter.ts`, `libs/domain/src/kennung.ts`, `libs/domain/src/verein.ts`, `libs/domain/src/einladung.ts` und je eine `.spec.ts`
- Modify: `libs/domain/src/index.ts`, `apps/cli/src/demo.ts` (`DEMO_SLUG` aus `@jufi/domain` importieren, eigene Konstante weg)

**Interfaces:**

- Produces: `pruefePasswort(passwort: string): { ok: true } | { ok: false; grund: 'zu-kurz' | 'zu-haeufig' }`; `PASSWORT_MIN = 10`; `PASSWORT_HINWEIS: Record<'zu-kurz' | 'zu-haeufig', string>` = `{ 'zu-kurz': 'Mindestens 10 Zeichen', 'zu-haeufig': 'Dieses Passwort ist zu verbreitet' }`.
- Produces: `normalisiereBenutzername(s: string): string` (trim, klein); `pruefeBenutzername(s: string): boolean` auf dem normalisierten Wert, Muster `^[a-z0-9][a-z0-9._-]{2,29}$`.
- Produces: `normalisiereEmail(s: string): string` (trim, klein); `pruefeEmail(s: string): boolean` auf dem normalisierten Wert: `^[^\s@]+@[^\s@]+\.[^\s@]+$`, höchstens 254 Zeichen.
- Produces: `DEMO_SLUG = 'demo'`; `pruefeNeuenSlug(slug: string): SlugPruefung` = `pruefeSlug`, zusätzlich `{ ok: false, grund: 'reserviert' }` für `DEMO_SLUG`; `slugVorschlag(anzeigename: string): string`; `normalisiereFarbe(s)` (trim, klein), `pruefeFarbe(s): boolean` (`^#[0-9a-f]{6}$`); `pruefeAnzeigename(s): boolean` (getrimmt 1–24 Code-Points); `pruefeVereinsname(s): boolean` (getrimmt 1–120 Code-Points); `SLUG_HINWEIS: Record<'format' | 'laenge' | 'reserviert', string>` = `{ format: 'Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche', laenge: '3 bis 30 Zeichen', reserviert: 'Dieser Slug ist reserviert' }`.
- Produces: `EINLADUNG_GUELTIG_MS = 14 * 24 * 60 * 60 * 1000`, `RESET_GUELTIG_MS = 60 * 60 * 1000`, `EINRICHTUNG_GUELTIG_MS = 60 * 60 * 1000`; `einladungsAblauf(art: 'EINLADUNG' | 'RESET', jetzt: Date): Date`.

`pruefePasswort`: `[...passwort].length < 10` → `zu-kurz`; Kleinschreibung in `HAEUFIGE_PASSWOERTER` (ein `ReadonlySet<string>`) oder nur ein wiederholtes Zeichen (`/^(.)\1+$/u`) → `zu-haeufig`. Die Liste in `haeufige-passwoerter.ts` hat mindestens 100 kleingeschriebene Einträge mit mindestens 10 Zeichen (kürzere scheitern ohnehin), deutsch und englisch, von Hand aus bekannten Listen (z. B. SecLists „10k most common") übernommen — kein Download zur Laufzeit; der Kopfkommentar nennt die Quelle.

`slugVorschlag`: klein; `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`; übrige Diakritika per `normalize('NFD')` entfernen; jede Folge außer `[a-z0-9]` → `-`; Bindestriche am Rand weg; auf 30 Zeichen kürzen, danach Bindestrich am Ende weg; besteht das Ergebnis `pruefeNeuenSlug` nicht → `''`.

- [ ] **Step 1: Tests schreiben**

- `passwort.spec.ts`: `'abc'` → zu-kurz; `'123456789'` (9) → zu-kurz; `'1234567890'` → zu-haeufig; `'Passwort123'` → zu-haeufig (Groß/klein egal; der Eintrag `passwort123` steht in der Liste); `'aaaaaaaaaaaa'` → zu-haeufig; `'Forelle am Glonnbach'` → ok; `'🐟🐟🐟🐟🐟abcde'` (10 Code-Points) → ok; `jeder Eintrag der Liste ist klein und hat mindestens 10 Zeichen`.
- `kennung.spec.ts`: `normalisiereBenutzername('  Florian ')` → `'florian'`; gültig: `'florian'`, `'f.binder'`, `'admin_2'`; ungültig: `'fb'`, `'-florian'`, `'flo rian'`, `'Florian'` (nicht normalisiert), 31 Zeichen. `normalisiereEmail('  Thomas@Example.ORG ')` → `'thomas@example.org'`; gültig `'thomas@example.org'`; ungültig `'thomas'`, `'thomas@example'`, `'a b@example.org'`, 255 Zeichen.
- `verein.spec.ts`: `pruefeNeuenSlug('demo')` → reserviert; `pruefeNeuenSlug('glonntal')` → ok; `pruefeSlug('demo')` bleibt ok. `slugVorschlag`: `'Jungfischer Glonntal'` → `'jungfischer-glonntal'`; `'Jungfischer Über-Österreich!'` → `'jungfischer-ueber-oesterreich'`; `'Straße & Söhne'` → `'strasse-soehne'`; `'Café Élan'` → `'cafe-elan'`; `'ab'` → `''`; `'Admin'` → `''`; `'Demo'` → `''`; ein 40-Zeichen-Name → höchstens 30 Zeichen, endet nicht auf `-`. `pruefeFarbe`: `'#0f766e'` ja; `'#0F766E'`, `'0f766e'`, `'#0f766'` nein; `normalisiereFarbe(' #0F766E ')` → `'#0f766e'`. `pruefeAnzeigename`: `''`, `'   '`, 25 Zeichen nein; `'Jungfischer Glonntal'` ja. `pruefeVereinsname('Glonntal Fischereiverein 1889 e.V. Petershausen')` ja.
- `einladung.spec.ts`: `einladungsAblauf('EINLADUNG', new Date('2026-10-13T10:00:00Z'))` → `2026-10-27T10:00:00Z`; `'RESET'` → `2026-10-13T11:00:00Z`.

- [ ] **Step 2: Rot sehen** — Run: `pnpm nx test domain --skip-nx-cache` · Expected: FAIL (Module fehlen).
- [ ] **Step 3: Umsetzen, Exporte in `index.ts`, `demo.ts` umstellen**
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run-many -t test typecheck -p domain cli --skip-nx-cache` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Regeln fuer Passwort, Benutzername, E-Mail, neuen Slug, Farbe und Einladungsdauer"`

---

### Task 3: `libs/auth` — WebAuthn und Zwischenmarke, `BASIS_URL` als reiner Ursprung

**Files:**

- Create: `libs/auth/src/lib/webauthn.ts`, `libs/auth/src/lib/webauthn.spec.ts`, `libs/auth/src/lib/zwischenmarke.ts`, `libs/auth/src/lib/zwischenmarke.spec.ts`
- Modify: `libs/auth/src/index.ts` (Kopfkommentar: WebAuthn ist jetzt da, Challenges speichert der Server), `libs/auth/src/lib/env-check.ts`, `libs/auth/src/lib/env-check.spec.ts`, `libs/auth/src/lib/cookies.ts`

**Interfaces:**

- Produces (aus `../hwyd/libs/auth/src/lib/webauthn.ts`, **ohne** `storeChallenge`/`takeChallenge` und ohne Prisma): `RP_NAME = 'JuFi App'`, `WEBAUTHN_CHALLENGE_TTL_MS`, `RelyingParty`, `resolveRelyingParty`, `passkeyLabel`, `StoredPasskey`, `encodePublicKey`, `decodePublicKey`, `verifyRegistration`, `authenticationOptions`, `verifyAuthentication`, `ChallengePurpose`; geändert: `registrationOptions({ rp, user: { id: string; name: string; displayName: string }, existing })` (Name und Anzeigename getrennt, Spec 4.2).
- Produces: `challengeAusAntwort(antwort: { response: { clientDataJSON: string } }): string | undefined` — dekodiert `clientDataJSON` (base64url → JSON) und liefert `challenge`; alles Kaputte → `undefined`.
- Produces: `ZWISCHENMARKE_GUELTIG_MS = 5 * 60 * 1000`; `signiereZwischenmarke(id: string, geheimnis: string, jetztMs: number): string` und `pruefeZwischenmarke(marke: string, geheimnis: string, jetztMs: number): string | undefined` — Format und HMAC wie `signChallenge`/`verifyChallenge` in `../hwyd/apps/hwyd/src/server/routes/auth.ts`, aber Geheimnis und Zeit als Parameter.
- Produces: `ADMIN_SITZUNG_SEKUNDEN = 12 * 60 * 60` und `ADMIN_COOKIE_PFAD = '/admin/'` in `cookies.ts`.
- Changes: `checkSecrets` verlangt für `BASIS_URL` einen reinen Ursprung: `new URL(v).origin === v`, sonst `'muss ein reiner Ursprung sein (Schema, Host, Port, ohne Pfad und ohne Schrägstrich am Ende)'`; die bisherige Schrägstrich-Prüfung geht darin auf (Pflicht aus Etappe 1 für Etappe 3, vorgezogen, weil die Origin-Prüfung in Task 4 diesen Wert vergleicht).

- [ ] **Step 1: Tests schreiben** — `webauthn.spec.ts` aus `../hwyd/libs/auth/src/lib/webauthn.spec.ts` übernehmen und anpassen (RP-Name, getrennter `displayName`: `registrationOptions(…).user.displayName === 'florian · JuFi-Admin'` bei entsprechender Eingabe); dazu `challengeAusAntwort` liest die Challenge aus einem selbst gebauten `clientDataJSON` und liefert `undefined` für `'%%%'` und für JSON ohne `challenge`. `zwischenmarke.spec.ts`: Rundreise liefert die ID; falsches Geheimnis, verändertes Zeichen, Ablauf (`jetztMs + ZWISCHENMARKE_GUELTIG_MS`) und falsche Teilezahl → `undefined`. `env-check.spec.ts`: `'http://localhost:4200'` ok; `'https://test.jufi-app.de/'`, `'https://test.jufi-app.de/app'`, `'https://test.jufi-app.de?x=1'` beanstandet.
- [ ] **Step 2: Rot sehen** — Run: `pnpm nx test auth --skip-nx-cache` · Expected: FAIL.
- [ ] **Step 3: Umsetzen**
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run-many -t test typecheck -p auth --skip-nx-cache` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "libs/auth: WebAuthn aus hwyd ohne Datenbank, Zwischenmarke, BASIS_URL als reiner Ursprung"`

---

### Task 4: Server-Grundlagen für den Admin — Umgebung, Origin, Admin-Sitzung, Admin-Router

**Files:**

- Create: `apps/jufi/src/server/umgebung.ts`, `apps/jufi/src/server/ursprung.ts`, `apps/jufi/src/server/admin/sitzung.ts`, `apps/jufi/src/server/admin/api.ts`, `apps/jufi/src/server/admin/test-admin.ts`
- Modify: `apps/jufi/src/server/app.ts`, `apps/jufi/src/server.ts`, `apps/jufi/src/server/verein.ts` (`Router({ caseSensitive: true })`), `apps/jufi/src/server/test-setup.ts`, `apps/jufi/src/server/test-umgebung.ts` (setzt `TOTP_ENC_KEY` und `SESSION_SECRET` auf feste Testwerte), alle bestehenden `*.spec.ts`, die `createApp` aufrufen; `.env.example` und `README.md` (Geheimnisse braucht jetzt auch `pnpm run dev`)
- Test: `apps/jufi/src/server/ursprung.spec.ts`, `apps/jufi/src/server/admin/sitzung.spec.ts`, `apps/jufi/src/server/admin/schutz.spec.ts`

**Interfaces:**

- Produces: `interface Umgebung { basisUrl: string; sitzungsGeheimnis: string; webauthnRpId?: string; webauthnOrigin?: string }`; `umgebungAusEnv(env: Record<string, string | undefined>): Umgebung` ruft `assertSecrets(env)` und baut das Objekt (leere WebAuthn-Werte → `undefined`).
- Produces: `AppDeps` = `{ prisma; version; umgebung: Umgebung; jetzt?: () => Date; anmeldeVersuche?: AttemptTracker; webauthn?: WebauthnPruefer }` mit `WebauthnPruefer = { verifyRegistration: typeof verifyRegistration; verifyAuthentication: typeof verifyAuthentication }`; `createApp` setzt Standardwerte (`() => new Date()`, neuer `AttemptTracker`, die echten Funktionen aus `@jufi/auth`).
- Produces: `pruefeUrsprung(erlaubt: string): RequestHandler` — App-weit vor allen Routen.
- Produces (`admin/sitzung.ts`): `legeAdminSitzungAn(prisma, adminId: string, jetzt: Date, userAgent?: string): Promise<string>` (liefert das Token); `adminAusSitzung(deps: AppDeps): RequestHandler` (liest `jufi_admin`, sucht `AdminSession` per `hashToken`, abgelaufen → Zeile löschen und wie ohne Sitzung; setzt `res.locals.admin = { id, benutzername }` und `res.locals.adminSitzungId`); `brauchtAdmin: RequestHandler` (401 `{ fehler: 'nicht angemeldet' }`); `adminKontext(res): { admin: { id: string; benutzername: string }; sitzungId: string }` (wirft ohne Sitzung, wie `vereinsKontext`); `setzeAdminCookie(req, res, token)`, `loescheAdminCookie(req, res)`.
- Produces (`admin/api.ts`): `adminApi(deps: AppDeps): Router` (`caseSensitive: true`; alle Admin-Endpunkte **direkt** auf diesem Router, geschützte mit `brauchtAdmin` als erstem Handler der Route); `adminRouten(router: Router): { methode: string; pfad: string }[]` nach dem Muster von `vereinsRouten`; `OEFFENTLICHE_ADMIN_ROUTEN: readonly string[]` (Einträge `'POST /anmelden'` usw.).
- Produces in dieser Task: `GET /ich` → `{ benutzername, totpAktiv: boolean, passkeys: number, wiederherstellungscodesUebrig: number }`; `POST /abmelden` → 204, Sitzung gelöscht, Cookie gelöscht.
- Produces (`test-admin.ts`): `meldeAdminAn(prisma, jetzt?: Date): Promise<{ admin: PlattformAdmin; cookie: string }>` (legt einen Admin mit eindeutigem Namen und eine Sitzung an). `test-setup.ts`: `TEST_UMGEBUNG: Umgebung` (`basisUrl: 'http://jufi.test'`) und `sende(url: string, pfad: string, optionen?: { methode?: string; body?: unknown; cookie?: string; kopf?: Record<string, string> }): Promise<Response>`, das bei schreibenden Methoden `Origin: TEST_UMGEBUNG.basisUrl` und JSON setzt.

Einbindung in `createApp`, in dieser Reihenfolge: `app.set('case sensitive routing', true)` und `app.set('trust proxy', 1)` (statt `true`; Kommentar: genau ein Proxy davor, Traefik — sonst bestimmt ein gefälschtes `X-Forwarded-For` die IP und damit den Backoff-Schlüssel), Sicherheits-Header, JSON-Parser, `pruefeUrsprung(new URL(umgebung.basisUrl).origin)`, `/healthz`, dann `app.use('/admin/api/v1', adminAusSitzung(deps), adminApi(deps), nichtGefunden)` **vor** der Vereins-API.

`server.ts`: `const prisma = createPrismaClientFromEnv()` zuerst (lädt `.env`), dann `umgebungAusEnv(process.env)` in einem `try`, das bei Fehler die Meldung ausgibt und mit 1 endet — auch unter `pnpm run dev`; der bisherige `assertSecrets`-Block entfällt. `.env.example`/`README.md`: die Sätze „`pnpm run dev` prüft sie noch nicht" ersetzen.

- [ ] **Step 1: Tests schreiben**

- `ursprung.spec.ts`: `POST` ohne `Origin` → 403 `{ fehler: 'Ursprung nicht erlaubt' }`; mit `Origin: http://boese.test` → 403; mit `Origin: http://jufi.test` → nicht 403 (z. B. 401 auf `/admin/api/v1/abmelden`); `GET` ohne `Origin` → nicht 403.
- `sitzung.spec.ts` (mit `jetzt` als Abhängigkeit): `GET /ich mit Sitzung liefert den Benutzernamen`; `ohne Cookie 401`; `Sitzung nach 12 Stunden abgelaufen und geloescht` (Review Focus 4: Sitzung bei `t0`, Anfrage bei `t0 + 12 h` → 401, `adminSession.count` 0); `Nutzung verlaengert nicht` (Anfrage bei `t0 + 11 h`, danach `ablauf` unverändert); `Abmelden loescht die Sitzung und das Cookie` (`Set-Cookie` enthält `jufi_admin=;`, `Path=/admin/`, `Max-Age=0`); `Cookie traegt Secure nur ueber https` (eine Anfrage an einen öffentlichen Endpunkt, der ein Cookie setzt, gibt es erst in Task 5 — hier stattdessen: `setzeAdminCookie` mit `X-Forwarded-Proto: https` über eine kleine Express-Testapp prüfen, `Path=/admin/`, `Max-Age=43200`, `HttpOnly`, `SameSite=Lax`, `Secure` genau bei https); `Vereins-Cookie oeffnet den Admin nicht` (`Cookie: jufi_sitzung=<Token einer AdminSession>` → 401); `/ADMIN/api/v1/ich ist nicht der Admin` → 404.
- `schutz.spec.ts`: `jede Admin-Route ist oeffentlich oder geschuetzt eingetragen` (Menge aus `adminRouten(adminApi(deps))` = `OEFFENTLICHE_ADMIN_ROUTEN` ∪ `GESCHUETZT`, wobei `GESCHUETZT` eine Liste im Test ist — kommt eine Route hinzu, scheitert der Test, bis sie eingetragen ist); `it.each(GESCHUETZT)('%s ohne Sitzung ist 401')` (Pfadparameter wie `:id` durch eine erfundene ID ersetzen).

- [ ] **Step 2: Rot sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache` · Expected: FAIL.
- [ ] **Step 3: Umsetzen; bestehende Tests auf `umgebung: TEST_UMGEBUNG` umstellen**
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache && pnpm nx typecheck jufi && pnpm nx build jufi` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Admin-Sitzung, Admin-Router, Origin-Pruefung, trust proxy 1, Umgebung beim Start geprueft"`

---

### Task 5: Einrichtung und Anmeldung mit Passwort und TOTP

**Files:**

- Create: `apps/jufi/src/server/admin/anmeldung.ts`
- Modify: `apps/jufi/src/server/admin/api.ts`
- Test: `apps/jufi/src/server/admin/anmeldung.spec.ts`

**Interfaces:**

- Consumes: `pruefePasswort`, `PASSWORT_HINWEIS`, `normalisiereBenutzername` (Task 2); `signiereZwischenmarke`/`pruefeZwischenmarke` (Task 3); Sitzung und Cookie (Task 4); `hashPassword`, `verifyPassword`, `verifyTotp`, `decryptSecret`, `encryptSecret`, `generateTotpSecret`, `totpUri`, `generateRecoveryCodes`, `hashRecoveryCode`, `hashToken` aus `@jufi/auth`.
- Produces (öffentlich):
  - `POST /einrichtung/pruefen` `{ token }` → 200 `{ benutzername }` | 404 `{ fehler: 'Dieser Link gilt nicht mehr' }` (abgelaufen, eingelöst, unbekannt). Verbraucht nichts.
  - `POST /einrichtung/abschliessen` `{ token, passwort }` → 200 `{ benutzername }` + Admin-Cookie | 400 `{ fehler: PASSWORT_HINWEIS[grund] }` | 404 wie oben. Eine Transaktion: `adminEinrichtung.updateMany({ where: { tokenHash, eingeloestAm: null, ablauf: { gt: jetzt } }, data: { eingeloestAm: jetzt } })` muss genau 1 zählen, sonst 404; dann Passwort-Hash setzen, Sitzung anlegen. Das Passwort wird vor der Transaktion gegen die Regel geprüft.
  - `POST /anmelden` `{ benutzername, passwort }` → `{ schritt: 'fertig' }` + Cookie (ohne TOTP) | `{ schritt: 'totp', zwischenmarke }` (mit aktivem TOTP) | 401 | 429. Benutzername wird normalisiert. Unbekannter Name oder Admin ohne Passwort: trotzdem gegen einen Platzhalter-Hash prüfen (wie hwyd), damit die Antwortzeit nichts verrät.
  - `POST /anmelden/totp` `{ zwischenmarke, code?, wiederherstellungscode? }` → `{ schritt: 'fertig', wiederherstellungscodesUebrig }` + Cookie | 401 `{ fehler: 'Anmeldung abgelaufen, bitte neu beginnen' }` (Marke ungültig/abgelaufen) | 401 `Anmeldung fehlgeschlagen` | 429. Ein Wiederherstellungscode wird beim Treffer sofort als verwendet markiert.
- Produces (geschützt):
  - `POST /konto/totp/start` → 409 `{ fehler: 'TOTP ist schon eingerichtet' }` | 200 `{ zwischenmarke, geheimnis, uri, wiederherstellungscodes }` — Zwischenmarke ist `encryptSecret(JSON)` mit `{ adminId, geheimnis, hashes, ablaufMs }` wie `../hwyd/apps/hwyd/src/server/routes/totp.ts`; `uri = totpUri(geheimnis, '<benutzername> (Admin)')`.
  - `POST /konto/totp/bestaetigen` `{ zwischenmarke, code }` → 200 `{ ok: true }` | 400 `{ fehler: 'Einrichtung abgelaufen, bitte neu beginnen' }` (auch: Marke eines anderen Admins) | 401 `{ fehler: 'Code stimmt nicht' }` | 429. Speichert verschlüsseltes Geheimnis, `totpAktivAm`, ersetzt alle Wiederherstellungscodes — in einer Transaktion.

- [ ] **Step 1: Tests schreiben** (Admin und Einrichtung direkt per Prisma anlegen; TOTP-Codes mit `generate` aus `otplib` erzeugen)

- `Einrichtungslink pruefen nennt den Benutzernamen und verbraucht nichts`
- `abgelaufener, eingeloester und unbekannter Link sind 404 mit "Dieser Link gilt nicht mehr"`
- `Einrichtung abschliessen setzt das Passwort, meldet an und verbraucht den Link`
- `zu kurzes und zu verbreitetes Passwort werden mit dem Hinweis abgelehnt, der Link bleibt gueltig`
- `Doppelklick: zwei gleichzeitige Abschluesse, genau einer gelingt` (Review Focus 1: `Promise.all` zweier Anfragen → Status `[200, 404]` in beliebiger Reihenfolge, `adminSession.count` 1)
- `Anmeldung ohne TOTP liefert schritt fertig und das Cookie`; `Benutzername in Grossbuchstaben und mit Leerzeichen wird gefunden`
- `falsches Passwort und unbekannter Name antworten gleich` (Status und Body identisch)
- `Anmeldung mit TOTP verlangt den Code` → `schritt: 'totp'`, kein Cookie; mit richtigem Code → Cookie; falscher Code → 401; abgelaufene Marke (`jetzt` + 6 min) → `Anmeldung abgelaufen, bitte neu beginnen`
- `Wiederherstellungscode gilt genau einmal`
- `vierter Fehlversuch in Folge ist 429 mit wartenSekunden`
- `Backoff je IP laesst sich nicht mit X-Forwarded-For umgehen` (vier Fehlversuche mit wechselnden Namen und `X-Forwarded-For: <zufällig>, 10.0.0.1` → der vierte ist 429)
- `TOTP einrichten: start, falscher Code 401, richtiger Code aktiviert und ersetzt die Codes`; `start bei aktivem TOTP ist 409`; `Marke eines anderen Admins wird abgelehnt`

- [ ] **Step 2: Rot sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache` · Expected: FAIL (404 auf die neuen Pfade; `schutz.spec.ts` meldet neue, nicht eingetragene Routen erst nach dem Umsetzen).
- [ ] **Step 3: Umsetzen; Routen in `OEFFENTLICHE_ADMIN_ROUTEN` bzw. `GESCHUETZT` (schutz.spec.ts) eintragen**
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache && pnpm nx typecheck jufi` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Admin: Einrichtung per Einmal-Link, Anmeldung mit Passwort und TOTP, TOTP einrichten"`

---

### Task 6: Passkeys für den Admin

**Files:**

- Create: `apps/jufi/src/server/admin/passkeys.ts`
- Modify: `apps/jufi/src/server/admin/api.ts`
- Test: `apps/jufi/src/server/admin/passkeys.spec.ts`

**Interfaces:**

- Consumes: `registrationOptions`, `authenticationOptions`, `resolveRelyingParty`, `passkeyLabel`, `challengeAusAntwort`, `WEBAUTHN_CHALLENGE_TTL_MS` (Task 3); `deps.webauthn` (Task 4).
- Produces: `speichereAdminChallenge(prisma, { challenge, purpose, adminId: string | null, jetzt })` (räumt abgelaufene Challenges vorher weg) und `nimmAdminChallenge(prisma, { challenge, purpose, jetzt }): Promise<{ adminId: string | null } | undefined>` — löscht die Zeile **vor** jeder Prüfung; `undefined` bei fehlender Zeile, falschem Zweck, Ablauf **oder `vereinId` gesetzt** (eine Vereins-Challenge taugt nie für den Admin).
- Produces (öffentlich): `POST /anmelden/passkey/optionen` → Optionen (Challenge mit `vereinId` und `adminId` null, Zweck `authenticate`); `POST /anmelden/passkey` `{ antwort }` → `{ schritt: 'fertig' }` + Cookie | 401 `Anmeldung fehlgeschlagen`. Gesucht wird **nur** in `AdminPasskey` (`credentialId = antwort.id`); nach Erfolg `counter` und `lastUsedAt` setzen. Backoff je IP.
- Produces (geschützt): `POST /konto/passkey/optionen` → Optionen mit `user: { id: admin.id, name: benutzername, displayName: '<benutzername> · JuFi-Admin' }`, `existing` = eigene Passkeys, Challenge mit `adminId`; `POST /konto/passkey` `{ antwort }` → 201 `{ label }` | 400 `{ fehler: 'Passkey konnte nicht eingerichtet werden' }` (Challenge fehlt, gehört einem anderen Admin, Prüfung scheitert).
- RP aus `resolveRelyingParty({ host: req.headers.host, secure: req.secure, rpId: umgebung.webauthnRpId, origin: umgebung.webauthnOrigin })`.

- [ ] **Step 1: Tests schreiben** (`deps.webauthn` durch Attrappen ersetzen, die eine feste Antwort liefern; die echte Kryptografie ist in `libs/auth` und von `@simplewebauthn` geprüft, der Weg im Browser wird bei der Abnahme mit Touch ID gezeigt)

- `Anmeldeoptionen legen eine Admin-Challenge an` (Zeile mit `vereinId` und `adminId` null, Zweck `authenticate`)
- `Passkey-Anmeldung mit bekanntem Admin-Passkey meldet an und zaehlt den Zaehler hoch`
- `Vereins-Passkey wird nicht erkannt` (dieselbe `credentialId` nur in `Passkey` eines erfundenen Vereins → 401, Prüfer nicht aufgerufen)
- `Challenge eines Vereins gilt nicht fuer den Admin` (Challenge-Zeile mit `vereinId` → 401)
- `Challenge gilt nur einmal` (zweiter Versuch mit derselben Antwort → 401)
- `Passkey hinzufuegen speichert ihn mit Geraetenamen` (`User-Agent` iPhone → Label `iPhone`)
- `Registrierung mit der Challenge eines anderen Admins scheitert`

- [ ] **Step 2: Rot sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache` · Expected: FAIL.
- [ ] **Step 3: Umsetzen; Routen in die Listen eintragen**
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache && pnpm nx typecheck jufi` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Admin: Passkeys anmelden und hinzufuegen, nur aus AdminPasskey"`

---

### Task 7: Kommandozeile — Admin anlegen und zurücksetzen, Verein löschen

**Files:**

- Create: `apps/cli/src/admin.ts`, `apps/cli/src/verein-loeschen.ts`, `apps/cli/src/admin.spec.ts`, `apps/cli/src/verein-loeschen.spec.ts`
- Modify: `apps/cli/src/main.ts`, `apps/cli/src/main.spec.ts`, `README.md` (Abschnitt „Admin anlegen"), `CLAUDE.md` („Stand": Admin lokal anlegen)

**Interfaces:**

- Consumes: `normalisiereBenutzername`, `pruefeBenutzername`, `EINRICHTUNG_GUELTIG_MS` (Task 2); `generateLinkToken`, `hashToken`.
- Produces: `Abhaengigkeiten` bekommt `basisUrl: () => string` und `frage: (text: string) => Promise<string>`. In `starte()`: `basisUrl` lädt `.env` (wie `createPrismaClientFromEnv`) und wirft, wenn `BASIS_URL` fehlt oder `new URL(v).origin !== v`; `frage` über `node:readline/promises`.
- Produces: `adminAnlegen(prisma, benutzername: string, jetzt: Date): Promise<string>` (Token) — wirft `CliFehler('Admin <name> gibt es schon.')`; `adminZuruecksetzen(prisma, benutzername, jetzt): Promise<string>` — wirft `CliFehler('Admin <name> gibt es nicht.')`; löscht in einer Transaktion Sitzungen, Passkeys, Wiederherstellungscodes, Einrichtungen und Challenges des Admins, leert `passwortHash`, `totpGeheimnis`, `totpAktivAm`, legt eine neue Einrichtung an.
- Produces: `vereinLoeschen(prisma, slug: string, bestaetigung: string): Promise<'geloescht' | 'abgebrochen'>`; `vereinZumLoeschen(prisma, slug): Promise<{ anzeigename: string; personen: number } | null>`.
- Produces: `class CliFehler extends Error` — erwartete Verweigerung, Exit-Code 1 mit Meldung (wie `DemoGeschuetztFehler`, der davon erben darf).
- Befehle und Ausgaben, wörtlich:
  - `admin anlegen <name>` → `Admin <name> angelegt. Einrichtungslink (1 Stunde gültig, nur einmal):` dann `<BASIS_URL>/admin/einrichten#<token>`; ungültiger Name → `Benutzername: 3 bis 30 Zeichen, Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.` (Exit 1).
  - `admin zuruecksetzen <name>` → `Admin <name> zurückgesetzt: Passwort, Passkeys, TOTP und Sitzungen gelöscht. Neuer Einrichtungslink (1 Stunde gültig, nur einmal):` dann der Link.
  - `verein loeschen <slug>` → fragt `Verein „<anzeigename>" (<slug>) mit <n> Personen endgültig löschen? Zur Bestätigung den Slug eintippen: `; Antwort genau der Slug → `Verein <slug> gelöscht.` (Exit 0), sonst `Abgebrochen, nichts gelöscht.` (Exit 1); unbekannt → `Verein <slug> gibt es nicht.` (Exit 1). Das Protokoll bleibt (kein Fremdschlüssel).
  - Hilfe um die drei Befehle ergänzt; fehlendes Argument → Hilfe-Hinweis, Exit 2.

- [ ] **Step 1: Tests schreiben** — `admin anlegen gibt einen Link aus, dessen Token zur gespeicherten Einrichtung passt` (`hashToken` des Tokens hinter `#` = `tokenHash`, `ablauf` = `jetzt + 1 h`); `doppelter Name ist Exit 1`; `Name wird normalisiert` (`' Florian '` → `florian`); `ungueltiger Name ist Exit 1`; `zuruecksetzen loescht Zugangsdaten und Sitzungen und gibt einen neuen Link aus` (vorher Passwort, TOTP, Passkey, Sitzung, offene Einrichtung anlegen; danach alle 0 bzw. leer, eine neue Einrichtung); `zuruecksetzen unbekannt ist Exit 1`; `verein loeschen mit richtiger Bestaetigung loescht alles des Vereins und laesst andere stehen`; `falsche Bestaetigung loescht nichts`; `Protokolleintraege ueberleben das Loeschen`; `ohne BASIS_URL bricht admin anlegen mit Meldung ab und legt nichts an`.
- [ ] **Step 2: Rot sehen** — Run: `pnpm nx test cli --skip-nx-cache` · Expected: FAIL.
- [ ] **Step 3: Umsetzen, README und CLAUDE.md ergänzen** (README: `pnpm run cli admin anlegen <name>`, Link im Browser öffnen, Passwort setzen; Hinweis, dass der Link nur unter der `BASIS_URL` funktioniert)
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run-many -t test typecheck -p cli --skip-nx-cache` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "CLI: admin anlegen und zuruecksetzen, verein loeschen mit Bestaetigung"`

---

### Task 8: Vereine anlegen und ansehen — Datenschicht, Einladung, Protokoll, Admin-Test

**Files:**

- Create: `apps/jufi/src/server/einladung.ts`, `apps/jufi/src/server/admin/daten.ts`, `apps/jufi/src/server/admin/vereine.ts`
- Modify: `apps/jufi/src/server/admin/api.ts`
- Test: `apps/jufi/src/server/einladung.spec.ts`, `apps/jufi/src/server/admin/vereine.spec.ts`, `apps/jufi/src/server/admin/datenschutz.spec.ts`

**Interfaces:**

- Consumes: Regeln aus Task 2; `Recht` aus `@jufi/db`.
- Produces (`einladung.ts`): `erzeugeEinladung(tx: Prisma.TransactionClient, e: { vereinId: string; personId: string; art: EinladungArt; erstelltVonPersonId: string | null; jetzt: Date }): Promise<string>` (löscht offene derselben Art und Person, legt die neue mit `einladungsAblauf` an, liefert das Token); `einladungsLink(basisUrl, slug, token)` → `` `${basisUrl}/${slug}/einladung#${token}` ``; `leitungsEinladungsText({ vorname, anzeigename, link })` →
  `Hallo <vorname>, du bist als Leitung von „<anzeigename>" in die JuFi App eingeladen. Richte hier deinen Zugang ein – der Link gilt 14 Tage und nur für dich:\n<link>`
- Produces (`admin/daten.ts`): `adminDaten(prisma: PrismaClient)` mit
  - `vereinsliste(jetzt): Promise<VereinZeile[]>`, `VereinZeile = { id, slug, anzeigename, status, kennzahlen: Kennzahlen }`, sortiert nach Anzeigename;
  - `Kennzahlen = { jungfischer: number; erwachsene: number; zugaenge: number; offeneEinladungen: number; letzteAnmeldung: string | null }` — Personen ohne `entferntAm`; offene Einladungen: nicht eingelöst, `ablauf > jetzt`; `letzteAnmeldung` = jüngstes `Session.angelegtAm` als `JJJJ-MM-TT` in Europe/Berlin;
  - `vereinsdetails(id, jetzt): Promise<VereinDetails | null>`, `VereinDetails = { id, slug, name, anzeigename, farbe, status, angelegtAm: string, kennzahlen, ansprechpartner: { personId, vorname, nachname, email: string | null }[], ersteLeitung: { personId, vorname, nachname } | null, slugAenderbar: boolean, protokoll: { zeitpunkt: string; aktion: AdminAktion; admin: string }[] }` — Ansprechpartner: `JUGENDLEITER_RECHTE` in `rechte`, nicht entfernt; `slugAenderbar` und `ersteLeitung` nur solange der Verein **keinen `Zugang`** hat (der entsteht erst beim Einlösen); `ersteLeitung` = Person der jüngsten Einladung der Art `EINLADUNG` mit `erstelltVonPersonId` null; Protokoll die letzten 20, neueste zuerst;
  - `legeVereinAn(eingabe: NeuerVerein, adminId, jetzt): Promise<{ id: string; slug: string; leitung: { vorname: string }; anzeigename: string; token: string }>` — eine Transaktion: Verein, Person (`ERWACHSENER`, alle Werte aus `Recht`, E-Mail normalisiert), Einladung, Protokoll `VEREIN_ANGELEGT` mit `betroffenePersonId`.
- Produces (Routen, geschützt):
  - `GET /vereine` → `{ vereine: VereinZeile[] }`
  - `POST /vereine` `{ name, anzeigename, slug, farbe, leitung: { vorname, nachname, email } }` → 201 `{ id, slug, einladung: { link, text } }` | 400 `{ fehler, feld }` (`feld` ∈ `name`, `anzeigename`, `slug`, `farbe`, `vorname`, `nachname`, `email`; Texte: `SLUG_HINWEIS[grund]`, `'Höchstens 24 Zeichen, nicht leer'`, `'Bitte den offiziellen Namen angeben'`, `'Farbe als #rrggbb'`, `'Bitte ausfüllen'`, `'Keine gültige E-Mail-Adresse'`) | 409 `{ fehler: 'Dieser Slug ist vergeben', feld: 'slug' }` (Prisma `P2002` auf `slug` abfangen, kein 500)
  - `GET /vereine/:id` → `VereinDetails` | 404 `{ fehler: 'nicht gefunden' }`

Nur `admin/daten.ts` liest Vereinstabellen; `admin/vereine.ts` bekommt `adminDaten(...)`, nicht den `PrismaClient`.

- [ ] **Step 1: Tests schreiben**

- `einladung.spec.ts`: `neue Einladung macht die offene alte derselben Art ungueltig` (alte Zeile weg, eingelöste bleibt); `RESET laesst EINLADUNG stehen`; `Link und Text` (Token hinter `#`, Text wörtlich wie oben).
- `vereine.spec.ts`:
  - `Verein anlegen legt Verein, erste Leitung mit allen Rechten, Einladung und Protokoll an` (Rechte = alle Werte von `Recht`; `einladung.link` beginnt mit `http://jufi.test/glonntal-test/einladung#`; `hashToken(token)` steht in `Einladung`; Protokoll `VEREIN_ANGELEGT` mit `vereinSlug` und `betroffenePersonId`)
  - `E-Mail wird normalisiert gespeichert` (Review Focus 3: `'  Thomas@Example.ORG '` → `thomas@example.org`)
  - `Slug demo, reservierter und kaputter Slug werden mit feld slug abgelehnt`; `zu langer Anzeigename`, `Farbe #FFF`, `E-Mail ohne @` → 400 mit passendem `feld`
  - `gleichzeitig zweimal derselbe Slug: einmal 201, einmal 409` (Review Focus 2, `Promise.all`)
  - `Vereinsliste mit Kennzahlen` (erfundener Verein mit 2 Jungfischern, 1 entferntem Jungfischer, 2 Erwachsenen, 1 Zugang, 1 offener und 1 abgelaufener Einladung, Sitzung am `2026-10-12T23:30:00Z` → `{ jungfischer: 2, erwachsene: 2, zugaenge: 1, offeneEinladungen: 1, letzteAnmeldung: '2026-10-13' }` — Berlin, nicht UTC)
  - `Vereinsdetails nennen nur Ansprechpartner`; `unbekannte ID ist 404`
- `datenschutz.spec.ts` (Spec 9, Admin-Test): ein erfundener Verein mit den Personen des Demo-Vereins (Leitung Thomas Beispiel mit allen Rechten; Katrin Muster ohne `JUGENDLEITER_RECHTE`; Sandra und Hans Huber ohne Rechte; Jungfischer Lena Huber, Max Huber, Jonas Weber — der Demo-Code liegt in `apps/cli` und ist hier nicht importierbar, daher nachgebaut) → die Antworten von `GET /vereine` und `GET /vereine/:id` enthalten keinen der Namen `Katrin`, `Muster`, `Sandra`, `Hans`, `Huber`, `Lena`, `Max`, `Jonas`, `Weber`, aber `Thomas`. Task 9 ergänzt die Antworten seiner Endpunkte in diesem Test.

- [ ] **Step 2: Rot sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache` · Expected: FAIL.
- [ ] **Step 3: Umsetzen; Routen in `GESCHUETZT` eintragen**
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache && pnpm nx typecheck jufi` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Admin: Vereine anlegen und ansehen, Einladung der ersten Leitung, Protokoll, Admin-Datenschutztest"`

---

### Task 9: Sperren, Slug korrigieren, Einladung erneuern, Notfall-Link

**Files:**

- Modify: `apps/jufi/src/server/admin/daten.ts`, `apps/jufi/src/server/admin/vereine.ts`, `apps/jufi/src/server/admin/datenschutz.spec.ts`
- Test: `apps/jufi/src/server/admin/vereinsaktionen.spec.ts`

**Interfaces:**

- Produces (`adminDaten`): `setzeStatus(id, status: VereinStatus, adminId, jetzt): Promise<'geaendert' | 'unveraendert' | null>`; `korrigiereSlug(id, slug, adminId, jetzt): Promise<{ token: string; vorname: string; anzeigename: string } | 'fest' | 'vergeben' | null>`; `erneuereErsteEinladung(id, adminId, jetzt): Promise<{ token; vorname; anzeigename; slug } | 'angenommen' | null>`; `notfallLink(id, personId, adminId, jetzt): Promise<{ token; vorname; anzeigename; slug } | null>`. Jede Variante in einer Transaktion mit ihrem Protokolleintrag; `null` = Verein (bzw. Person) nicht gefunden.
- Produces (Routen, geschützt):
  - `POST /vereine/:id/sperren` → `{ status: 'GESPERRT' }`; `POST /vereine/:id/entsperren` → `{ status: 'AKTIV' }`; ohne Änderung kein Protokolleintrag. Sitzungen des Vereins bleiben (Spec 7.3).
  - `POST /vereine/:id/slug` `{ slug }` → `{ slug, einladung: { link, text } }` — die alte Einladung zeigte auf den alten Slug, deshalb erneuert die Korrektur sie gleich mit; Protokoll `SLUG_KORRIGIERT` (mit dem neuen Slug) und `ERSTE_EINLADUNG_ERNEUERT` | 400 `{ fehler: SLUG_HINWEIS[grund], feld: 'slug' }` (über `pruefeNeuenSlug`) | 409 `{ fehler: 'Der Slug ist fest, seit die erste Einladung angenommen wurde' }` | 409 `{ fehler: 'Dieser Slug ist vergeben', feld: 'slug' }` | 404.
  - `POST /vereine/:id/einladung-erneuern` → `{ einladung: { link, text } }`, Protokoll `ERSTE_EINLADUNG_ERNEUERT` | 409 `{ fehler: 'Die erste Einladung ist schon angenommen' }` | 404.
  - `POST /vereine/:id/notfall-link` `{ personId }` → `{ einladung: { link, text } }`, Art `EINLADUNG`, Protokoll `NOTFALL_LINK` mit `betroffenePersonId` | 404, wenn die Person kein Ansprechpartner **dieses** Vereins ist (Spec 7.3: für niemanden sonst).

- [ ] **Step 1: Tests schreiben**

- `sperren macht die Vereins-API 404 und entsperren wieder 200`; `zweimal sperren schreibt einen Protokolleintrag`; `Sitzungen bleiben beim Sperren`
- `Slug korrigieren vor der Annahme: neuer Slug, neue Einladung mit neuem Slug, alte ungueltig, zwei Protokolleintraege`
- `Slug korrigieren nach der Annahme ist 409, nichts geaendert, kein Protokoll` (Review Focus 5: Verein mit einem `Zugang`)
- `Slug demo und vergebener Slug werden abgelehnt`
- `Einladung erneuern ersetzt die offene; nach der Annahme 409`
- `Notfall-Link fuer einen Ansprechpartner`; `Notfall-Link fuer Kind, Elternteil ohne Rechte, entfernte Leitung und Leitung eines fremden Vereins ist 404, keine Einladung, kein Protokoll` (Review Focus 5)
- `datenschutz.spec.ts` ergänzt: Antworten von Sperren, Entsperren, Notfall-Link und Einladung erneuern enthalten keinen der Namen außer dem der Leitung.

- [ ] **Step 2: Rot sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache` · Expected: FAIL.
- [ ] **Step 3: Umsetzen; Routen in `GESCHUETZT` eintragen**
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run jufi:test-server --skip-nx-cache && pnpm nx typecheck jufi` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Admin: sperren, Slug korrigieren, erste Einladung erneuern, Notfall-Link"`

---

### Task 10: Oberfläche — Anmelden, Einrichten, Konto

**Files:**

- Create: `apps/jufi/src/app/admin/admin-api.ts`, `admin.routes.ts`, `admin-rahmen.ts`, `anmelden.ts`, `einrichten.ts`, `konto.ts`, `totp-einrichtung.ts`, `passkey-browser.ts` und Specs zu `anmelden`, `einrichten`, `admin.routes` (Wächter)
- Modify: `apps/jufi/src/app/app.routes.ts`, `package.json` (`qrcode`, `@types/qrcode` — Versionen wie in `../hwyd/package.json`), `pnpm-lock.yaml`

**Interfaces:**

- Consumes: alle Admin-Endpunkte aus Tasks 4–6; `pruefePasswort`, `PASSWORT_HINWEIS` aus `@jufi/domain` (dieselbe Regel wie der Server, Spec 5.1).
- Produces: `AdminApi` (root-Service) mit einer Methode je Endpunkt, Pfade absolut (`/admin/api/v1/…`), Fehler als `AdminFehler { status: number; fehler: string; feld?: string; wartenSekunden?: number }`.
- Produces: `ADMIN_ROUTES` — `''` → `AdminRahmen` mit Wächter `adminAngemeldet` und Kindern `''` → Umleitung `vereine`, `vereine`, `vereine/neu`, `vereine/:id`, `konto`; daneben ohne Wächter `anmelden`, `einrichten`. `app.routes.ts`: `{ path: 'admin', loadChildren: … }` **vor** `':slug'` (nachgeladen, damit `qrcode` und die Admin-Seiten nicht im Startbündel der Mitglieder landen).
- Produces: `adminAngemeldet: CanActivateFn` — `GET /ich` ok → `true`, 401 → `UrlTree` `/admin/anmelden`.
- Produces: `PasskeyBrowser` mit `anmelden()` und `hinzufuegen()` über `@simplewebauthn/browser` (`startAuthentication`/`startRegistration` mit `optionsJSON`), Abbruch durch den Nutzer als eigener Ausgang ohne Fehlermeldung — Vorlage `../hwyd/apps/hwyd/src/app/core/passkeys.ts`.
- Seiten:
  - **Anmelden** (`/admin/anmelden`): Benutzername, Passwort, „Anmelden"; bei `schritt: 'totp'` ein Feld „Code aus der Authenticator-App" und der Umschalter „Wiederherstellungscode verwenden"; daneben „Mit Passkey anmelden". Fehler als Text unter dem Formular (`Anmeldung fehlgeschlagen`, bei 429 `Zu viele Versuche – bitte in <n> Sekunden erneut`). Erfolg → `/admin/vereine`.
  - **Einrichten** (`/admin/einrichten#<token>`): Token aus `location.hash`, sofort `pruefen`; ungültig → „Dieser Link gilt nicht mehr – lass dir mit `admin zuruecksetzen` einen neuen geben". Gültig: „Willkommen, <benutzername>", Passwort und Wiederholung, Regelhinweis live aus `pruefePasswort`; nach dem Abschluss Schritt TOTP („Dringend empfohlen", überspringbar) und Schritt Passkey (überspringbar), dann „Zu den Vereinen". Das Fragment wird nach dem Lesen per `history.replaceState` entfernt, damit es nicht im Verlauf liegt.
  - **Konto** (`/admin/konto`): Stand aus `GET /ich`; TOTP einrichten, wenn nicht aktiv; Passkey hinzufügen; Abmelden.
  - **TOTP-Einrichtung** (Bauteil, in Einrichten und Konto): QR-Code per `toCanvas` aus `qrcode` auf ein `<canvas>` (nicht `toDataURL`: die CSP erlaubt `img-src 'self'`, kein `data:`; Kommentar), weißer Rand auch im Dunkelmodus, darunter das Geheimnis in Vierergruppen, Codefeld, die zehn Wiederherstellungscodes mit „Kopieren" und dem Satz „Bewahre sie getrennt vom Gerät auf. Jeder gilt einmal."
  - **Rahmen**: Kopfzeile „JuFi Admin", Links „Vereine", „Konto", Knopf „Abmelden".

- [ ] **Step 1: Tests schreiben** (`HttpTestingController`, wie `verein-start.spec.ts`)

- `anmelden.spec.ts`: `ohne TOTP fuehrt die Anmeldung zu den Vereinen`; `mit TOTP erscheint das Codefeld, der Code wird mit der Zwischenmarke gesendet`; `401 zeigt Anmeldung fehlgeschlagen`; `429 nennt die Wartezeit`.
- `einrichten.spec.ts`: `liest das Token aus dem Fragment und prueft es`; `ungueltiger Link zeigt den Hinweis`; `zu kurzes Passwort sperrt den Knopf und nennt die Regel`; `nach dem Abschluss folgt der TOTP-Schritt, der sich ueberspringen laesst`.
- `admin.routes.spec.ts`: `ohne Sitzung leitet der Waechter zur Anmeldung um`; `/admin fuehrt angemeldet zu /admin/vereine`.

- [ ] **Step 2: Rot sehen** — Run: `pnpm nx test jufi --skip-nx-cache` · Expected: FAIL.
- [ ] **Step 3: Umsetzen** (Gestaltung aus `app/gestaltung/`, Tokens aus `styles.css`; Formulare mit Signalen; keine Backticks in Kommentaren der Vorlagen)
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run-many -t test typecheck -p jufi --skip-nx-cache && pnpm nx build jufi --skip-nx-cache` · Expected: PASS, Bau ohne Budget-Warnung für das Startbündel.
- [ ] **Step 5: Commit** — `git commit -m "Admin-Oberflaeche: Anmelden, Einrichten mit TOTP und Passkey, Konto"`

---

### Task 11: Oberfläche — Vereinsliste, Verein anlegen, Vereinsseite

**Files:**

- Create: `apps/jufi/src/app/admin/vereine.ts`, `verein-neu.ts`, `verein-seite.ts`, `einladung-anzeige.ts` und Specs zu den ersten drei
- Modify: `apps/jufi/src/app/admin/admin-api.ts`, `admin.routes.ts`

**Interfaces:**

- Consumes: Endpunkte aus Tasks 8 und 9; `slugVorschlag`, `pruefeNeuenSlug`, `SLUG_HINWEIS`, `pruefeAnzeigename`, `pruefeEmail`, `normalisiereEmail` aus `@jufi/domain`.
- Seiten:
  - **Vereine** (`/admin/vereine`): Tabelle Anzeigename (Link zur Vereinsseite), Slug, Status (`jf-pille`), Jungfischer, Erwachsene, Zugänge, offene Einladungen, letzte Anmeldung (Datum deutsch, `—` ohne); Knopf „Verein anlegen". Leerer Zustand: „Noch kein Verein angelegt."
  - **Verein anlegen** (`/admin/vereine/neu`): offizieller Name, Anzeigename (Zähler `n/24`), Slug (folgt `slugVorschlag(anzeigename)`, bis man ihn selbst ändert; Vorschau `<BASIS_URL-Ursprung>/<slug>/`), Farbe (`<input type="color">`, Start `#0f766e`), erste Leitung: Vorname, Nachname, E-Mail. Fehler aus `feld` am jeweiligen Feld. Nach 201: `EinladungAnzeige` statt Formular, Link zur Vereinsseite.
  - **EinladungAnzeige** (Bauteil): der fertige Text in einem Kasten, Knöpfe „Text kopieren" und „Link kopieren" (`navigator.clipboard.writeText`, danach Meldung „Kopiert"); Hinweis „Der Link gilt 14 Tage. Annehmen lässt er sich, sobald die Anmeldung fertig ist (Etappe 3)." — der letzte Satz steht nur bis Etappe 3 und hat einen Kommentar, der das sagt.
  - **Vereinsseite** (`/admin/vereine/:id`): Kopf mit Anzeigename, offiziellem Namen, Slug, Status; Kennzahlen; Ansprechpartner mit Name, E-Mail und je „Notfall-Link erzeugen" (mit Rückfrage „Neuen Einladungslink für <Vorname> erzeugen? Der Verein sieht das in seiner Verwaltung."); „Sperren"/„Entsperren" mit Rückfrage; solange `slugAenderbar`: Feld „Slug korrigieren"; solange `ersteLeitung`: „Einladung für <Vorname> erneuern"; Protokoll (Zeitpunkt deutsch, Aktion als Text, Admin). Jede Aktion zeigt danach `EinladungAnzeige` bzw. lädt die Seite neu. Rückfragen über ein eigenes kleines Dialog-Bauteil, nicht `window.confirm`.
  - Aktionen als Text: `VEREIN_ANGELEGT` „Verein angelegt", `GESPERRT` „gesperrt", `ENTSPERRT` „entsperrt", `SLUG_KORRIGIERT` „Slug korrigiert", `NOTFALL_LINK` „Notfall-Link erzeugt", `ERSTE_EINLADUNG_ERNEUERT` „Einladung der ersten Leitung erneuert".

- [ ] **Step 1: Tests schreiben**

- `vereine.spec.ts`: `zeigt je Verein eine Zeile mit Kennzahlen`; `leerer Zustand`.
- `verein-neu.spec.ts`: `Slug folgt dem Anzeigenamen, bis er von Hand geaendert wird`; `Slug demo wird schon im Formular als reserviert markiert`; `400 mit feld email zeigt den Fehler am E-Mail-Feld`; `nach dem Anlegen erscheinen Text und Kopierknoepfe`.
- `verein-seite.spec.ts`: `Slug-Feld und Erneuern nur solange nichts angenommen ist`; `Sperren fragt nach und sendet erst nach Bestaetigung`; `Notfall-Link zeigt danach den Text`.

- [ ] **Step 2: Rot sehen** — Run: `pnpm nx test jufi --skip-nx-cache` · Expected: FAIL.
- [ ] **Step 3: Umsetzen**
- [ ] **Step 4: Grün sehen** — Run: `pnpm nx run-many -t test test-server typecheck --skip-nx-cache && pnpm nx build jufi --skip-nx-cache && pnpm exec prettier --check .` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Admin-Oberflaeche: Vereinsliste, Verein anlegen, Vereinsseite mit Aktionen und Protokoll"`

---

## Abnahme durch den Eigentümer (nach dem Gesamtreview)

Lokal, nur mit erfundenen Daten:

1. `pnpm run dev`, in einem zweiten Terminal `pnpm run cli admin anlegen <name>`, Link öffnen.
2. Passwort setzen, TOTP mit der Authenticator-App einrichten, Passkey mit Touch ID hinzufügen.
3. Abmelden, mit Passkey anmelden; abmelden, mit Passwort und Code anmelden.
4. Einen erfundenen Verein anlegen, Text kopieren, Slug korrigieren, sperren (`/<slug>` zeigt „nicht gefunden"), entsperren, Notfall-Link für die Leitung; das Protokoll zeigt alles.

Vorher misst der Controller die Seiten bei 1280 × 800, hell und dunkel (`scrollWidth`, keine Überläufe).
