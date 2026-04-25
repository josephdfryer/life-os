-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Item_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_ownedById_fkey" FOREIGN KEY ("ownedById") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assembly" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "childItemId" TEXT NOT NULL,
    "parentItemId" TEXT NOT NULL,
    "assembledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assembledById" TEXT,
    "disassembledAt" DATETIME,
    "disassembledById" TEXT,
    "notes" TEXT,
    CONSTRAINT "Assembly_childItemId_fkey" FOREIGN KEY ("childItemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assembly_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assembly_assembledById_fkey" FOREIGN KEY ("assembledById") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Assembly_disassembledById_fkey" FOREIGN KEY ("disassembledById") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ItemInteraction" (
    "itemId" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "role" TEXT,

    PRIMARY KEY ("itemId", "interactionId"),
    CONSTRAINT "ItemInteraction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ItemInteraction_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Interaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Interaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Interaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Interaction" ("actionItems", "amount", "billable", "createdAt", "direction", "duration", "emotionalWeight", "eventId", "id", "notes", "outcome", "personId", "sourceFileId", "summary", "timestamp", "type") SELECT "actionItems", "amount", "billable", "createdAt", "direction", "duration", "emotionalWeight", "eventId", "id", "notes", "outcome", "personId", "sourceFileId", "summary", "timestamp", "type" FROM "Interaction";
DROP TABLE "Interaction";
ALTER TABLE "new_Interaction" RENAME TO "Interaction";
CREATE INDEX "Interaction_personId_timestamp_idx" ON "Interaction"("personId", "timestamp" DESC);
CREATE INDEX "Interaction_timestamp_idx" ON "Interaction"("timestamp" DESC);
CREATE INDEX "Interaction_placeId_idx" ON "Interaction"("placeId");
CREATE TABLE "new_Place" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "address" TEXT,
    "coordinates" TEXT,
    "meaning" TEXT,
    "parentPlaceId" TEXT,
    CONSTRAINT "Place_parentPlaceId_fkey" FOREIGN KEY ("parentPlaceId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Place" ("address", "coordinates", "id", "meaning", "name", "type") SELECT "address", "coordinates", "id", "meaning", "name", "type" FROM "Place";
DROP TABLE "Place";
ALTER TABLE "new_Place" RENAME TO "Place";
CREATE INDEX "Place_parentPlaceId_idx" ON "Place"("parentPlaceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
CREATE INDEX "Item_createdAt_idx" ON "Item"("createdAt");

-- CreateIndex
CREATE INDEX "Assembly_childItemId_idx" ON "Assembly"("childItemId");

-- CreateIndex
CREATE INDEX "Assembly_parentItemId_idx" ON "Assembly"("parentItemId");

-- CreateIndex
CREATE INDEX "Assembly_disassembledAt_idx" ON "Assembly"("disassembledAt");
