# TP2 Etappe 1: Gerüst — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das lauffähige Fundament der echten App: Workspace mit `apps/jufi`, `apps/cli`, `libs/domain`, `libs/db`, `libs/auth`, das vollständige Datenmodell aus Spec 3 mit Mandantenschutz in der Datenbank, `vereinDb`, Healthcheck, Vereins-Auflösung per Slug, eine erste Vereinsseite und ein Demo-Verein — lokal mit Postgres und Mailpit.

**Architecture:** Angular 22 (CSR) und Express über `@angular/ssr` in einem Deployable wie `../hwyd`. Der Express-Teil entsteht über `createApp(deps)`, damit API-Tests ihn ohne Angular gegen eine Wegwerf-Datenbank starten können. Das Datenmodell aus Spec 3 kommt komplett in dieser Etappe, damit die Mandantentrennung per zusammengesetztem Fremdschlüssel einmal und an einer Stelle bewiesen wird; spätere Etappen bauen nur noch Verhalten.

**Tech Stack:** Angular 22, Express 4, Prisma 7 mit `@prisma/adapter-pg`, Postgres 17, Nx 23, pnpm 10, Vitest 4, esbuild (CLI), `@node-rs/argon2`, `otplib`, Docker (lokal Postgres und Mailpit).

**Spec:** `docs/superpowers/specs/2026-10-12-jufi-tp2-fundament-design.md` (Etappe 1 aus 1.4; Abschnitte 2, 3, 8.5, 9). Rahmen: `docs/superpowers/specs/2026-10-11-jufi-rahmen-design.md`. Vorlage für Code und Konfiguration: `../hwyd` (lesen, kopieren, anpassen — nie dorthin schreiben).

## Global Constraints

- Code-Kommentare, Oberfläche, Commit-Nachrichten deutsch; Commits ASCII (Umlaute umschrieben), Abschluss `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Kommentare erklären **warum**; bei verworfener Alternative steht sie mit Grund im Kommentar.
- Einrückung Tabs; Ausnahmen YAML, `schema.prisma` (zwei Leerzeichen), `package.json`, Markdown.
- Angular: Inline-Vorlagen und -Stile, `@if`/`@for`, Signale, `changeDetection: OnPush`, **keine Backticks in Kommentaren innerhalb von `template:`/`styles:`**.
- Regeln sind reine Funktionen ohne Angular-/Express-Abhängigkeit und bekommen `jetzt: Date` als Parameter; nie `new Date()` im Regelcode.
- Was eine Person nicht sehen darf, ist „nicht gefunden": 404, nie 403.
- Nur erfundene Daten in Tests, Demo und Browserprüfung.
- Paketnamen `@jufi/domain`, `@jufi/db`, `@jufi/auth`, `@jufi/cli`; Nx-Projektnamen `domain`, `db`, `auth`, `cli`, `jufi`.
- Lokale Postgres auf `127.0.0.1:5433` (hwyd belegt 5432), Container `jufi-postgres-dev`, Benutzer `jufi`, Passwort `jufi_dev_only`, Datenbank `jufi`, `--locale=C --encoding=UTF8`.
- Mailpit lokal: SMTP `127.0.0.1:1025`, Weboberfläche `127.0.0.1:8025`.
- Jede Testdatenbank heißt `jufi_test_<projekt>` (`jufi_test_db`, `jufi_test_server`, `jufi_test_cli`), damit parallel laufende Projekte sich nicht gegenseitig zurücksetzen.
- Fehlerantworten der API als JSON `{ "fehler": "<Text>" }`.
- Größengrenze für Anfragen 100 KB (Spec 8.5).
- Reservierte Slugs (Spec 2.4): `admin`, `api`, `entwurf`, `assets`, `impressum`, `datenschutz`, `healthz`, `favicon.ico`, `robots.txt`.
- Slug: `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–30 Zeichen. Anzeigename höchstens 24 Zeichen.
- Vor jedem Push `pnpm exec prettier --check .`. Kein Push, kein Deploy ohne ausdrückliche Ansage des Eigentümers.
- `pnpm deploy` nie aufrufen (pnpms eingebautes Workspace-Deploy).
- Bleibt eine Stiländerung ohne Wirkung: zuerst die Server-Logs lesen.

## Review Focus

1. **Slug in Großschreibung oder mit Umlaut** (`/Demo/api/v1/verein`, `/dämo/api/v1/verein`): erwartet 404 ohne Datenbankfehler im Log. Test in Task 6.
2. **Verschachtelte Schreibvorgänge an `vereinDb` vorbei** (verschachteltes `create` mit Personen-ID aus einem fremden Verein): erwartet Ablehnung durch die Datenbank, nicht stilles Anlegen. Test in Task 4.
3. **Datenbank hängt statt abzulehnen**: `/healthz` antwortet nach spätestens ~2 s mit 503, statt den Docker-Healthcheck hängen zu lassen. Test in Task 5.
4. **Kaputtes JSON im Body**: erwartet 400 `{ fehler: 'Ungültige Anfrage' }`, nicht 500. Test in Task 5.
5. **`vereinDb` in einer interaktiven Transaktion**: `tx.person.findMany()` sieht nur den eigenen Verein; Rohabfragen sind gesperrt. Test in Task 4.

---

## Dateistruktur

```
docker-compose.dev.yml            Postgres 5433 + Mailpit (lokal)
.env.example                      Vorlage fuer .env
prisma.config.ts                  Prisma 7: Schema-Pfad, Migrationen, URL aus .env
prisma/schema.prisma              komplettes Datenmodell aus Spec 3
prisma/migrations/<ts>_fundament/ erste Migration inkl. CHECK-Constraints
tools/version-stamp.mjs           schreibt apps/jufi/src/version.generated.ts
libs/domain/src/slug.ts           pruefeSlug, RESERVIERTE_SLUGS
libs/auth/src/lib/*.ts            aus hwyd: passwords, tokens, rate-limit, totp, cookies, env-check
libs/db/src/lib/client.ts         createPrismaClient, createPrismaClientFromEnv
libs/db/src/lib/verein-db.ts      vereinDb, VEREINS_MODELLE
libs/db/src/testing.ts            bereiteTestDatenbankVor (Einstieg @jufi/db/testing)
apps/jufi/src/server.ts           Express + Angular-Handler + listen
apps/jufi/src/server/app.ts       createApp(deps)
apps/jufi/src/server/health.ts    /healthz
apps/jufi/src/server/sicherheit.ts Sicherheits-Header
apps/jufi/src/server/fehler.ts    Fehlerbehandlung
apps/jufi/src/server/verein.ts    vereinAusSlug, vereinsApi-Router
apps/jufi/src/app/...             Shell, Seiten, gestaltung/ (Kopie aus dem Entwurf)
apps/cli/src/main.ts              Befehls-Verteiler
apps/cli/src/demo.ts              demoEinspielen
```

---

### Task 1: Workspace-Grundlagen und `libs/domain` mit Slug-Regel

