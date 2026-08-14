-- File intelligence adds support records around the existing Note and
-- ImportedFile provenance model. This migration is deliberately additive:
-- no primitive or existing support table is rebuilt or truncated.

ALTER TABLE "AssistantMessage" ADD COLUMN "metadata" TEXT;
ALTER TABLE "ImportedFile" ADD COLUMN "uploadIntentId" TEXT;
ALTER TABLE "ImportedFile" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "ImportedFile" ADD COLUMN "archiveReason" TEXT;
ALTER TABLE "ImportedFile" ADD COLUMN "processingState" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "AiAnalysisRun" ADD COLUMN "processingRunId" TEXT;
ALTER TABLE "AiAnalysisRun" ADD COLUMN "purpose" TEXT;
ALTER TABLE "TheorySnapshotSource" ADD COLUMN "evidenceClaimId" TEXT;
ALTER TABLE "TheorySnapshotSource" ADD COLUMN "evidenceClassification" TEXT;
ALTER TABLE "TheorySnapshotSource" ADD COLUMN "evidenceStatus" TEXT;
ALTER TABLE "TheorySnapshotSource" ADD COLUMN "citation" TEXT;

CREATE TABLE "FileUploadIntent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  "completedAt" DATETIME,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "filename" TEXT NOT NULL,
  "safeFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "storeOnly" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "FileUploadIntent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FileProcessingRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "sourceFileId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "processorVersion" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "workflowRunId" TEXT,
  "summary" TEXT,
  "error" TEXT,
  CONSTRAINT "FileProcessingRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileProcessingRun_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FileChunk" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "sourceFileId" TEXT NOT NULL,
  "processingRunId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "locatorType" TEXT NOT NULL,
  "locator" TEXT NOT NULL,
  CONSTRAINT "FileChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileChunk_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileChunk_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "FileProcessingRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FileEntityMention" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "sourceFileId" TEXT NOT NULL,
  "processingRunId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "entityType" TEXT NOT NULL,
  "sourceText" TEXT NOT NULL,
  "normalizedText" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "exactQuote" TEXT NOT NULL,
  "identityEvidence" TEXT,
  "startOffset" INTEGER,
  "endOffset" INTEGER,
  "confidence" REAL NOT NULL,
  "resolutionStatus" TEXT NOT NULL DEFAULT 'unresolved',
  "resolutionLevel" INTEGER,
  "resolutionReason" TEXT,
  "resolvedEntityId" TEXT,
  "resolvedPersonId" TEXT,
  "resolutionUpdatedAt" DATETIME,
  CONSTRAINT "FileEntityMention_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileEntityMention_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileEntityMention_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "FileProcessingRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileEntityMention_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "FileChunk" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileEntityMention_resolvedPersonId_fkey" FOREIGN KEY ("resolvedPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "EvidenceClaim" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "sourceFileId" TEXT NOT NULL,
  "processingRunId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "assertion" TEXT NOT NULL,
  "structuredValue" TEXT,
  "classification" TEXT NOT NULL,
  "claimType" TEXT,
  "exactQuote" TEXT NOT NULL,
  "startOffset" INTEGER,
  "endOffset" INTEGER,
  "occurredAt" DATETIME,
  "validFrom" DATETIME,
  "validTo" DATETIME,
  "confidence" REAL NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unreviewed',
  "reviewedAt" DATETIME,
  "reviewedBy" TEXT,
  "supersedesClaimId" TEXT,
  "correctionNoteId" TEXT,
  "graphResultType" TEXT,
  "graphResultId" TEXT,
  "graphEventId" TEXT,
  CONSTRAINT "EvidenceClaim_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EvidenceClaim_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EvidenceClaim_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "FileProcessingRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EvidenceClaim_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "FileChunk" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EvidenceClaim_supersedesClaimId_fkey" FOREIGN KEY ("supersedesClaimId") REFERENCES "EvidenceClaim" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EvidenceClaim_correctionNoteId_fkey" FOREIGN KEY ("correctionNoteId") REFERENCES "Note" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "FileEntityResolution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fromPersonId" TEXT,
  "toPersonId" TEXT,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "reason" TEXT,
  CONSTRAINT "FileEntityResolution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileEntityResolution_mentionId_fkey" FOREIGN KEY ("mentionId") REFERENCES "FileEntityMention" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileEntityResolution_fromPersonId_fkey" FOREIGN KEY ("fromPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FileEntityResolution_toPersonId_fkey" FOREIGN KEY ("toPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PersonExternalIdentifier" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "provider" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonExternalIdentifier_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PersonExternalIdentifier_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "EvidenceClaimSubject" (
  "claimId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "subjectRole" TEXT NOT NULL,
  "relevanceWeight" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("claimId", "mentionId"),
  CONSTRAINT "EvidenceClaimSubject_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "EvidenceClaim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EvidenceClaimSubject_mentionId_fkey" FOREIGN KEY ("mentionId") REFERENCES "FileEntityMention" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FileUploadIntent_workspaceId_storageKey_key" ON "FileUploadIntent"("workspaceId", "storageKey");
