import { Prisma, type PrismaClient } from "@life-os/db"
import { createId } from "@paralleldrive/cuid2"
import {
  createItemInTransaction,
  ensureStateDefinitionInTransaction,
  ItemError,
  recordStateInTransaction,
  updateItemInTransaction,
} from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"
import { fireItemCreateRules, fireItemUpdateRules, type ItemCommandActor } from "./item-commands"
import {
  createStocktakeSnapshot,
  expiryStatus,
  INVENTORY_INTERACTION_TYPES,
  MISSING_STATE,
  parseStocktakeSnapshot,
  purchaseOrderProgress,
  STOCKTAKE_EVENT_TYPE,
  stockStatus,
  stocktakeProgress,
  validateQuantityAdjustment,
  validateReceiptQuantity,
} from "./inventory-core"

type Db = PrismaClient | Prisma.TransactionClient

export class InventoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
  }
}

async function requireItem(db: Db, workspaceId: string, itemId: string) {
  const item = await db.item.findFirst({
    where: { id: itemId, workspaceId },
    select: {
      id: true,
      name: true,
      assetId: true,
      placeId: true,
      assembledInto: {
        where: { disassembledAt: null },
        select: { parentItemId: true },
        take: 1,
      },
    },
  })
  if (!item) throw new InventoryError("Item not found", 404, "ITEM_NOT_FOUND")
  return item
}

async function requirePlace(db: Db, workspaceId: string, placeId: string) {
  const place = await db.place.findFirst({
    where: { id: placeId, workspaceId },
    select: { id: true, name: true, parentPlaceId: true },
  })
  if (!place) throw new InventoryError("Place not found", 404, "PLACE_NOT_FOUND")
  return place
}

async function requireStocktake(db: Db, workspaceId: string, stocktakeId: string) {
  const event = await db.event.findFirst({
    where: { id: stocktakeId, workspaceId, type: STOCKTAKE_EVENT_TYPE },
  })
  if (!event) throw new InventoryError("Stocktake not found", 404, "STOCKTAKE_NOT_FOUND")
  return event
}

function participant(workspaceId: string, entityType: string, entityId: string, role: string) {
  return { workspaceId, entityType, entityId, role }
}

function inventoryActor(workspaceId: string): ItemCommandActor {
  return { type: "system", label: "stuff.inventory", workspaceId }
}

export async function getDescendantPlaceIds(db: Db, workspaceId: string, rootPlaceId: string) {
  await requirePlace(db, workspaceId, rootPlaceId)
  const seen = new Set([rootPlaceId])
  let frontier = [rootPlaceId]

  while (frontier.length > 0) {
    const children = await db.place.findMany({
      where: { workspaceId, parentPlaceId: { in: frontier } },
      select: { id: true },
    })
    frontier = children.map(({ id }) => id).filter((id) => !seen.has(id))
    frontier.forEach((id) => seen.add(id))
  }
  return [...seen]
}

export async function getEffectiveLocation(db: Db, workspaceId: string, itemId: string) {
  const visited = new Set<string>()
  let currentId = itemId
  const inheritedThrough: Array<{ id: string; name: string; assetId: string }> = []

  while (!visited.has(currentId)) {
    visited.add(currentId)
    const item = await db.item.findFirst({
      where: { id: currentId, workspaceId },
      select: {
        id: true,
        name: true,
        assetId: true,
        place: { select: { id: true, name: true } },
        assembledInto: {
          where: { disassembledAt: null },
          take: 1,
          select: {
            parentItem: { select: { id: true, name: true, assetId: true } },
          },
        },
      },
    })
    if (!item) throw new InventoryError("Item not found", 404, "ITEM_NOT_FOUND")
    if (item.place) return { place: item.place, inheritedThrough }
    const parent = item.assembledInto[0]?.parentItem
    if (!parent) return { place: null, inheritedThrough }
    inheritedThrough.push(parent)
    currentId = parent.id
  }

  throw new InventoryError("Assembly cycle prevents location resolution", 409, "ASSEMBLY_CYCLE")
}

export async function moveItem(
  db: PrismaClient,
  input: {
    workspaceId: string
    itemId: string
    destinationPlaceId: string
    expectedFromPlaceId: string | null
    actorPersonId?: string | null
    stocktakeId?: string | null
    timestamp?: Date
  },
) {
  const actor = inventoryActor(input.workspaceId)
  const result = await db.$transaction(async (tx) => {
    const item = await requireItem(tx, input.workspaceId, input.itemId)
    const destination = await requirePlace(tx, input.workspaceId, input.destinationPlaceId)
    if (input.stocktakeId) await requireStocktake(tx, input.workspaceId, input.stocktakeId)
    if (item.assembledInto.length > 0) {
      throw new InventoryError(
        "This item is assembled into another item. Move its container or disassemble it first.",
        409,
        "ITEM_ASSEMBLED",
      )
    }
    if (item.placeId !== input.expectedFromPlaceId) {
      throw new InventoryError("The item was moved by someone else. Refresh and try again.", 409, "STALE_LOCATION")
    }

    const source = item.placeId
      ? await requirePlace(tx, input.workspaceId, item.placeId)
      : null
    const timestamp = input.timestamp ?? new Date()
    const participants = [
      ...(input.actorPersonId
        ? [participant(input.workspaceId, "Person", input.actorPersonId, "actor")]
        : []),
      participant(input.workspaceId, "Item", item.id, "subject"),
      ...(source ? [participant(input.workspaceId, "Place", source.id, "source")] : []),
      participant(input.workspaceId, "Place", destination.id, "destination"),
      ...(input.stocktakeId
        ? [participant(input.workspaceId, "Event", input.stocktakeId, "stocktake")]
        : []),
    ]

    try {
      await updateItemInTransaction(tx, item.id, { placeId: destination.id }, input.workspaceId, {
        actor,
        expected: { placeId: input.expectedFromPlaceId },
        eventType: "item.move",
        payload: { fromPlaceId: item.placeId, toPlaceId: destination.id },
      })
    } catch (error) {
      if (!(error instanceof ItemError) || error.code !== "conflict") throw error
      throw new InventoryError("The item was moved by someone else. Refresh and try again.", 409, "STALE_LOCATION")
    }

    const interaction = await tx.interaction.create({
      data: {
        workspaceId: input.workspaceId,
        personId: input.actorPersonId ?? null,
        eventId: input.stocktakeId ?? null,
        placeId: destination.id,
        type: INVENTORY_INTERACTION_TYPES.moved,
        timestamp,
        summary: source
          ? `Moved ${item.name} from ${source.name} to ${destination.name}`
          : `Moved ${item.name} to ${destination.name}`,
        participants: { create: participants },
        itemInteractions: { create: { itemId: item.id, role: "moved" } },
      },
    })

    return { itemId: item.id, placeId: destination.id, interactionId: interaction.id }
  })
  await fireItemUpdateRules(result.itemId, ["placeId"], input.workspaceId, actor)
  return result
}