**Files:**

- Modify: `package.json`, `nx.json`, `tsconfig.json`, `.gitignore`
- Create: `docker-compose.dev.yml`, `.env.example`, `libs/domain/package.json`, `libs/domain/tsconfig.json`, `libs/domain/tsconfig.lib.json`, `libs/domain/tsconfig.spec.json`, `libs/domain/vitest.config.mts`, `libs/domain/src/index.ts`, `libs/domain/src/slug.ts`
- Test: `libs/domain/src/slug.spec.ts`

**Interfaces:**

- Produces: `pruefeSlug(slug: string): { ok: true } | { ok: false; grund: 'format' | 'laenge' | 'reserviert' }`, `RESERVIERTE_SLUGS: readonly string[]` aus `@jufi/domain`.
- Produces: Root-Skripte `db:up`, `db:down`, `db:psql`, `db:migrate`, `db:generate`, `dev`, `test` (siehe Step 6).

- [ ] **Step 1: Abhängigkeiten ergänzen**

Aus `../hwyd/package.json` dieselben Versionen übernehmen. Dependencies: `@angular/platform-server`, `@angular/ssr`, `@node-rs/argon2`, `@prisma/adapter-pg`, `@prisma/client`, `@simplewebauthn/server`, `@simplewebauthn/browser`, `express`, `otplib`, `pg`. DevDependencies: `@nx/esbuild`, `@nx/node`, `@nx/vite`, `@types/express`, `esbuild`, `prisma`, `vite`, `@vitest/coverage-v8`. `pnpm install`.

Expected: Installation ohne `ERR_PNPM_IGNORED_BUILDS` (die Liste in `pnpm-workspace.yaml` deckt `prisma` und `@prisma/engines` schon ab).

- [ ] **Step 2: Nx-Plugins wie hwyd**

`nx.json`: `plugins` mit `@nx/js/typescript` (typecheck/build wie `../hwyd/nx.json`) und `@nx/vitest` (`testTargetName: "test"`); `targetDefaults` für `@nx/esbuild:esbuild` wie hwyd. Bestehende Einträge für den Entwurf bleiben.

- [ ] **Step 3: Lokale Dienste**

`docker-compose.dev.yml` nach `../hwyd/docker-compose.dev.yml` mit den Werten aus den Global Constraints, dazu Dienst `mailpit` (`axllent/mailpit:v1.21`, Ports `127.0.0.1:1025:1025` und `127.0.0.1:8025:8025`, Container `jufi-mailpit-dev`). Kopfkommentar: warum 5433 (hwyd belegt 5432) und warum Mailpit (keine Mail verlässt lokal den Rechner).

`.env.example` mit kommentierten Platzhaltern: `DATABASE_URL="postgresql://jufi:jufi_dev_only@127.0.0.1:5433/jufi?schema=public"`, `TEST_DATABASE_HOST_URL="postgresql://jufi:jufi_dev_only@127.0.0.1:5433/postgres"`, `SESSION_SECRET=""`, `TOTP_ENC_KEY=""`, `BASIS_URL="http://localhost:4200"`, `WEBAUTHN_RP_ID=""`, `WEBAUTHN_ORIGIN=""`, `SMTP_HOST="127.0.0.1"`, `SMTP_PORT="1025"`, `MAIL_ABSENDER="app@jufi-app.de"`, `MAIL_ANTWORT="kontakt@jufi-app.de"`, `MAIL_BETREFF_PRAEFIX="[Lokal] "`. Erzeugungsbefehle wie in `../hwyd/.env.example`.

`.gitignore`: `apps/jufi/src/version.generated.ts`, `libs/db/src/generated/`, `apps/cli/dist/`.

- [ ] **Step 4: Test für die Slug-Regel schreiben**

```ts
import { pruefeSlug, RESERVIERTE_SLUGS } from './slug';

describe('pruefeSlug', () => {
	it.each(['glonntal', 'fv-glonntal', 'abc', 'a1-b2', 'x'.repeat(30)])('nimmt %s an', (s) => {
		expect(pruefeSlug(s)).toEqual({ ok: true });
	});
	it.each(['Glonntal', 'dämo', 'fv_glonntal', '-glonntal', 'glonntal-', 'fv--glonntal', 'glonn tal', ''])(
		'lehnt %j wegen des Formats ab',
		(s) => expect(pruefeSlug(s)).toEqual({ ok: false, grund: 'format' }),
	);
	it.each(['ab', 'x'.repeat(31)])('lehnt %s wegen der Laenge ab', (s) => {
		expect(pruefeSlug(s)).toEqual({ ok: false, grund: 'laenge' });
	});
	it('lehnt jeden reservierten Namen ab', () => {
		for (const s of ['admin', 'api', 'entwurf', 'assets', 'impressum', 'datenschutz', 'healthz']) {
			expect(pruefeSlug(s)).toEqual({ ok: false, grund: 'reserviert' });
		}
		expect(RESERVIERTE_SLUGS).toEqual(
			expect.arrayContaining([
				'admin',
				'api',
				'entwurf',
				'assets',
				'impressum',
				'datenschutz',
				'healthz',
				'favicon.ico',
				'robots.txt',
			]),
		);
	});
});
```

Reihenfolge der Prüfung: Format vor Länge vor Reserviert (`''` ist also `format`, `ab` ist `laenge`).

- [ ] **Step 5: Bibliothek anlegen, Test rot sehen**

Projektdateien nach `../hwyd/libs/domain/*` (Name `@jufi/domain`, `nx.name` `domain`); `tsconfig.json` im Wurzelverzeichnis bekommt die Referenz. `slug.ts` zunächst nur mit `export const RESERVIERTE_SLUGS: readonly string[] = [];` und `export function pruefeSlug(_s: string) { return { ok: true } as const; }`.

Run: `pnpm nx test domain --skip-nx-cache`
Expected: FAIL in den Ablehnungsfällen.

- [ ] **Step 6: `pruefeSlug` umsetzen, Skripte ergänzen**

`pruefeSlug(slug: string)` in `libs/domain/src/slug.ts`; Kommentar zu `favicon.ico`/`robots.txt`: würden am Format ohnehin scheitern, stehen aber in der Liste, weil sie auf oberster Ebene der Plattform gehören (Spec 2.4). Export über `src/index.ts`.

Root-`package.json`, Skripte: `"dev": "pnpm run db:up && nx serve jufi"`, `"db:up": "docker compose -f docker-compose.dev.yml up -d --wait"`, `"db:down"`, `"db:psql": "docker exec -it jufi-postgres-dev psql -U jufi -d jufi"`, `"db:migrate": "prisma migrate dev"`, `"db:generate": "prisma generate"`, `"test": "nx run-many -t test test-server"`.

