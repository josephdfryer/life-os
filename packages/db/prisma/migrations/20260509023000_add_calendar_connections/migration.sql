-- CreateTable
CREATE TABLE "CalendarConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
  "userId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider" TEXT NOT NULL DEFAULT 'google',
  "status" TEXT NOT NULL DEFAULT 'active',
  "accountEmail" TEXT,
  "calendarId" TEXT NOT NULL DEFAULT 'primary',
  "calendarSummary" TEXT,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "expiresAt" DATETIME,
  "scope" TEXT,
  "syncToken" TEXT,
  "lastSyncedAt" DATETIME,
  "lastError" TEXT,
  CONSTRAINT "CalendarConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarEventLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
  "connectionId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider" TEXT NOT NULL DEFAULT 'google',
  "calendarId" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "iCalUID" TEXT,
  "eventId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastSeenAt" DATETIME,
  CONSTRAINT "CalendarEventLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CalendarEventLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CalendarEventLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_workspaceId_provider_calendarId_key" ON "CalendarConnection"("workspaceId", "provider", "calendarId");
CREATE INDEX "CalendarConnection_userId_idx" ON "CalendarConnection"("userId");
CREATE INDEX "CalendarConnection_workspaceId_status_idx" ON "CalendarConnection"("workspaceId", "status");
CREATE UNIQUE INDEX "CalendarEventLink_workspaceId_provider_calendarId_externalEventId_key" ON "CalendarEventLink"("workspaceId", "provider", "calendarId", "externalEventId");
CREATE INDEX "CalendarEventLink_connectionId_idx" ON "CalendarEventLink"("connectionId");
CREATE INDEX "CalendarEventLink_eventId_idx" ON "CalendarEventLink"("eventId");
CREATE INDEX "CalendarEventLink_workspaceId_status_idx" ON "CalendarEventLink"("workspaceId", "status");
