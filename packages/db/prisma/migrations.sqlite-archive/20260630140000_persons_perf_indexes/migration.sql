-- Migration: persons_perf_indexes
-- Adds emailSearch denormalized column and performance indexes for ~10k contacts.

ALTER TABLE "Person" ADD COLUMN "emailSearch" TEXT;
UPDATE "Person" SET "emailSearch" = lower("emails");

CREATE INDEX "Person_workspaceId_company_idx" ON "Person"("workspaceId", "company");
CREATE INDEX "Person_workspaceId_headline_idx" ON "Person"("workspaceId", "headline");
CREATE INDEX "Person_workspaceId_emailSearch_idx" ON "Person"("workspaceId", "emailSearch");