export async function startStocktake(
  db: PrismaClient,
  input: {
    workspaceId: string
    placeId: string
    includeDescendants: boolean
    actorPersonId?: string | null
    timestamp?: Date
  },
) {
  const timestamp = input.timestamp ?? new Date()
  const place = await requirePlace(db, input.workspaceId, input.placeId)
  const placeIds = input.includeDescendants
    ? await getDescendantPlaceIds(db, input.workspaceId, input.placeId)
    : [input.placeId]
  const expectedItems = await db.item.findMany({
    where: { workspaceId: input.workspaceId, placeId: { in: placeIds } },
    select: { id: true },
  })
  const snapshot = createStocktakeSnapshot({
    placeIds,
    expectedItemIds: expectedItems.map(({ id }) => id),
    includeDescendants: input.includeDescendants,
  })

  return db.event.create({
    data: {
      workspaceId: input.workspaceId,
      name: `${place.name} stocktake`,
      type: STOCKTAKE_EVENT_TYPE,
      start: timestamp,
      timestamp,
      placeId: place.id,
      metadata: JSON.stringify(snapshot),
    },
  })
}

export async function verifyStocktakeItem(
  db: PrismaClient,
  input: {
    workspaceId: string
    stocktakeId: string
    itemId: string
    actorPersonId?: string | null
    timestamp?: Date
  },
) {
  const actor = inventoryActor(input.workspaceId)
  const result = await db.$transaction(async (tx) => {
    const event = await requireStocktake(tx, input.workspaceId, input.stocktakeId)
    if (event.end) throw new InventoryError("This stocktake is already finished", 409, "STOCKTAKE_FINISHED")
    const item = await requireItem(tx, input.workspaceId, input.itemId)
    const snapshot = parseStocktakeSnapshot(event.metadata)
    const effective = await getEffectiveLocation(tx, input.workspaceId, item.id)
    const locationAccepted = effective.place ? snapshot.placeIds.includes(effective.place.id) : false
    if (!locationAccepted) {
      throw new InventoryError(
        "This item is outside the stocktake location. Confirm a move before verifying it here.",
        409,
        "UNEXPECTED_LOCATION",
      )
    }

    const existing = await tx.interactionParticipant.findFirst({
      where: {
        workspaceId: input.workspaceId,
        entityType: "Item",
        entityId: item.id,
        interaction: {
          eventId: event.id,
          type: { in: [INVENTORY_INTERACTION_TYPES.verified, INVENTORY_INTERACTION_TYPES.moved] },
        },
      },
      select: { interactionId: true },
    })
    if (existing) return { itemId: item.id, interactionId: existing.interactionId, duplicate: true }

    const timestamp = input.timestamp ?? new Date()
    const interaction = await tx.interaction.create({
      data: {
        workspaceId: input.workspaceId,
        personId: input.actorPersonId ?? null,
        eventId: event.id,
        placeId: effective.place?.id ?? event.placeId,
        type: INVENTORY_INTERACTION_TYPES.verified,
        timestamp,
        summary: `Verified ${item.name} during ${event.name}`,
        participants: {
          create: [
            ...(input.actorPersonId
              ? [participant(input.workspaceId, "Person", input.actorPersonId, "actor")]
              : []),
            participant(input.workspaceId, "Item", item.id, "subject"),
            participant(input.workspaceId, "Event", event.id, "stocktake"),
            ...(effective.place
              ? [participant(input.workspaceId, "Place", effective.place.id, "observed_at")]
              : []),
          ],
        },
        itemInteractions: { create: { itemId: item.id, role: "verified" } },
      },
    })
    return { itemId: item.id, interactionId: interaction.id, duplicate: false }
  })
}

export async function getStocktakeDetail(db: Db, workspaceId: string, stocktakeId: string) {
  const event = await requireStocktake(db, workspaceId, stocktakeId)
  const snapshot = parseStocktakeSnapshot(event.metadata)
  const observations = await db.interactionParticipant.groupBy({
    by: ["entityId"],
    where: {
      workspaceId,
      entityType: "Item",
      interaction: {
        eventId: event.id,
        type: { in: [INVENTORY_INTERACTION_TYPES.verified, INVENTORY_INTERACTION_TYPES.moved] },
      },
    },
  })
  const observedIds = observations.map(({ entityId }) => entityId)
  const ids = [...new Set([...snapshot.expectedItemIds, ...observedIds])]
  const items = await db.item.findMany({
    where: { workspaceId, id: { in: ids } },
    select: { id: true, name: true, assetId: true, placeId: true },
  })
  const byId = new Map(items.map((item) => [item.id, item]))
  const progress = stocktakeProgress(snapshot, observedIds)

  return {
    ...event,
    snapshot,
    progress,
    expectedItems: snapshot.expectedItemIds.map((id) => byId.get(id)).filter(Boolean),
    missingItems: progress.missing.map((id) => byId.get(id)).filter(Boolean),
    unexpectedItems: progress.unexpected.map((id) => byId.get(id)).filter(Boolean),
  }
}

