-- Control plane foundation: GraphEvent, GraphEventReceipt, ReviewItem.
-- See docs/adr/0002-graph-event-spine.md.
--
-- All three tables are new — no existing table is altered. Safe on a
-- populated database with no downtime.

CREATE TABLE "GraphEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "sourceConnector" TEXT,
    "correlationId" TEXT,
    "causationId" TEXT,
    "causationDepth" INTEGER NOT NULL DEFAULT 0,
    "ruleVersionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "provenance" TEXT,
    CONSTRAINT "GraphEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GraphEvent_causationId_fkey" FOREIGN KEY ("causationId") REFERENCES "GraphEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GraphEvent_workspaceId_idempotencyKey_key" ON "GraphEvent"("workspaceId", "idempotencyKey");
CREATE INDEX "GraphEvent_workspaceId_occurredAt_idx" ON "GraphEvent"("workspaceId", "occurredAt" DESC);
CREATE INDEX "GraphEvent_workspaceId_subjectType_subjectId_idx" ON "GraphEvent"("workspaceId", "subjectType", "subjectId");
CREATE INDEX "GraphEvent_workspaceId_eventType_occurredAt_idx" ON "GraphEvent"("workspaceId", "eventType", "occurredAt" DESC);
CREATE INDEX "GraphEvent_correlationId_idx" ON "GraphEvent"("correlationId");
CREATE INDEX "GraphEvent_causationId_idx" ON "GraphEvent"("causationId");

CREATE TABLE "GraphEventReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" DATETIME,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphEventReceipt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "GraphEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GraphEventReceipt_eventId_consumer_key" ON "GraphEventReceipt"("eventId", "consumer");
CREATE INDEX "GraphEventReceipt_consumer_status_nextRetryAt_idx" ON "GraphEventReceipt"("consumer", "status", "nextRetryAt");

CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "proposedCommand" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "confidence" REAL,
    "evidence" TEXT,
    "riskTier" TEXT NOT NULL DEFAULT 'review',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "resultType" TEXT,
    "resultId" TEXT,
    CONSTRAINT "ReviewItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReviewItem_workspaceId_source_sourceId_key" ON "ReviewItem"("workspaceId", "source", "sourceId");
CREATE INDEX "ReviewItem_workspaceId_status_priority_createdAt_idx" ON "ReviewItem"("workspaceId", "status", "priority", "createdAt");
CREATE INDEX "ReviewItem_workspaceId_source_itemType_idx" ON "ReviewItem"("workspaceId", "source", "itemType");
CREATE INDEX "ReviewItem_workspaceId_targetType_targetId_idx" ON "ReviewItem"("workspaceId", "targetType", "targetId");
