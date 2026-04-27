-- Add multi-value columns
ALTER TABLE "Person" ADD COLUMN "emails" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Person" ADD COLUMN "phones" TEXT NOT NULL DEFAULT '[]';

-- Migrate existing single values into JSON arrays
UPDATE "Person" SET "emails" = json_array("email") WHERE "email" IS NOT NULL AND "email" != '';
UPDATE "Person" SET "phones" = json_array("phone") WHERE "phone" IS NOT NULL AND "phone" != '';

-- Drop old columns and index (requires SQLite 3.35+)
DROP INDEX IF EXISTS "Person_email_idx";
ALTER TABLE "Person" DROP COLUMN "email";
ALTER TABLE "Person" DROP COLUMN "phone";