export async function finishStocktake(db: PrismaClient, workspaceId: string, stocktakeId: string) {
  await requireStocktake(db, workspaceId, stocktakeId)
  await db.event.updateMany({
    where: { id: stocktakeId, workspaceId, type: STOCKTAKE_EVENT_TYPE, end: null },
    data: { end: new Date() },
  })
  return getStocktakeDetail(db, workspaceId, stocktakeId)
}

export async function markItemMissing(
  db: PrismaClient,
  input: { workspaceId: string; stocktakeId: string; itemId: string; timestamp?: Date },
) {
  const detail = await getStocktakeDetail(db, input.workspaceId, input.stocktakeId)
  if (!detail.progress.missing.includes(input.itemId)) {
    throw new InventoryError("Only an unobserved stocktake item can be marked missing", 409, "ITEM_OBSERVED")
  }
  await requireItem(db, input.workspaceId, input.itemId)
  const actor = inventoryActor(input.workspaceId)
  const result = await db.$transaction(async tx => {
    const definition = await ensureStateDefinitionInTransaction(tx, {
      ...MISSING_STATE,
      description: "Not found during an inventory check",
    }, input.workspaceId)
    return recordStateInTransaction(tx, {
      entityType: "Item",
      entityId: input.itemId,
      definitionId: definition.id,
      source: `stocktake:${input.stocktakeId}`,
      recordedAt: input.timestamp ?? new Date(),
    }, input.workspaceId, actor)
  })
  await runRulesForTarget({
    trigger: "state.record",
    targetType: "state",
    targetId: result.state.id,
    payload: {
      stateId: result.state.id,
      entityType: result.state.entityType,
      entityId: result.state.entityId,
      definitionType: result.definition.type,
      definitionValue: result.definition.value,
      severity: result.state.severity,
    },
    actor,
  })
  return result.state
}

export async function adjustItemQuantity(
  db: PrismaClient,
  input: {
    workspaceId: string
    itemId: string
    delta: number
    reason: string
    actorPersonId?: string | null
    timestamp?: Date
  },
) {
  const actor = inventoryActor(input.workspaceId)
  const result = await db.$transaction(async (tx) => {
    const item = await tx.item.findFirst({
      where: { id: input.itemId, workspaceId: input.workspaceId },
      select: {
        id: true,
        name: true,
        quantity: true,
        placeId: true,
        definition: { select: { trackingMode: true, unit: true } },
      },
    })
    if (!item) throw new InventoryError("Item not found", 404, "ITEM_NOT_FOUND")
    const reason = input.reason.trim()
    if (!reason) throw new InventoryError("An adjustment reason is required", 400, "REASON_REQUIRED")

    let quantityAfter: number
    try {
      quantityAfter = validateQuantityAdjustment({
        currentQuantity: item.quantity,
        delta: input.delta,
        trackingMode: item.definition?.trackingMode ?? "untracked",
      })
    } catch (error) {
      throw new InventoryError(
        error instanceof Error ? error.message : "Invalid quantity change",
        409,
        "INVALID_QUANTITY",
      )
    }

    try {
      await updateItemInTransaction(tx, item.id, { quantity: quantityAfter }, input.workspaceId, {
        actor,
        expected: { quantity: item.quantity },
        eventType: "item.quantity.adjust",
        payload: { delta: input.delta, quantityAfter, reason },
      })
    } catch (error) {
      if (!(error instanceof ItemError) || error.code !== "conflict") throw error
      throw new InventoryError("Quantity changed elsewhere. Refresh and try again.", 409, "STALE_QUANTITY")
    }
    const timestamp = input.timestamp ?? new Date()
    const interaction = await tx.interaction.create({
      data: {
        workspaceId: input.workspaceId,
        personId: input.actorPersonId ?? null,
        placeId: item.placeId,
        type: INVENTORY_INTERACTION_TYPES.adjusted,
        timestamp,
        summary: `${reason}: ${item.name} ${input.delta > 0 ? "+" : ""}${input.delta} ${item.definition?.unit ?? "each"}`,
        notes: reason,
        participants: {
          create: [
            ...(input.actorPersonId
              ? [participant(input.workspaceId, "Person", input.actorPersonId, "actor")]
              : []),
            participant(input.workspaceId, "Item", item.id, "subject"),
            ...(item.placeId
              ? [participant(input.workspaceId, "Place", item.placeId, "stock_location")]
              : []),
          ],
        },
        itemInteractions: {
          create: {
            itemId: item.id,
            role: "adjusted",
            quantityDelta: input.delta,
            quantityAfter,
          },
        },
      },
    })
    return { itemId: item.id, quantityAfter, interactionId: interaction.id }
  })
  await fireItemUpdateRules(result.itemId, ["quantity"], input.workspaceId, actor)
  return result
}

