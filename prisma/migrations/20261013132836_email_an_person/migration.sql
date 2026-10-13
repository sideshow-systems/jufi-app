-- Entscheidung: Die E-Mail gehoert an die Person, nicht an den Zugang. Die erste
-- Leitung, die Ansprechpartner eines Vereins und jeder Erwachsene, der beim
-- Anlegen eine Adresse bekommt, brauchen sie, bevor es einen Zugang gibt; der
-- Zugang entsteht erst beim Einloesen der Einladung. Eine zweite Kopie am Zugang
-- haette zwei Adressen auseinanderlaufen lassen.

-- DropIndex
DROP INDEX "Zugang_vereinId_email_key";

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Person_vereinId_email_key" ON "Person"("vereinId", "email");

-- Beide CHECKs am Zugang nannten die Spalte email; sie fallen sonst mit ihr weg,
-- ohne dass die Migration es sagt. Darum erst ausdruecklich, dann die Spalte.
-- zugang_kennung (E-Mail oder Anmeldename am Zugang) entfaellt ersatzlos: Die
-- Kennung Erwachsener liegt jetzt an der Person, ein CHECK koennte sie nicht
-- mehr zusammen mit dem Anmeldenamen des Zugangs pruefen -- das geht in Postgres
-- nicht ueber zwei Tabellen. Etappe 3 prueft beim Einloesen der Einladung in
-- libs/domain, dass der Zugang eine Kennung hat.
ALTER TABLE "Zugang" DROP CONSTRAINT zugang_kennung;
ALTER TABLE "Zugang" DROP CONSTRAINT zugang_kleinschreibung;

-- AlterTable
ALTER TABLE "Zugang" DROP COLUMN "email";

-- CHECK-Constraints, von Hand ergaenzt: Prisma bildet sie nicht ab und meldet
-- fuer sie auch keine Abweichung zwischen Schema und Datenbank. Wie in der
-- Migration fundament sind sie Doppelschutz zu libs/domain: Der Code prueft
-- zuerst und antwortet verstaendlich, die CHECKs fangen ab, was an ihm
-- vorbeikommt.

-- Der Anmeldename bleibt als einzige Kennung am Zugang kleingeschrieben, damit
-- "Lena" und "lena" nicht zwei Zugaenge ergeben. Rand und Leerstring prueft der
-- Code, beim Anmeldenamen reicht die Kleinschreibung als Untergrenze.
ALTER TABLE "Zugang" ADD CONSTRAINT zugang_kleinschreibung CHECK (anmeldename = lower(anmeldename));

-- Die E-Mail ist Kennung und Vergleichsschluessel (eindeutig je Verein). Ohne
-- Kleinschreibung und ohne Rand waeren "Sandra@Example.org" und
-- "sandra@example.org " zwei verschiedene Personen mit derselben Adresse; der
-- Leerstring waere eine Adresse, die niemandem gehoert, aber den Eindeutigkeits-
-- index belegt. NULL bleibt erlaubt: Beim Anlegen ist die Adresse freiwillig.
ALTER TABLE "Person" ADD CONSTRAINT person_email CHECK (
	email IS NULL OR (email = lower(email) AND email = btrim(email) AND email <> '')
);

-- Die Vereinsfarbe landet in CSS und im Manifest; ein Wert wie "red" oder
-- "#0F766E" liesse die Ableitung der uebrigen Farben (Hell/Dunkel, Kontrast)
-- ins Leere laufen. Kleinschreibung, damit dieselbe Farbe nur eine Schreibweise hat.
ALTER TABLE "Verein" ADD CONSTRAINT verein_farbe CHECK (farbe ~ '^#[0-9a-f]{6}$');

-- Prisma legt Listenfelder ohne NOT NULL an. Ein NULL in rechte liesse den CHECK
-- person_art_felder (cardinality(rechte) = 0) als "unbekannt" durchrutschen, und
-- der Code rechnet mit einer Liste. Der Standardwert (leere Liste) bleibt.
ALTER TABLE "Person" ALTER COLUMN "rechte" SET NOT NULL;