Run: `pnpm nx test domain --skip-nx-cache && pnpm run db:up && docker exec jufi-postgres-dev pg_isready -U jufi`
Expected: Tests PASS; `accepting connections`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Workspace fuer die App: Abhaengigkeiten, lokale Dienste, libs/domain mit Slug-Regel"
```

---

### Task 2: `libs/auth` aus hwyd

**Files:**

- Create: `libs/auth/package.json`, `tsconfig*.json`, `vitest.config.mts`, `src/index.ts`, `src/lib/{passwords,tokens,rate-limit,totp,cookies,env-check}.ts`
- Test: `libs/auth/src/lib/{tokens,rate-limit,totp,cookies,env-check,passwords}.spec.ts`

**Interfaces:**

- Produces aus `@jufi/auth`:
  - `hashPassword(pw: string): Promise<string>`, `verifyPassword(hash: string, pw: string): Promise<boolean>`
  - `generateSessionToken(): string`, `generateLinkToken(): string` (32 Zufallsbytes, base64url, 43 Zeichen), `hashToken(t: string): string` (SHA-256 hex), `safeEqualHex(a, b): boolean`, `generateRecoveryCodes(n = 10): string[]`, `normalizeRecoveryCode`, `hashRecoveryCode`
  - `AttemptTracker`, `lockoutMs`, `FREE_ATTEMPTS`, `MAX_DELAY_MS` (unverändert aus hwyd)
  - `TOTP_ISSUER = 'JuFi App'`, `generateTotpSecret`, `totpUri`, `verifyTotp`, `encryptSecret`, `decryptSecret`
  - `MITGLIEDER_COOKIE = 'jufi_sitzung'`, `ADMIN_COOKIE = 'jufi_admin'`, `serializeCookie(name: string, token: string, o: { path: string; maxAgeSeconds: number; secure: boolean }): string`, `serializeClearedCookie(name: string, o: { path: string; secure: boolean }): string`, `readCookie(header: string | undefined, name: string): string | undefined`
  - `checkSecrets(env)`, `assertSecrets(env)` prüfen `DATABASE_URL`, `SESSION_SECRET` (≥ 32 Zeichen), `TOTP_ENC_KEY` (genau 32 Byte base64), `BASIS_URL` (absolute http(s)-URL ohne abschließenden Schrägstrich)

- [ ] **Step 1: Tests aus hwyd übernehmen und anpassen**

`tokens`, `rate-limit`, `totp`, `cookies`, `env-check` aus `../hwyd/libs/auth/src/lib/*.spec.ts` kopieren und auf die Schnittstellen oben umstellen. Zusätzlich:

```ts
it('generateLinkToken liefert 43 base64url-Zeichen und nie zweimal dasselbe', () => {
	const a = generateLinkToken();
	expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(generateLinkToken()).not.toBe(a);
});
it('Cookie traegt Name, Pfad, HttpOnly, SameSite=Lax und Secure nur bei https', () => {
	const c = serializeCookie('jufi_sitzung', 'abc', { path: '/glonntal/', maxAgeSeconds: 60, secure: true });
	expect(c).toContain('jufi_sitzung=abc');
	expect(c).toContain('Path=/glonntal/');
	expect(c).toContain('HttpOnly');
	expect(c).toContain('SameSite=Lax');
	expect(c).toContain('Secure');
	expect(serializeCookie('x', 'y', { path: '/', maxAgeSeconds: 1, secure: false })).not.toContain('Secure');
});
it('readCookie findet das Cookie unter mehreren, auch mit gleichem Praefix', () => {
	expect(readCookie('jufi_sitzung_alt=1; jufi_sitzung=zwei', 'jufi_sitzung')).toBe('zwei');
});
it('env-check verlangt BASIS_URL ohne abschliessenden Schraegstrich', () => {
	const gut = { DATABASE_URL: 'x', SESSION_SECRET: 'a'.repeat(32), TOTP_ENC_KEY: Buffer.alloc(32).toString('base64') };
	expect(checkSecrets({ ...gut, BASIS_URL: 'https://test.jufi-app.de' })).toEqual([]);
	expect(checkSecrets({ ...gut, BASIS_URL: 'https://test.jufi-app.de/' }).map((p) => p.variable)).toEqual([
		'BASIS_URL',
	]);
	expect(checkSecrets({ ...gut }).map((p) => p.variable)).toEqual(['BASIS_URL']);
});
it('Passwort-Hash prueft das richtige und lehnt ein falsches ab', async () => {
	const h = await hashPassword('lange-passphrase-123');
	expect(await verifyPassword(h, 'lange-passphrase-123')).toBe(true);
	expect(await verifyPassword(h, 'falsch')).toBe(false);
});
```

- [ ] **Step 2: Tests rot sehen**

Bibliothek anlegen (Projektdateien nach `../hwyd/libs/auth`, ohne Abhängigkeit zu `@jufi/db`), `src/lib/*.ts` zunächst mit den Exporten als Stummel, die werfen.

Run: `pnpm nx test auth --skip-nx-cache`
Expected: FAIL in allen neuen Tests.

- [ ] **Step 3: Module aus hwyd kopieren und umbauen**

`passwords`, `tokens`, `rate-limit`, `totp`, `env-check` aus hwyd kopieren; Kommentare und Begründungen mitnehmen, wo sie gelten. Abweichungen:

- `passwords.ts` ohne `MIN_PASSWORD_LENGTH`: die Passwortregel (mindestens 10 Zeichen, Sperrliste) gehört nach `libs/domain` und kommt in Etappe 3; zwei Regeln an zwei Orten würden auseinanderlaufen.
- `cookies.ts` mit Name und Pfad als Parameter: Mitglieder-Cookie gilt nur für `/<slug>/`, Admin-Cookie nur für `/admin/` (Spec 4.5).
- `totp.ts`: `TOTP_ISSUER = 'JuFi App'`.
- `sessions.ts` und `webauthn.ts` kommen **nicht** mit: sie hängen in hwyd am Modell `User` und werden in Etappe 2 (Admin) und 3 (Vereine) gegen die neuen Tabellen gebaut. Kommentar in `src/index.ts`.

Run: `pnpm nx test auth --skip-nx-cache && pnpm nx typecheck auth`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add libs/auth tsconfig.json pnpm-lock.yaml
git commit -m "libs/auth aus hwyd uebernommen: Passwoerter, Tokens, Backoff, TOTP, Cookies je Pfad, env-check"
```

---

### Task 3: `libs/db` mit vollständigem Datenmodell

**Files:**

- Create: `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/<zeitstempel>_fundament/migration.sql`, `libs/db/package.json`, `tsconfig*.json`, `vitest.config.mts`, `src/index.ts`, `src/lib/client.ts`, `src/testing.ts`, `src/test-setup.ts`
- Test: `libs/db/src/schema.spec.ts`

**Interfaces:**

- Produces aus `@jufi/db`: `createPrismaClient(o?: { connectionString?: string; log?: boolean }): PrismaClient`, `createPrismaClientFromEnv(o?)`, Typen `PrismaClient`, `Prisma` und alle Enums des Schemas.
- Produces aus `@jufi/db/testing`: `bereiteTestDatenbankVor(name: string): Promise<string>` — löscht und erzeugt `jufi_test_<name>` über `TEST_DATABASE_HOST_URL` (Vorgabe `postgresql://jufi:jufi_dev_only@127.0.0.1:5433/postgres`), spielt mit `prisma migrate deploy` alle Migrationen ein und liefert die URL. Ist Postgres nicht erreichbar, wirft sie `Postgres auf 127.0.0.1:5433 nicht erreichbar – erst pnpm run db:up`.
- Produces: Modelle und Enums wie unten; spätere Etappen ändern das Schema nur noch per neuer Migration.

Modelle (Spec 3; Felder dort, hier nur, was die Spec offen lässt):

| Modell                                                                                    | Festlegungen für die Umsetzung                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Verein`                                                                                  | `status VereinStatus @default(AKTIV)`; `slug @unique`                                                                                                                                                                              |
| `VereinLogo`                                                                              | `vereinId @id`, `bild Bytes`, `mimeType`, `icon192 Bytes`, `icon512 Bytes`, `geaendertAm`                                                                                                                                          |
| `Person`                                                                                  | `@@unique([vereinId, id])`; `rechte Recht[] @default([])`; `jugendsprecher Boolean @default(false)`; `zugangErlaubt Boolean @default(true)`; `vorname`/`nachname` `String` (leer bei Grabstein); `geburtsdatum DateTime? @db.Date` |
| `Bezugsperson`                                                                            | `@@unique([erwachsenerId, jungfischerId])`; zwei Relationen zu `Person` über `[vereinId, erwachsenerId]` bzw. `[vereinId, jungfischerId]` → `[vereinId, id]`                                                                       |
| `Untergruppe`                                                                             | `@@unique([vereinId, name])`, `@@unique([vereinId, id])`                                                                                                                                                                           |
| `UntergruppeMitglied`                                                                     | `@@id([untergruppeId, personId])`; Relationen über `[vereinId, untergruppeId]` und `[vereinId, personId]`                                                                                                                          |
| `Zugang`                                                                                  | `personId @unique`; `@@unique([vereinId, id])`, `@@unique([vereinId, email])`, `@@unique([vereinId, anmeldename])`; Relation `[vereinId, personId]`                                                                                |
| `Passkey`, `RecoveryCode`, `Session`                                                      | Relation `[vereinId, zugangId]` → `Zugang[vereinId, id]`; `Passkey.credentialId @unique`; `Session.tokenHash @unique`                                                                                                              |
| `WebauthnChallenge`                                                                       | `vereinId String?` — `null` gehört dem Plattform-Admin (Challenges tragen keine Personendaten; eine zweite Tabelle brächte nichts)                                                                                                 |
| `Einladung`                                                                               | `tokenHash @unique`; `erstelltVonPersonId String?` — `null` heißt „vom Plattform-Admin", Einzelheiten im `AdminProtokoll` (keine Verbindung Vereinsdaten ↔ Admin-Tabellen, Spec 3.2)                                               |
| `Einwilligung`                                                                            | Relationen `[vereinId, jungfischerId]` und `[vereinId, erteiltVon]`                                                                                                                                                                |
| `MailWarteschlange`                                                                       | `vereinId String?` mit Cascade                                                                                                                                                                                                     |
| `PlattformAdmin`, `AdminSession`, `AdminPasskey`, `AdminRecoveryCode`, `AdminEinrichtung` | ohne `vereinId`                                                                                                                                                                                                                    |
| `AdminProtokoll`                                                                          | `aktion AdminAktion`; `vereinId String` und `vereinSlug String` **ohne** Fremdschlüssel (das Protokoll überlebt das Löschen eines Vereins); `betroffenePersonId String?`                                                           |

Enums: `VereinStatus { AKTIV GESPERRT }`, `PersonArt { JUNGFISCHER ERWACHSENER }`, `Recht { MITGLIEDER THREADS_ERSTELLEN ALLE_THREADS DOKUMENTE ANTWORTEN_DETAIL JUGENDLEITER_RECHTE EINSTELLUNGEN }`, `Beziehung { MUTTER VATER GROSSMUTTER GROSSVATER TANTE ONKEL GESCHWISTER PFLEGEPERSON ANDERE }`, `EinladungArt { EINLADUNG RESET }`, `EinwilligungArt { DSGVO_ART8 }`, `AdminAktion { VEREIN_ANGELEGT GESPERRT ENTSPERRT SLUG_KORRIGIERT NOTFALL_LINK ERSTE_EINLADUNG_ERNEUERT }`.

Alle Relationen zum `Verein` mit `onDelete: Cascade`. Personenbezogene Relationen innerhalb des Vereins: `Cascade` für Zugang, Passkey, Session, RecoveryCode, Einladung, Bezugsperson, UntergruppeMitglied; `Restrict` für `Einwilligung` (Nachweis, Spec 3.4).

- [ ] **Step 1: Test für die Regeln der Datenbank schreiben**

`libs/db/src/schema.spec.ts` gegen `jufi_test_db` (über `test-setup.ts` als `globalSetup`, das `bereiteTestDatenbankVor('db')` aufruft und die URL in `process.env.DATABASE_URL` legt). Jeder Test legt seine Vereine mit eindeutigem Slug an. Erwartete Fehler werden über den Prisma-Fehlercode oder die Constraint-Bezeichnung geprüft:

- `Bezugsperson mit Erwachsenem aus fremdem Verein wird abgelehnt` (Fremdschlüssel)
- `UntergruppeMitglied mit Person aus fremdem Verein wird abgelehnt`
- `Session mit Zugang aus fremdem Verein wird abgelehnt`
- `gleiche E-Mail in zwei Vereinen erlaubt, im selben Verein abgelehnt` (P2002)
- `gleicher Anmeldename im selben Verein abgelehnt`
- `E-Mail und Anmeldename nur kleingeschrieben` (CHECK `zugang_kleinschreibung`)
- `Zugang ohne E-Mail und ohne Anmeldename abgelehnt` (CHECK `zugang_kennung`)
- `Jungfischer ohne Geburtsdatum abgelehnt, als Grabstein erlaubt` (CHECK `person_art_felder`)
- `Erwachsener mit Geburtsdatum oder als Jugendsprecher abgelehnt`
- `Jungfischer mit Rechten abgelehnt`
- `ANDERE ohne Freitext abgelehnt, MUTTER mit Freitext abgelehnt` (CHECK `bezugsperson_freitext`)
- `Slug mit Grossbuchstaben und Anzeigename ueber 24 Zeichen abgelehnt` (CHECK `verein_slug`, `verein_anzeigename`)
- `Verein loeschen entfernt alle Vereinsdaten, AdminProtokoll bleibt`
- `Person mit Einwilligung laesst sich nicht hart loeschen` (Restrict)

- [ ] **Step 2: Schema ohne CHECK-Constraints, Test rot sehen**

`prisma.config.ts` und `client.ts` nach hwyd (`libs/db/src/generated` als Ausgabe). Schema schreiben, `pnpm prisma migrate dev --name fundament --create-only`, `pnpm prisma generate`.

Run: `pnpm prisma validate && pnpm nx test db --skip-nx-cache`
Expected: `validate` grün; die Fremdschlüssel- und Eindeutigkeitstests PASS, alle CHECK-Tests FAIL.

- [ ] **Step 3: CHECK-Constraints von Hand in die Migration**

Ans Ende von `migration.sql` (Prisma bildet CHECKs nicht ab und meldet dafür keine Abweichung):

```sql
ALTER TABLE "Verein" ADD CONSTRAINT verein_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 30);
ALTER TABLE "Verein" ADD CONSTRAINT verein_anzeigename CHECK (char_length(anzeigename) BETWEEN 1 AND 24);
ALTER TABLE "Person" ADD CONSTRAINT person_art_felder CHECK (
	(art = 'JUNGFISCHER' AND cardinality(rechte) = 0 AND (geburtsdatum IS NOT NULL OR "entferntAm" IS NOT NULL))
	OR (art = 'ERWACHSENER' AND geburtsdatum IS NULL AND jugendsprecher = false AND "volljaehrigGeprueftAm" IS NULL)
);
ALTER TABLE "Bezugsperson" ADD CONSTRAINT bezugsperson_freitext CHECK (
	(beziehung = 'ANDERE') = ("beziehungFreitext" IS NOT NULL AND btrim("beziehungFreitext") <> '')
);
ALTER TABLE "Zugang" ADD CONSTRAINT zugang_kennung CHECK (email IS NOT NULL OR anmeldename IS NOT NULL);
ALTER TABLE "Zugang" ADD CONSTRAINT zugang_kleinschreibung CHECK (email = lower(email) AND anmeldename = lower(anmeldename));
```

Davor ein SQL-Kommentar: Doppelschutz zu `libs/domain` (Spec 3.3), und warum der Grabstein beim Jungfischer ohne Geburtsdatum auskommt (Spec 5.8).

Run: `pnpm prisma migrate dev && pnpm nx test db --skip-nx-cache`
Expected: alle Tests PASS.

- [ ] **Step 4: Commit**

```bash
git add prisma prisma.config.ts libs/db tsconfig.json .gitignore pnpm-lock.yaml
git commit -m "libs/db: Datenmodell TP2 mit Mandantenschutz per zusammengesetztem Fremdschluessel und CHECKs"
```

---

### Task 4: `vereinDb`

**Files:**

- Create: `libs/db/src/lib/verein-db.ts`
- Modify: `libs/db/src/index.ts`
- Test: `libs/db/src/verein-db.spec.ts`

**Interfaces:**

- Consumes: `PrismaClient` aus Task 3.
- Produces: `vereinDb(prisma: PrismaClient, vereinId: string): VereinDb` (Rückgabetyp des erweiterten Clients), `VEREINS_MODELLE: readonly Prisma.ModelName[]`, `class VereinDbFehler extends Error`.

Regeln der Erweiterung (`prisma.$extends`, Kommentar mit Verweis auf Rahmen 7.3 und Spec 3.1):

- Modelle in `VEREINS_MODELLE` (alle mit `vereinId`): `vereinId` wird in jedes `where` (find*, count, aggregate, groupBy, update*, delete*, upsert) und in jedes `data`/`create` (create, createMany, createManyAndReturn, upsert) gesetzt. Ein vom Aufrufer mitgegebenes `vereinId` (oder `verein`) wirft `VereinDbFehler`. Schreibvorgänge benutzen Fremdschlüssel als Skalar (`personId`), nicht `connect`.
- `Verein`: nur lesen und `update`, jeweils mit `where.id = vereinId`; `create`, `delete*`, `upsert` werfen.
- Alle anderen Modelle (Admin-Tabellen): jede Operation wirft `VereinDbFehler`.
- `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe` werfen `VereinDbFehler` (Rohabfragen umgingen den eingesetzten Verein).

- [ ] **Step 1: Tests schreiben**

Gegen `jufi_test_db`, zwei Vereine `a` und `b` mit je einem Erwachsenen:

- `findMany sieht nur Personen des eigenen Vereins`
- `findUnique mit ID aus fremdem Verein liefert null`
- `create setzt vereinId selbst`
- `create mit fremder vereinId wirft VereinDbFehler`
- `update einer fremden Person wirft P2025 und aendert nichts`
- `updateMany mit vereinId im data wirft VereinDbFehler`
- `deleteMany loescht nur im eigenen Verein`
- `verein.findMany liefert nur den eigenen Verein; verein.create wirft`
- `plattformAdmin ueber vereinDb wirft`
- `$queryRaw ueber vereinDb wirft`
- `in $transaction sieht tx nur den eigenen Verein` (Review Focus 5)
- `verschachteltes create mit Person aus fremdem Verein scheitert an der Datenbank` (Review Focus 2): `db.person.update({ where: { id: kindA }, data: { <Relation zu Bezugsperson als Kind>: { create: { vereinId: undefined, erwachsenerId: erwachsenerB, beziehung: 'MUTTER', erziehungsberechtigt: true } } } })` → Fehler.
- `VEREINS_MODELLE stimmt mit dem Schema ueberein`: liest `prisma/schema.prisma`, sammelt alle `model`-Blöcke mit einem Feld `vereinId`, außer `AdminProtokoll` (trägt `vereinId` nur als Notiz ohne Fremdschlüssel), und vergleicht sortiert mit `VEREINS_MODELLE`. Ein neues Vereinsmodell ohne Eintrag lässt den Test scheitern.

- [ ] **Step 2: Test rot sehen**

`verein-db.ts` mit `export const VEREINS_MODELLE = [] as const; export class VereinDbFehler extends Error {}; export function vereinDb(p: PrismaClient, _id: string) { return p; }`.

Run: `pnpm nx test db --skip-nx-cache`
Expected: FAIL bei Isolation (`findMany` sieht beide Vereine), bei allen `wirft`-Fällen und beim Schema-Vergleich. Der Test zum verschachtelten `create` darf schon grün sein — ihn erfüllt die Datenbank aus Task 3.

- [ ] **Step 3: Umsetzen**

`VereinLogo` (Schlüssel ist `vereinId`), `WebauthnChallenge` und `MailWarteschlange` (beide mit `vereinId` optional) stehen in `VEREINS_MODELLE`: über `vereinDb` sieht und schreibt man nur Zeilen des eigenen Vereins; Admin-Challenges und Admin-Mails laufen nie über `vereinDb`.

Run: `pnpm nx test db --skip-nx-cache && pnpm nx typecheck db`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add libs/db
git commit -m "vereinDb: Verein in jede Abfrage, fremde Modelle und Rohabfragen gesperrt"
```

---

### Task 5: Server-Gerüst von `apps/jufi`

**Files:**

- Create: `apps/jufi/project.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.spec.json`, `vitest.server.config.mts`, `src/index.html`, `src/main.ts`, `src/main.server.ts`, `src/styles.css` (vorläufig leer, Task 7 füllt), `src/app/app.ts`, `src/app/app.config.ts`, `src/app/app.config.server.ts`, `src/app/app.routes.ts`, `src/app/app.routes.server.ts`, `src/server.ts`, `src/server/app.ts`, `src/server/health.ts`, `src/server/sicherheit.ts`, `src/server/fehler.ts`, `src/server/test-setup.ts`, `tools/version-stamp.mjs`
- Test: `apps/jufi/src/server/app.spec.ts`

**Interfaces:**

- Consumes: `createPrismaClientFromEnv`, `bereiteTestDatenbankVor` (Task 3), `assertSecrets` (Task 2).
- Produces: `createApp(deps: AppDeps): express.Express` in `src/server/app.ts` mit `interface AppDeps { prisma: PrismaClient; version: { version: string; commit: string } }`; `starteTestServer(app): Promise<{ url: string; schliessen(): Promise<void> }>` in `src/server/test-setup.ts` (lauscht auf Port 0).
- Produces: `src/version.generated.ts` mit `export const VERSION = { version, commit }` (von `tools/version-stamp.mjs`, Ziel `stamp`).

`project.json` nach `../hwyd/apps/hwyd/project.json`, ohne Service Worker, ohne SCSS (`styles.css`), ohne `changelog-stamp`:

- `build`: `outputMode: "server"`, `ssr.entry: "apps/jufi/src/server.ts"`, `externalDependencies: ["@node-rs/argon2", "@prisma/client", "@prisma/adapter-pg", "pg", "otplib", "express"]`, `security.allowedHosts: ["test.jufi-app.de", "localhost", "127.0.0.1"]`, Budgets wie im Entwurf.
- `serve`: Port 4200.
- `test`: `@angular/build:unit-test`, `runner: "vitest"`, `include: ["src/app/**/*.spec.ts"]`.
- `test-server`: `nx:run-commands`, `vitest run -c apps/jufi/vitest.server.config.mts`, hängt an `stamp`. Kommentar: eigener Lauf in Node, weil der Angular-Testrunner jsdom und den Angular-Bau mitbringt, Server-Tests aber eine echte Datenbank und kein DOM brauchen.
- `typecheck`, `stamp` wie hwyd.

