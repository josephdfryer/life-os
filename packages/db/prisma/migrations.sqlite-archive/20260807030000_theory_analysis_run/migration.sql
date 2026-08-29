CREATE TABLE "TheoryAnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "subjectPersonId" TEXT NOT NULL,
    "credentialId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "snapshotId" TEXT,
    "output" TEXT,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCost" REAL,
    CONSTRAINT "TheoryAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TheoryAnalysisRun_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TheoryAnalysisRun_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TheoryAnalysisRun_workspaceId_createdAt_idx" ON "TheoryAnalysisRun"("workspaceId", "createdAt");
CREATE INDEX "TheoryAnalysisRun_subjectPersonId_createdAt_idx" ON "TheoryAnalysisRun"("subjectPersonId", "createdAt");
CREATE INDEX "TheoryAnalysisRun_subjectPersonId_status_idx" ON "TheoryAnalysisRun"("subjectPersonId", "status");
