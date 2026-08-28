CREATE TABLE "Device" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "platform" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "appVersion" TEXT NOT NULL,
  "lastSeenAt" DATETIME,
  "revokedAt" DATETIME,
  CONSTRAINT "Device_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Device_workspaceId_createdAt_idx" ON "Device"("workspaceId", "createdAt");
CREATE INDEX "Device_workspaceId_revokedAt_idx" ON "Device"("workspaceId", "revokedAt");

CREATE TABLE "DeviceSource" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "source" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "permissionStatus" TEXT NOT NULL DEFAULT 'unknown',
  "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
  "lastSuccessAt" DATETIME,
  "lastErrorCode" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "DeviceSource_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeviceSource_deviceId_source_key" ON "DeviceSource"("deviceId", "source");
CREATE INDEX "DeviceSource_deviceId_enabled_idx" ON "DeviceSource"("deviceId", "enabled");

CREATE TABLE "DeviceCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "accessExpiresAt" DATETIME NOT NULL,
  "refreshExpiresAt" DATETIME NOT NULL,
  "scopes" TEXT NOT NULL,
  "lastUsedAt" DATETIME,
  "revokedAt" DATETIME,
  CONSTRAINT "DeviceCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeviceCredential_refreshTokenHash_key" ON "DeviceCredential"("refreshTokenHash");
CREATE UNIQUE INDEX "DeviceCredential_accessTokenHash_key" ON "DeviceCredential"("accessTokenHash");
CREATE INDEX "DeviceCredential_deviceId_revokedAt_idx" ON "DeviceCredential"("deviceId", "revokedAt");
CREATE INDEX "DeviceCredential_accessExpiresAt_idx" ON "DeviceCredential"("accessExpiresAt");
CREATE INDEX "DeviceCredential_refreshExpiresAt_idx" ON "DeviceCredential"("refreshExpiresAt");

CREATE TABLE "DeviceAuthorization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "codeHash" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  CONSTRAINT "DeviceAuthorization_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeviceAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeviceAuthorization_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeviceAuthorization_codeHash_key" ON "DeviceAuthorization"("codeHash");
CREATE INDEX "DeviceAuthorization_workspaceId_createdAt_idx" ON "DeviceAuthorization"("workspaceId", "createdAt");
CREATE INDEX "DeviceAuthorization_deviceId_expiresAt_idx" ON "DeviceAuthorization"("deviceId", "expiresAt");

CREATE TABLE "DeviceIngestItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "source" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "observedAt" DATETIME NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "resultType" TEXT,
  "resultId" TEXT,
  "errorCode" TEXT,
  CONSTRAINT "DeviceIngestItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeviceIngestItem_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeviceIngestItem_workspaceId_source_sourceId_key" ON "DeviceIngestItem"("workspaceId", "source", "sourceId");
CREATE INDEX "DeviceIngestItem_deviceId_createdAt_idx" ON "DeviceIngestItem"("deviceId", "createdAt");
CREATE INDEX "DeviceIngestItem_workspaceId_status_createdAt_idx" ON "DeviceIngestItem"("workspaceId", "status", "createdAt");
