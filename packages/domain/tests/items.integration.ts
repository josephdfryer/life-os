import assert from "node:assert/strict"
import { db } from "@life-os/db"
import {
  createItem,
  deleteItem,
  ItemError,
  updateItemInTransaction,
} from "../items"

const workspaceId = "items-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Items integration", slug: workspaceId } })

  const item = await createItem({ name: "  Field jacket  ", assetId: "  #ITM-001  " }, workspaceId)
  assert.equal(item.name, "Field jacket")
  assert.equal(item.assetId, "#ITM-001")
  assert.equal(await db.graphEvent.count({
    where: { workspaceId, subjectType: "Item", subjectId: item.id, eventType: "item.create" },
  }), 1)

  const updated = await db.$transaction(tx => updateItemInTransaction(
    tx,
    item.id,
    { quantity: 3 },
    workspaceId,
    {
      expected: { quantity: 1 },
      eventType: "item.quantity.adjust",
      payload: { delta: 2, quantityAfter: 3 },
    },
  ))
  assert.equal(updated.quantity, 3)
  assert.equal(await db.graphEvent.count({
    where: { workspaceId, subjectType: "Item", subjectId: item.id, eventType: "item.quantity.adjust" },
  }), 1)

  await assert.rejects(
    () => db.$transaction(tx => updateItemInTransaction(tx, item.id, { quantity: 4 }, workspaceId, { expected: { quantity: 1 } })),
    (error: unknown) => error instanceof ItemError && error.code === "conflict",
  )

  await deleteItem(item.id, workspaceId)
  assert.equal(await db.item.findUnique({ where: { id: item.id } }), null)
  assert.equal(await db.graphEvent.count({
    where: { workspaceId, subjectType: "Item", subjectId: item.id, eventType: "item.delete" },
  }), 1)
  await assert.rejects(
    () => deleteItem(item.id, workspaceId),
    (error: unknown) => error instanceof ItemError && error.code === "not_found",
  )

  console.log("All Item integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