CREATE INDEX "FileUploadIntent_workspaceId_status_createdAt_idx" ON "FileUploadIntent"("workspaceId", "status", "createdAt");
CREATE INDEX "FileUploadIntent_expiresAt_idx" ON "FileUploadIntent"("expiresAt");
CREATE UNIQUE INDEX "FileProcessingRun_workspaceId_runKey_key" ON "FileProcessingRun"("workspaceId", "runKey");
CREATE INDEX "FileProcessingRun_workspaceId_status_createdAt_idx" ON "FileProcessingRun"("workspaceId", "status", "createdAt");
CREATE INDEX "FileProcessingRun_sourceFileId_createdAt_idx" ON "FileProcessingRun"("sourceFileId", "createdAt");
CREATE INDEX "FileProcessingRun_workflowRunId_idx" ON "FileProcessingRun"("workflowRunId");
CREATE UNIQUE INDEX "FileChunk_processingRunId_ordinal_key" ON "FileChunk"("processingRunId", "ordinal");
CREATE INDEX "FileChunk_workspaceId_sourceFileId_version_ordinal_idx" ON "FileChunk"("workspaceId", "sourceFileId", "version", "ordinal");
CREATE INDEX "FileChunk_workspaceId_createdAt_idx" ON "FileChunk"("workspaceId", "createdAt");
CREATE INDEX "FileEntityMention_workspaceId_entityType_normalizedText_idx" ON "FileEntityMention"("workspaceId", "entityType", "normalizedText");
CREATE INDEX "FileEntityMention_workspaceId_resolvedPersonId_createdAt_idx" ON "FileEntityMention"("workspaceId", "resolvedPersonId", "createdAt");
CREATE INDEX "FileEntityMention_workspaceId_resolutionStatus_createdAt_idx" ON "FileEntityMention"("workspaceId", "resolutionStatus", "createdAt");
CREATE INDEX "FileEntityMention_sourceFileId_chunkId_idx" ON "FileEntityMention"("sourceFileId", "chunkId");
CREATE INDEX "FileEntityResolution_workspaceId_createdAt_idx" ON "FileEntityResolution"("workspaceId", "createdAt");
CREATE INDEX "FileEntityResolution_mentionId_createdAt_idx" ON "FileEntityResolution"("mentionId", "createdAt");
CREATE INDEX "FileEntityResolution_fromPersonId_createdAt_idx" ON "FileEntityResolution"("fromPersonId", "createdAt");
CREATE INDEX "FileEntityResolution_toPersonId_createdAt_idx" ON "FileEntityResolution"("toPersonId", "createdAt");
CREATE UNIQUE INDEX "PersonExternalIdentifier_workspaceId_externalId_key" ON "PersonExternalIdentifier"("workspaceId", "externalId");
CREATE INDEX "PersonExternalIdentifier_personId_idx" ON "PersonExternalIdentifier"("personId");
CREATE INDEX "EvidenceClaim_workspaceId_status_createdAt_idx" ON "EvidenceClaim"("workspaceId", "status", "createdAt");
CREATE INDEX "EvidenceClaim_workspaceId_classification_createdAt_idx" ON "EvidenceClaim"("workspaceId", "classification", "createdAt");
CREATE INDEX "EvidenceClaim_sourceFileId_chunkId_idx" ON "EvidenceClaim"("sourceFileId", "chunkId");
CREATE INDEX "EvidenceClaim_supersedesClaimId_idx" ON "EvidenceClaim"("supersedesClaimId");
CREATE INDEX "EvidenceClaimSubject_mentionId_idx" ON "EvidenceClaimSubject"("mentionId");
CREATE INDEX "EvidenceClaimSubject_claimId_relevanceWeight_idx" ON "EvidenceClaimSubject"("claimId", "relevanceWeight");
CREATE UNIQUE INDEX "ImportedFile_uploadIntentId_key" ON "ImportedFile"("uploadIntentId");
CREATE INDEX "ImportedFile_workspaceId_archivedAt_createdAt_idx" ON "ImportedFile"("workspaceId", "archivedAt", "createdAt");
CREATE INDEX "ImportedFile_workspaceId_processingState_createdAt_idx" ON "ImportedFile"("workspaceId", "processingState", "createdAt");
CREATE INDEX "AiAnalysisRun_processingRunId_purpose_idx" ON "AiAnalysisRun"("processingRunId", "purpose");
CREATE INDEX "TheorySnapshotSource_evidenceClaimId_idx" ON "TheorySnapshotSource"("evidenceClaimId");

-- External-content FTS keeps workspace and file identity in ordinary columns;
-- application queries always include workspaceId and archivedAt checks.
CREATE VIRTUAL TABLE "FileChunkFts" USING fts5(
  "chunkId" UNINDEXED,
  "workspaceId" UNINDEXED,
  "sourceFileId" UNINDEXED,
  "filename",
  "content",
  tokenize = 'unicode61 remove_diacritics 2'
);
