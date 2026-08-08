CREATE TABLE "LifeModelAnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "credentialId" TEXT,
    "snapshotId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCost" REAL,
    CONSTRAINT "LifeModelAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LifeModelAnalysisRun_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LifeModelAnalysisRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LifeModelSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "LifeModelAnalysisRun_workspaceId_createdAt_idx" ON "LifeModelAnalysisRun"("workspaceId", "createdAt");
CREATE INDEX "LifeModelAnalysisRun_workspaceId_status_idx" ON "LifeModelAnalysisRun"("workspaceId", "status");
CREATE INDEX "LifeModelAnalysisRun_snapshotId_idx" ON "LifeModelAnalysisRun"("snapshotId");

CREATE TABLE "LifeModelClaimFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "claimId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "replacementStatement" TEXT,
    "reason" TEXT,
    "sourceNoteId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifeModelClaimFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LifeModelClaimFeedback_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "LifeModelClaim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LifeModelClaimFeedback_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "LifeModelClaimFeedback_workspaceId_createdAt_idx" ON "LifeModelClaimFeedback"("workspaceId", "createdAt");
CREATE INDEX "LifeModelClaimFeedback_claimId_createdAt_idx" ON "LifeModelClaimFeedback"("claimId", "createdAt");
CREATE INDEX "LifeModelClaimFeedback_sourceNoteId_idx" ON "LifeModelClaimFeedback"("sourceNoteId");
