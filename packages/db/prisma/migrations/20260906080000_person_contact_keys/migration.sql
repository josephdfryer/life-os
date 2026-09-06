-- PersonContact: one row per normalized email or phone a Person carries, so
-- the contact matcher can find candidates with an index instead of loading
-- every Person in the workspace and matching in application code (that was
-- O(people) per ingested record: ~15M row materializations for a 2,000-contact
-- phone sync). Not unique on (workspace, kind, normalized): two People may
-- legitimately share a key until the merge tool resolves them.
--
-- Maintained by a trigger on Person, not by application dual-writes. Person
-- emails/phones are written from domain commands, the merge tool, bulk
-- updates, imports, seeds, and one-off scripts; a trigger keeps every one of
-- them consistent forever. The SQL normalizers below mirror
-- packages/domain/contact-matching.ts exactly and are pinned by an integration
-- test that runs both over the same fixtures.

-- CreateTable
CREATE TABLE "PersonContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,

    CONSTRAINT "PersonContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonContact_workspaceId_kind_normalized_idx" ON "PersonContact"("workspaceId", "kind", "normalized");

-- CreateIndex
CREATE INDEX "PersonContact_personId_idx" ON "PersonContact"("personId");

-- AddForeignKey
ALTER TABLE "PersonContact" ADD CONSTRAINT "PersonContact_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fuzzy candidate retrieval for the name stage of matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Person.emails / Person.phones are JSON arrays stored as text. Tolerate a
-- malformed value (return an empty array) rather than fail the write.
CREATE OR REPLACE FUNCTION lifeos_json_text_array(value text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN RETURN '[]'::jsonb; END IF;
  RETURN CASE WHEN jsonb_typeof(value::jsonb) = 'array' THEN value::jsonb ELSE '[]'::jsonb END;
EXCEPTION WHEN others THEN
  RETURN '[]'::jsonb;
END $$;

-- Mirror of normalizeEmailForMatch: lowercase, trim, drop +tag sub-addressing,
-- collapse dots for Gmail mailboxes, reject anything without a dotted domain.
CREATE OR REPLACE FUNCTION lifeos_normalize_email(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v text := lower(btrim(coalesce(value, '')));
  at_pos int;
  local_part text;
  domain_part text;
  plus_pos int;
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  at_pos := length(v) - position('@' IN reverse(v)) + 1;
  IF position('@' IN v) = 0 OR at_pos <= 1 OR at_pos = length(v) THEN RETURN NULL; END IF;
  local_part := substr(v, 1, at_pos - 1);
  domain_part := substr(v, at_pos + 1);
  IF position('.' IN domain_part) = 0 THEN RETURN NULL; END IF;
  plus_pos := position('+' IN local_part);
  IF plus_pos > 1 THEN local_part := substr(local_part, 1, plus_pos - 1); END IF;
  IF domain_part IN ('gmail.com', 'googlemail.com') THEN local_part := replace(local_part, '.', ''); END IF;
  IF local_part = '' THEN RETURN NULL; END IF;
  RETURN local_part || '@' || domain_part;
END $$;

-- Mirror of normalizePhoneForMatch: digits only, drop a 00 prefix, drop a
-- leading US 1 on 11-digit numbers, require at least 7 digits.
CREATE OR REPLACE FUNCTION lifeos_normalize_phone(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  digits text := regexp_replace(coalesce(value, ''), '\D', '', 'g');
BEGIN
  digits := regexp_replace(digits, '^00', '');
  IF length(digits) = 11 AND left(digits, 1) = '1' THEN digits := substr(digits, 2); END IF;
  IF length(digits) >= 7 THEN RETURN digits; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION lifeos_sync_person_contacts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "PersonContact" WHERE "personId" = NEW.id;
  INSERT INTO "PersonContact" ("id", "workspaceId", "personId", "kind", "normalized")
  SELECT gen_random_uuid()::text, NEW."workspaceId", NEW.id, 'email', k
  FROM (SELECT DISTINCT lifeos_normalize_email(e) AS k
        FROM jsonb_array_elements_text(lifeos_json_text_array(NEW.emails)) AS e) s
  WHERE k IS NOT NULL;
  INSERT INTO "PersonContact" ("id", "workspaceId", "personId", "kind", "normalized")
  SELECT gen_random_uuid()::text, NEW."workspaceId", NEW.id, 'phone', k
  FROM (SELECT DISTINCT lifeos_normalize_phone(p) AS k
        FROM jsonb_array_elements_text(lifeos_json_text_array(NEW.phones)) AS p) s
  WHERE k IS NOT NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS person_contacts_sync ON "Person";
CREATE TRIGGER person_contacts_sync
AFTER INSERT OR UPDATE OF "emails", "phones", "workspaceId" ON "Person"
FOR EACH ROW EXECUTE FUNCTION lifeos_sync_person_contacts();

-- Backfill every existing Person once. Idempotent: the trigger owns the rows
-- from here on, and re-running this migration is a no-op under Prisma.
INSERT INTO "PersonContact" ("id", "workspaceId", "personId", "kind", "normalized")
SELECT gen_random_uuid()::text, p."workspaceId", p.id, 'email', s.k
FROM "Person" p
CROSS JOIN LATERAL (SELECT DISTINCT lifeos_normalize_email(e) AS k
                    FROM jsonb_array_elements_text(lifeos_json_text_array(p.emails)) AS e) s
WHERE s.k IS NOT NULL;

INSERT INTO "PersonContact" ("id", "workspaceId", "personId", "kind", "normalized")
SELECT gen_random_uuid()::text, p."workspaceId", p.id, 'phone', s.k
FROM "Person" p
CROSS JOIN LATERAL (SELECT DISTINCT lifeos_normalize_phone(ph) AS k
                    FROM jsonb_array_elements_text(lifeos_json_text_array(p.phones)) AS ph) s
WHERE s.k IS NOT NULL;
