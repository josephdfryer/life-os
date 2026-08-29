-- Storage-neutral media metadata, primary Item imagery, and auditable AI runs.
ALTER TABLE "ImportedFile" ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "ImportedFile" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "ImportedFile" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "ImportedFile" ADD COLUMN "checksum" TEXT;
ALTER TABLE "ImportedFile" ADD COLUMN "capturedAt" DATETIME;

ALTER TABLE "Item" ADD COLUMN "primaryImageFileId" TEXT REFERENCES "ImportedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Item" ADD COLUMN "attributes" TEXT;

CREATE TABLE "AiProviderCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "provider" TEXT NOT NULL,
  "label" TEXT,
  "apiKeyEncrypted" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastUsedAt" DATETIME,
  CONSTRAINT "AiProviderCredential_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AiAnalysisRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME,
  "credentialId" TEXT,
  "sourceFileId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "output" TEXT,
  "error" TEXT,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "estimatedCost" REAL,
  CONSTRAINT "AiAnalysisRun_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiAnalysisRun_credentialId_fkey"
    FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AiAnalysisRun_sourceFileId_fkey"
    FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AiProviderCredential_workspaceId_provider_key"
  ON "AiProviderCredential"("workspaceId", "provider");
CREATE INDEX "AiProviderCredential_workspaceId_status_idx"
  ON "AiProviderCredential"("workspaceId", "status");
CREATE INDEX "AiAnalysisRun_workspaceId_createdAt_idx"
  ON "AiAnalysisRun"("workspaceId", "createdAt");
CREATE INDEX "AiAnalysisRun_sourceFileId_idx"
  ON "AiAnalysisRun"("sourceFileId");
CREATE INDEX "ImportedFile_workspaceId_checksum_idx"
  ON "ImportedFile"("workspaceId", "checksum");
CREATE INDEX "Item_primaryImageFileId_idx"
  ON "Item"("primaryImageFileId");