export async function configureItemTracking(
  db: PrismaClient,
  input: {
    workspaceId: string
    itemId: string
    definitionId: string | null
    lotId: string | null
    serialNumber: string | null
  },
) {
  const item = await requireItem(db, input.workspaceId, input.itemId)
  const actor = inventoryActor(input.workspaceId)
  if (!input.definitionId) {
    await db.$transaction(tx => updateItemInTransaction(
      tx,
      item.id,
      { definitionId: null, lotId: null, serialNumber: input.serialNumber },
      input.workspaceId,
      { actor },
    ))
    await fireItemUpdateRules(item.id, ["definitionId", "lotId", "serialNumber"], input.workspaceId, actor)
    return
  }
  const definition = await db.itemDefinition.findFirst({
    where: { id: input.definitionId, workspaceId: input.workspaceId, active: true },
  })
  if (!definition) throw new InventoryError("Item definition not found", 404, "DEFINITION_NOT_FOUND")
  const current = await db.item.findFirstOrThrow({
    where: { id: item.id, workspaceId: input.workspaceId },
    select: { quantity: true },
  })
  const serialNumber = input.serialNumber?.trim() || null
  if (definition.trackingMode === "serial" && (!serialNumber || current.quantity !== 1)) {
    throw new InventoryError("Serialized Items require a serial number and quantity one", 409, "SERIAL_REQUIRED")
  }
  let lotId: string | null = null
  if (input.lotId) {
    const lot = await db.inventoryLot.findFirst({
      where: {
        id: input.lotId,
        workspaceId: input.workspaceId,
        definitionId: definition.id,
      },
      select: { id: true },
    })
    if (!lot) throw new InventoryError("Lot does not belong to this definition", 409, "LOT_MISMATCH")
    lotId = lot.id
  }
  if (definition.trackingMode === "lot" && !lotId) {
    throw new InventoryError("Lot-tracked Items require a lot", 409, "LOT_REQUIRED")
  }
  try {
    await db.$transaction(tx => updateItemInTransaction(
      tx,
      item.id,
      { definitionId: definition.id, lotId, serialNumber },
      input.workspaceId,
      { actor },
    ))
  } catch {
    throw new InventoryError("That serial number is already used for this definition", 409, "DUPLICATE_SERIAL")
  }
  await fireItemUpdateRules(item.id, ["definitionId", "lotId", "serialNumber"], input.workspaceId, actor)
}

export async function createItemDefinition(
  db: PrismaClient,
  input: {
    workspaceId: string
    name: string
    sku?: string | null
    category?: string | null
    description?: string | null
    unit?: string | null
    trackingMode?: "untracked" | "lot" | "serial"
    reorderPoint?: number | null
    targetStock?: number | null
    defaultShelfLifeDays?: number | null
  },
) {
  const name = input.name.trim()
  if (!name) throw new InventoryError("Definition name is required", 400, "NAME_REQUIRED")
  if (input.trackingMode && !["untracked", "lot", "serial"].includes(input.trackingMode)) {
    throw new InventoryError("Tracking mode is invalid", 400, "INVALID_TRACKING_MODE")
  }
  const reorderPoint = input.reorderPoint ?? null
  const targetStock = input.targetStock ?? null
  if (
    (reorderPoint != null && (!Number.isFinite(reorderPoint) || reorderPoint < 0)) ||
    (targetStock != null && (!Number.isFinite(targetStock) || targetStock < 0))
  ) {
    throw new InventoryError("Stock thresholds cannot be negative", 400, "INVALID_THRESHOLD")
  }
  if (reorderPoint != null && targetStock != null && targetStock < reorderPoint) {
    throw new InventoryError("Target stock must be at least the reorder point", 400, "INVALID_THRESHOLD")
  }
  try {
    return await db.itemDefinition.create({
      data: {
        workspaceId: input.workspaceId,
        name,
        sku: input.sku?.trim() || null,
        category: input.category?.trim() || null,
        description: input.description?.trim() || null,
        unit: input.unit?.trim() || "each",
        trackingMode: input.trackingMode ?? "untracked",
        reorderPoint,
        targetStock,
        defaultShelfLifeDays: input.defaultShelfLifeDays ?? null,
      },
    })
  } catch {
    throw new InventoryError("That SKU is already in use", 409, "DUPLICATE_SKU")
  }
}

export async function createInventoryLot(
  db: PrismaClient,
  input: {
    workspaceId: string
    definitionId: string
    lotCode: string
    manufacturedAt?: Date | null
    receivedAt?: Date | null
    expiresAt?: Date | null
    notes?: string | null
  },
) {
  const definition = await db.itemDefinition.findFirst({
    where: { id: input.definitionId, workspaceId: input.workspaceId, active: true },
    select: { id: true, trackingMode: true },
  })
  if (!definition) throw new InventoryError("Item definition not found", 404, "DEFINITION_NOT_FOUND")
  if (definition.trackingMode === "untracked") {
    throw new InventoryError("This definition is not configured for lot tracking", 409, "LOT_TRACKING_DISABLED")
  }
  const lotCode = input.lotCode.trim()
  if (!lotCode) throw new InventoryError("Lot code is required", 400, "LOT_CODE_REQUIRED")
  if (input.manufacturedAt && input.expiresAt && input.expiresAt < input.manufacturedAt) {
    throw new InventoryError("Expiry cannot precede manufacture", 400, "INVALID_EXPIRY")
  }
  try {
    return await db.inventoryLot.create({
      data: {
        workspaceId: input.workspaceId,
        definitionId: definition.id,
        lotCode,
        manufacturedAt: input.manufacturedAt ?? null,
        receivedAt: input.receivedAt ?? null,
        expiresAt: input.expiresAt ?? null,
        notes: input.notes?.trim() || null,
      },
    })
  } catch {
    throw new InventoryError("That lot code already exists for this definition", 409, "DUPLICATE_LOT")
  }
}

export async function createSupplier(
  db: PrismaClient,
  input: {
    workspaceId: string
    name: string
    supplierCode?: string | null
    email?: string | null
    phone?: string | null
    website?: string | null
    paymentTerms?: string | null
    notes?: string | null
  },
) {
  const name = input.name.trim()
  if (!name) throw new InventoryError("Supplier name is required", 400, "NAME_REQUIRED")
  try {
    return await db.$transaction(async (tx) => {
      const group = await tx.group.create({
        data: {
          workspaceId: input.workspaceId,
          name,
          groupType: "corporation",
          notes: input.notes?.trim() || null,
        },
      })
      const profile = await tx.supplierProfile.create({
        data: {
          workspaceId: input.workspaceId,
          groupId: group.id,
          supplierCode: input.supplierCode?.trim() || null,
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          website: input.website?.trim() || null,
          paymentTerms: input.paymentTerms?.trim() || null,
        },
      })
      return { ...profile, name: group.name }
    })
  } catch {
    throw new InventoryError("That supplier code is already in use", 409, "DUPLICATE_SUPPLIER_CODE")
  }
}

