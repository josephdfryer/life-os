-- Display-name backfill for the "Life OS" -> "LifeOS" rename.
--
-- Data-only: no table is created, altered, or dropped. Code that creates new
-- workspaces already writes "LifeOS", so without this pass a database keeps a
-- permanent mix of both spellings.
--
-- `slug` is deliberately untouched: slugs are identifiers, they are joined on
-- and appear in URLs, so 'joseph-life-os' must keep resolving.
--
-- Paired production script: packages/db/turso-migrate-lifeos-rename.ts
UPDATE "Workspace"
   SET "name" = REPLACE("name", 'Life OS', 'LifeOS')
 WHERE "name" LIKE '%Life OS%';
