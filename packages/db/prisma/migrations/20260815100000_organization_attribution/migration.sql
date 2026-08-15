-- Organization attribution on interactions and notes.
-- Purely additive: two nullable columns and two indexes. No table is rebuilt,
-- truncated, or reset, and no existing row changes.

-- The organization an interaction was with, stamped when it happens rather than
-- inferred later from employment dates.
ALTER TABLE "Interaction" ADD COLUMN "groupId" TEXT;

-- Subject, not provenance: "this Note is about this Group". Group.sourceNoteId
-- is the reverse edge and means "this Group was derived from this Note".
ALTER TABLE "Note" ADD COLUMN "aboutGroupId" TEXT;

CREATE INDEX "Interaction_workspaceId_groupId_timestamp_idx" ON "Interaction"("workspaceId", "groupId", "timestamp" DESC);
CREATE INDEX "Note_workspaceId_aboutGroupId_timestamp_idx" ON "Note"("workspaceId", "aboutGroupId", "timestamp" DESC);
