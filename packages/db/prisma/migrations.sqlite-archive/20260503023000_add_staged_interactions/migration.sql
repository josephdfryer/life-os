-- CreateTable
CREATE TABLE "StagedInteraction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "candidatePersonId" TEXT,
  "confidence" REAL,
  "matchReason" TEXT,
  "type" TEXT NOT NULL DEFAULT 'message',
  "timestamp" DATETIME NOT NULL,
  "summary" TEXT,
  "body" TEXT,
  "direction" TEXT,
  "metadata" TEXT,
  "acceptedAt" DATETIME,
  "acceptedPersonId" TEXT,
  "interactionId" TEXT,
  CONSTRAINT "StagedInteraction_candidatePersonId_fkey" FOREIGN KEY ("candidatePersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StagedInteraction_source_sourceId_key" ON "StagedInteraction"("source", "sourceId");

-- CreateIndex
CREATE INDEX "StagedInteraction_status_createdAt_idx" ON "StagedInteraction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StagedInteraction_candidatePersonId_idx" ON "StagedInteraction"("candidatePersonId");

-- CreateIndex
CREATE INDEX "StagedInteraction_timestamp_idx" ON "StagedInteraction"("timestamp");