`vitest.server.config.mts`: `environment: 'node'`, `include: ['src/server/**/*.spec.ts']`, `globalSetup` ruft `bereiteTestDatenbankVor('server')`, `resolve.alias` für `@jufi/domain`, `@jufi/db`, `@jufi/db/testing`, `@jufi/auth` auf die jeweiligen `src/index.ts` bzw. `src/testing.ts` (die App ist kein pnpm-Paket; Angular löst über `paths` in `tsconfig.json` auf).

`server.ts` nach hwyd: `createApp(...)`, dann statische Dateien und `AngularNodeAppEngine` mit `trustProxyHeaders` wie hwyd (Kommentar übernehmen), Fehlerbehandlung zuletzt, `assertSecrets()` vor `listen`, Port `process.env.PORT ?? 4000`. `app.routes.server.ts`: `**` → `RenderMode.Client` (Begründung wie hwyd).

`createApp` in dieser Reihenfolge: `trust proxy`, `x-powered-by` aus, Sicherheits-Header, `express.json({ limit: '100kb' })`, `GET /healthz`. Die Fehlerbehandlung aus `fehler.ts` hängt `createApp` selbst ans Ende, damit Tests sie ohne `server.ts` sehen; `server.ts` registriert sie für den Angular-Teil ein zweites Mal.

