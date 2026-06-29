-- Migration: add_note_primitive
-- Adds the Note primitive (8th primitive) and nullable sourceNoteId provenance
-- links on Plan, Event, State, Interaction, and Group.

-- ── Note table ───────────────────────────────────────────────────────────────

CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timestamp" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "sourceFileId" TEXT,
    CONSTRAINT "Note_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Note_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Note_workspaceId_timestamp_idx" ON "Note"("workspaceId", "timestamp" DESC);
CREATE INDEX "Note_sourceFileId_idx" ON "Note"("sourceFileId");

-- ── Provenance: sourceNoteId on derived models ───────────────────────────────

ALTER TABLE "Event" ADD COLUMN "sourceNoteId" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "sourceNoteId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "sourceNoteId" TEXT;
ALTER TABLE "Group" ADD COLUMN "sourceNoteId" TEXT;
ALTER TABLE "State" ADD COLUMN "sourceNoteId" TEXT;
