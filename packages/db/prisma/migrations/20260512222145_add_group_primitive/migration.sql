/*
  Warnings:

  - You are about to drop the column `email` on the `Person` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Person` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "name" TEXT NOT NULL,
    "groupType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Group_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PersonGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    CONSTRAINT "PersonGroup_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PersonGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentGroupId" TEXT NOT NULL,
    "childGroupId" TEXT NOT NULL,
    "role" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    CONSTRAINT "GroupGroup_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupGroup_childGroupId_fkey" FOREIGN KEY ("childGroupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaceGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "placeId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    CONSTRAINT "PlaceGroup_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaceGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_EventGroupTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_EventGroupTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_EventGroupTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" DATETIME,
    "lastUsedAt" DATETIME,
    "createdByUserId" TEXT,
    "ownerPersonId" TEXT,
    CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ApiKey_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ApiKey" ("createdAt", "createdByUserId", "expiresAt", "id", "keyHash", "keyPrefix", "lastUsedAt", "name", "ownerPersonId", "status", "updatedAt", "workspaceId") SELECT "createdAt", "createdByUserId", "expiresAt", "id", "keyHash", "keyPrefix", "lastUsedAt", "name", "ownerPersonId", "status", "updatedAt", "workspaceId" FROM "ApiKey";
DROP TABLE "ApiKey";
ALTER TABLE "new_ApiKey" RENAME TO "ApiKey";
CREATE UNIQUE INDEX "ApiKey_keyPrefix_key" ON "ApiKey"("keyPrefix");
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_status_idx" ON "ApiKey"("status");
CREATE INDEX "ApiKey_workspaceId_idx" ON "ApiKey"("workspaceId");
CREATE INDEX "ApiKey_createdByUserId_idx" ON "ApiKey"("createdByUserId");
CREATE INDEX "ApiKey_ownerPersonId_idx" ON "ApiKey"("ownerPersonId");
CREATE TABLE "new_ApprovedEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "workspaceId" TEXT,
    "invitedById" TEXT,
    CONSTRAINT "ApprovedEmail_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ApprovedEmail_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ApprovedEmail" ("createdAt", "email", "id", "invitedById", "status", "updatedAt", "workspaceId") SELECT "createdAt", "email", "id", "invitedById", "status", "updatedAt", "workspaceId" FROM "ApprovedEmail";
DROP TABLE "ApprovedEmail";
ALTER TABLE "new_ApprovedEmail" RENAME TO "ApprovedEmail";
CREATE UNIQUE INDEX "ApprovedEmail_email_key" ON "ApprovedEmail"("email");
CREATE INDEX "ApprovedEmail_status_idx" ON "ApprovedEmail"("status");
CREATE INDEX "ApprovedEmail_workspaceId_idx" ON "ApprovedEmail"("workspaceId");
CREATE INDEX "ApprovedEmail_invitedById_idx" ON "ApprovedEmail"("invitedById");
CREATE TABLE "new_AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "userId" TEXT,
    "apiKeyId" TEXT,
    "personId" TEXT,
    "metadata" TEXT,
    CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AuditLog" ("action", "actorId", "actorLabel", "actorType", "apiKeyId", "createdAt", "id", "metadata", "personId", "targetId", "targetType", "userId", "workspaceId") SELECT "action", "actorId", "actorLabel", "actorType", "apiKeyId", "createdAt", "id", "metadata", "personId", "targetId", "targetType", "userId", "workspaceId" FROM "AuditLog";
DROP TABLE "AuditLog";
ALTER TABLE "new_AuditLog" RENAME TO "AuditLog";
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX "AuditLog_actorType_actorId_idx" ON "AuditLog"("actorType", "actorId");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_apiKeyId_idx" ON "AuditLog"("apiKeyId");
CREATE INDEX "AuditLog_personId_idx" ON "AuditLog"("personId");
CREATE TABLE "new_CalendarConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
INSERT INTO "new_CalendarConnection" ("accessToken", "accountEmail", "calendarId", "calendarSummary", "createdAt", "expiresAt", "id", "lastError", "lastSyncedAt", "provider", "refreshToken", "scope", "status", "syncToken", "updatedAt", "userId", "workspaceId") SELECT "accessToken", "accountEmail", "calendarId", "calendarSummary", "createdAt", "expiresAt", "id", "lastError", "lastSyncedAt", "provider", "refreshToken", "scope", "status", "syncToken", "updatedAt", "userId", "workspaceId" FROM "CalendarConnection";
DROP TABLE "CalendarConnection";
ALTER TABLE "new_CalendarConnection" RENAME TO "CalendarConnection";
CREATE INDEX "CalendarConnection_userId_idx" ON "CalendarConnection"("userId");
CREATE INDEX "CalendarConnection_workspaceId_status_idx" ON "CalendarConnection"("workspaceId", "status");
CREATE UNIQUE INDEX "CalendarConnection_workspaceId_provider_calendarId_key" ON "CalendarConnection"("workspaceId", "provider", "calendarId");
CREATE TABLE "new_CalendarEventLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "connectionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
INSERT INTO "new_CalendarEventLink" ("calendarId", "connectionId", "createdAt", "eventId", "externalEventId", "iCalUID", "id", "lastSeenAt", "provider", "status", "updatedAt", "workspaceId") SELECT "calendarId", "connectionId", "createdAt", "eventId", "externalEventId", "iCalUID", "id", "lastSeenAt", "provider", "status", "updatedAt", "workspaceId" FROM "CalendarEventLink";
DROP TABLE "CalendarEventLink";
ALTER TABLE "new_CalendarEventLink" RENAME TO "CalendarEventLink";
CREATE INDEX "CalendarEventLink_connectionId_idx" ON "CalendarEventLink"("connectionId");
CREATE INDEX "CalendarEventLink_eventId_idx" ON "CalendarEventLink"("eventId");
CREATE INDEX "CalendarEventLink_workspaceId_status_idx" ON "CalendarEventLink"("workspaceId", "status");
CREATE UNIQUE INDEX "CalendarEventLink_workspaceId_provider_calendarId_externalEventId_key" ON "CalendarEventLink"("workspaceId", "provider", "calendarId", "externalEventId");
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "placeId" TEXT,
    "notes" TEXT,
    "transcript" TEXT,
    "metadata" TEXT,
    CONSTRAINT "Event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("createdAt", "id", "metadata", "name", "notes", "placeId", "timestamp", "transcript", "type", "workspaceId") SELECT "createdAt", "id", "metadata", "name", "notes", "placeId", "timestamp", "transcript", "type", "workspaceId" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_workspaceId_timestamp_idx" ON "Event"("workspaceId", "timestamp");
CREATE TABLE "new_GmailConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
INSERT INTO "new_GmailConnection" ("accessToken", "accountEmail", "createdAt", "expiresAt", "historyId", "id", "lastError", "lastSyncedAt", "mailboxId", "provider", "refreshToken", "scope", "status", "updatedAt", "userId", "workspaceId") SELECT "accessToken", "accountEmail", "createdAt", "expiresAt", "historyId", "id", "lastError", "lastSyncedAt", "mailboxId", "provider", "refreshToken", "scope", "status", "updatedAt", "userId", "workspaceId" FROM "GmailConnection";
DROP TABLE "GmailConnection";
ALTER TABLE "new_GmailConnection" RENAME TO "GmailConnection";
CREATE INDEX "GmailConnection_userId_idx" ON "GmailConnection"("userId");
CREATE INDEX "GmailConnection_workspaceId_status_idx" ON "GmailConnection"("workspaceId", "status");
CREATE UNIQUE INDEX "GmailConnection_workspaceId_provider_mailboxId_key" ON "GmailConnection"("workspaceId", "provider", "mailboxId");
CREATE TABLE "new_GmailMessageLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "connectionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
INSERT INTO "new_GmailMessageLink" ("connectionId", "createdAt", "externalMessageId", "historyId", "id", "interactionId", "lastSeenAt", "mailboxId", "provider", "stagedItemId", "status", "threadId", "updatedAt", "workspaceId") SELECT "connectionId", "createdAt", "externalMessageId", "historyId", "id", "interactionId", "lastSeenAt", "mailboxId", "provider", "stagedItemId", "status", "threadId", "updatedAt", "workspaceId" FROM "GmailMessageLink";
DROP TABLE "GmailMessageLink";
ALTER TABLE "new_GmailMessageLink" RENAME TO "GmailMessageLink";
CREATE INDEX "GmailMessageLink_connectionId_idx" ON "GmailMessageLink"("connectionId");
CREATE INDEX "GmailMessageLink_interactionId_idx" ON "GmailMessageLink"("interactionId");
CREATE INDEX "GmailMessageLink_stagedItemId_idx" ON "GmailMessageLink"("stagedItemId");
CREATE INDEX "GmailMessageLink_workspaceId_status_idx" ON "GmailMessageLink"("workspaceId", "status");
CREATE UNIQUE INDEX "GmailMessageLink_workspaceId_provider_mailboxId_externalMessageId_key" ON "GmailMessageLink"("workspaceId", "provider", "mailboxId", "externalMessageId");
CREATE TABLE "new_ImportedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" TEXT,
    CONSTRAINT "ImportedFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImportedFile" ("content", "createdAt", "filePath", "filename", "format", "id", "sizeBytes", "workspaceId") SELECT "content", "createdAt", "filePath", "filename", "format", "id", "sizeBytes", "workspaceId" FROM "ImportedFile";
DROP TABLE "ImportedFile";
ALTER TABLE "new_ImportedFile" RENAME TO "ImportedFile";
CREATE INDEX "ImportedFile_workspaceId_createdAt_idx" ON "ImportedFile"("workspaceId", "createdAt");
CREATE TABLE "new_Interaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personId" TEXT,
    "eventId" TEXT,
    "placeId" TEXT,
    "type" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "duration" INTEGER,
    "emotionalWeight" TEXT,
    "outcome" TEXT,
    "summary" TEXT,
    "notes" TEXT,
    "actionItems" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "amount" REAL,
    "direction" TEXT,
    "sourceFileId" TEXT,
    CONSTRAINT "Interaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Interaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Interaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Interaction" ("actionItems", "amount", "billable", "createdAt", "direction", "duration", "emotionalWeight", "eventId", "id", "notes", "outcome", "personId", "placeId", "sourceFileId", "summary", "timestamp", "type", "workspaceId") SELECT "actionItems", "amount", "billable", "createdAt", "direction", "duration", "emotionalWeight", "eventId", "id", "notes", "outcome", "personId", "placeId", "sourceFileId", "summary", "timestamp", "type", "workspaceId" FROM "Interaction";
DROP TABLE "Interaction";
ALTER TABLE "new_Interaction" RENAME TO "Interaction";
CREATE INDEX "Interaction_personId_timestamp_idx" ON "Interaction"("personId", "timestamp" DESC);
CREATE INDEX "Interaction_workspaceId_timestamp_idx" ON "Interaction"("workspaceId", "timestamp" DESC);
CREATE INDEX "Interaction_timestamp_idx" ON "Interaction"("timestamp" DESC);
CREATE INDEX "Interaction_placeId_idx" ON "Interaction"("placeId");
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "make" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "assetId" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "purchaseDate" DATETIME,
    "purchasePrice" REAL,
    "purchaseFrom" TEXT,
    "warrantyExpires" DATETIME,
    "lifetimeWarranty" BOOLEAN NOT NULL DEFAULT false,
    "warrantyDetails" TEXT,
    "placeId" TEXT,
    "ownedById" TEXT,
    "tags" TEXT,
    "notes" TEXT,
    "color" TEXT,
    "colorSoft" TEXT,
    CONSTRAINT "Item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Item_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_ownedById_fkey" FOREIGN KEY ("ownedById") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("assetId", "category", "color", "colorSoft", "createdAt", "description", "id", "lifetimeWarranty", "make", "model", "name", "notes", "ownedById", "placeId", "purchaseDate", "purchaseFrom", "purchasePrice", "quantity", "serialNumber", "tags", "updatedAt", "warrantyDetails", "warrantyExpires", "workspaceId") SELECT "assetId", "category", "color", "colorSoft", "createdAt", "description", "id", "lifetimeWarranty", "make", "model", "name", "notes", "ownedById", "placeId", "purchaseDate", "purchaseFrom", "purchasePrice", "quantity", "serialNumber", "tags", "updatedAt", "warrantyDetails", "warrantyExpires", "workspaceId" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_assetId_key" ON "Item"("assetId");
CREATE INDEX "Item_name_idx" ON "Item"("name");
CREATE INDEX "Item_category_idx" ON "Item"("category");
CREATE INDEX "Item_assetId_idx" ON "Item"("assetId");
CREATE INDEX "Item_placeId_idx" ON "Item"("placeId");
CREATE INDEX "Item_ownedById_idx" ON "Item"("ownedById");
CREATE INDEX "Item_createdAt_idx" ON "Item"("createdAt");
CREATE INDEX "Item_workspaceId_idx" ON "Item"("workspaceId");
CREATE TABLE "new_Person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "first" TEXT NOT NULL,
    "last" TEXT NOT NULL,
    "nickname" TEXT,
    "title" TEXT,
    "headline" TEXT,
    "emails" TEXT NOT NULL DEFAULT '[]',
    "phones" TEXT NOT NULL DEFAULT '[]',
    "birthday" TEXT,
    "closeness" INTEGER NOT NULL DEFAULT 2,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "values" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "company" TEXT,
    "location" TEXT,
    "linkedin" TEXT,
    "twitter" TEXT,
    "website" TEXT,
    "color" TEXT,
    "colorSoft" TEXT,
    CONSTRAINT "Person_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Person" ("birthday", "closeness", "color", "colorSoft", "company", "createdAt", "first", "headline", "id", "last", "linkedin", "location", "nickname", "notes", "tags", "twitter", "updatedAt", "values", "website", "workspaceId") SELECT "birthday", "closeness", "color", "colorSoft", "company", "createdAt", "first", "headline", "id", "last", "linkedin", "location", "nickname", "notes", "tags", "twitter", "updatedAt", "values", "website", "workspaceId" FROM "Person";
DROP TABLE "Person";
ALTER TABLE "new_Person" RENAME TO "Person";
CREATE INDEX "Person_workspaceId_last_first_idx" ON "Person"("workspaceId", "last", "first");
CREATE INDEX "Person_last_first_idx" ON "Person"("last", "first");
CREATE INDEX "Person_title_idx" ON "Person"("title");
CREATE INDEX "Person_closeness_idx" ON "Person"("closeness");
CREATE INDEX "Person_birthday_idx" ON "Person"("birthday");
CREATE INDEX "Person_createdAt_idx" ON "Person"("createdAt");
CREATE TABLE "new_Place" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "name" TEXT NOT NULL,
    "type" TEXT,
    "address" TEXT,
    "coordinates" TEXT,
    "meaning" TEXT,
    "parentPlaceId" TEXT,
    CONSTRAINT "Place_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Place_parentPlaceId_fkey" FOREIGN KEY ("parentPlaceId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Place" ("address", "coordinates", "id", "meaning", "name", "parentPlaceId", "type", "workspaceId") SELECT "address", "coordinates", "id", "meaning", "name", "parentPlaceId", "type", "workspaceId" FROM "Place";
DROP TABLE "Place";
ALTER TABLE "new_Place" RENAME TO "Place";
CREATE INDEX "Place_parentPlaceId_idx" ON "Place"("parentPlaceId");
CREATE INDEX "Place_workspaceId_idx" ON "Place"("workspaceId");
CREATE TABLE "new_Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personId" TEXT,
    "text" TEXT NOT NULL,
    "timescale" TEXT,
    "successSignals" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "parentId" TEXT,
    CONSTRAINT "Plan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Plan_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Plan_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Plan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Plan" ("createdAt", "id", "parentId", "personId", "status", "successSignals", "text", "timescale", "workspaceId") SELECT "createdAt", "id", "parentId", "personId", "status", "successSignals", "text", "timescale", "workspaceId" FROM "Plan";
DROP TABLE "Plan";
ALTER TABLE "new_Plan" RENAME TO "Plan";
CREATE INDEX "Plan_workspaceId_createdAt_idx" ON "Plan"("workspaceId", "createdAt");
CREATE INDEX "Plan_workspaceId_personId_idx" ON "Plan"("workspaceId", "personId");
CREATE TABLE "new_Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "mode" TEXT NOT NULL DEFAULT 'suggest',
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actions" TEXT NOT NULL DEFAULT '[]',
    "stopProcessing" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    CONSTRAINT "Rule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Rule" ("actions", "conditions", "createdAt", "createdByUserId", "description", "id", "mode", "name", "priority", "status", "stopProcessing", "trigger", "updatedAt", "workspaceId") SELECT "actions", "conditions", "createdAt", "createdByUserId", "description", "id", "mode", "name", "priority", "status", "stopProcessing", "trigger", "updatedAt", "workspaceId" FROM "Rule";
DROP TABLE "Rule";
ALTER TABLE "new_Rule" RENAME TO "Rule";
CREATE INDEX "Rule_workspaceId_trigger_status_priority_idx" ON "Rule"("workspaceId", "trigger", "status", "priority");
CREATE INDEX "Rule_trigger_status_priority_idx" ON "Rule"("trigger", "status", "priority");
CREATE INDEX "Rule_createdByUserId_idx" ON "Rule"("createdByUserId");
CREATE TABLE "new_RuleRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "matched" BOOLEAN NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" TEXT,
    "actionsPlanned" TEXT,
    "actionsApplied" TEXT,
    "message" TEXT,
    CONSTRAINT "RuleRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RuleRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RuleRun" ("actionsApplied", "actionsPlanned", "createdAt", "id", "input", "matched", "message", "mode", "ruleId", "status", "targetId", "targetType", "trigger", "workspaceId") SELECT "actionsApplied", "actionsPlanned", "createdAt", "id", "input", "matched", "message", "mode", "ruleId", "status", "targetId", "targetType", "trigger", "workspaceId" FROM "RuleRun";
DROP TABLE "RuleRun";
ALTER TABLE "new_RuleRun" RENAME TO "RuleRun";
CREATE INDEX "RuleRun_ruleId_createdAt_idx" ON "RuleRun"("ruleId", "createdAt");
CREATE INDEX "RuleRun_workspaceId_createdAt_idx" ON "RuleRun"("workspaceId", "createdAt");
CREATE INDEX "RuleRun_trigger_createdAt_idx" ON "RuleRun"("trigger", "createdAt");
CREATE INDEX "RuleRun_matched_createdAt_idx" ON "RuleRun"("matched", "createdAt");
CREATE INDEX "RuleRun_targetType_targetId_idx" ON "RuleRun"("targetType", "targetId");
CREATE TABLE "new_StagedInteraction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL DEFAULT 'interaction',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "candidatePersonId" TEXT,
    "confidence" REAL,
    "matchReason" TEXT,
    "type" TEXT NOT NULL DEFAULT 'message',
    "timestamp" DATETIME NOT NULL,
    "summary" TEXT,
    "body" TEXT,
    "direction" TEXT,
    "metadata" TEXT,
    "acceptedAt" DATETIME,
    "acceptedPersonId" TEXT,
    "interactionId" TEXT,
    CONSTRAINT "StagedInteraction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StagedInteraction_candidatePersonId_fkey" FOREIGN KEY ("candidatePersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StagedInteraction" ("acceptedAt", "acceptedPersonId", "body", "candidatePersonId", "confidence", "contactEmail", "contactName", "contactPhone", "createdAt", "direction", "id", "interactionId", "itemType", "matchReason", "metadata", "source", "sourceId", "status", "summary", "timestamp", "type", "updatedAt", "workspaceId") SELECT "acceptedAt", "acceptedPersonId", "body", "candidatePersonId", "confidence", "contactEmail", "contactName", "contactPhone", "createdAt", "direction", "id", "interactionId", "itemType", "matchReason", "metadata", "source", "sourceId", "status", "summary", "timestamp", "type", "updatedAt", "workspaceId" FROM "StagedInteraction";
DROP TABLE "StagedInteraction";
ALTER TABLE "new_StagedInteraction" RENAME TO "StagedInteraction";
CREATE INDEX "StagedInteraction_status_createdAt_idx" ON "StagedInteraction"("status", "createdAt");
CREATE INDEX "StagedInteraction_source_itemType_createdAt_idx" ON "StagedInteraction"("source", "itemType", "createdAt");
CREATE INDEX "StagedInteraction_candidatePersonId_idx" ON "StagedInteraction"("candidatePersonId");
CREATE INDEX "StagedInteraction_timestamp_idx" ON "StagedInteraction"("timestamp");
CREATE UNIQUE INDEX "StagedInteraction_workspaceId_source_sourceId_key" ON "StagedInteraction"("workspaceId", "source", "sourceId");
CREATE TABLE "new_Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "ownerUserId" TEXT,
    CONSTRAINT "Workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Workspace" ("createdAt", "id", "name", "ownerUserId", "slug", "status", "updatedAt") SELECT "createdAt", "id", "name", "ownerUserId", "slug", "status", "updatedAt" FROM "Workspace";
DROP TABLE "Workspace";
ALTER TABLE "new_Workspace" RENAME TO "Workspace";
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE INDEX "Workspace_ownerUserId_idx" ON "Workspace"("ownerUserId");
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");
CREATE TABLE "new_WorkspaceMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkspaceMember" ("createdAt", "id", "role", "status", "updatedAt", "userId", "workspaceId") SELECT "createdAt", "id", "role", "status", "updatedAt", "userId", "workspaceId" FROM "WorkspaceMember";
DROP TABLE "WorkspaceMember";
ALTER TABLE "new_WorkspaceMember" RENAME TO "WorkspaceMember";
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE INDEX "WorkspaceMember_workspaceId_status_idx" ON "WorkspaceMember"("workspaceId", "status");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Group_workspaceId_idx" ON "Group"("workspaceId");

-- CreateIndex
CREATE INDEX "Group_workspaceId_groupType_idx" ON "Group"("workspaceId", "groupType");

-- CreateIndex
CREATE INDEX "PersonGroup_personId_idx" ON "PersonGroup"("personId");

-- CreateIndex
CREATE INDEX "PersonGroup_groupId_idx" ON "PersonGroup"("groupId");

-- CreateIndex
CREATE INDEX "GroupGroup_parentGroupId_idx" ON "GroupGroup"("parentGroupId");

-- CreateIndex
CREATE INDEX "GroupGroup_childGroupId_idx" ON "GroupGroup"("childGroupId");

-- CreateIndex
CREATE INDEX "PlaceGroup_placeId_idx" ON "PlaceGroup"("placeId");

-- CreateIndex
CREATE INDEX "PlaceGroup_groupId_idx" ON "PlaceGroup"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "_EventGroupTags_AB_unique" ON "_EventGroupTags"("A", "B");

-- CreateIndex
CREATE INDEX "_EventGroupTags_B_index" ON "_EventGroupTags"("B");
