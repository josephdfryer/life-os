CREATE TABLE "Connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "status" TEXT NOT NULL DEFAULT 'active',
    "accountEmail" TEXT,
    "label" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "expiresAt" DATETIME,
    "scope" TEXT,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "metadata" TEXT,
    "sourceTable" TEXT,
    "sourceId" TEXT,
    CONSTRAINT "Connection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Connection_workspaceId_kind_status_idx" ON "Connection"("workspaceId", "kind", "status");
CREATE INDEX "Connection_sourceTable_sourceId_idx" ON "Connection"("sourceTable", "sourceId");
CREATE INDEX "Connection_userId_idx" ON "Connection"("userId");