- `GET /healthz`: `select 1` mit 2-s-Zeitlimit (wie hwyd); 200 `{ status: 'ok', version, commit }` oder 503 `{ status: 'degraded' }`, Ursache nur ins Log.
- Sicherheits-Header auf jeder Antwort, Werte exakt wie `deploy/nginx-sicherheit.conf` (CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`); Kommentar verweist auf die Begründungen dort.
- Fehlerbehandlung wie hwyd, mit deutschen Schlüsseln: 4xx aus dem Body-Parser bleiben (413 `{ fehler: 'Anfrage zu groß' }`, sonst `{ fehler: 'Ungültige Anfrage' }`), alles andere 500 `{ fehler: 'interner Fehler' }` ohne Einzelheiten.

- [ ] **Step 1: Tests schreiben**

```ts
describe('createApp', () => {
	it('/healthz meldet ok mit Version', async () => {
		const r = await fetch(`${url}/healthz`);
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ status: 'ok', version: '1.2.3', commit: 'abc' });
	});
	it('/healthz meldet 503, wenn die Datenbank ablehnt', async () => {
		/* prisma mit postgresql://x:y@127.0.0.1:1/z */
	});
	it('/healthz meldet nach spaetestens 2,5 s 503, wenn die Datenbank haengt', async () => {
		// Fake-Prisma: $queryRaw liefert ein nie erfuellendes Promise
		const start = Date.now();
		const r = await fetch(`${haengendUrl}/healthz`);
		expect(r.status).toBe(503);
		expect(Date.now() - start).toBeLessThan(2_500);
	});
	it('setzt die Sicherheits-Header und kein X-Powered-By', async () => {
		const r = await fetch(`${url}/healthz`);
		expect(r.headers.get('content-security-policy')).toBe(
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
		);
		expect(r.headers.get('x-frame-options')).toBe('DENY');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(r.headers.get('x-powered-by')).toBeNull();
	});
	it('lehnt einen Body ueber 100 KB mit 413 ab', async () => {
		const r = await fetch(`${url}/demo/api/v1/egal`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ x: 'a'.repeat(101 * 1024) }),
		});
		expect(r.status).toBe(413);
		expect(await r.json()).toEqual({ fehler: 'Anfrage zu groß' });
	});
	it('beantwortet kaputtes JSON mit 400', async () => {
		const r = await fetch(`${url}/demo/api/v1/egal`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{kaputt',
		});
		expect(r.status).toBe(400);
		expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage' });
	});
});
```

`version` kommt als Abhängigkeit in `createApp`, damit der Test `{ version: '1.2.3', commit: 'abc' }` festlegen kann.

- [ ] **Step 2: Rot sehen**

`createApp` liefert zunächst ein leeres `express()`.

Run: `pnpm nx run jufi:test-server --skip-nx-cache`
Expected: FAIL (404 statt 200, Header fehlen).

- [ ] **Step 3: Umsetzen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache && pnpm nx typecheck jufi && pnpm nx build jufi`
Expected: Tests PASS; Bau erzeugt `dist/apps/jufi/server/server.mjs`.

