-- AlterTable
ALTER TABLE "Place" ADD COLUMN "googlePlaceId" TEXT;

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "format" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rawData" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "stagedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportStagedVisit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importJobId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "placeName" TEXT,
    "placeAddress" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "googlePlaceId" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "confidence" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedPlaceId" TEXT,
    "resolvedEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportStagedVisit_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportStagedVisit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportStagedVisit_resolvedPlaceId_fkey" FOREIGN KEY ("resolvedPlaceId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ImportJob_workspaceId_createdAt_idx" ON "ImportJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_workspaceId_status_idx" ON "ImportJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ImportStagedVisit_importJobId_status_confidence_idx" ON "ImportStagedVisit"("importJobId", "status", "confidence");

-- CreateIndex
CREATE INDEX "ImportStagedVisit_workspaceId_status_startedAt_idx" ON "ImportStagedVisit"("workspaceId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "ImportStagedVisit_googlePlaceId_idx" ON "ImportStagedVisit"("googlePlaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Place_googlePlaceId_key" ON "Place"("googlePlaceId");