export async function createPurchaseOrder(
  db: PrismaClient,
  input: {
    workspaceId: string
    supplierId: string
    orderNumber: string
    currency?: string | null
    orderedAt?: Date
    expectedAt?: Date | null
    notes?: string | null
    actorPersonId?: string | null
    lines: Array<{
      definitionId: string
      orderedQuantity: number
      unitCost?: number | null
      destinationPlaceId?: string | null
    }>
  },
) {
  const orderNumber = input.orderNumber.trim()
  if (!orderNumber) throw new InventoryError("Order number is required", 400, "ORDER_NUMBER_REQUIRED")
  if (input.lines.length === 0) throw new InventoryError("At least one order line is required", 400, "LINES_REQUIRED")
  if (input.lines.some((line) => !Number.isFinite(line.orderedQuantity) || line.orderedQuantity <= 0)) {
    throw new InventoryError("Ordered quantities must be greater than zero", 400, "INVALID_QUANTITY")
  }

  return db.$transaction(async (tx) => {
    const supplier = await tx.supplierProfile.findFirst({
      where: { id: input.supplierId, workspaceId: input.workspaceId, active: true },
      include: { group: { select: { id: true, name: true } } },
    })
    if (!supplier) throw new InventoryError("Supplier not found", 404, "SUPPLIER_NOT_FOUND")
    const definitionIds = [...new Set(input.lines.map((line) => line.definitionId))]
    const definitions = await tx.itemDefinition.findMany({
      where: { workspaceId: input.workspaceId, id: { in: definitionIds }, active: true },
    })
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition]))
    if (definitions.length !== definitionIds.length) {
      throw new InventoryError("An order line definition was not found", 404, "DEFINITION_NOT_FOUND")
    }
    const placeIds = [...new Set(input.lines.flatMap((line) => line.destinationPlaceId ? [line.destinationPlaceId] : []))]
    if (placeIds.length > 0) {
      const placeCount = await tx.place.count({ where: { workspaceId: input.workspaceId, id: { in: placeIds } } })
      if (placeCount !== placeIds.length) throw new InventoryError("A destination Place was not found", 404, "PLACE_NOT_FOUND")
    }
    const duplicateOrder = await tx.purchaseOrder.findFirst({
      where: { workspaceId: input.workspaceId, orderNumber },
      select: { id: true },
    })
    if (duplicateOrder) throw new InventoryError("That order number is already in use", 409, "DUPLICATE_ORDER_NUMBER")
    const orderedAt = input.orderedAt ?? new Date()
    const plan = await tx.plan.create({
      data: {
        workspaceId: input.workspaceId,
        text: `Purchase ${orderNumber} from ${supplier.group.name}`,
        timescale: "purchase_order",
        successSignals: JSON.stringify(["All ordered quantities received"]),
        status: "active",
        scheduledStart: input.expectedAt ?? null,
      },
    })
    const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          workspaceId: input.workspaceId,
          planId: plan.id,
          supplierId: supplier.id,
          orderNumber,
          currency: input.currency?.trim().toUpperCase() || "USD",
          orderedAt,
          expectedAt: input.expectedAt ?? null,
          notes: input.notes?.trim() || null,
          lines: {
            create: input.lines.map((line) => {
              const definition = definitionById.get(line.definitionId)!
              return {
                definitionId: definition.id,
                descriptionSnapshot: definition.name,
                skuSnapshot: definition.sku,
                orderedQuantity: line.orderedQuantity,
                unitCost: line.unitCost ?? null,
                destinationPlaceId: line.destinationPlaceId ?? null,
              }
            }),
          },
        },
        include: { lines: true },
    })
    await tx.interaction.create({
        data: {
          workspaceId: input.workspaceId,
          personId: input.actorPersonId ?? null,
          type: "purchase_order_placed",
          timestamp: orderedAt,
          summary: `Placed ${orderNumber} with ${supplier.group.name}`,
          participants: {
            create: [
              ...(input.actorPersonId
                ? [participant(input.workspaceId, "Person", input.actorPersonId, "actor")]
                : []),
              participant(input.workspaceId, "Plan", plan.id, "purchase_order"),
              participant(input.workspaceId, "Group", supplier.group.id, "supplier"),
            ],
          },
        },
    })
    return purchaseOrder
  })
}

