import type { Prisma } from "@life-os/db"
import { writeAuditLog, type AuditActor } from "./audit"
import { publishGraphEvent, type GraphEventActor } from "./events"

type Actor = GraphEventActor & AuditActor

export class ItemError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation" | "conflict") {
    super(message)
    this.name = "ItemError"
  }
}

// assetId is optional to callers even though the column is required and @unique:
// createItemInTransaction generates one when it is absent. Callers that own a
// numbering convention (Stuff, wardrobe) still pass their own.
export type ItemCreateData = Omit<
  Prisma.ItemUncheckedCreateInput,
  "id" | "workspaceId" | "createdAt" | "updatedAt" | "assetId"
> & { assetId?: string }

export type ItemUpdateData = Prisma.ItemUncheckedUpdateManyInput

export type ItemWriteOptions = {
  actor?: Actor
  eventType?: string
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

// Matches the #CAT-NNN convention apps/stuff established: first three letters of
// the category, or ITM. The count is not atomic, so two concurrent creates can
// pick the same number — the @unique constraint catches that and the caller
// retries with the next free suffix rather than failing the write.
async function nextAssetId(tx: Prisma.TransactionClient, workspaceId: string, category: string | null) {
  const prefix = category?.trim()
    ? category.trim().slice(0, 3).toUpperCase().replace(/[^A-Z]/g, "X")
    : "ITM"
  const count = await tx.item.count({ where: { workspaceId } })
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = `#${prefix}-${String(count + 1 + attempt).padStart(3, "0")}`
    const taken = await tx.item.findFirst({ where: { workspaceId, assetId: candidate }, select: { id: true } })
    if (!taken) return candidate
  }
  // Deterministic suffixes exhausted (heavily concurrent, or a manual assetId
  // already occupies the run). Fall back to something that cannot collide.
  return `#${prefix}-${Date.now().toString(36).toUpperCase()}`
}

export async function createItemInTransaction(
  tx: Prisma.TransactionClient,
  data: ItemCreateData,
  workspaceId = "default-workspace",
  options: ItemWriteOptions = {},
) {
  if (typeof data.name !== "string" || !data.name.trim()) {
    throw new ItemError("Item name is required", "validation")
  }

  // assetId is required and @unique with no database default, and generating it
  // used to live only in apps/stuff's POST /api/items — so every other caller had
  // to know the convention and reimplement it, or fail. Generating it here when
  // it is absent makes the domain layer sufficient on its own; a caller that
  // supplies one (Stuff, wardrobe) still wins.
  const assetId = typeof data.assetId === "string" && data.assetId.trim()
    ? data.assetId.trim()
    : await nextAssetId(tx, workspaceId, typeof data.category === "string" ? data.category : null)

  const item = await tx.item.create({
    data: { ...data, workspaceId, name: data.name.trim(), assetId },
  })
  await publishGraphEvent(tx, {
    workspaceId,
    subjectType: "Item",
    subjectId: item.id,
    eventType: options.eventType ?? "item.create",
    actor: options.actor,
    idempotencyKey: options.idempotencyKey ?? `item-create:${item.id}`,
    payload: options.payload ?? { name: item.name, assetId: item.assetId, category: item.category },
  })
  return item
}

export async function updateItemInTransaction(
  tx: Prisma.TransactionClient,
  id: string,
  data: ItemUpdateData,
  workspaceId = "default-workspace",
  options: ItemWriteOptions & { expected?: Prisma.ItemWhereInput } = {},
) {
  const fields = Object.keys(data)
  if (fields.length === 0) {
    const existing = await tx.item.findFirst({ where: { id, workspaceId } })
    if (!existing) throw new ItemError("Item not found", "not_found")
    return existing
  }

  const result = await tx.item.updateMany({
    where: { AND: [{ id, workspaceId }, options.expected ?? {}] },
    data,
  })
  if (result.count !== 1) {
    const exists = await tx.item.count({ where: { id, workspaceId } })
    throw new ItemError(exists ? "Item changed elsewhere" : "Item not found", exists ? "conflict" : "not_found")
  }
  const item = await tx.item.findFirstOrThrow({ where: { id, workspaceId } })
  await publishGraphEvent(tx, {
    workspaceId,
    subjectType: "Item",
    subjectId: id,
    eventType: options.eventType ?? "item.update",
    actor: options.actor,
    idempotencyKey: options.idempotencyKey ?? `item-update:${id}:${Date.now()}`,
    payload: options.payload ?? { fields },
  })
  return item
}

export async function deleteItemInTransaction(
  tx: Prisma.TransactionClient,
  id: string,
  workspaceId = "default-workspace",
  options: ItemWriteOptions = {},
) {
  const existing = await tx.item.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new ItemError("Item not found", "not_found")
  await tx.item.delete({ where: { id } })
  await publishGraphEvent(tx, {
    workspaceId,
    subjectType: "Item",
    subjectId: id,
    eventType: options.eventType ?? "item.delete",
    actor: options.actor,
    idempotencyKey: options.idempotencyKey ?? `item-delete:${id}`,
    payload: options.payload ?? {},
  })
}

export async function createItem(
  data: ItemCreateData,
  workspaceId = "default-workspace",
  actor?: Actor,
) {
  const { db } = await import("@life-os/db")
  const item = await db.$transaction(tx => createItemInTransaction(tx, data, workspaceId, { actor }))
  await writeAuditLog({ actor, action: "item.create", targetType: "item", targetId: item.id })
  return item
}

export async function updateItem(
  id: string,
  data: ItemUpdateData,
  workspaceId = "default-workspace",
  actor?: Actor,
) {
  const { db } = await import("@life-os/db")
  const item = await db.$transaction(tx => updateItemInTransaction(tx, id, data, workspaceId, { actor }))
  await writeAuditLog({ actor, action: "item.update", targetType: "item", targetId: id, metadata: { fields: Object.keys(data) } })
  return item
}

export async function deleteItem(id: string, workspaceId = "default-workspace", actor?: Actor) {
  const { db } = await import("@life-os/db")
  await db.$transaction(tx => deleteItemInTransaction(tx, id, workspaceId, { actor }))
  await writeAuditLog({ actor, action: "item.delete", targetType: "item", targetId: id })
}
