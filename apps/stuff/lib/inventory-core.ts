export const INVENTORY_INTERACTION_TYPES = {
  moved: "item_moved",
  verified: "inventory_verified",
  adjusted: "inventory_adjusted",
  received: "inventory_received",
} as const

export const STOCKTAKE_EVENT_TYPE = "stocktake"
export const MISSING_STATE = {
  entityType: "Item",
  type: "inventory_condition",
  value: "missing",
} as const

export type StocktakeSnapshot = {
  version: 1
  placeIds: string[]
  expectedItemIds: string[]
  includeDescendants: boolean
}

export function createStocktakeSnapshot(input: {
  placeIds: string[]
  expectedItemIds: string[]
  includeDescendants: boolean
}): StocktakeSnapshot {
  return {
    version: 1,
    placeIds: [...new Set(input.placeIds)],
    expectedItemIds: [...new Set(input.expectedItemIds)],
    includeDescendants: input.includeDescendants,
  }
}

export function parseStocktakeSnapshot(metadata: string | null): StocktakeSnapshot {
  if (!metadata) throw new Error("Stocktake snapshot is missing")
  const value = JSON.parse(metadata) as Partial<StocktakeSnapshot>
  if (
    value.version !== 1 ||
    !Array.isArray(value.placeIds) ||
    !Array.isArray(value.expectedItemIds) ||
    typeof value.includeDescendants !== "boolean"
  ) {
    throw new Error("Stocktake snapshot is invalid")
  }
  return value as StocktakeSnapshot
}

export function stocktakeProgress(snapshot: StocktakeSnapshot, observedItemIds: Iterable<string>) {
  const observed = new Set(observedItemIds)
  const expected = new Set(snapshot.expectedItemIds)
  const verifiedExpected = snapshot.expectedItemIds.filter((id) => observed.has(id))
  const missing = snapshot.expectedItemIds.filter((id) => !observed.has(id))
  const unexpected = [...observed].filter((id) => !expected.has(id))

  return {
    expected: expected.size,
    observed: observed.size,
    verifiedExpected,
    missing,
    unexpected,
    completePercent: expected.size === 0
      ? 100
      : Math.round((verifiedExpected.length / expected.size) * 100),
  }
}

export function isMissingCurrent(input: {
  missingRecordedAt?: Date | null
  lastObservedAt?: Date | null
}) {
  if (!input.missingRecordedAt) return false
  if (!input.lastObservedAt) return true
  return input.missingRecordedAt.getTime() > input.lastObservedAt.getTime()
}

export function resolveScannedValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed, "https://life-os.local")
    const match = url.pathname.match(/^\/inventory\/(items|places)\/([^/]+)$/)
    if (match) {
      return {
        kind: match[1] === "items" ? "item" as const : "place" as const,
        id: decodeURIComponent(match[2]),
      }
    }
  } catch {
    // Fall through to a human-readable asset identifier.
  }

  return { kind: "lookup" as const, id: trimmed }
}

export type TrackingMode = "untracked" | "lot" | "serial"

export function validateQuantityAdjustment(input: {
  currentQuantity: number
  delta: number
  trackingMode: TrackingMode
}) {
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    throw new Error("Quantity change must be a non-zero number")
  }
  const quantityAfter = input.currentQuantity + input.delta
  if (quantityAfter < 0) throw new Error("Quantity cannot fall below zero")
  if (input.trackingMode === "serial" && quantityAfter !== 1) {
    throw new Error("A serialized Item must always have quantity one")
  }
  return quantityAfter
}

export function stockStatus(input: {
  quantity: number
  reorderPoint: number | null
  targetStock: number | null
}) {
  const low = input.reorderPoint != null && input.quantity <= input.reorderPoint
  const suggestedOrder = low && input.targetStock != null
    ? Math.max(0, input.targetStock - input.quantity)
    : 0
  return { low, suggestedOrder }
}

export function expiryStatus(expiresAt: Date | null, now = new Date()) {
  if (!expiresAt) return null
  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
  if (daysRemaining < 0) return { status: "expired" as const, daysRemaining }
  if (daysRemaining <= 30) return { status: "expiring" as const, daysRemaining }
  return { status: "fresh" as const, daysRemaining }
}

export type PurchaseLineProgress = {
  id: string
  orderedQuantity: number
  receivedQuantity: number
  unitCost: number | null
}

export function purchaseOrderProgress(lines: PurchaseLineProgress[]) {
  const ordered = lines.reduce((sum, line) => sum + line.orderedQuantity, 0)
  const received = lines.reduce((sum, line) => sum + line.receivedQuantity, 0)
  const totalCost = lines.reduce(
    (sum, line) => sum + Math.round(line.orderedQuantity * (line.unitCost ?? 0)),
    0,
  )
  const complete = lines.length > 0 && lines.every((line) => line.receivedQuantity >= line.orderedQuantity)
  const partial = !complete && lines.some((line) => line.receivedQuantity > 0)
  return {
    ordered,
    received,
    complete,
    status: complete ? "received" as const : partial ? "partial" as const : "ordered" as const,
    totalCost,
  }
}

export function validateReceiptQuantity(input: {
  orderedQuantity: number
  receivedQuantity: number
  receivingNow: number
}) {
  if (!Number.isFinite(input.receivingNow) || input.receivingNow <= 0) {
    throw new Error("Received quantity must be greater than zero")
  }
  const remaining = Math.max(0, input.orderedQuantity - input.receivedQuantity)
  if (input.receivingNow > remaining) {
    throw new Error(`Received quantity exceeds the ${remaining} remaining`)
  }
  return remaining - input.receivingNow
}