export async function receivePurchaseOrder(
  db: PrismaClient,
  input: {
    workspaceId: string
    purchaseOrderId: string
    actorPersonId?: string | null
    receiptFileId?: string | null
    receivedAt?: Date
    lines: Array<{
      orderLineId: string
      quantity: number
      itemId?: string | null
      lotId?: string | null
      serialNumber?: string | null
      destinationPlaceId?: string | null
    }>
  },
) {
  if (input.lines.length === 0) throw new InventoryError("At least one receipt line is required", 400, "LINES_REQUIRED")
  if (new Set(input.lines.map((line) => line.orderLineId)).size !== input.lines.length) {
    throw new InventoryError("Each order line can appear only once per receipt", 400, "DUPLICATE_RECEIPT_LINE")
  }

  const actor = inventoryActor(input.workspaceId)
  const itemRuleEvents: Array<
    | { kind: "create"; item: { id: string; name: string; assetId: string } }
    | { kind: "update"; itemId: string; fields: string[] }
  > = []
  const result = await db.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, workspaceId: input.workspaceId },
      include: {
        plan: true,
        supplier: { include: { group: true } },
        lines: {
          include: {
            definition: true,
            receiptLines: { select: { quantity: true } },
          },
        },
      },
    })
    if (!order) throw new InventoryError("Purchase order not found", 404, "ORDER_NOT_FOUND")
    if (order.plan.status === "abandoned") throw new InventoryError("This order was cancelled", 409, "ORDER_CANCELLED")
    if (input.receiptFileId) {
      const file = await tx.importedFile.findFirst({
        where: { id: input.receiptFileId, workspaceId: input.workspaceId },
        select: { id: true },
      })
      if (!file) throw new InventoryError("Receipt file not found", 404, "RECEIPT_NOT_FOUND")
    }
    const lineById = new Map(order.lines.map((line) => [line.id, line]))
    const receivedAt = input.receivedAt ?? new Date()
    const commonPlaceIds = [...new Set(input.lines.flatMap((entry) => {
      const orderLine = lineById.get(entry.orderLineId)
      const placeId = entry.destinationPlaceId ?? orderLine?.destinationPlaceId
      return placeId ? [placeId] : []
    }))]
    const event = await tx.event.create({
      data: {
        workspaceId: input.workspaceId,
        name: `Received ${order.orderNumber} from ${order.supplier.group.name}`,
        type: "purchase_received",
        start: receivedAt,
        end: receivedAt,
        timestamp: receivedAt,
        placeId: commonPlaceIds.length === 1 ? commonPlaceIds[0] : null,
        sourcePlanId: order.planId,
        groupTags: { connect: { id: order.supplier.groupId } },
      },
    })

    for (const entry of input.lines) {
      const orderLine = lineById.get(entry.orderLineId)
      if (!orderLine) throw new InventoryError("Order line not found", 404, "ORDER_LINE_NOT_FOUND")
      const alreadyReceived = orderLine.receiptLines.reduce((sum, line) => sum + line.quantity, 0)
      try {
        validateReceiptQuantity({
          orderedQuantity: orderLine.orderedQuantity,
          receivedQuantity: alreadyReceived,
          receivingNow: entry.quantity,
        })
      } catch (error) {
        throw new InventoryError(
          error instanceof Error ? error.message : "Invalid receipt quantity",
          409,
          "INVALID_RECEIPT_QUANTITY",
        )
      }
      const destinationPlaceId = entry.destinationPlaceId ?? orderLine.destinationPlaceId
      if (!destinationPlaceId) {
        throw new InventoryError("A receiving destination is required", 400, "DESTINATION_REQUIRED")
      }
      await requirePlace(tx, input.workspaceId, destinationPlaceId)

      let lotId = entry.lotId ?? null
      if (orderLine.definition.trackingMode === "lot" && !lotId) {
        throw new InventoryError("A lot is required for this order line", 409, "LOT_REQUIRED")
      }
      if (lotId) {
        const lot = await tx.inventoryLot.findFirst({
          where: {
            id: lotId,
            workspaceId: input.workspaceId,
            definitionId: orderLine.definitionId,
          },
          select: { id: true },
        })
        if (!lot) throw new InventoryError("Lot does not match the ordered definition", 409, "LOT_MISMATCH")
        lotId = lot.id
      }
      const serialNumber = entry.serialNumber?.trim() || null
      if (orderLine.definition.trackingMode === "serial" && (entry.quantity !== 1 || !serialNumber)) {
        throw new InventoryError("Serialized receipts require quantity one and a serial number", 409, "SERIAL_REQUIRED")
      }

      let item = entry.itemId
        ? await tx.item.findFirst({
          where: {
            id: entry.itemId,
            workspaceId: input.workspaceId,
            definitionId: orderLine.definitionId,
          },
        })
        : null
      if (entry.itemId && !item) throw new InventoryError("Receiving Item does not match the order line", 409, "ITEM_MISMATCH")
      if (item && item.placeId !== destinationPlaceId) {
        throw new InventoryError("Existing receiving Item is stored at a different Place", 409, "PLACE_MISMATCH")
      }
      if (item && lotId && item.lotId !== lotId) {
        throw new InventoryError("Existing receiving Item belongs to a different lot", 409, "LOT_MISMATCH")
      }
      if (!item) {
        item = await createItemInTransaction(
          tx,
          {
            name: orderLine.descriptionSnapshot,
            assetId: `#RCV-${createId().slice(-8).toUpperCase()}`,
            category: orderLine.definition.category,
            quantity: 0,
            placeId: destinationPlaceId,
            definitionId: orderLine.definitionId,
            lotId,
            serialNumber,
          },
          input.workspaceId,
          { actor },
        )
        itemRuleEvents.push({ kind: "create", item: { id: item.id, name: item.name, assetId: item.assetId } })
      }
      let quantityAfter: number
      try {
        quantityAfter = validateQuantityAdjustment({
          currentQuantity: item.quantity,
          delta: entry.quantity,
          trackingMode: orderLine.definition.trackingMode,
        })
      } catch (error) {
        throw new InventoryError(
          error instanceof Error ? error.message : "Invalid receiving balance",
          409,
          "INVALID_QUANTITY",
        )
      }
      try {
        await updateItemInTransaction(tx, item.id, { quantity: quantityAfter }, input.workspaceId, {
          actor,
          expected: { quantity: item.quantity },
          eventType: "item.quantity.receive",
          payload: { delta: entry.quantity, quantityAfter, purchaseOrderId: order.id },
        })
      } catch (error) {
        if (!(error instanceof ItemError) || error.code !== "conflict") throw error
        throw new InventoryError("Receiving balance changed elsewhere", 409, "STALE_QUANTITY")
      }
      itemRuleEvents.push({ kind: "update", itemId: item.id, fields: ["quantity"] })

      const interaction = await tx.interaction.create({
        data: {
          workspaceId: input.workspaceId,
          personId: input.actorPersonId ?? null,
          eventId: event.id,
          placeId: destinationPlaceId,
          sourceFileId: input.receiptFileId ?? null,
          type: INVENTORY_INTERACTION_TYPES.received,
          timestamp: receivedAt,
          summary: `Received ${entry.quantity} ${orderLine.definition.unit} of ${orderLine.descriptionSnapshot}`,
          participants: {
            create: [
              ...(input.actorPersonId
                ? [participant(input.workspaceId, "Person", input.actorPersonId, "actor")]
                : []),
              participant(input.workspaceId, "Item", item.id, "received_item"),
              participant(input.workspaceId, "Plan", order.planId, "purchase_order"),
              participant(input.workspaceId, "Event", event.id, "receiving"),
              participant(input.workspaceId, "Group", order.supplier.groupId, "supplier"),
              participant(input.workspaceId, "Place", destinationPlaceId, "destination"),
            ],
          },
          itemInteractions: {
            create: {
              itemId: item.id,
              role: "received",
              quantityDelta: entry.quantity,
              quantityAfter,
            },
          },
        },
      })
      await tx.purchaseReceiptLine.create({
        data: {
          workspaceId: input.workspaceId,
          eventId: event.id,
          orderLineId: orderLine.id,
          itemId: item.id,
          lotId,
          quantity: entry.quantity,
        },
      })
      void interaction
    }

    const progressLines = await Promise.all(order.lines.map(async (line) => ({
      id: line.id,
      orderedQuantity: line.orderedQuantity,
      receivedQuantity: (await tx.purchaseReceiptLine.aggregate({
        where: { orderLineId: line.id },
        _sum: { quantity: true },
      }))._sum.quantity ?? 0,
      unitCost: line.unitCost,
    })))
    const progress = purchaseOrderProgress(progressLines)
    if (progress.complete) {
      await tx.plan.updateMany({
        where: { id: order.planId, workspaceId: input.workspaceId },
        data: { status: "completed" },
      })
    }
    return { eventId: event.id, progress }
  })
  await Promise.all(itemRuleEvents.map(event => event.kind === "create"
    ? fireItemCreateRules(event.item, input.workspaceId, actor)
    : fireItemUpdateRules(event.itemId, event.fields, input.workspaceId, actor)))
  return result
}