- [ ] **Step 4: Probelauf von Hand**

`cp .env.example .env`, Geheimnisse mit `openssl rand -base64 32` füllen, `pnpm prisma migrate deploy`, dann `pnpm run dev`.

Run: `curl -s localhost:4200/healthz`
Expected: `{"status":"ok","version":"0.1.0","commit":"<sha>"}`.

- [ ] **Step 5: Commit**

```bash
git add apps/jufi tools/version-stamp.mjs package.json tsconfig.json .gitignore
git commit -m "apps/jufi: Express-Geruest mit Healthcheck, Sicherheits-Headern, Groessengrenze und Fehlerbehandlung"
```

---

### Task 6: Verein aus dem Slug und Mandanten-Test

**Files:**

- Create: `apps/jufi/src/server/verein.ts`
- Modify: `apps/jufi/src/server/app.ts`
- Test: `apps/jufi/src/server/verein.spec.ts`, `apps/jufi/src/server/mandanten.spec.ts`

**Interfaces:**

- Consumes: `pruefeSlug` (Task 1), `vereinDb` (Task 4), `createApp` (Task 5).
- Produces: `vereinAusSlug(prisma): RequestHandler` setzt `res.locals.verein: Verein` und `res.locals.db: VereinDb`; `vereinsApi: express.Router` (alle Vereins-Endpunkte **direkt** auf diesem einen Router, ohne Unter-Router — sonst kann der Mandanten-Test sie nicht lesen; Kommentar dazu); `vereinsRouten(): { methode: string; pfad: string }[]` liest `vereinsApi.stack`.
- Produces: `GET /:slug/api/v1/verein` → 200 `{ slug, anzeigename, farbe, hatLogo }`.
- Produces: Unbekannter Pfad unter `/:slug/api/v1/` → 404 `{ fehler: 'nicht gefunden' }`.

