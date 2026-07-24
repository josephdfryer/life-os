import { createClient, type Client } from "@libsql/client"

const migrationName = "20260724030000_add_inventory_phase_2_support"

// Idempotent production apply for Phase 2 inventory support (stock identity and
// quantity). Mirrors prisma/migrations/20260724030000_add_inventory_phase_2_support.
// Additive only: new ItemDefinition/InventoryLot tables, nullable Item edges,
// ItemInteraction ledger columns, and indexes. Existing Item rows keep their
// quantity, location, and history. Safe to re-run.

async function addColumnIfMissing(client: Client, table: string, column: string, definition: string) {
  const result = await client.execute({
    sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  })
  if (result.rows.length === 0) {
    console.log(`  Adding ${table}.${column}...`)
    await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
  }
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
    process.exit(1)
  }

  const client = createClient({ url, authToken })
  try {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS "ItemDefinition" (
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
      )`,
      `CREATE TABLE IF NOT EXISTS "InventoryLot" (
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
      )`,
    ], "write")

    await addColumnIfMissing(client, "Item", "definitionId", 'TEXT REFERENCES "ItemDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE')
    await addColumnIfMissing(client, "Item", "lotId", 'TEXT REFERENCES "InventoryLot" ("id") ON DELETE SET NULL ON UPDATE CASCADE')
    await addColumnIfMissing(client, "ItemInteraction", "quantityDelta", "REAL")
    await addColumnIfMissing(client, "ItemInteraction", "quantityAfter", "REAL")

    await client.batch([
      `CREATE UNIQUE INDEX IF NOT EXISTS "ItemDefinition_workspaceId_sku_key" ON "ItemDefinition"("workspaceId", "sku")`,
      `CREATE INDEX IF NOT EXISTS "ItemDefinition_workspaceId_name_idx" ON "ItemDefinition"("workspaceId", "name")`,
      `CREATE INDEX IF NOT EXISTS "ItemDefinition_workspaceId_active_idx" ON "ItemDefinition"("workspaceId", "active")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLot_workspaceId_definitionId_lotCode_key" ON "InventoryLot"("workspaceId", "definitionId", "lotCode")`,
      `CREATE INDEX IF NOT EXISTS "InventoryLot_workspaceId_expiresAt_idx" ON "InventoryLot"("workspaceId", "expiresAt")`,
      `CREATE INDEX IF NOT EXISTS "InventoryLot_definitionId_idx" ON "InventoryLot"("definitionId")`,
      `CREATE INDEX IF NOT EXISTS "Item_definitionId_idx" ON "Item"("definitionId")`,
      `CREATE INDEX IF NOT EXISTS "Item_lotId_idx" ON "Item"("lotId")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Item_workspaceId_definitionId_serialNumber_key" ON "Item"("workspaceId", "definitionId", "serialNumber")`,
    ], "write")

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
