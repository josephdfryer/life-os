-- Migration: add_era_finance
-- Era (era.app) finance integration: connection, account links, transaction links.
-- See docs/ERA_FINANCE_INTEGRATION.md

CREATE TABLE "EraConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
  "userId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "accountEmail" TEXT,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "expiresAt" DATETIME,
  "scope" TEXT,
  "lastSyncedAt" DATETIME,
  "lastError" TEXT,
  "syncCursor" TEXT,
  CONSTRAINT "EraConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EraConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EraConnection_workspaceId_userId_key" ON "EraConnection"("workspaceId", "userId");
CREATE INDEX "EraConnection_userId_idx" ON "EraConnection"("userId");
CREATE INDEX "EraConnection_workspaceId_status_idx" ON "EraConnection"("workspaceId", "status");

CREATE TABLE "EraAccountLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
  "connectionId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "eraAccountId" TEXT NOT NULL,
  "institution" TEXT,
  "accountName" TEXT,
  "accountType" TEXT,
  "currency" TEXT DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastSeenAt" DATETIME,
  CONSTRAINT "EraAccountLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EraAccountLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EraConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EraAccountLink_workspaceId_eraAccountId_key" ON "EraAccountLink"("workspaceId", "eraAccountId");
CREATE INDEX "EraAccountLink_connectionId_idx" ON "EraAccountLink"("connectionId");
CREATE INDEX "EraAccountLink_workspaceId_status_idx" ON "EraAccountLink"("workspaceId", "status");

CREATE TABLE "EraTransactionLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
  "connectionId" TEXT NOT NULL,
  "accountLinkId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "eraTransactionId" TEXT NOT NULL,
  "interactionId" TEXT,
  "stagedItemId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'staged',
  "lastSeenAt" DATETIME,
  CONSTRAINT "EraTransactionLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EraTransactionLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EraConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EraTransactionLink_accountLinkId_fkey" FOREIGN KEY ("accountLinkId") REFERENCES "EraAccountLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EraTransactionLink_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EraTransactionLink_stagedItemId_fkey" FOREIGN KEY ("stagedItemId") REFERENCES "StagedInteraction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EraTransactionLink_workspaceId_eraTransactionId_key" ON "EraTransactionLink"("workspaceId", "eraTransactionId");
CREATE INDEX "EraTransactionLink_connectionId_idx" ON "EraTransactionLink"("connectionId");
CREATE INDEX "EraTransactionLink_interactionId_idx" ON "EraTransactionLink"("interactionId");
CREATE INDEX "EraTransactionLink_stagedItemId_idx" ON "EraTransactionLink"("stagedItemId");
CREATE INDEX "EraTransactionLink_workspaceId_status_idx" ON "EraTransactionLink"("workspaceId", "status");