export async function getProcurementOverview(db: Db, workspaceId: string) {
  const [suppliers, orders] = await Promise.all([
    db.supplierProfile.findMany({
      where: { workspaceId, active: true },
      include: {
        group: { select: { id: true, name: true, notes: true } },
        _count: { select: { purchaseOrders: true } },
      },
      orderBy: { group: { name: "asc" } },
    }),
    db.purchaseOrder.findMany({
      where: { workspaceId },
      include: {
        plan: { select: { status: true } },
        supplier: { include: { group: { select: { name: true } } } },
        lines: {
          include: {
            definition: { select: { unit: true } },
            receiptLines: { select: { quantity: true } },
          },
        },
      },
      orderBy: { orderedAt: "desc" },
    }),
  ])
  return {
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      groupId: supplier.groupId,
      name: supplier.group.name,
      supplierCode: supplier.supplierCode,
      email: supplier.email,
      phone: supplier.phone,
      website: supplier.website,
      paymentTerms: supplier.paymentTerms,
      orderCount: supplier._count.purchaseOrders,
    })),
    orders: orders.map((order) => {
      const lines = order.lines.map((line) => ({
        id: line.id,
        definitionId: line.definitionId,
        description: line.descriptionSnapshot,
        sku: line.skuSnapshot,
        unit: line.definition.unit,
        orderedQuantity: line.orderedQuantity,
        receivedQuantity: line.receiptLines.reduce((sum, receipt) => sum + receipt.quantity, 0),
        unitCost: line.unitCost,
        destinationPlaceId: line.destinationPlaceId,
      }))
      return {
        id: order.id,
        planId: order.planId,
        planStatus: order.plan.status,
        supplierId: order.supplierId,
        supplierName: order.supplier.group.name,
        orderNumber: order.orderNumber,
        currency: order.currency,
        orderedAt: order.orderedAt,
        expectedAt: order.expectedAt,
        notes: order.notes,
        lines,
        progress: purchaseOrderProgress(lines.map((line) => ({
          id: line.id,
          orderedQuantity: line.orderedQuantity,
          receivedQuantity: line.receivedQuantity,
          unitCost: line.unitCost,
        }))),
      }
    }),
  }
}

