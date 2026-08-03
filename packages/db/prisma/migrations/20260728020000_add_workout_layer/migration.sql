-- The workout layer for Level Up: exercises the workspace actually performs,
-- programs and their days, sessions, and body composition. Plus the columns
-- LevelUpTrainingSet needs to describe a set inside a prescription.

ALTER TABLE "LevelUpTrainingSet" ADD COLUMN "exerciseId" TEXT;
ALTER TABLE "LevelUpTrainingSet" ADD COLUMN "setIndex" INTEGER;
ALTER TABLE "LevelUpTrainingSet" ADD COLUMN "durationSec" INTEGER;
ALTER TABLE "LevelUpTrainingSet" ADD COLUMN "isBodyweight" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LevelUpTrainingSet" ADD COLUMN "rpe" REAL;

ALTER TABLE "LevelUpProfile" ADD COLUMN "unitPreference" TEXT NOT NULL DEFAULT 'lb';
ALTER TABLE "LevelUpProfile" ADD COLUMN "microPlates" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LevelUpProfile" ADD COLUMN "activeProgramId" TEXT;

CREATE TABLE IF NOT EXISTS "LevelUpExercise" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "modality" TEXT NOT NULL DEFAULT 'load',
  "catalogKey" TEXT,
  "defaultRestSec" INTEGER NOT NULL DEFAULT 90,
  "muscleGroup" TEXT,
  "jointLoad" TEXT,
  "substituteId" TEXT,
  CONSTRAINT "LevelUpExercise_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LevelUpExercise_substituteId_fkey"
    FOREIGN KEY ("substituteId") REFERENCES "LevelUpExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "LevelUpProgram" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "name" TEXT NOT NULL,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "LevelUpProgram_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "LevelUpProgramDay" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "LevelUpProgramDay_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LevelUpProgramDay_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "LevelUpProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "LevelUpProgramEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "programDayId" TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "targetSets" INTEGER NOT NULL DEFAULT 3,
  "targetReps" INTEGER,
  "targetLoadKg" REAL,
  "targetDurationSec" INTEGER,
  "restSec" INTEGER,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "LevelUpProgramEntry_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LevelUpProgramEntry_programDayId_fkey"
    FOREIGN KEY ("programDayId") REFERENCES "LevelUpProgramDay"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LevelUpProgramEntry_exerciseId_fkey"
    FOREIGN KEY ("exerciseId") REFERENCES "LevelUpExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "LevelUpSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" DATETIME,
  "programDayId" TEXT,
  "kneeFlare" BOOLEAN NOT NULL DEFAULT false,
  "lumbarFlare" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  CONSTRAINT "LevelUpSession_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LevelUpSession_programDayId_fkey"
    FOREIGN KEY ("programDayId") REFERENCES "LevelUpProgramDay"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "LevelUpBodyMetric" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "measuredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "weightKg" REAL,
  "bodyFatPct" REAL,
  "musclePct" REAL,
  "notes" TEXT,
  CONSTRAINT "LevelUpBodyMetric_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "LevelUpExercise_workspaceId_key_key" ON "LevelUpExercise"("workspaceId", "key");
CREATE INDEX IF NOT EXISTS "LevelUpExercise_workspaceId_idx" ON "LevelUpExercise"("workspaceId");
CREATE INDEX IF NOT EXISTS "LevelUpProgram_workspaceId_isActive_idx" ON "LevelUpProgram"("workspaceId", "isActive");
CREATE INDEX IF NOT EXISTS "LevelUpProgramDay_programId_order_idx" ON "LevelUpProgramDay"("programId", "order");
CREATE INDEX IF NOT EXISTS "LevelUpProgramDay_workspaceId_idx" ON "LevelUpProgramDay"("workspaceId");
CREATE INDEX IF NOT EXISTS "LevelUpProgramEntry_programDayId_order_idx" ON "LevelUpProgramEntry"("programDayId", "order");
CREATE INDEX IF NOT EXISTS "LevelUpProgramEntry_workspaceId_idx" ON "LevelUpProgramEntry"("workspaceId");
CREATE INDEX IF NOT EXISTS "LevelUpSession_workspaceId_startedAt_idx" ON "LevelUpSession"("workspaceId", "startedAt");
CREATE INDEX IF NOT EXISTS "LevelUpBodyMetric_workspaceId_measuredAt_idx" ON "LevelUpBodyMetric"("workspaceId", "measuredAt");
CREATE INDEX IF NOT EXISTS "LevelUpTrainingSet_workspaceId_exerciseId_performedAt_idx"
  ON "LevelUpTrainingSet"("workspaceId", "exerciseId", "performedAt");

-- SQLite cannot add a foreign key to an existing table, so
-- LevelUpTrainingSet.sessionId -> LevelUpSession stays client-enforced. The
-- column held free-text grouping keys and no rows existed at migration time.
