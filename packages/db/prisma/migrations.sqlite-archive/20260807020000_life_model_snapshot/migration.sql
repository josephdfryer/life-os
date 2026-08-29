CREATE TABLE "LifeModelSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "version" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "modelId" TEXT,
    "promptVersion" TEXT,
    "synthesizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LifeModelSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LifeModelSnapshot_workspaceId_version_idx" ON "LifeModelSnapshot"("workspaceId", "version");
CREATE INDEX "LifeModelSnapshot_workspaceId_status_idx" ON "LifeModelSnapshot"("workspaceId", "status");

CREATE TABLE "LifeModelClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" REAL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "windowStart" DATETIME,
    "windowEnd" DATETIME,
    "evidence" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifeModelClaim_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LifeModelSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LifeModelClaim_snapshotId_idx" ON "LifeModelClaim"("snapshotId");
CREATE INDEX "LifeModelClaim_kind_idx" ON "LifeModelClaim"("kind");
CREATE INDEX "LifeModelClaim_subjectType_subjectId_idx" ON "LifeModelClaim"("subjectType", "subjectId");
