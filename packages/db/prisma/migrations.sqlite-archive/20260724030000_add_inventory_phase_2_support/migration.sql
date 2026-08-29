-- Additive Phase 2 inventory support. Existing Item rows remain valid and
-- retain their current quantity, location, and history.
CREATE TABLE "ItemDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "trackingMode" TEXT NOT NULL DEFAULT 'untracked',
    "reorderPoint" REAL,
    "targetStock" REAL,
    "defaultShelfLifeDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ItemDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "manufacturedAt" DATETIME,
    "receivedAt" DATETIME,
    "expiresAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryLot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryLot_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ItemDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Item" ADD COLUMN "definitionId" TEXT REFERENCES "ItemDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Item" ADD COLUMN "lotId" TEXT REFERENCES "InventoryLot" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ItemInteraction" ADD COLUMN "quantityDelta" REAL;
ALTER TABLE "ItemInteraction" ADD COLUMN "quantityAfter" REAL;

CREATE UNIQUE INDEX "ItemDefinition_workspaceId_sku_key" ON "ItemDefinition"("workspaceId", "sku");
CREATE INDEX "ItemDefinition_workspaceId_name_idx" ON "ItemDefinition"("workspaceId", "name");
CREATE INDEX "ItemDefinition_workspaceId_active_idx" ON "ItemDefinition"("workspaceId", "active");
CREATE UNIQUE INDEX "InventoryLot_workspaceId_definitionId_lotCode_key" ON "InventoryLot"("workspaceId", "definitionId", "lotCode");
CREATE INDEX "InventoryLot_workspaceId_expiresAt_idx" ON "InventoryLot"("workspaceId", "expiresAt");
CREATE INDEX "InventoryLot_definitionId_idx" ON "InventoryLot"("definitionId");
CREATE INDEX "Item_definitionId_idx" ON "Item"("definitionId");
CREATE INDEX "Item_lotId_idx" ON "Item"("lotId");
CREATE UNIQUE INDEX "Item_workspaceId_definitionId_serialNumber_key" ON "Item"("workspaceId", "definitionId", "serialNumber");
