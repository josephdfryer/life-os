-- Additive provenance for Granola note imports. Provider content remains on
-- the canonical Event; credentials and sync state remain on Connection.
CREATE TABLE "GranolaNoteLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "connectionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "externalNoteId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "calendarEventId" TEXT,
    "remoteCreatedAt" DATETIME,
    "remoteUpdatedAt" DATETIME,
    "contentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'synced',
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GranolaNoteLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GranolaNoteLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GranolaNoteLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GranolaNoteLink_workspaceId_externalNoteId_key" ON "GranolaNoteLink"("workspaceId", "externalNoteId");
CREATE INDEX "GranolaNoteLink_connectionId_status_idx" ON "GranolaNoteLink"("connectionId", "status");
CREATE INDEX "GranolaNoteLink_eventId_idx" ON "GranolaNoteLink"("eventId");
CREATE INDEX "GranolaNoteLink_workspaceId_remoteUpdatedAt_idx" ON "GranolaNoteLink"("workspaceId", "remoteUpdatedAt");
