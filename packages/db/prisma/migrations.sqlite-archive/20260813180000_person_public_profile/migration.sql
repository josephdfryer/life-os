ALTER TABLE "Person" ADD COLUMN "publicProfileEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Person" ADD COLUMN "publicSlug" TEXT;

-- SQLite treats NULLs as distinct in a unique index, so the many Person rows
-- with no publicSlug do not collide with each other.
CREATE UNIQUE INDEX "Person_publicSlug_key" ON "Person"("publicSlug");
