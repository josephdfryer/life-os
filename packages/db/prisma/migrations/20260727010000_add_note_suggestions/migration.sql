CREATE TABLE "NoteAnalysisRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "credentialId" TEXT,
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
  CONSTRAINT "NoteAnalysisRun_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NoteAnalysisRun_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NoteAnalysisRun_credentialId_fkey"
    FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "NoteSuggestion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "analysisRunId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" DATETIME,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "title" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "confidence" REAL,
  "acceptedEntityType" TEXT,
  "acceptedEntityId" TEXT,
  CONSTRAINT "NoteSuggestion_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NoteSuggestion_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NoteSuggestion_analysisRunId_fkey"
    FOREIGN KEY ("analysisRunId") REFERENCES "NoteAnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NoteAnalysisRun_noteId_promptVersion_key"
  ON "NoteAnalysisRun"("noteId", "promptVersion");
CREATE INDEX "NoteAnalysisRun_workspaceId_createdAt_idx"
  ON "NoteAnalysisRun"("workspaceId", "createdAt");
CREATE INDEX "NoteAnalysisRun_noteId_createdAt_idx"
  ON "NoteAnalysisRun"("noteId", "createdAt");
CREATE INDEX "NoteSuggestion_workspaceId_status_createdAt_idx"
  ON "NoteSuggestion"("workspaceId", "status", "createdAt");
CREATE INDEX "NoteSuggestion_noteId_status_idx"
  ON "NoteSuggestion"("noteId", "status");
CREATE INDEX "NoteSuggestion_analysisRunId_idx"
  ON "NoteSuggestion"("analysisRunId");
