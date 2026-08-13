-- Level Up: idempotent native-session/set replay, session RPE, workout Event
-- reconciliation, and the readiness-snapshot provenance record.
-- See docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md "Public interfaces and
-- persistence" and "Readiness provenance".

ALTER TABLE "LevelUpTrainingSet" ADD COLUMN "source" TEXT;
ALTER TABLE "LevelUpTrainingSet" ADD COLUMN "sourceId" TEXT;
CREATE UNIQUE INDEX "LevelUpTrainingSet_workspaceId_source_sourceId_key" ON "LevelUpTrainingSet"("workspaceId", "source", "sourceId");

ALTER TABLE "LevelUpSession" ADD COLUMN "source" TEXT;
ALTER TABLE "LevelUpSession" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "LevelUpSession" ADD COLUMN "sessionRpe" REAL;
ALTER TABLE "LevelUpSession" ADD COLUMN "workoutEventId" TEXT;
CREATE UNIQUE INDEX "LevelUpSession_workspaceId_source_sourceId_key" ON "LevelUpSession"("workspaceId", "source", "sourceId");

CREATE TABLE "LevelUpReadinessSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshotAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "localDay" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL DEFAULT 'v1',
  "ruleSetVersion" TEXT NOT NULL DEFAULT 'v1',
  "inputs" TEXT NOT NULL,
  "formSignal" TEXT,
  "band" TEXT NOT NULL DEFAULT 'full',
  "originalPrescriptionHash" TEXT,
  "suggestedPrescriptionHash" TEXT,
  "reasonCodes" TEXT NOT NULL DEFAULT '[]',
  "userChoice" TEXT,
  "overriddenAt" DATETIME,
  CONSTRAINT "LevelUpReadinessSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LevelUpReadinessSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LevelUpSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LevelUpReadinessSnapshot_sessionId_key" ON "LevelUpReadinessSnapshot"("sessionId");
CREATE INDEX "LevelUpReadinessSnapshot_workspaceId_snapshotAt_idx" ON "LevelUpReadinessSnapshot"("workspaceId", "snapshotAt");
