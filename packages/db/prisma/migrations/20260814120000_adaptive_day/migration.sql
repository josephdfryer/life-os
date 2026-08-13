CREATE TABLE "AdaptiveDayBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "day" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "capacityBand" TEXT NOT NULL,
    "inputSnapshot" TEXT NOT NULL,
    "missingSignals" TEXT NOT NULL DEFAULT '[]',
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'current',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdaptiveDayBrief_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AdaptiveDayBrief_workspaceId_day_rulesVersion_idx" ON "AdaptiveDayBrief"("workspaceId", "day", "rulesVersion");
CREATE INDEX "AdaptiveDayBrief_workspaceId_day_status_idx" ON "AdaptiveDayBrief"("workspaceId", "day", "status");

CREATE TABLE "AdaptiveIntervention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "briefId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "recommendationText" TEXT NOT NULL,
    "reasonCodes" TEXT NOT NULL DEFAULT '[]',
    "evidence" TEXT,
    "proposedCommand" TEXT,
    "riskTier" TEXT NOT NULL DEFAULT 'review',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewItemId" TEXT,
    "resultType" TEXT,
    "resultId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdaptiveIntervention_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "AdaptiveDayBrief" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AdaptiveIntervention_reviewItemId_key" ON "AdaptiveIntervention"("reviewItemId");
CREATE INDEX "AdaptiveIntervention_briefId_rank_idx" ON "AdaptiveIntervention"("briefId", "rank");
CREATE INDEX "AdaptiveIntervention_reviewItemId_idx" ON "AdaptiveIntervention"("reviewItemId");

CREATE TABLE "AdaptiveInterventionOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "interventionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "confidence" REAL,
    "evidence" TEXT,
    "note" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdaptiveInterventionOutcome_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AdaptiveInterventionOutcome_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "AdaptiveIntervention" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AdaptiveInterventionOutcome_workspaceId_createdAt_idx" ON "AdaptiveInterventionOutcome"("workspaceId", "createdAt");
CREATE INDEX "AdaptiveInterventionOutcome_interventionId_createdAt_idx" ON "AdaptiveInterventionOutcome"("interventionId", "createdAt");
