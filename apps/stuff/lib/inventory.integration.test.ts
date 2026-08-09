import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url))
const dbPackageRoot = join(repoRoot, "packages/db")
const require = createRequire(import.meta.url)
const dbDir = mkdtempSync(join(tmpdir(), "life-os-stuff-"))
const dbPath = join(dbDir, "stuff.db")
process.env.DATABASE_URL = `file:${dbPath}`
process.env.TURSO_DATABASE_URL = ""
process.env.TURSO_AUTH_TOKEN = ""

function applyMigrations(path: string) {
  const Database = require("better-sqlite3")
  const sqlite = new Database(path)
  sqlite.pragma("foreign_keys = OFF")
  const migrationsDir = join(dbPackageRoot, "prisma/migrations")
  for (const dirname of readdirSync(migrationsDir).filter(name => name !== "migration_lock.toml").sort()) {
    sqlite.exec(readFileSync(join(migrationsDir, dirname, "migration.sql"), "utf8"))
  }
  sqlite.pragma("foreign_keys = ON")
  sqlite.close()
}

test("inventory overview and stocktake detail derive latest item evidence in SQL", async () => {
  applyMigrations(dbPath)
  const [{ db }, inventory, core] = await Promise.all([
    import("./db"),
    import("./inventory"),
    import("./inventory-core"),
  ])
  const workspace = await db.workspace.create({
    data: { id: "inventory-perf-workspace", name: "Inventory Perf", slug: "inventory-perf" },
  })
  const place = await db.place.create({
    data: { workspaceId: workspace.id, name: "Closet", type: "storage" },
  })
  const destination = await db.place.create({
    data: { workspaceId: workspace.id, name: "Hall", type: "storage" },
  })
  const item = await db.item.create({
    data: { workspaceId: workspace.id, name: "Coat", assetId: "PERF-COAT", placeId: place.id },
  })
  const stocktake = await db.event.create({
    data: {
      workspaceId: workspace.id,
      name: "Closet stocktake",
      type: core.STOCKTAKE_EVENT_TYPE,
      start: new Date("2026-08-01T10:00:00Z"),
      timestamp: new Date("2026-08-01T10:00:00Z"),
      placeId: place.id,
      metadata: JSON.stringify(core.createStocktakeSnapshot({
        placeIds: [place.id],
        expectedItemIds: [item.id],
        includeDescendants: false,
      })),
    },
  })
  const definition = await db.stateDefinition.create({
    data: { workspaceId: workspace.id, ...core.MISSING_STATE },
  })
  await db.state.create({
    data: {
      workspaceId: workspace.id,
      entityType: "Item",
      entityId: item.id,
      definitionId: definition.id,
      recordedAt: new Date("2026-08-01T11:00:00Z"),
    },
  })
  const interaction = await db.interaction.create({
    data: {
      workspaceId: workspace.id,
      eventId: stocktake.id,
      placeId: place.id,
      type: core.INVENTORY_INTERACTION_TYPES.verified,
      timestamp: new Date("2026-08-02T12:00:00Z"),
      participants: { create: { workspaceId: workspace.id, entityType: "Item", entityId: item.id, role: "subject" } },
    },
  })

  const [overview, detail] = await Promise.all([
    inventory.getInventoryOverview(db, workspace.id),
    inventory.getStocktakeDetail(db, workspace.id, stocktake.id),
  ])
  assert.equal(overview.items[0].lastObservedAt, "2026-08-02T12:00:00.000Z")
  assert.equal(overview.items[0].attentionReason, null)
  assert.equal(detail.progress.verifiedExpected[0], item.id)
  assert.equal(detail.progress.missing.length, 0)
  assert.equal(interaction.eventId, stocktake.id)

  const moved = await inventory.moveItem(db, {
    workspaceId: workspace.id,
    itemId: item.id,
    destinationPlaceId: destination.id,
    expectedFromPlaceId: place.id,
    timestamp: new Date("2026-08-03T12:00:00Z"),
  })
  assert.equal(moved.placeId, destination.id)
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).placeId, destination.id)
  assert.equal(
    (await db.interaction.findUniqueOrThrow({ where: { id: moved.interactionId } })).type,
    core.INVENTORY_INTERACTION_TYPES.moved,
  )
  assert.equal(await db.graphEvent.count({
    where: { workspaceId: workspace.id, subjectType: "Item", subjectId: item.id, eventType: "item.move" },
  }), 1)

  const adjusted = await inventory.adjustItemQuantity(db, {
    workspaceId: workspace.id,
    itemId: item.id,
    delta: 2,
    reason: "Found two spares",
    timestamp: new Date("2026-08-04T12:00:00Z"),
  })
  assert.equal(adjusted.quantityAfter, 3)
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).quantity, 3)
  const quantityEvidence = await db.itemInteraction.findFirstOrThrow({
    where: { interactionId: adjusted.interactionId, itemId: item.id },
  })
  assert.equal(quantityEvidence.quantityDelta, 2)
  assert.equal(quantityEvidence.quantityAfter, 3)
  assert.equal(await db.graphEvent.count({
    where: { workspaceId: workspace.id, subjectType: "Item", subjectId: item.id, eventType: "item.quantity.adjust" },
  }), 1)

  const missingItem = await db.item.create({
    data: { workspaceId: workspace.id, name: "Umbrella", assetId: "PERF-UMBRELLA", placeId: place.id },
  })
  const missingStocktake = await db.event.create({
    data: {
      workspaceId: workspace.id,
      name: "Missing-item stocktake",
      type: core.STOCKTAKE_EVENT_TYPE,
      start: new Date("2026-08-05T12:00:00Z"),
      timestamp: new Date("2026-08-05T12:00:00Z"),
      placeId: place.id,
      metadata: JSON.stringify(core.createStocktakeSnapshot({
        placeIds: [place.id],
        expectedItemIds: [missingItem.id],
        includeDescendants: false,
      })),
    },
  })
  const missingState = await inventory.markItemMissing(db, {
    workspaceId: workspace.id,
    stocktakeId: missingStocktake.id,
    itemId: missingItem.id,
    timestamp: new Date("2026-08-05T13:00:00Z"),
  })
  assert.equal(missingState.entityId, missingItem.id)
  assert.equal(await db.graphEvent.count({
    where: { workspaceId: workspace.id, subjectType: "State", subjectId: missingState.id, eventType: "state.record" },
  }), 1)
  await db.$disconnect()
})
