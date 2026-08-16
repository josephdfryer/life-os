-- Subject edges on Note, matching aboutGroupId.
-- Purely additive: nullable columns and indexes. No table is rebuilt,
-- truncated, or reset, and no existing row is deleted.
--
-- X.sourceNoteId remains provenance ("X was derived from this Note").
-- Note.aboutXId means "this Note is about X".

ALTER TABLE "Note" ADD COLUMN "aboutPersonId" TEXT;
ALTER TABLE "Note" ADD COLUMN "aboutPlaceId" TEXT;
ALTER TABLE "Note" ADD COLUMN "aboutItemId" TEXT;
ALTER TABLE "Note" ADD COLUMN "aboutEventId" TEXT;
ALTER TABLE "Note" ADD COLUMN "aboutPlanId" TEXT;
ALTER TABLE "Note" ADD COLUMN "aboutStateId" TEXT;

CREATE INDEX "Note_workspaceId_aboutPersonId_timestamp_idx" ON "Note"("workspaceId", "aboutPersonId", "timestamp" DESC);
CREATE INDEX "Note_workspaceId_aboutPlaceId_timestamp_idx" ON "Note"("workspaceId", "aboutPlaceId", "timestamp" DESC);
CREATE INDEX "Note_workspaceId_aboutItemId_timestamp_idx" ON "Note"("workspaceId", "aboutItemId", "timestamp" DESC);
CREATE INDEX "Note_workspaceId_aboutEventId_timestamp_idx" ON "Note"("workspaceId", "aboutEventId", "timestamp" DESC);
CREATE INDEX "Note_workspaceId_aboutPlanId_timestamp_idx" ON "Note"("workspaceId", "aboutPlanId", "timestamp" DESC);
CREATE INDEX "Note_workspaceId_aboutStateId_timestamp_idx" ON "Note"("workspaceId", "aboutStateId", "timestamp" DESC);

-- Theory used to stuff the subject into metadata.subjectPersonId. Promote
-- those to the real edge so synthesis can query the column instead of a
-- string search. json_extract returns NULL on non-JSON, so this is a no-op
-- for notes that never had a subject.
UPDATE "Note"
SET "aboutPersonId" = json_extract("metadata", '$.subjectPersonId')
WHERE "aboutPersonId" IS NULL
  AND json_extract("metadata", '$.subjectPersonId') IS NOT NULL
  AND json_extract("metadata", '$.subjectPersonId') != '';
