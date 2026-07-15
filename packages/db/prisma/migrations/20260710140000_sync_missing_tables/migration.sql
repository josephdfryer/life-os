-- Migration: sync_missing_tables
-- Creates every schema table absent from production Turso (schema drift).
--
-- IF NOT EXISTS guards: on a clean migration replay, PlaceNote is already
-- created by 20260512224500_add_place_notes. This migration exists to
-- repair databases where drift left it missing.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlaceNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "placeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "eventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaceNote_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaceNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaceNote_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlaceNote_placeId_createdAt_idx" ON "PlaceNote"("placeId", "createdAt");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlaceNote_workspaceId_createdAt_idx" ON "PlaceNote"("workspaceId", "createdAt");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlaceNote_eventId_idx" ON "PlaceNote"("eventId");