export async function getInventoryOverview(db: Db, workspaceId: string) {
  const [places, items, recentObservations, missingStates, activeStocktakes, definitions, lots] = await Promise.all([
    listInventoryPlaces(db, workspaceId),
    db.item.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        assetId: true,
        category: true,
        quantity: true,
        placeId: true,
        definitionId: true,
        lotId: true,
        serialNumber: true,
        createdAt: true,
        assembledInto: {
          where: { disassembledAt: null },
          take: 1,
          select: { parentItemId: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.$queryRaw<Array<{ entityId: string; observedAt: Date | string | number | bigint }>>(Prisma.sql`
      SELECT ip."entityId" AS "entityId", MAX(i."timestamp") AS "observedAt"
      FROM "InteractionParticipant" ip
      INNER JOIN "Interaction" i ON i."id" = ip."interactionId"
      WHERE ip."workspaceId" = ${workspaceId}
        AND ip."entityType" = 'Item'
        AND i."workspaceId" = ${workspaceId}
        AND i."type" IN (${INVENTORY_INTERACTION_TYPES.moved}, ${INVENTORY_INTERACTION_TYPES.verified})
      GROUP BY ip."entityId"
    `),
    db.state.groupBy({
      by: ["entityId"],
      where: {
        workspaceId,
        entityType: "Item",
        definition: MISSING_STATE,
      },
      _max: { recordedAt: true },
    }),
    listActiveStocktakes(db, workspaceId),
    db.itemDefinition.findMany({
      where: { workspaceId, active: true },
      include: {
        items: { select: { id: true, quantity: true } },
        _count: { select: { lots: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.inventoryLot.findMany({
      where: { workspaceId },
      include: {
        definition: { select: { name: true, sku: true } },
        items: { select: { id: true, quantity: true } },
      },
      orderBy: [{ expiresAt: "asc" }, { lotCode: "asc" }],
    }),
  ])

  const lastObserved = new Map<string, Date>()
  for (const observation of recentObservations) {
    const observedAt = toDate(observation.observedAt)
    if (observedAt) lastObserved.set(observation.entityId, observedAt)
  }
  const lastMissing = new Map<string, Date>()
  for (const state of missingStates) {
    if (state._max.recordedAt) lastMissing.set(state.entityId, state._max.recordedAt)
  }
  const itemById = new Map(items.map((item) => [item.id, item]))
  const resolvePlaceId = (itemId: string) => {
    const seen = new Set<string>()
    let current = itemById.get(itemId)
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      if (current.placeId) return current.placeId
      current = current.assembledInto[0]
        ? itemById.get(current.assembledInto[0].parentItemId)
        : undefined
    }
    return null
  }
  const now = Date.now()
  const staleAfterMs = 90 * 24 * 60 * 60 * 1000
  const enrichedItems = items.map((item) => {
    const observedAt = lastObserved.get(item.id) ?? null
    const missingAt = lastMissing.get(item.id) ?? null
    const effectivePlaceId = resolvePlaceId(item.id)
    const missing = Boolean(missingAt && (!observedAt || missingAt > observedAt))
    const attentionReason = missing
      ? "Missing"
      : !effectivePlaceId
        ? "No location"
        : !observedAt
          ? "Never verified"
          : now - observedAt.getTime() > staleAfterMs
            ? "Verification stale"
            : null
    return {
      id: item.id,
      name: item.name,
      assetId: item.assetId,
      category: item.category,
      quantity: item.quantity,
      placeId: item.placeId,
      definitionId: item.definitionId,
      lotId: item.lotId,
      serialNumber: item.serialNumber,
      effectivePlaceId,
      inherited: !item.placeId && Boolean(effectivePlaceId),
      lastObservedAt: observedAt?.toISOString() ?? null,
      attentionReason,
    }
  })
  const directCounts = new Map<string, number>()
  const effectiveCounts = new Map<string, number>()
  for (const item of enrichedItems) {
    if (item.placeId) directCounts.set(item.placeId, (directCounts.get(item.placeId) ?? 0) + 1)
    if (item.effectivePlaceId) {
      effectiveCounts.set(item.effectivePlaceId, (effectiveCounts.get(item.effectivePlaceId) ?? 0) + 1)
    }
  }

  return {
    places: places.map((place) => ({
      ...place,
      directItemCount: directCounts.get(place.id) ?? 0,
      effectiveItemCount: effectiveCounts.get(place.id) ?? 0,
    })),
    items: enrichedItems,
    attentionItems: enrichedItems.filter((item) => item.attentionReason),
    activeStocktakes,
    definitions: definitions.map((definition) => {
      const quantity = definition.items.reduce((sum, item) => sum + item.quantity, 0)
      return {
        id: definition.id,
        name: definition.name,
        sku: definition.sku,
        category: definition.category,
        unit: definition.unit,
        trackingMode: definition.trackingMode,
        reorderPoint: definition.reorderPoint,
        targetStock: definition.targetStock,
        defaultShelfLifeDays: definition.defaultShelfLifeDays,
        quantity,
        itemCount: definition.items.length,
        lotCount: definition._count.lots,
        ...stockStatus({
          quantity,
          reorderPoint: definition.reorderPoint,
          targetStock: definition.targetStock,
        }),
      }
    }),
    lots: lots.map((lot) => ({
      id: lot.id,
      definitionId: lot.definitionId,
      definitionName: lot.definition.name,
      sku: lot.definition.sku,
      lotCode: lot.lotCode,
      manufacturedAt: lot.manufacturedAt,
      receivedAt: lot.receivedAt,
      expiresAt: lot.expiresAt,
      quantity: lot.items.reduce((sum, item) => sum + item.quantity, 0),
      itemCount: lot.items.length,
      expiry: expiryStatus(lot.expiresAt),
    })),
  }
}

export async function listInventoryPlaces(db: Db, workspaceId: string) {
  const result: Array<{ id: string; name: string; type: string | null; parentPlaceId: string | null }> = []
  let cursor: string | undefined
  do {
    const rows = await db.place.findMany({
      where: { workspaceId },
      select: { id: true, name: true, type: true, parentPlaceId: true },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    result.push(...rows)
    cursor = rows.length === 200 ? rows.at(-1)?.id : undefined
  } while (cursor)
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

function toDate(value: Date | string | number | bigint): Date | null {
  const date = value instanceof Date ? value : new Date(typeof value === "bigint" ? Number(value) : value)
  return Number.isNaN(date.getTime()) ? null : date
}

async function listActiveStocktakes(db: Db, workspaceId: string) {
  const result: Array<{ id: string; name: string; start: Date; placeId: string | null }> = []
  let cursor: string | undefined
  do {
    const rows = await db.event.findMany({
      where: { workspaceId, type: STOCKTAKE_EVENT_TYPE, end: null },
      select: { id: true, name: true, start: true, placeId: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    result.push(...rows)
    cursor = rows.length === 500 ? rows.at(-1)?.id : undefined
  } while (cursor)
  return result.sort((a, b) => b.start.getTime() - a.start.getTime())
}