Einbindung in `createApp`: `app.use('/:slug/api/v1', vereinAusSlug(prisma), vereinsApi, nichtGefunden)`. Später kommt `/admin` **vor** diese Zeile; `pruefeSlug('admin')` ist ohnehin `reserviert`.

`vereinAusSlug`: `pruefeSlug` zuerst (kein Datenbankzugriff für unmögliche Slugs), dann `prisma.verein.findUnique({ where: { slug } })`; fehlt er oder ist `GESPERRT` → 404 `{ fehler: 'nicht gefunden' }`.

- [ ] **Step 1: Tests schreiben**

`verein.spec.ts`:

- `liefert Anzeigename und Farbe eines aktiven Vereins` → `{ slug: 'glonntal-test', anzeigename: 'Jungfischer Glonntal', farbe: '#0f766e', hatLogo: false }`
- `gesperrter Verein ist nicht gefunden` → 404 `{ fehler: 'nicht gefunden' }`
- `unbekannter Slug ist nicht gefunden`
- `reservierter Slug ist nicht gefunden` (`/admin/api/v1/verein`)
- `Grossschreibung und Umlaut sind nicht gefunden, ohne Datenbankfehler` (`/Glonntal-test/…`, `/d%C3%A4mo/…`; Review Focus 1) — zusätzlich `console.error` per `vi.spyOn` nicht aufgerufen
- `unbekannter Pfad unter der Vereins-API ist 404 JSON`

`mandanten.spec.ts`:

```ts
/**
 * Jede Vereins-Route braucht hier einen Fall (Spec 9). Kommt eine Route
 * hinzu, scheitert der erste Test, bis der Fall eingetragen ist.
 */
const FAELLE: Record<string, (k: Kontext) => Promise<void>> = {
	'GET /verein': async (k) => {
		// Ohne Objekt-ID: der Verein kommt allein aus dem Slug. Geprueft wird,
		// dass ein gesperrter fremder Verein nichts preisgibt.
		expect((await fetch(`${k.url}/${k.gesperrt.slug}/api/v1/verein`)).status).toBe(404);
	},
};
it('jede Vereins-Route hat einen Fall', () => {
	expect(
		vereinsRouten()
			.map((r) => `${r.methode} ${r.pfad}`)
			.sort(),
	).toEqual(Object.keys(FAELLE).sort());
});
it.each(Object.entries(FAELLE))('%s gibt nichts aus fremden Vereinen preis', async (_name, fall) => fall(kontext));
```

`Kontext` hält `url`, einen aktiven Verein `eigen`, einen aktiven `fremd` und einen `gesperrt`; spätere Etappen ergänzen Sitzungen.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache`
Expected: FAIL (`vereinsRouten` leer bzw. 404 statt 200).

- [ ] **Step 3: Umsetzen**

Run: `pnpm nx run jufi:test-server --skip-nx-cache && pnpm nx typecheck jufi`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/jufi/src/server
git commit -m "Verein aus dem Slug, Vereins-API mit erstem Endpunkt und Mandanten-Test"
```

---

### Task 7: Angular-Hülle, Gestaltung und erste Vereinsseite

**Files:**

- Create: `apps/jufi/src/app/gestaltung/{farben,farben.spec,format,format.spec,icon,meldung,thema,thema-wahl,ui}.ts` (Kopie aus `apps/entwurf/src/app/gestaltung/`), `apps/jufi/src/app/seiten/plattform-start.ts`, `apps/jufi/src/app/seiten/verein-start.ts`, `apps/jufi/src/app/seiten/nicht-gefunden.ts`, `apps/jufi/src/app/daten/verein-api.ts`
- Modify: `apps/jufi/src/styles.css` (Kopie aus `apps/entwurf/src/styles.css`), `apps/jufi/src/app/app.routes.ts`, `apps/jufi/src/app/app.config.ts`, `apps/jufi/src/index.html`
- Test: `apps/jufi/src/app/seiten/verein-start.spec.ts`

**Interfaces:**

- Consumes: `GET /:slug/api/v1/verein` (Task 6).
- Produces: `VereinApi.lade(slug: string): Observable<OeffentlicherVerein | 'nicht-gefunden'>` mit `interface OeffentlicherVerein { slug: string; anzeigename: string; farbe: string; hatLogo: boolean }`; `NichtGefundenComponent` (Selektor `jf-nicht-gefunden`), Text „Nicht gefunden oder keine Berechtigung" (Spec 6.5).
- Produces: Routen `''` → `PlattformStartComponent`, `':slug'` → `VereinStartComponent`, `'**'` → `NichtGefundenComponent`.

Kopie der Gestaltung: nur die genannten Dateien; `teilen-aktion`, `texte`, `herunterladen` bleiben im Entwurf (sie hängen an dessen Daten). `thema.ts`: Schlüssel `jufi:thema`, Kommentar zu Entwurfsversionen streichen. Jede kopierte Datei bekommt keinen Verweis auf den Entwurf, nur auf Rahmen 5.1.1. `index.html`: `lang="de"`, `<base href="/">`, Titel „JuFi App", `viewport-fit=cover`, `color-scheme`, `robots noindex` (bis zum Live-Gang, Kommentar).

`app.config.ts`: `provideBrowserGlobalErrorListeners()`, `provideRouter(routes, withComponentInputBinding())`, `provideHttpClient(withFetch())`.

