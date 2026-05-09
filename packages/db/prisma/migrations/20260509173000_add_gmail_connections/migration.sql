-- CreateTable
CREATE TABLE "GmailConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
  "userId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider" TEXT NOT NULL DEFAULT 'google',
  "status" TEXT NOT NULL DEFAULT 'active',
  "accountEmail" TEXT,
  "mailboxId" TEXT NOT NULL DEFAULT 'me',
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "expiresAt" DATETIME,
  "scope" TEXT,
  "historyId" TEXT,
  "lastSyncedAt" DATETIME,
  "lastError" TEXT,
  CONSTRAINT "GmailConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GmailMessageLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
  "connectionId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider" TEXT NOT NULL DEFAULT 'google',
  "mailboxId" TEXT NOT NULL,
  "externalMessageId" TEXT NOT NULL,
  "threadId" TEXT,
  "historyId" TEXT,
  "interactionId" TEXT,
  "stagedItemId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastSeenAt" DATETIME,
  CONSTRAINT "GmailMessageLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GmailMessageLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GmailConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GmailMessageLink_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GmailMessageLink_stagedItemId_fkey" FOREIGN KEY ("stagedItemId") REFERENCES "StagedInteraction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_workspaceId_provider_mailboxId_key" ON "GmailConnection"("workspaceId", "provider", "mailboxId");
CREATE INDEX "GmailConnection_userId_idx" ON "GmailConnection"("userId");
CREATE INDEX "GmailConnection_workspaceId_status_idx" ON "GmailConnection"("workspaceId", "status");
CREATE UNIQUE INDEX "GmailMessageLink_workspaceId_provider_mailboxId_externalMessageId_key" ON "GmailMessageLink"("workspaceId", "provider", "mailboxId", "externalMessageId");
CREATE INDEX "GmailMessageLink_connectionId_idx" ON "GmailMessageLink"("connectionId");
CREATE INDEX "GmailMessageLink_interactionId_idx" ON "GmailMessageLink"("interactionId");
CREATE INDEX "GmailMessageLink_stagedItemId_idx" ON "GmailMessageLink"("stagedItemId");
CREATE INDEX "GmailMessageLink_workspaceId_status_idx" ON "GmailMessageLink"("workspaceId", "status");
