ALTER TABLE "CalendarEventLink" ADD COLUMN "planId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "reconciliationStatus" TEXT;
ALTER TABLE "Plan" ADD COLUMN "reconciledAt" DATETIME;

CREATE INDEX "CalendarEventLink_planId_idx" ON "CalendarEventLink"("planId");
CREATE UNIQUE INDEX "Event_sourcePlanId_key" ON "Event"("sourcePlanId");

-- SQLite cannot add a foreign-key constraint to an existing table with
-- ALTER COLUMN. Prisma still enforces the relation in generated clients; the
-- next table-rebuild migration can materialize this constraint if needed.
