-- Workspace-level opt-in toggle for automatic contact deduplication.
-- See apps/persons/server/domain/merge.ts's autoDedupePersons.

ALTER TABLE "Workspace" ADD COLUMN "autoMergeEnabled" BOOLEAN NOT NULL DEFAULT false;
