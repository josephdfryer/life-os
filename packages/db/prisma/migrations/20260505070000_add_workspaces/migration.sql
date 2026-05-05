-- CreateTable
CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "ownerUserId" TEXT,
  CONSTRAINT "Workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'owner',
  "status" TEXT NOT NULL DEFAULT 'active',
  CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovedEmail" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "email" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "workspaceId" TEXT,
  "invitedById" TEXT,
  CONSTRAINT "ApprovedEmail_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ApprovedEmail_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Seed the current single-user data into one owner workspace.
INSERT INTO "Workspace" ("id", "createdAt", "updatedAt", "name", "slug", "status")
VALUES ('default-workspace', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Joseph''s Life OS', 'joseph-life-os', 'active');

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "Event" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "Interaction" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "Plan" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "Place" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "Item" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "ImportedFile" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "StagedInteraction" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "Rule" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "RuleRun" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "ApiKey" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace';
ALTER TABLE "AuditLog" ADD COLUMN "workspaceId" TEXT DEFAULT 'default-workspace';

-- Preserve existing users as members of the default workspace.
INSERT INTO "WorkspaceMember" ("id", "createdAt", "updatedAt", "workspaceId", "userId", "role", "status")
SELECT lower(hex(randomblob(16))), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'default-workspace', "id", 'owner', 'active'
FROM "User";

UPDATE "Workspace"
SET "ownerUserId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "id" = 'default-workspace';

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE INDEX "Workspace_ownerUserId_idx" ON "Workspace"("ownerUserId");
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");

CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE INDEX "WorkspaceMember_workspaceId_status_idx" ON "WorkspaceMember"("workspaceId", "status");

CREATE UNIQUE INDEX "ApprovedEmail_email_key" ON "ApprovedEmail"("email");
CREATE INDEX "ApprovedEmail_status_idx" ON "ApprovedEmail"("status");
CREATE INDEX "ApprovedEmail_workspaceId_idx" ON "ApprovedEmail"("workspaceId");
CREATE INDEX "ApprovedEmail_invitedById_idx" ON "ApprovedEmail"("invitedById");

CREATE INDEX "Person_workspaceId_last_first_idx" ON "Person"("workspaceId", "last", "first");
CREATE INDEX "ApiKey_workspaceId_idx" ON "ApiKey"("workspaceId");
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");
CREATE INDEX "Rule_workspaceId_trigger_status_priority_idx" ON "Rule"("workspaceId", "trigger", "status", "priority");
CREATE INDEX "RuleRun_workspaceId_createdAt_idx" ON "RuleRun"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "StagedInteraction_workspaceId_source_sourceId_key" ON "StagedInteraction"("workspaceId", "source", "sourceId");
CREATE INDEX "Event_workspaceId_timestamp_idx" ON "Event"("workspaceId", "timestamp");
CREATE INDEX "Interaction_workspaceId_timestamp_idx" ON "Interaction"("workspaceId", "timestamp");
CREATE INDEX "Plan_workspaceId_createdAt_idx" ON "Plan"("workspaceId", "createdAt");
CREATE INDEX "Plan_workspaceId_personId_idx" ON "Plan"("workspaceId", "personId");
CREATE INDEX "Place_workspaceId_idx" ON "Place"("workspaceId");
CREATE INDEX "Item_workspaceId_idx" ON "Item"("workspaceId");
CREATE INDEX "ImportedFile_workspaceId_createdAt_idx" ON "ImportedFile"("workspaceId", "createdAt");

DROP INDEX IF EXISTS "StagedInteraction_source_sourceId_key";
