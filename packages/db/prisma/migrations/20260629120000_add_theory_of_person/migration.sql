-- Migration: add_theory_of_person
-- App-layer cache/versioning for the Theory of Person view. NOT a life primitive.
-- TheorySnapshot is a versioned, auditable synthesis derived from stored truth;
-- TheorySnapshotSource links each snapshot back to the records used to build it.

CREATE TABLE "TheorySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "subjectPersonId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "markdownBody" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "confidence" REAL,
    "synthesizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TheorySnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TheorySnapshot_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TheorySnapshot_subjectPersonId_idx" ON "TheorySnapshot"("subjectPersonId");
CREATE INDEX "TheorySnapshot_subjectPersonId_version_idx" ON "TheorySnapshot"("subjectPersonId", "version");
CREATE INDEX "TheorySnapshot_status_idx" ON "TheorySnapshot"("status");
CREATE INDEX "TheorySnapshot_workspaceId_idx" ON "TheorySnapshot"("workspaceId");

CREATE TABLE "TheorySnapshotSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "contribution" TEXT,
    "weight" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TheorySnapshotSource_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TheorySnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TheorySnapshotSource_snapshotId_idx" ON "TheorySnapshotSource"("snapshotId");
CREATE INDEX "TheorySnapshotSource_sourceType_sourceId_idx" ON "TheorySnapshotSource"("sourceType", "sourceId");
