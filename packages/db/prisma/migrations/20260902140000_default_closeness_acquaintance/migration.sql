-- A newly created Person is an address-book fact until the owner explicitly
-- declares a closer relationship. Keep existing closeness choices unchanged;
-- this migration changes only the database default for future direct writes.
ALTER TABLE "Person" ALTER COLUMN "closeness" SET DEFAULT 1;
