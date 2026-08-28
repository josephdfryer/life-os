-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('draft', 'active', 'blocked', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "StagedVisitStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "InventoryTrackingMode" AS ENUM ('untracked', 'lot', 'serial');

-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('family', 'employer', 'friend_group', 'sports_team', 'corporation', 'community', 'other');

-- CreateEnum
CREATE TYPE "PlaceGroupRelationshipType" AS ENUM ('corporate_parent', 'employer_location', 'home_venue', 'residence', 'usual_spot', 'other');

-- CreateEnum
CREATE TYPE "ReviewItemStatus" AS ENUM ('pending', 'accepted', 'edited_accepted', 'dismissed', 'superseded', 'failed');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "ownerUserId" TEXT,
    "autoMergeEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'owner',
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovedEmail" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "workspaceId" TEXT,
    "invitedById" TEXT,

    CONSTRAINT "ApprovedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "first" TEXT NOT NULL,
    "last" TEXT NOT NULL,
    "nickname" TEXT,
    "title" TEXT,
    "headline" TEXT,
    "emails" TEXT NOT NULL DEFAULT '[]',
    "emailSearch" TEXT,
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
    "facebook" TEXT,
    "instagram" TEXT,
    "color" TEXT,
    "colorSoft" TEXT,
    "publicProfileEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicSlug" TEXT,
    "source" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "personId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceSource" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "permissionStatus" TEXT NOT NULL DEFAULT 'unknown',
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DeviceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCredential" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAuthorization" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "codeHash" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceIngestItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resultType" TEXT,
    "resultId" TEXT,
    "errorCode" TEXT,

    CONSTRAINT "DeviceIngestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "ownerPersonId" TEXT,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeyScope" (
    "apiKeyId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,

    CONSTRAINT "ApiKeyScope_pkey" PRIMARY KEY ("apiKeyId","scope")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "status" TEXT NOT NULL DEFAULT 'active',
    "accountEmail" TEXT,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "calendarSummary" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "syncTokenEncrypted" TEXT,
    "fullSyncPageToken" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "connectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "calendarId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "iCalUID" TEXT,
    "planId" TEXT,
    "eventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "CalendarEventLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "status" TEXT NOT NULL DEFAULT 'active',
    "accountEmail" TEXT,
    "mailboxId" TEXT NOT NULL DEFAULT 'me',
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "historyId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailMessageLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "connectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "mailboxId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "threadId" TEXT,
    "historyId" TEXT,
    "interactionId" TEXT,
    "stagedItemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "GmailMessageLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "accountEmail" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "syncCursor" TEXT,

    CONSTRAINT "EraConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraAccountLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "connectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "eraAccountId" TEXT NOT NULL,
    "institution" TEXT,
    "accountName" TEXT,
    "accountType" TEXT,
    "currency" TEXT DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSeenAt" TIMESTAMP(3),
    "ownerPersonId" TEXT,
    "householdGroupId" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EraAccountLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraTransactionLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "connectionId" TEXT NOT NULL,
    "accountLinkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "eraTransactionId" TEXT NOT NULL,
    "interactionId" TEXT,
    "stagedItemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'staged',
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "EraTransactionLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "status" TEXT NOT NULL DEFAULT 'active',
    "accountEmail" TEXT,
    "label" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" TEXT,
    "sourceTable" TEXT,
    "sourceId" TEXT,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GranolaNoteLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "connectionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "externalNoteId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "calendarEventId" TEXT,
    "remoteCreatedAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'synced',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GranolaNoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "mode" TEXT NOT NULL DEFAULT 'suggest',
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actions" TEXT NOT NULL DEFAULT '[]',
    "stopProcessing" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
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
    "causationDepth" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RuleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedInteraction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL DEFAULT 'interaction',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "candidatePersonId" TEXT,
    "confidence" DOUBLE PRECISION,
    "matchReason" TEXT,
    "type" TEXT NOT NULL DEFAULT 'message',
    "timestamp" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,
    "body" TEXT,
    "direction" TEXT,
    "metadata" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedPersonId" TEXT,
    "interactionId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "enrichedAt" TIMESTAMP(3),

    CONSTRAINT "StagedInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3),
    "timestamp" TIMESTAMP(3) NOT NULL,
    "placeId" TEXT,
    "notes" TEXT,
    "transcript" TEXT,
    "metadata" TEXT,
    "sourcePlanId" TEXT,
    "parentEventId" TEXT,
    "sourceNoteId" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personId" TEXT,
    "eventId" TEXT,
    "placeId" TEXT,
    "groupId" TEXT,
    "type" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER,
    "emotionalWeight" TEXT,
    "outcome" TEXT,
    "summary" TEXT,
    "notes" TEXT,
    "actionItems" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "amount" INTEGER,
    "direction" TEXT,
    "sourceFileId" TEXT,
    "sourceNoteId" TEXT,
    "source" TEXT,
    "sourceId" TEXT,
    "subtype" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "category" TEXT,
    "merchantName" TEXT,
    "accountLinkId" TEXT,
    "actorPersonId" TEXT,
    "metadata" TEXT,
    "enrichmentVersion" INTEGER NOT NULL DEFAULT 0,
    "enrichedAt" TIMESTAMP(3),

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteractionParticipant" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" TEXT,
    "workspaceId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "band" TEXT,
    "source" TEXT,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InteractionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personId" TEXT,
    "text" TEXT NOT NULL,
    "timescale" TEXT,
    "successSignals" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'active',
    "dueOn" TIMESTAMP(3),
    "deferCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "parentId" TEXT,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "placeId" TEXT,
    "externalSource" TEXT,
    "externalInstanceId" TEXT,
    "reconciliationStatus" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "sourceNoteId" TEXT,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanExpectedPerson" (
    "planId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',

    CONSTRAINT "PlanExpectedPerson_pkey" PRIMARY KEY ("planId","personId")
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "name" TEXT NOT NULL,
    "googlePlaceId" TEXT,
    "type" TEXT,
    "address" TEXT,
    "coordinates" TEXT,
    "meaning" TEXT,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "parentPlaceId" TEXT,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'pending',
    "format" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rawData" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "stagedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportStagedVisit" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "placeName" TEXT,
    "placeAddress" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "googlePlaceId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL,
    "aiEnrichment" JSONB,
    "status" "StagedVisitStatus" NOT NULL DEFAULT 'pending',
    "resolvedPlaceId" TEXT,
    "resolvedEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportStagedVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceNote" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaceNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "make" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "assetId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "definitionId" TEXT,
    "lotId" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "purchasePrice" INTEGER,
    "purchaseFrom" TEXT,
    "warrantyExpires" TIMESTAMP(3),
    "lifetimeWarranty" BOOLEAN NOT NULL DEFAULT false,
    "warrantyDetails" TEXT,
    "placeId" TEXT,
    "ownedById" TEXT,
    "primaryImageFileId" TEXT,
    "attributes" TEXT,
    "tags" TEXT,
    "notes" TEXT,
    "color" TEXT,
    "colorSoft" TEXT,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDefinition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "trackingMode" "InventoryTrackingMode" NOT NULL DEFAULT 'untracked',
    "reorderPoint" DOUBLE PRECISION,
    "targetStock" DOUBLE PRECISION,
    "defaultShelfLifeDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ItemDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "manufacturedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assembly" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "childItemId" TEXT NOT NULL,
    "parentItemId" TEXT NOT NULL,
    "assembledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assembledById" TEXT,
    "disassembledAt" TIMESTAMP(3),
    "disassembledById" TEXT,
    "notes" TEXT,

    CONSTRAINT "Assembly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemInteraction" (
    "itemId" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "role" TEXT,
    "quantityDelta" DOUBLE PRECISION,
    "quantityAfter" DOUBLE PRECISION,

    CONSTRAINT "ItemInteraction_pkey" PRIMARY KEY ("itemId","interactionId")
);

-- CreateTable
CREATE TABLE "ImportedFile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" TEXT,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "storageKey" TEXT,
    "mimeType" TEXT,
    "checksum" TEXT,
    "capturedAt" TIMESTAMP(3),
    "uploadIntentId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,
    "processingState" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "ImportedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileUploadIntent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "filename" TEXT NOT NULL,
    "safeFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storeOnly" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FileUploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileProcessingRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'queued',
    "processorVersion" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "summary" TEXT,
    "error" TEXT,

    CONSTRAINT "FileProcessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "processingRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "locatorType" TEXT NOT NULL,
    "locator" TEXT NOT NULL,

    CONSTRAINT "FileChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileEntityMention" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "processingRunId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "entityType" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "exactQuote" TEXT NOT NULL,
    "identityEvidence" TEXT,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL,
    "resolutionStatus" TEXT NOT NULL DEFAULT 'unresolved',
    "resolutionLevel" INTEGER,
    "resolutionReason" TEXT,
    "resolvedEntityId" TEXT,
    "resolvedPersonId" TEXT,
    "resolutionUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "FileEntityMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonExternalIdentifier" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonExternalIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileEntityResolution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mentionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromPersonId" TEXT,
    "toPersonId" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,

    CONSTRAINT "FileEntityResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceClaim" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "processingRunId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assertion" TEXT NOT NULL,
    "structuredValue" TEXT,
    "classification" TEXT NOT NULL,
    "claimType" TEXT,
    "exactQuote" TEXT NOT NULL,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "occurredAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unreviewed',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "supersedesClaimId" TEXT,
    "correctionNoteId" TEXT,
    "graphResultType" TEXT,
    "graphResultId" TEXT,
    "graphEventId" TEXT,

    CONSTRAINT "EvidenceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceClaimSubject" (
    "claimId" TEXT NOT NULL,
    "mentionId" TEXT NOT NULL,
    "subjectRole" TEXT NOT NULL,
    "relevanceWeight" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceClaimSubject_pkey" PRIMARY KEY ("claimId","mentionId")
);

-- CreateTable
CREATE TABLE "AiProviderCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "apiKeyEncrypted" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AiProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "credentialId" TEXT,
    "sourceFileId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "processingRunId" TEXT,
    "purpose" TEXT,

    CONSTRAINT "AiAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteAnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "credentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCost" DOUBLE PRECISION,

    CONSTRAINT "NoteAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TheoryAnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "subjectPersonId" TEXT NOT NULL,
    "credentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "snapshotId" TEXT,
    "output" TEXT,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCost" DOUBLE PRECISION,

    CONSTRAINT "TheoryAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifeModelAnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "credentialId" TEXT,
    "snapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCost" DOUBLE PRECISION,

    CONSTRAINT "LifeModelAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteSuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "acceptedEntityType" TEXT,
    "acceptedEntityId" TEXT,

    CONSTRAINT "NoteSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "name" TEXT NOT NULL,
    "groupType" "GroupType" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceNoteId" TEXT,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "supplierCode" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "paymentTerms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "expectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "orderedQuantity" DOUBLE PRECISION NOT NULL,
    "unitCost" INTEGER,
    "destinationPlaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceiptLine" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonGroup" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),

    CONSTRAINT "PersonGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupGroup" (
    "id" TEXT NOT NULL,
    "parentGroupId" TEXT NOT NULL,
    "childGroupId" TEXT NOT NULL,
    "role" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),

    CONSTRAINT "GroupGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceGroup" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "relationshipType" "PlaceGroupRelationshipType" NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),

    CONSTRAINT "PlaceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "sourceFileId" TEXT,
    "aboutPersonId" TEXT,
    "aboutPlaceId" TEXT,
    "aboutItemId" TEXT,
    "aboutEventId" TEXT,
    "aboutPlanId" TEXT,
    "aboutGroupId" TEXT,
    "aboutStateId" TEXT,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TheorySnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "subjectPersonId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "markdownBody" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "confidence" DOUBLE PRECISION,
    "synthesizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TheorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TheorySnapshotSource" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "contribution" TEXT,
    "weight" DOUBLE PRECISION,
    "evidenceClaimId" TEXT,
    "evidenceClassification" TEXT,
    "evidenceStatus" TEXT,
    "citation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TheorySnapshotSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifeModelSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "version" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "modelId" TEXT,
    "promptVersion" TEXT,
    "synthesizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifeModelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifeModelClaim" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifeModelClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifeModelClaimFeedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "claimId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "replacementStatement" TEXT,
    "reason" TEXT,
    "sourceNoteId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifeModelClaimFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptiveDayBrief" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "day" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "capacityBand" TEXT NOT NULL,
    "inputSnapshot" TEXT NOT NULL,
    "missingSignals" TEXT NOT NULL DEFAULT '[]',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'current',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdaptiveDayBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptiveIntervention" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "recommendationText" TEXT NOT NULL,
    "reasonCodes" TEXT NOT NULL DEFAULT '[]',
    "evidence" TEXT,
    "proposedCommand" TEXT,
    "riskTier" TEXT NOT NULL DEFAULT 'review',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewItemId" TEXT,
    "resultType" TEXT,
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdaptiveIntervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptiveInterventionOutcome" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "interventionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidence" TEXT,
    "note" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdaptiveInterventionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateDefinition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "StateDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "State" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "severity" DOUBLE PRECISION,
    "source" TEXT,
    "sourceNoteId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "channel" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "birthDate" TIMESTAMP(3),
    "sex" TEXT NOT NULL DEFAULT 'male',
    "bodyweightKg" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "standingReachCm" DOUBLE PRECISION,
    "primaryBuild" TEXT,
    "coldStartCompletedAt" TIMESTAMP(3),
    "unitPreference" TEXT NOT NULL DEFAULT 'lb',
    "microPlates" BOOLEAN NOT NULL DEFAULT false,
    "activeProgramId" TEXT,

    CONSTRAINT "LevelUpProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpTestResult" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "testKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "bodyweightKg" DOUBLE PRECISION,
    "populationSource" TEXT NOT NULL DEFAULT 'general',
    "source" TEXT NOT NULL DEFAULT 'combine',
    "protocolFlags" TEXT,
    "context" TEXT,
    "deviceFingerprint" TEXT,
    "combineId" TEXT,

    CONSTRAINT "LevelUpTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpCombine" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "label" TEXT,
    "notes" TEXT,
    "block" TEXT,

    CONSTRAINT "LevelUpCombine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpRatingSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "combineId" TEXT,
    "engineVersion" TEXT NOT NULL DEFAULT 'v2',
    "ovr" DOUBLE PRECISION NOT NULL,
    "ratings" TEXT NOT NULL,
    "subRatings" TEXT NOT NULL,
    "buildOvrs" TEXT NOT NULL,
    "badges" TEXT NOT NULL,
    "caps" TEXT NOT NULL,

    CONSTRAINT "LevelUpRatingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpTrainingSet" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,
    "exerciseKey" TEXT NOT NULL,
    "exerciseId" TEXT,
    "setIndex" INTEGER,
    "reps" INTEGER NOT NULL,
    "loadKg" DOUBLE PRECISION NOT NULL,
    "durationSec" INTEGER,
    "isBodyweight" BOOLEAN NOT NULL DEFAULT false,
    "bodyweightKg" DOUBLE PRECISION,
    "rpe" DOUBLE PRECISION,
    "rank" DOUBLE PRECISION,
    "rankLetter" TEXT,
    "balanceResidual" DOUBLE PRECISION,
    "isPr" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "sourceId" TEXT,

    CONSTRAINT "LevelUpTrainingSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpExercise" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "modality" TEXT NOT NULL DEFAULT 'load',
    "catalogKey" TEXT,
    "defaultRestSec" INTEGER NOT NULL DEFAULT 90,
    "muscleGroup" TEXT,
    "jointLoad" TEXT,
    "substituteId" TEXT,

    CONSTRAINT "LevelUpExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpProgram" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LevelUpProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpProgramDay" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LevelUpProgramDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpProgramEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "programDayId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "targetSets" INTEGER NOT NULL DEFAULT 3,
    "targetReps" INTEGER,
    "targetLoadKg" DOUBLE PRECISION,
    "targetDurationSec" INTEGER,
    "restSec" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LevelUpProgramEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "programDayId" TEXT,
    "kneeFlare" BOOLEAN NOT NULL DEFAULT false,
    "lumbarFlare" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "source" TEXT,
    "sourceId" TEXT,
    "sessionRpe" DOUBLE PRECISION,
    "workoutEventId" TEXT,

    CONSTRAINT "LevelUpSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpBodyMetric" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weightKg" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "musclePct" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "LevelUpBodyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpReadinessSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localDay" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL DEFAULT 'v1',
    "ruleSetVersion" TEXT NOT NULL DEFAULT 'v1',
    "inputs" TEXT NOT NULL,
    "formSignal" TEXT,
    "band" TEXT NOT NULL DEFAULT 'full',
    "originalPrescriptionHash" TEXT,
    "suggestedPrescriptionHash" TEXT,
    "reasonCodes" TEXT NOT NULL DEFAULT '[]',
    "userChoice" TEXT,
    "overriddenAt" TIMESTAMP(3),

    CONSTRAINT "LevelUpReadinessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpBadgeUnlock" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "badgeKey" TEXT NOT NULL,
    "tier" TEXT NOT NULL,

    CONSTRAINT "LevelUpBadgeUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelUpTargetBuild" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buildKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "targets" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "achievedAt" TIMESTAMP(3),

    CONSTRAINT "LevelUpTargetBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "sourceConnector" TEXT,
    "correlationId" TEXT,
    "causationId" TEXT,
    "causationDepth" INTEGER NOT NULL DEFAULT 0,
    "ruleVersionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "provenance" TEXT,

    CONSTRAINT "GraphEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEventReceipt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphEventReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "proposedCommand" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "confidence" DOUBLE PRECISION,
    "evidence" TEXT,
    "riskTier" TEXT NOT NULL DEFAULT 'review',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" "ReviewItemStatus" NOT NULL DEFAULT 'pending',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resultType" TEXT,
    "resultId" TEXT,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_EventGroupTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EventGroupTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_ownerUserId_idx" ON "Workspace"("ownerUserId");

-- CreateIndex
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_status_idx" ON "WorkspaceMember"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovedEmail_email_key" ON "ApprovedEmail"("email");

-- CreateIndex
CREATE INDEX "ApprovedEmail_status_idx" ON "ApprovedEmail"("status");

-- CreateIndex
CREATE INDEX "ApprovedEmail_workspaceId_idx" ON "ApprovedEmail"("workspaceId");

-- CreateIndex
CREATE INDEX "ApprovedEmail_invitedById_idx" ON "ApprovedEmail"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "Person_publicSlug_key" ON "Person"("publicSlug");

-- CreateIndex
CREATE INDEX "Person_workspaceId_last_first_idx" ON "Person"("workspaceId", "last", "first");

-- CreateIndex
CREATE INDEX "Person_workspaceId_createdAt_id_idx" ON "Person"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Person_last_first_idx" ON "Person"("last", "first");

-- CreateIndex
CREATE INDEX "Person_title_idx" ON "Person"("title");

-- CreateIndex
CREATE INDEX "Person_closeness_idx" ON "Person"("closeness");

-- CreateIndex
CREATE INDEX "Person_birthday_idx" ON "Person"("birthday");

-- CreateIndex
CREATE INDEX "Person_createdAt_idx" ON "Person"("createdAt");

-- CreateIndex
CREATE INDEX "Person_workspaceId_company_idx" ON "Person"("workspaceId", "company");

-- CreateIndex
CREATE INDEX "Person_workspaceId_headline_idx" ON "Person"("workspaceId", "headline");

-- CreateIndex
CREATE INDEX "Person_workspaceId_emailSearch_idx" ON "Person"("workspaceId", "emailSearch");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "Device_workspaceId_createdAt_idx" ON "Device"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Device_workspaceId_revokedAt_idx" ON "Device"("workspaceId", "revokedAt");

-- CreateIndex
CREATE INDEX "DeviceSource_deviceId_enabled_idx" ON "DeviceSource"("deviceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceSource_deviceId_source_key" ON "DeviceSource"("deviceId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCredential_refreshTokenHash_key" ON "DeviceCredential"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCredential_accessTokenHash_key" ON "DeviceCredential"("accessTokenHash");

-- CreateIndex
CREATE INDEX "DeviceCredential_deviceId_revokedAt_idx" ON "DeviceCredential"("deviceId", "revokedAt");

-- CreateIndex
CREATE INDEX "DeviceCredential_accessExpiresAt_idx" ON "DeviceCredential"("accessExpiresAt");

-- CreateIndex
CREATE INDEX "DeviceCredential_refreshExpiresAt_idx" ON "DeviceCredential"("refreshExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthorization_codeHash_key" ON "DeviceAuthorization"("codeHash");

-- CreateIndex
CREATE INDEX "DeviceAuthorization_workspaceId_createdAt_idx" ON "DeviceAuthorization"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "DeviceAuthorization_deviceId_expiresAt_idx" ON "DeviceAuthorization"("deviceId", "expiresAt");

-- CreateIndex
CREATE INDEX "DeviceIngestItem_deviceId_createdAt_idx" ON "DeviceIngestItem"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "DeviceIngestItem_workspaceId_status_createdAt_idx" ON "DeviceIngestItem"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceIngestItem_workspaceId_source_sourceId_key" ON "DeviceIngestItem"("workspaceId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_scope_key" ON "Permission"("scope");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyPrefix_key" ON "ApiKey"("keyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_status_idx" ON "ApiKey"("status");

-- CreateIndex
CREATE INDEX "ApiKey_workspaceId_idx" ON "ApiKey"("workspaceId");

-- CreateIndex
CREATE INDEX "ApiKey_createdByUserId_idx" ON "ApiKey"("createdByUserId");

-- CreateIndex
CREATE INDEX "ApiKey_ownerPersonId_idx" ON "ApiKey"("ownerPersonId");

-- CreateIndex
CREATE INDEX "ApiKeyScope_scope_idx" ON "ApiKeyScope"("scope");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_idx" ON "AuditLog"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_apiKeyId_idx" ON "AuditLog"("apiKeyId");

-- CreateIndex
CREATE INDEX "AuditLog_personId_idx" ON "AuditLog"("personId");

-- CreateIndex
CREATE INDEX "CalendarConnection_userId_idx" ON "CalendarConnection"("userId");

-- CreateIndex
CREATE INDEX "CalendarConnection_workspaceId_status_idx" ON "CalendarConnection"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_workspaceId_provider_calendarId_key" ON "CalendarConnection"("workspaceId", "provider", "calendarId");

-- CreateIndex
CREATE INDEX "CalendarEventLink_connectionId_idx" ON "CalendarEventLink"("connectionId");

-- CreateIndex
CREATE INDEX "CalendarEventLink_planId_idx" ON "CalendarEventLink"("planId");

-- CreateIndex
CREATE INDEX "CalendarEventLink_eventId_idx" ON "CalendarEventLink"("eventId");

-- CreateIndex
CREATE INDEX "CalendarEventLink_workspaceId_status_idx" ON "CalendarEventLink"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventLink_workspaceId_provider_calendarId_externalE_key" ON "CalendarEventLink"("workspaceId", "provider", "calendarId", "externalEventId");

-- CreateIndex
CREATE INDEX "GmailConnection_userId_idx" ON "GmailConnection"("userId");

-- CreateIndex
CREATE INDEX "GmailConnection_workspaceId_status_idx" ON "GmailConnection"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_workspaceId_provider_mailboxId_key" ON "GmailConnection"("workspaceId", "provider", "mailboxId");

-- CreateIndex
CREATE INDEX "GmailMessageLink_connectionId_idx" ON "GmailMessageLink"("connectionId");

-- CreateIndex
CREATE INDEX "GmailMessageLink_interactionId_idx" ON "GmailMessageLink"("interactionId");

-- CreateIndex
CREATE INDEX "GmailMessageLink_stagedItemId_idx" ON "GmailMessageLink"("stagedItemId");

-- CreateIndex
CREATE INDEX "GmailMessageLink_workspaceId_status_idx" ON "GmailMessageLink"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GmailMessageLink_workspaceId_provider_mailboxId_externalMes_key" ON "GmailMessageLink"("workspaceId", "provider", "mailboxId", "externalMessageId");

-- CreateIndex
CREATE INDEX "EraConnection_userId_idx" ON "EraConnection"("userId");

-- CreateIndex
CREATE INDEX "EraConnection_workspaceId_status_idx" ON "EraConnection"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EraConnection_workspaceId_userId_key" ON "EraConnection"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "EraAccountLink_connectionId_idx" ON "EraAccountLink"("connectionId");

-- CreateIndex
CREATE INDEX "EraAccountLink_workspaceId_status_idx" ON "EraAccountLink"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "EraAccountLink_ownerPersonId_idx" ON "EraAccountLink"("ownerPersonId");

-- CreateIndex
CREATE INDEX "EraAccountLink_householdGroupId_idx" ON "EraAccountLink"("householdGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "EraAccountLink_workspaceId_eraAccountId_key" ON "EraAccountLink"("workspaceId", "eraAccountId");

-- CreateIndex
CREATE INDEX "EraTransactionLink_connectionId_idx" ON "EraTransactionLink"("connectionId");

-- CreateIndex
CREATE INDEX "EraTransactionLink_interactionId_idx" ON "EraTransactionLink"("interactionId");

-- CreateIndex
CREATE INDEX "EraTransactionLink_stagedItemId_idx" ON "EraTransactionLink"("stagedItemId");

-- CreateIndex
CREATE INDEX "EraTransactionLink_workspaceId_status_idx" ON "EraTransactionLink"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EraTransactionLink_workspaceId_eraTransactionId_key" ON "EraTransactionLink"("workspaceId", "eraTransactionId");

-- CreateIndex
CREATE INDEX "Connection_workspaceId_kind_status_idx" ON "Connection"("workspaceId", "kind", "status");

-- CreateIndex
CREATE INDEX "Connection_sourceTable_sourceId_idx" ON "Connection"("sourceTable", "sourceId");

-- CreateIndex
CREATE INDEX "Connection_userId_idx" ON "Connection"("userId");

-- CreateIndex
CREATE INDEX "GranolaNoteLink_connectionId_status_idx" ON "GranolaNoteLink"("connectionId", "status");

-- CreateIndex
CREATE INDEX "GranolaNoteLink_eventId_idx" ON "GranolaNoteLink"("eventId");

-- CreateIndex
CREATE INDEX "GranolaNoteLink_workspaceId_remoteUpdatedAt_idx" ON "GranolaNoteLink"("workspaceId", "remoteUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GranolaNoteLink_workspaceId_externalNoteId_key" ON "GranolaNoteLink"("workspaceId", "externalNoteId");

-- CreateIndex
CREATE INDEX "Rule_workspaceId_trigger_status_priority_idx" ON "Rule"("workspaceId", "trigger", "status", "priority");

-- CreateIndex
CREATE INDEX "Rule_trigger_status_priority_idx" ON "Rule"("trigger", "status", "priority");

-- CreateIndex
CREATE INDEX "Rule_createdByUserId_idx" ON "Rule"("createdByUserId");

-- CreateIndex
CREATE INDEX "RuleRun_ruleId_createdAt_idx" ON "RuleRun"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "RuleRun_workspaceId_createdAt_idx" ON "RuleRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "RuleRun_trigger_createdAt_idx" ON "RuleRun"("trigger", "createdAt");

-- CreateIndex
CREATE INDEX "RuleRun_matched_createdAt_idx" ON "RuleRun"("matched", "createdAt");

-- CreateIndex
CREATE INDEX "RuleRun_targetType_targetId_idx" ON "RuleRun"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "StagedInteraction_status_priority_createdAt_idx" ON "StagedInteraction"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "StagedInteraction_source_itemType_createdAt_idx" ON "StagedInteraction"("source", "itemType", "createdAt");

-- CreateIndex
CREATE INDEX "StagedInteraction_candidatePersonId_idx" ON "StagedInteraction"("candidatePersonId");

-- CreateIndex
CREATE INDEX "StagedInteraction_timestamp_idx" ON "StagedInteraction"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "StagedInteraction_workspaceId_source_sourceId_key" ON "StagedInteraction"("workspaceId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_sourcePlanId_key" ON "Event"("sourcePlanId");

-- CreateIndex
CREATE INDEX "Event_workspaceId_start_idx" ON "Event"("workspaceId", "start");

-- CreateIndex
CREATE INDEX "Event_workspaceId_timestamp_idx" ON "Event"("workspaceId", "timestamp");

-- CreateIndex
CREATE INDEX "Event_workspaceId_timestamp_id_idx" ON "Event"("workspaceId", "timestamp" DESC, "id");

-- CreateIndex
CREATE INDEX "Event_sourcePlanId_idx" ON "Event"("sourcePlanId");

-- CreateIndex
CREATE INDEX "Event_parentEventId_idx" ON "Event"("parentEventId");

-- CreateIndex
CREATE INDEX "Interaction_personId_timestamp_idx" ON "Interaction"("personId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Interaction_workspaceId_timestamp_idx" ON "Interaction"("workspaceId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Interaction_timestamp_idx" ON "Interaction"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "Interaction_placeId_idx" ON "Interaction"("placeId");

-- CreateIndex
CREATE INDEX "Interaction_workspaceId_timestamp_id_idx" ON "Interaction"("workspaceId", "timestamp" DESC, "id");

-- CreateIndex
CREATE INDEX "Interaction_workspaceId_type_timestamp_idx" ON "Interaction"("workspaceId", "type", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Interaction_workspaceId_actorPersonId_timestamp_idx" ON "Interaction"("workspaceId", "actorPersonId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Interaction_workspaceId_category_timestamp_idx" ON "Interaction"("workspaceId", "category", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Interaction_accountLinkId_idx" ON "Interaction"("accountLinkId");

-- CreateIndex
CREATE INDEX "Interaction_workspaceId_groupId_timestamp_idx" ON "Interaction"("workspaceId", "groupId", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Interaction_workspaceId_source_sourceId_key" ON "Interaction"("workspaceId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "InteractionParticipant_interactionId_idx" ON "InteractionParticipant"("interactionId");

-- CreateIndex
CREATE INDEX "InteractionParticipant_entityType_entityId_idx" ON "InteractionParticipant"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "InteractionParticipant_workspaceId_idx" ON "InteractionParticipant"("workspaceId");

-- CreateIndex
CREATE INDEX "InteractionParticipant_entityType_entityId_interactionId_idx" ON "InteractionParticipant"("entityType", "entityId", "interactionId");

-- CreateIndex
CREATE INDEX "InteractionParticipant_workspaceId_entityType_entityId_idx" ON "InteractionParticipant"("workspaceId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "InteractionParticipant_interactionId_entityType_entityId_ro_key" ON "InteractionParticipant"("interactionId", "entityType", "entityId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_externalInstanceId_key" ON "Plan"("externalInstanceId");

-- CreateIndex
CREATE INDEX "Plan_workspaceId_createdAt_idx" ON "Plan"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Plan_workspaceId_personId_idx" ON "Plan"("workspaceId", "personId");

-- CreateIndex
CREATE INDEX "Plan_workspaceId_scheduledStart_idx" ON "Plan"("workspaceId", "scheduledStart");

-- CreateIndex
CREATE INDEX "Plan_workspaceId_status_dueOn_idx" ON "Plan"("workspaceId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "Plan_externalInstanceId_idx" ON "Plan"("externalInstanceId");

-- CreateIndex
CREATE INDEX "PlanExpectedPerson_personId_idx" ON "PlanExpectedPerson"("personId");

-- CreateIndex
CREATE INDEX "PlanExpectedPerson_workspaceId_idx" ON "PlanExpectedPerson"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Place_googlePlaceId_key" ON "Place"("googlePlaceId");

-- CreateIndex
CREATE INDEX "Place_parentPlaceId_idx" ON "Place"("parentPlaceId");

-- CreateIndex
CREATE INDEX "Place_workspaceId_idx" ON "Place"("workspaceId");

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
CREATE INDEX "PlaceNote_placeId_createdAt_idx" ON "PlaceNote"("placeId", "createdAt");

-- CreateIndex
CREATE INDEX "PlaceNote_workspaceId_createdAt_idx" ON "PlaceNote"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "PlaceNote_eventId_idx" ON "PlaceNote"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_assetId_key" ON "Item"("assetId");

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "Item"("name");

-- CreateIndex
CREATE INDEX "Item_category_idx" ON "Item"("category");

-- CreateIndex
CREATE INDEX "Item_assetId_idx" ON "Item"("assetId");

-- CreateIndex
CREATE INDEX "Item_placeId_idx" ON "Item"("placeId");

-- CreateIndex
CREATE INDEX "Item_ownedById_idx" ON "Item"("ownedById");

-- CreateIndex
CREATE INDEX "Item_primaryImageFileId_idx" ON "Item"("primaryImageFileId");

-- CreateIndex
CREATE INDEX "Item_createdAt_idx" ON "Item"("createdAt");

-- CreateIndex
CREATE INDEX "Item_workspaceId_idx" ON "Item"("workspaceId");

-- CreateIndex
CREATE INDEX "Item_definitionId_idx" ON "Item"("definitionId");

-- CreateIndex
CREATE INDEX "Item_lotId_idx" ON "Item"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_workspaceId_definitionId_serialNumber_key" ON "Item"("workspaceId", "definitionId", "serialNumber");

-- CreateIndex
CREATE INDEX "ItemDefinition_workspaceId_name_idx" ON "ItemDefinition"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ItemDefinition_workspaceId_active_idx" ON "ItemDefinition"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ItemDefinition_workspaceId_sku_key" ON "ItemDefinition"("workspaceId", "sku");

-- CreateIndex
CREATE INDEX "InventoryLot_workspaceId_expiresAt_idx" ON "InventoryLot"("workspaceId", "expiresAt");

-- CreateIndex
CREATE INDEX "InventoryLot_definitionId_idx" ON "InventoryLot"("definitionId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_workspaceId_definitionId_lotCode_key" ON "InventoryLot"("workspaceId", "definitionId", "lotCode");

-- CreateIndex
CREATE INDEX "Assembly_childItemId_idx" ON "Assembly"("childItemId");

-- CreateIndex
CREATE INDEX "Assembly_parentItemId_idx" ON "Assembly"("parentItemId");

-- CreateIndex
CREATE INDEX "Assembly_disassembledAt_idx" ON "Assembly"("disassembledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedFile_uploadIntentId_key" ON "ImportedFile"("uploadIntentId");

-- CreateIndex
CREATE INDEX "ImportedFile_workspaceId_createdAt_idx" ON "ImportedFile"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportedFile_workspaceId_checksum_idx" ON "ImportedFile"("workspaceId", "checksum");

-- CreateIndex
CREATE INDEX "ImportedFile_workspaceId_archivedAt_createdAt_idx" ON "ImportedFile"("workspaceId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ImportedFile_workspaceId_processingState_createdAt_idx" ON "ImportedFile"("workspaceId", "processingState", "createdAt");

-- CreateIndex
CREATE INDEX "FileUploadIntent_workspaceId_status_createdAt_idx" ON "FileUploadIntent"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FileUploadIntent_expiresAt_idx" ON "FileUploadIntent"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileUploadIntent_workspaceId_storageKey_key" ON "FileUploadIntent"("workspaceId", "storageKey");

-- CreateIndex
CREATE INDEX "FileProcessingRun_workspaceId_status_createdAt_idx" ON "FileProcessingRun"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FileProcessingRun_sourceFileId_createdAt_idx" ON "FileProcessingRun"("sourceFileId", "createdAt");

-- CreateIndex
CREATE INDEX "FileProcessingRun_workflowRunId_idx" ON "FileProcessingRun"("workflowRunId");

-- CreateIndex
CREATE UNIQUE INDEX "FileProcessingRun_workspaceId_runKey_key" ON "FileProcessingRun"("workspaceId", "runKey");

-- CreateIndex
CREATE INDEX "FileChunk_workspaceId_sourceFileId_version_ordinal_idx" ON "FileChunk"("workspaceId", "sourceFileId", "version", "ordinal");

-- CreateIndex
CREATE INDEX "FileChunk_workspaceId_createdAt_idx" ON "FileChunk"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileChunk_processingRunId_ordinal_key" ON "FileChunk"("processingRunId", "ordinal");

-- CreateIndex
CREATE INDEX "FileEntityMention_workspaceId_entityType_normalizedText_idx" ON "FileEntityMention"("workspaceId", "entityType", "normalizedText");

-- CreateIndex
CREATE INDEX "FileEntityMention_workspaceId_resolvedPersonId_createdAt_idx" ON "FileEntityMention"("workspaceId", "resolvedPersonId", "createdAt");

-- CreateIndex
CREATE INDEX "FileEntityMention_workspaceId_resolutionStatus_createdAt_idx" ON "FileEntityMention"("workspaceId", "resolutionStatus", "createdAt");

-- CreateIndex
CREATE INDEX "FileEntityMention_sourceFileId_chunkId_idx" ON "FileEntityMention"("sourceFileId", "chunkId");

-- CreateIndex
CREATE INDEX "PersonExternalIdentifier_personId_idx" ON "PersonExternalIdentifier"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonExternalIdentifier_workspaceId_externalId_key" ON "PersonExternalIdentifier"("workspaceId", "externalId");

-- CreateIndex
CREATE INDEX "FileEntityResolution_workspaceId_createdAt_idx" ON "FileEntityResolution"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "FileEntityResolution_mentionId_createdAt_idx" ON "FileEntityResolution"("mentionId", "createdAt");

-- CreateIndex
CREATE INDEX "FileEntityResolution_fromPersonId_createdAt_idx" ON "FileEntityResolution"("fromPersonId", "createdAt");

-- CreateIndex
CREATE INDEX "FileEntityResolution_toPersonId_createdAt_idx" ON "FileEntityResolution"("toPersonId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceClaim_workspaceId_status_createdAt_idx" ON "EvidenceClaim"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceClaim_workspaceId_classification_createdAt_idx" ON "EvidenceClaim"("workspaceId", "classification", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceClaim_sourceFileId_chunkId_idx" ON "EvidenceClaim"("sourceFileId", "chunkId");

-- CreateIndex
CREATE INDEX "EvidenceClaim_supersedesClaimId_idx" ON "EvidenceClaim"("supersedesClaimId");

-- CreateIndex
CREATE INDEX "EvidenceClaimSubject_mentionId_idx" ON "EvidenceClaimSubject"("mentionId");

-- CreateIndex
CREATE INDEX "EvidenceClaimSubject_claimId_relevanceWeight_idx" ON "EvidenceClaimSubject"("claimId", "relevanceWeight");

-- CreateIndex
CREATE INDEX "AiProviderCredential_workspaceId_status_idx" ON "AiProviderCredential"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderCredential_workspaceId_provider_key" ON "AiProviderCredential"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "AiAnalysisRun_workspaceId_createdAt_idx" ON "AiAnalysisRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAnalysisRun_sourceFileId_idx" ON "AiAnalysisRun"("sourceFileId");

-- CreateIndex
CREATE INDEX "AiAnalysisRun_processingRunId_purpose_idx" ON "AiAnalysisRun"("processingRunId", "purpose");

-- CreateIndex
CREATE INDEX "NoteAnalysisRun_workspaceId_createdAt_idx" ON "NoteAnalysisRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteAnalysisRun_noteId_createdAt_idx" ON "NoteAnalysisRun"("noteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NoteAnalysisRun_noteId_promptVersion_key" ON "NoteAnalysisRun"("noteId", "promptVersion");

-- CreateIndex
CREATE INDEX "TheoryAnalysisRun_workspaceId_createdAt_idx" ON "TheoryAnalysisRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "TheoryAnalysisRun_subjectPersonId_createdAt_idx" ON "TheoryAnalysisRun"("subjectPersonId", "createdAt");

-- CreateIndex
CREATE INDEX "TheoryAnalysisRun_subjectPersonId_status_idx" ON "TheoryAnalysisRun"("subjectPersonId", "status");

-- CreateIndex
CREATE INDEX "LifeModelAnalysisRun_workspaceId_createdAt_idx" ON "LifeModelAnalysisRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LifeModelAnalysisRun_workspaceId_status_idx" ON "LifeModelAnalysisRun"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "LifeModelAnalysisRun_snapshotId_idx" ON "LifeModelAnalysisRun"("snapshotId");

-- CreateIndex
CREATE INDEX "NoteSuggestion_workspaceId_status_createdAt_idx" ON "NoteSuggestion"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "NoteSuggestion_noteId_status_idx" ON "NoteSuggestion"("noteId", "status");

-- CreateIndex
CREATE INDEX "NoteSuggestion_analysisRunId_idx" ON "NoteSuggestion"("analysisRunId");

-- CreateIndex
CREATE INDEX "Group_workspaceId_idx" ON "Group"("workspaceId");

-- CreateIndex
CREATE INDEX "Group_workspaceId_groupType_idx" ON "Group"("workspaceId", "groupType");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProfile_groupId_key" ON "SupplierProfile"("groupId");

-- CreateIndex
CREATE INDEX "SupplierProfile_workspaceId_active_idx" ON "SupplierProfile"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProfile_workspaceId_supplierCode_key" ON "SupplierProfile"("workspaceId", "supplierCode");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_planId_key" ON "PurchaseOrder"("planId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_workspaceId_orderedAt_idx" ON "PurchaseOrder"("workspaceId", "orderedAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_workspaceId_orderNumber_key" ON "PurchaseOrder"("workspaceId", "orderNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_definitionId_idx" ON "PurchaseOrderLine"("definitionId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_destinationPlaceId_idx" ON "PurchaseOrderLine"("destinationPlaceId");

-- CreateIndex
CREATE INDEX "PurchaseReceiptLine_workspaceId_createdAt_idx" ON "PurchaseReceiptLine"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseReceiptLine_eventId_idx" ON "PurchaseReceiptLine"("eventId");

-- CreateIndex
CREATE INDEX "PurchaseReceiptLine_orderLineId_idx" ON "PurchaseReceiptLine"("orderLineId");

-- CreateIndex
CREATE INDEX "PurchaseReceiptLine_itemId_idx" ON "PurchaseReceiptLine"("itemId");

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
CREATE INDEX "Note_workspaceId_timestamp_idx" ON "Note"("workspaceId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Note_sourceFileId_idx" ON "Note"("sourceFileId");

-- CreateIndex
CREATE INDEX "Note_workspaceId_aboutPersonId_timestamp_idx" ON "Note"("workspaceId", "aboutPersonId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Note_workspaceId_aboutPlaceId_timestamp_idx" ON "Note"("workspaceId", "aboutPlaceId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Note_workspaceId_aboutItemId_timestamp_idx" ON "Note"("workspaceId", "aboutItemId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Note_workspaceId_aboutEventId_timestamp_idx" ON "Note"("workspaceId", "aboutEventId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Note_workspaceId_aboutPlanId_timestamp_idx" ON "Note"("workspaceId", "aboutPlanId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Note_workspaceId_aboutGroupId_timestamp_idx" ON "Note"("workspaceId", "aboutGroupId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Note_workspaceId_aboutStateId_timestamp_idx" ON "Note"("workspaceId", "aboutStateId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "TheorySnapshot_subjectPersonId_idx" ON "TheorySnapshot"("subjectPersonId");

-- CreateIndex
CREATE INDEX "TheorySnapshot_subjectPersonId_version_idx" ON "TheorySnapshot"("subjectPersonId", "version");

-- CreateIndex
CREATE INDEX "TheorySnapshot_status_idx" ON "TheorySnapshot"("status");

-- CreateIndex
CREATE INDEX "TheorySnapshot_workspaceId_idx" ON "TheorySnapshot"("workspaceId");

-- CreateIndex
CREATE INDEX "TheorySnapshotSource_snapshotId_idx" ON "TheorySnapshotSource"("snapshotId");

-- CreateIndex
CREATE INDEX "TheorySnapshotSource_sourceType_sourceId_idx" ON "TheorySnapshotSource"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "TheorySnapshotSource_evidenceClaimId_idx" ON "TheorySnapshotSource"("evidenceClaimId");

-- CreateIndex
CREATE INDEX "LifeModelSnapshot_workspaceId_version_idx" ON "LifeModelSnapshot"("workspaceId", "version");

-- CreateIndex
CREATE INDEX "LifeModelSnapshot_workspaceId_status_idx" ON "LifeModelSnapshot"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "LifeModelClaim_snapshotId_idx" ON "LifeModelClaim"("snapshotId");

-- CreateIndex
CREATE INDEX "LifeModelClaim_kind_idx" ON "LifeModelClaim"("kind");

-- CreateIndex
CREATE INDEX "LifeModelClaim_subjectType_subjectId_idx" ON "LifeModelClaim"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "LifeModelClaimFeedback_workspaceId_createdAt_idx" ON "LifeModelClaimFeedback"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LifeModelClaimFeedback_claimId_createdAt_idx" ON "LifeModelClaimFeedback"("claimId", "createdAt");

-- CreateIndex
CREATE INDEX "LifeModelClaimFeedback_sourceNoteId_idx" ON "LifeModelClaimFeedback"("sourceNoteId");

-- CreateIndex
CREATE INDEX "AdaptiveDayBrief_workspaceId_day_rulesVersion_idx" ON "AdaptiveDayBrief"("workspaceId", "day", "rulesVersion");

-- CreateIndex
CREATE INDEX "AdaptiveDayBrief_workspaceId_day_status_idx" ON "AdaptiveDayBrief"("workspaceId", "day", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdaptiveIntervention_reviewItemId_key" ON "AdaptiveIntervention"("reviewItemId");

-- CreateIndex
CREATE INDEX "AdaptiveIntervention_briefId_rank_idx" ON "AdaptiveIntervention"("briefId", "rank");

-- CreateIndex
CREATE INDEX "AdaptiveIntervention_reviewItemId_idx" ON "AdaptiveIntervention"("reviewItemId");

-- CreateIndex
CREATE INDEX "AdaptiveInterventionOutcome_workspaceId_createdAt_idx" ON "AdaptiveInterventionOutcome"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AdaptiveInterventionOutcome_interventionId_createdAt_idx" ON "AdaptiveInterventionOutcome"("interventionId", "createdAt");

-- CreateIndex
CREATE INDEX "StateDefinition_workspaceId_entityType_idx" ON "StateDefinition"("workspaceId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "StateDefinition_workspaceId_entityType_type_value_key" ON "StateDefinition"("workspaceId", "entityType", "type", "value");

-- CreateIndex
CREATE INDEX "State_workspaceId_entityId_entityType_idx" ON "State"("workspaceId", "entityId", "entityType");

-- CreateIndex
CREATE INDEX "State_workspaceId_entityId_entityType_recordedAt_idx" ON "State"("workspaceId", "entityId", "entityType", "recordedAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_workspaceId_from_createdAt_idx" ON "AssistantMessage"("workspaceId", "from", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LevelUpProfile_workspaceId_key" ON "LevelUpProfile"("workspaceId");

-- CreateIndex
CREATE INDEX "LevelUpTestResult_workspaceId_testKey_measuredAt_idx" ON "LevelUpTestResult"("workspaceId", "testKey", "measuredAt");

-- CreateIndex
CREATE INDEX "LevelUpTestResult_combineId_idx" ON "LevelUpTestResult"("combineId");

-- CreateIndex
CREATE INDEX "LevelUpCombine_workspaceId_completedAt_idx" ON "LevelUpCombine"("workspaceId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LevelUpRatingSnapshot_combineId_key" ON "LevelUpRatingSnapshot"("combineId");

-- CreateIndex
CREATE INDEX "LevelUpRatingSnapshot_workspaceId_computedAt_idx" ON "LevelUpRatingSnapshot"("workspaceId", "computedAt");

-- CreateIndex
CREATE INDEX "LevelUpTrainingSet_workspaceId_exerciseKey_performedAt_idx" ON "LevelUpTrainingSet"("workspaceId", "exerciseKey", "performedAt");

-- CreateIndex
CREATE INDEX "LevelUpTrainingSet_workspaceId_sessionId_idx" ON "LevelUpTrainingSet"("workspaceId", "sessionId");

-- CreateIndex
CREATE INDEX "LevelUpTrainingSet_workspaceId_exerciseId_performedAt_idx" ON "LevelUpTrainingSet"("workspaceId", "exerciseId", "performedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LevelUpTrainingSet_workspaceId_source_sourceId_key" ON "LevelUpTrainingSet"("workspaceId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "LevelUpExercise_workspaceId_idx" ON "LevelUpExercise"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "LevelUpExercise_workspaceId_key_key" ON "LevelUpExercise"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "LevelUpProgram_workspaceId_isActive_idx" ON "LevelUpProgram"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "LevelUpProgramDay_programId_order_idx" ON "LevelUpProgramDay"("programId", "order");

-- CreateIndex
CREATE INDEX "LevelUpProgramDay_workspaceId_idx" ON "LevelUpProgramDay"("workspaceId");

-- CreateIndex
CREATE INDEX "LevelUpProgramEntry_programDayId_order_idx" ON "LevelUpProgramEntry"("programDayId", "order");

-- CreateIndex
CREATE INDEX "LevelUpProgramEntry_workspaceId_idx" ON "LevelUpProgramEntry"("workspaceId");

-- CreateIndex
CREATE INDEX "LevelUpSession_workspaceId_startedAt_idx" ON "LevelUpSession"("workspaceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LevelUpSession_workspaceId_source_sourceId_key" ON "LevelUpSession"("workspaceId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "LevelUpBodyMetric_workspaceId_measuredAt_idx" ON "LevelUpBodyMetric"("workspaceId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LevelUpReadinessSnapshot_sessionId_key" ON "LevelUpReadinessSnapshot"("sessionId");

-- CreateIndex
CREATE INDEX "LevelUpReadinessSnapshot_workspaceId_snapshotAt_idx" ON "LevelUpReadinessSnapshot"("workspaceId", "snapshotAt");

-- CreateIndex
CREATE INDEX "LevelUpBadgeUnlock_workspaceId_unlockedAt_idx" ON "LevelUpBadgeUnlock"("workspaceId", "unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LevelUpBadgeUnlock_workspaceId_badgeKey_tier_key" ON "LevelUpBadgeUnlock"("workspaceId", "badgeKey", "tier");

-- CreateIndex
CREATE INDEX "LevelUpTargetBuild_workspaceId_status_idx" ON "LevelUpTargetBuild"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LevelUpTargetBuild_workspaceId_buildKey_key" ON "LevelUpTargetBuild"("workspaceId", "buildKey");

-- CreateIndex
CREATE INDEX "GraphEvent_workspaceId_occurredAt_idx" ON "GraphEvent"("workspaceId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "GraphEvent_workspaceId_subjectType_subjectId_idx" ON "GraphEvent"("workspaceId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "GraphEvent_workspaceId_eventType_occurredAt_idx" ON "GraphEvent"("workspaceId", "eventType", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "GraphEvent_correlationId_idx" ON "GraphEvent"("correlationId");

-- CreateIndex
CREATE INDEX "GraphEvent_causationId_idx" ON "GraphEvent"("causationId");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEvent_workspaceId_idempotencyKey_key" ON "GraphEvent"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GraphEventReceipt_consumer_status_nextRetryAt_idx" ON "GraphEventReceipt"("consumer", "status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEventReceipt_eventId_consumer_key" ON "GraphEventReceipt"("eventId", "consumer");

-- CreateIndex
CREATE INDEX "ReviewItem_workspaceId_status_priority_createdAt_idx" ON "ReviewItem"("workspaceId", "status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewItem_workspaceId_source_itemType_idx" ON "ReviewItem"("workspaceId", "source", "itemType");

-- CreateIndex
CREATE INDEX "ReviewItem_workspaceId_targetType_targetId_idx" ON "ReviewItem"("workspaceId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewItem_workspaceId_source_sourceId_key" ON "ReviewItem"("workspaceId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "_EventGroupTags_B_index" ON "_EventGroupTags"("B");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovedEmail" ADD CONSTRAINT "ApprovedEmail_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovedEmail" ADD CONSTRAINT "ApprovedEmail_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceSource" ADD CONSTRAINT "DeviceSource_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCredential" ADD CONSTRAINT "DeviceCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAuthorization" ADD CONSTRAINT "DeviceAuthorization_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAuthorization" ADD CONSTRAINT "DeviceAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAuthorization" ADD CONSTRAINT "DeviceAuthorization_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIngestItem" ADD CONSTRAINT "DeviceIngestItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIngestItem" ADD CONSTRAINT "DeviceIngestItem_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKeyScope" ADD CONSTRAINT "ApiKeyScope_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailConnection" ADD CONSTRAINT "GmailConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailConnection" ADD CONSTRAINT "GmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailMessageLink" ADD CONSTRAINT "GmailMessageLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailMessageLink" ADD CONSTRAINT "GmailMessageLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailMessageLink" ADD CONSTRAINT "GmailMessageLink_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailMessageLink" ADD CONSTRAINT "GmailMessageLink_stagedItemId_fkey" FOREIGN KEY ("stagedItemId") REFERENCES "StagedInteraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraConnection" ADD CONSTRAINT "EraConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraConnection" ADD CONSTRAINT "EraConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraAccountLink" ADD CONSTRAINT "EraAccountLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraAccountLink" ADD CONSTRAINT "EraAccountLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EraConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraAccountLink" ADD CONSTRAINT "EraAccountLink_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraAccountLink" ADD CONSTRAINT "EraAccountLink_householdGroupId_fkey" FOREIGN KEY ("householdGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraTransactionLink" ADD CONSTRAINT "EraTransactionLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraTransactionLink" ADD CONSTRAINT "EraTransactionLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EraConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraTransactionLink" ADD CONSTRAINT "EraTransactionLink_accountLinkId_fkey" FOREIGN KEY ("accountLinkId") REFERENCES "EraAccountLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraTransactionLink" ADD CONSTRAINT "EraTransactionLink_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraTransactionLink" ADD CONSTRAINT "EraTransactionLink_stagedItemId_fkey" FOREIGN KEY ("stagedItemId") REFERENCES "StagedInteraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GranolaNoteLink" ADD CONSTRAINT "GranolaNoteLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GranolaNoteLink" ADD CONSTRAINT "GranolaNoteLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GranolaNoteLink" ADD CONSTRAINT "GranolaNoteLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleRun" ADD CONSTRAINT "RuleRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleRun" ADD CONSTRAINT "RuleRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedInteraction" ADD CONSTRAINT "StagedInteraction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedInteraction" ADD CONSTRAINT "StagedInteraction_candidatePersonId_fkey" FOREIGN KEY ("candidatePersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_sourcePlanId_fkey" FOREIGN KEY ("sourcePlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_accountLinkId_fkey" FOREIGN KEY ("accountLinkId") REFERENCES "EraAccountLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_actorPersonId_fkey" FOREIGN KEY ("actorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionParticipant" ADD CONSTRAINT "InteractionParticipant_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExpectedPerson" ADD CONSTRAINT "PlanExpectedPerson_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExpectedPerson" ADD CONSTRAINT "PlanExpectedPerson_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExpectedPerson" ADD CONSTRAINT "PlanExpectedPerson_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_parentPlaceId_fkey" FOREIGN KEY ("parentPlaceId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportStagedVisit" ADD CONSTRAINT "ImportStagedVisit_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportStagedVisit" ADD CONSTRAINT "ImportStagedVisit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportStagedVisit" ADD CONSTRAINT "ImportStagedVisit_resolvedPlaceId_fkey" FOREIGN KEY ("resolvedPlaceId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceNote" ADD CONSTRAINT "PlaceNote_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceNote" ADD CONSTRAINT "PlaceNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceNote" ADD CONSTRAINT "PlaceNote_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ItemDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_ownedById_fkey" FOREIGN KEY ("ownedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_primaryImageFileId_fkey" FOREIGN KEY ("primaryImageFileId") REFERENCES "ImportedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDefinition" ADD CONSTRAINT "ItemDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ItemDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_childItemId_fkey" FOREIGN KEY ("childItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_assembledById_fkey" FOREIGN KEY ("assembledById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_disassembledById_fkey" FOREIGN KEY ("disassembledById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInteraction" ADD CONSTRAINT "ItemInteraction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInteraction" ADD CONSTRAINT "ItemInteraction_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedFile" ADD CONSTRAINT "ImportedFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedFile" ADD CONSTRAINT "ImportedFile_uploadIntentId_fkey" FOREIGN KEY ("uploadIntentId") REFERENCES "FileUploadIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileUploadIntent" ADD CONSTRAINT "FileUploadIntent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileProcessingRun" ADD CONSTRAINT "FileProcessingRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileProcessingRun" ADD CONSTRAINT "FileProcessingRun_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileChunk" ADD CONSTRAINT "FileChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileChunk" ADD CONSTRAINT "FileChunk_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileChunk" ADD CONSTRAINT "FileChunk_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "FileProcessingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileEntityMention" ADD CONSTRAINT "FileEntityMention_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileEntityMention" ADD CONSTRAINT "FileEntityMention_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileEntityMention" ADD CONSTRAINT "FileEntityMention_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "FileProcessingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileEntityMention" ADD CONSTRAINT "FileEntityMention_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "FileChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileEntityMention" ADD CONSTRAINT "FileEntityMention_resolvedPersonId_fkey" FOREIGN KEY ("resolvedPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonExternalIdentifier" ADD CONSTRAINT "PersonExternalIdentifier_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonExternalIdentifier" ADD CONSTRAINT "PersonExternalIdentifier_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileEntityResolution" ADD CONSTRAINT "FileEntityResolution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileEntityResolution" ADD CONSTRAINT "FileEntityResolution_mentionId_fkey" FOREIGN KEY ("mentionId") REFERENCES "FileEntityMention"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileEntityResolution" ADD CONSTRAINT "FileEntityResolution_fromPersonId_fkey" FOREIGN KEY ("fromPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileEntityResolution" ADD CONSTRAINT "FileEntityResolution_toPersonId_fkey" FOREIGN KEY ("toPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "FileProcessingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "FileChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_supersedesClaimId_fkey" FOREIGN KEY ("supersedesClaimId") REFERENCES "EvidenceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_correctionNoteId_fkey" FOREIGN KEY ("correctionNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceClaimSubject" ADD CONSTRAINT "EvidenceClaimSubject_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "EvidenceClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceClaimSubject" ADD CONSTRAINT "EvidenceClaimSubject_mentionId_fkey" FOREIGN KEY ("mentionId") REFERENCES "FileEntityMention"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderCredential" ADD CONSTRAINT "AiProviderCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysisRun" ADD CONSTRAINT "AiAnalysisRun_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "FileProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAnalysisRun" ADD CONSTRAINT "NoteAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAnalysisRun" ADD CONSTRAINT "NoteAnalysisRun_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAnalysisRun" ADD CONSTRAINT "NoteAnalysisRun_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheoryAnalysisRun" ADD CONSTRAINT "TheoryAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheoryAnalysisRun" ADD CONSTRAINT "TheoryAnalysisRun_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheoryAnalysisRun" ADD CONSTRAINT "TheoryAnalysisRun_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeModelAnalysisRun" ADD CONSTRAINT "LifeModelAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeModelAnalysisRun" ADD CONSTRAINT "LifeModelAnalysisRun_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeModelAnalysisRun" ADD CONSTRAINT "LifeModelAnalysisRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LifeModelSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteSuggestion" ADD CONSTRAINT "NoteSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteSuggestion" ADD CONSTRAINT "NoteSuggestion_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteSuggestion" ADD CONSTRAINT "NoteSuggestion_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "NoteAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProfile" ADD CONSTRAINT "SupplierProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProfile" ADD CONSTRAINT "SupplierProfile_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_destinationPlaceId_fkey" FOREIGN KEY ("destinationPlaceId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonGroup" ADD CONSTRAINT "PersonGroup_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonGroup" ADD CONSTRAINT "PersonGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupGroup" ADD CONSTRAINT "GroupGroup_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupGroup" ADD CONSTRAINT "GroupGroup_childGroupId_fkey" FOREIGN KEY ("childGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceGroup" ADD CONSTRAINT "PlaceGroup_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceGroup" ADD CONSTRAINT "PlaceGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_aboutPersonId_fkey" FOREIGN KEY ("aboutPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_aboutPlaceId_fkey" FOREIGN KEY ("aboutPlaceId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_aboutItemId_fkey" FOREIGN KEY ("aboutItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_aboutEventId_fkey" FOREIGN KEY ("aboutEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_aboutPlanId_fkey" FOREIGN KEY ("aboutPlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_aboutGroupId_fkey" FOREIGN KEY ("aboutGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_aboutStateId_fkey" FOREIGN KEY ("aboutStateId") REFERENCES "State"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheorySnapshot" ADD CONSTRAINT "TheorySnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheorySnapshot" ADD CONSTRAINT "TheorySnapshot_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheorySnapshotSource" ADD CONSTRAINT "TheorySnapshotSource_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TheorySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheorySnapshotSource" ADD CONSTRAINT "TheorySnapshotSource_evidenceClaimId_fkey" FOREIGN KEY ("evidenceClaimId") REFERENCES "EvidenceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeModelSnapshot" ADD CONSTRAINT "LifeModelSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeModelClaim" ADD CONSTRAINT "LifeModelClaim_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LifeModelSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeModelClaimFeedback" ADD CONSTRAINT "LifeModelClaimFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeModelClaimFeedback" ADD CONSTRAINT "LifeModelClaimFeedback_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "LifeModelClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeModelClaimFeedback" ADD CONSTRAINT "LifeModelClaimFeedback_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptiveDayBrief" ADD CONSTRAINT "AdaptiveDayBrief_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptiveIntervention" ADD CONSTRAINT "AdaptiveIntervention_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "AdaptiveDayBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptiveInterventionOutcome" ADD CONSTRAINT "AdaptiveInterventionOutcome_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptiveInterventionOutcome" ADD CONSTRAINT "AdaptiveInterventionOutcome_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "AdaptiveIntervention"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "State" ADD CONSTRAINT "State_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "StateDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "State" ADD CONSTRAINT "State_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpProfile" ADD CONSTRAINT "LevelUpProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpTestResult" ADD CONSTRAINT "LevelUpTestResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpTestResult" ADD CONSTRAINT "LevelUpTestResult_combineId_fkey" FOREIGN KEY ("combineId") REFERENCES "LevelUpCombine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpCombine" ADD CONSTRAINT "LevelUpCombine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpRatingSnapshot" ADD CONSTRAINT "LevelUpRatingSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpRatingSnapshot" ADD CONSTRAINT "LevelUpRatingSnapshot_combineId_fkey" FOREIGN KEY ("combineId") REFERENCES "LevelUpCombine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpTrainingSet" ADD CONSTRAINT "LevelUpTrainingSet_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpTrainingSet" ADD CONSTRAINT "LevelUpTrainingSet_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LevelUpSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpTrainingSet" ADD CONSTRAINT "LevelUpTrainingSet_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "LevelUpExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpExercise" ADD CONSTRAINT "LevelUpExercise_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpExercise" ADD CONSTRAINT "LevelUpExercise_substituteId_fkey" FOREIGN KEY ("substituteId") REFERENCES "LevelUpExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpProgram" ADD CONSTRAINT "LevelUpProgram_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpProgramDay" ADD CONSTRAINT "LevelUpProgramDay_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpProgramDay" ADD CONSTRAINT "LevelUpProgramDay_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LevelUpProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpProgramEntry" ADD CONSTRAINT "LevelUpProgramEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpProgramEntry" ADD CONSTRAINT "LevelUpProgramEntry_programDayId_fkey" FOREIGN KEY ("programDayId") REFERENCES "LevelUpProgramDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpProgramEntry" ADD CONSTRAINT "LevelUpProgramEntry_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "LevelUpExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpSession" ADD CONSTRAINT "LevelUpSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpSession" ADD CONSTRAINT "LevelUpSession_programDayId_fkey" FOREIGN KEY ("programDayId") REFERENCES "LevelUpProgramDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpBodyMetric" ADD CONSTRAINT "LevelUpBodyMetric_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpReadinessSnapshot" ADD CONSTRAINT "LevelUpReadinessSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpReadinessSnapshot" ADD CONSTRAINT "LevelUpReadinessSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LevelUpSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpBadgeUnlock" ADD CONSTRAINT "LevelUpBadgeUnlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelUpTargetBuild" ADD CONSTRAINT "LevelUpTargetBuild_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEvent" ADD CONSTRAINT "GraphEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEvent" ADD CONSTRAINT "GraphEvent_causationId_fkey" FOREIGN KEY ("causationId") REFERENCES "GraphEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEventReceipt" ADD CONSTRAINT "GraphEventReceipt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "GraphEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EventGroupTags" ADD CONSTRAINT "_EventGroupTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EventGroupTags" ADD CONSTRAINT "_EventGroupTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
