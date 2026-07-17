import { createClient } from "@libsql/client"

const migrationName = "20260714130000_money_as_cents"

// One-time production migration: converts Interaction.amount and
// Item.purchasePrice from REAL dollars to INTEGER cents, matching
// packages/db/prisma/migrations/20260714130000_money_as_cents/migration.sql.
//
// Usage:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx turso-migrate-money-as-cents.ts
//
// Idempotent: checks each column's declared type first and skips the
// conversion if it has already run (declared type is already INTEGER),
// so re-running this script never double-converts values.

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    const alreadyMigrated = await columnIsInteger(client, "Interaction", "amount")
    if (alreadyMigrated) {
      console.log(`${migrationName}: already applied (Interaction.amount is INTEGER). Skipping.`)
      return
    }

    console.log("Rewriting Interaction and Item tables (REAL dollars -> INTEGER cents)...")
    await client.executeMultiple(MIGRATION_SQL)
    console.log(`${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

async function columnIsInteger(client: ReturnType<typeof createClient>, table: string, column: string): Promise<boolean> {
  const result = await client.execute(`SELECT type FROM pragma_table_info('${table}') WHERE name = '${column}'`)
  const type = result.rows[0]?.type
  return typeof type === "string" && type.toUpperCase() === "INTEGER"
}

const MIGRATION_SQL = `
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "amount" INTEGER,
    "direction" TEXT,
    "sourceFileId" TEXT,
    "sourceNoteId" TEXT,
    CONSTRAINT "Interaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Interaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Interaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Interaction" ("id", "workspaceId", "createdAt", "personId", "eventId", "placeId", "type", "timestamp", "duration", "emotionalWeight", "outcome", "summary", "notes", "actionItems", "billable", "amount", "direction", "sourceFileId", "sourceNoteId")
SELECT "id", "workspaceId", "createdAt", "personId", "eventId", "placeId", "type", "timestamp", "duration", "emotionalWeight", "outcome", "summary", "notes", "actionItems", "billable", CAST(ROUND("amount" * 100) AS INTEGER), "direction", "sourceFileId", "sourceNoteId" FROM "Interaction";
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
    "purchasePrice" INTEGER,
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
INSERT INTO "new_Item" ("id", "workspaceId", "createdAt", "updatedAt", "name", "description", "category", "make", "model", "serialNumber", "assetId", "quantity", "purchaseDate", "purchasePrice", "purchaseFrom", "warrantyExpires", "lifetimeWarranty", "warrantyDetails", "placeId", "ownedById", "tags", "notes", "color", "colorSoft")
SELECT "id", "workspaceId", "createdAt", "updatedAt", "name", "description", "category", "make", "model", "serialNumber", "assetId", "quantity", "purchaseDate", CAST(ROUND("purchasePrice" * 100) AS INTEGER), "purchaseFrom", "warrantyExpires", "lifetimeWarranty", "warrantyDetails", "placeId", "ownedById", "tags", "notes", "color", "colorSoft" FROM "Item";
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
`

main().catch(e => { console.error(e); process.exit(1) })