`PlattformStartComponent` ist ein Platzhalter bis Etappe 5: Überschrift „JuFi App", ein Satz, Link `/entwurf/`. `VereinStartComponent` (Eingabe `slug`): lädt den Verein, setzt `ThemaService.setzeVereinsfarbe(farbe)` und `document.title = anzeigename`, zeigt „Willkommen bei den {{ anzeigename }}"-Platzhalter in einer `jf-karte`; bei `'nicht-gefunden'` die `NichtGefundenComponent`.

- [ ] **Step 1: Tests schreiben**

Mit `HttpTestingController` und `RouterTestingHarness`:

- `zeigt den Anzeigenamen und setzt die Vereinsfarbe` — Antwort `{ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false }` auf `GET /demo/api/v1/verein`; Text enthält „Jungfischer Demo"; `document.documentElement.style.getPropertyValue('--akzent-hell')` ist nicht leer.
- `zeigt bei 404 Nicht gefunden oder keine Berechtigung`
- `unbekannte tiefe Route zeigt Nicht gefunden` (`/demo/gibt/es/nicht`)

Die kopierten `farben.spec.ts` und `format.spec.ts` laufen mit.

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx test jufi --watch=false --skip-nx-cache`
Expected: FAIL (Bauteile fehlen).

- [ ] **Step 3: Umsetzen**

Run: `pnpm nx test jufi --watch=false --skip-nx-cache && pnpm nx build jufi`
Expected: PASS; Bau ohne Budget-Fehler.

- [ ] **Step 4: Commit**

```bash
git add apps/jufi/src
git commit -m "apps/jufi: Gestaltung aus dem Entwurf, Plattform-Platzhalter, erste Vereinsseite, Nicht gefunden"
```

---

### Task 8: `apps/cli` mit Demo-Verein, Entwicklungsablauf dokumentiert

**Files:**

- Create: `apps/cli/package.json` (esbuild-Ziel nach `../hwyd/apps/importer/package.json`, Ausgabe `apps/cli/dist/main.js`, extern `@prisma/client`, `@prisma/adapter-pg`, `pg`, `@node-rs/argon2`), `apps/cli/tsconfig.json`, `apps/cli/tsconfig.app.json`, `apps/cli/vitest.config.mts`, `apps/cli/src/main.ts`, `apps/cli/src/demo.ts`
- Modify: `package.json` (Skripte), `README.md`, `CLAUDE.md`
- Test: `apps/cli/src/demo.spec.ts`, `apps/cli/src/main.spec.ts`

**Interfaces:**

- Consumes: `createPrismaClientFromEnv`, `bereiteTestDatenbankVor('cli')`.
- Produces: `demoEinspielen(prisma: PrismaClient, jetzt: Date): Promise<{ vereinId: string; personen: number }>`; `fuehreAus(argv: string[], deps: { prisma: () => PrismaClient; jetzt: () => Date; ausgabe: (s: string) => void }): Promise<number>` (Rückgabe = Exit-Code).
- Produces: Root-Skripte `"cli": "nx build cli && node apps/cli/dist/main.js"`, `"demo": "pnpm run cli demo einspielen"`.

Demo-Verein (alles erfunden; Namen aus dem Entwurf):

- Verein: Slug `demo`, Name „Jungfischer Demo e.V.", Anzeigename „Jungfischer Demo", Farbe `#0f766e`.
- Erwachsene: Thomas Beispiel (alle Rechte), Katrin Muster (alle außer `JUGENDLEITER_RECHTE` und `EINSTELLUNGEN`), Sandra Huber (keine Rechte), Hans Huber (keine Rechte).
- Jungfischer (Geburtsdatum relativ zu `jetzt`, damit die Alter stabil bleiben): Lena Huber (14), Max Huber (12), Jonas Weber (17, Jugendsprecher).
- Familie: Sandra → Lena und Max (`MUTTER`, erziehungsberechtigt); Hans → Lena (`GROSSVATER`, nicht erziehungsberechtigt).
- Untergruppe „Ältere" mit Lena und Jonas.
- Ohne Zugänge (die entstehen ab Etappe 3).
- Bestehender Verein `demo` wird vorher gelöscht (Cascade), andere Vereine bleiben unberührt.

`fuehreAus`: `hilfe` (auch ohne Argumente) listet die Befehle und liefert 0; `demo einspielen` liefert 0 und gibt `Demo-Verein angelegt: /demo/ (7 Personen)` aus; Unbekanntes gibt `Unbekannter Befehl. Hilfe: pnpm run cli hilfe` aus und liefert 2. Admin- und Löschbefehle kommen in Etappe 2.

- [ ] **Step 1: Tests schreiben**

- `demo einspielen legt 7 Personen, 3 Familienzuordnungen und eine Untergruppe an`
- `zweimal einspielen ergibt denselben Stand` (Zählung gleich, genau ein Verein `demo`)
- `andere Vereine bleiben unberuehrt`
- `Jonas ist Jugendsprecher und am Bezugstag 17` (`jetzt = new Date('2026-10-12T12:00:00Z')`; Alter aus Geburtsdatum und `jetzt` gerechnet ergibt 17, Lena 14, Max 12)
- `fuehreAus ohne Argumente zeigt die Hilfe und liefert 0`
- `fuehreAus mit unbekanntem Befehl liefert 2`

- [ ] **Step 2: Rot sehen**

Run: `pnpm nx test cli --skip-nx-cache`
Expected: FAIL.

- [ ] **Step 3: Umsetzen**

Run: `pnpm nx test cli --skip-nx-cache && pnpm run demo`
Expected: Tests PASS; Ausgabe `Demo-Verein angelegt: /demo/ (7 Personen)`.

- [ ] **Step 4: Dokumentation**

`README.md`: Abschnitt „App entwickeln" — `.env` anlegen, `pnpm run db:up`, `pnpm prisma migrate dev`, `pnpm run demo`, `pnpm run dev` → `http://localhost:4200/demo`, Mailpit unter `http://127.0.0.1:8025`, Tests brauchen laufendes Postgres. `CLAUDE.md`, Abschnitt „Stand": `apps/jufi` ist die echte App (TP2), lokal `pnpm run dev` → `http://localhost:4200/`; Tests brauchen `pnpm run db:up`; `vereinDb` ist der einzige Weg zu Vereinsdaten in Vereins-Routen.

- [ ] **Step 5: Gesamtprüfung**

Run: `pnpm run db:up && pnpm test && pnpm run typecheck && pnpm nx build jufi && pnpm exec prettier --check .`
Expected: alles grün.

Von Hand: `pnpm run dev`, im Browser `http://localhost:4200/demo` bei 375 × 812 und 1280 × 800, hell und dunkel: Anzeigename sichtbar, `document.documentElement.scrollWidth <= innerWidth`; `http://localhost:4200/gibtsnicht` zeigt „Nicht gefunden oder keine Berechtigung".

- [ ] **Step 6: Commit**

```bash
git add apps/cli package.json pnpm-lock.yaml README.md CLAUDE.md tsconfig.json
git commit -m "apps/cli mit Demo-Verein, Entwicklungsablauf der App dokumentiert"
```
