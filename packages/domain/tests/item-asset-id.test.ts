import test from "node:test"
import assert from "node:assert/strict"

// createItem previously required the caller to supply assetId, which is @unique
// with no database default. The only generator lived in apps/stuff's route
// handler, so any other caller either duplicated the convention or failed at
// runtime with "Item assetId is required" — which is exactly what happened when
// the assistant gained a create_item tool.
//
// These run against the same scratch DATABASE_URL the rest of the suite uses.
test("createItem generates an assetId when the caller omits one", async () => {
  const { createItem } = await import("../items")
  const { db } = await import("@life-os/db")

  const workspaceId = "item-assetid-test"
  await db.workspace.upsert({
    where: { id: workspaceId },
    update: {},
    create: { id: workspaceId, name: "Item AssetId Test", slug: workspaceId },
  })

  const item = await createItem({ name: "2021 Volvo XC60", category: "vehicle" }, workspaceId, {
    type: "assistant",
    label: "LifeOS Assistant",
  })
  try {
    assert.ok(item.assetId, "assetId should be generated, not left empty")
    assert.match(item.assetId, /^#VEH-\d{3}$/, `expected #VEH-NNN, got ${item.assetId}`)
    assert.equal(item.name, "2021 Volvo XC60")
  } finally {
    await db.item.delete({ where: { id: item.id } }).catch(() => undefined)
  }
})

test("an explicitly supplied assetId still wins", async () => {
  const { createItem } = await import("../items")
  const { db } = await import("@life-os/db")

  const item = await createItem({ name: "Labelled thing", assetId: "#WRD-ABC123" }, "item-assetid-test")
  try {
    assert.equal(item.assetId, "#WRD-ABC123")
  } finally {
    await db.item.delete({ where: { id: item.id } }).catch(() => undefined)
  }
})

test("uncategorised items fall back to the ITM prefix", async () => {
  const { createItem } = await import("../items")
  const { db } = await import("@life-os/db")

  const item = await createItem({ name: "Unsorted" }, "item-assetid-test")
  try {
    assert.match(item.assetId, /^#ITM-\d{3}$/, `expected #ITM-NNN, got ${item.assetId}`)
  } finally {
    await db.item.delete({ where: { id: item.id } }).catch(() => undefined)
  }
})
