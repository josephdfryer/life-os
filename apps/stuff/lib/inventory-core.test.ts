import assert from "node:assert/strict"
import test from "node:test"
import {
  createStocktakeSnapshot,
  isMissingCurrent,
  parseStocktakeSnapshot,
  purchaseOrderProgress,
  resolveScannedValue,
  expiryStatus,
  stockStatus,
  stocktakeProgress,
  validateQuantityAdjustment,
  validateReceiptQuantity,
} from "./inventory-core"

test("stocktake snapshots freeze and deduplicate scope", () => {
  const snapshot = createStocktakeSnapshot({
    placeIds: ["closet", "drawer", "drawer"],
    expectedItemIds: ["coat", "shoes", "coat"],
    includeDescendants: true,
  })

  assert.deepEqual(parseStocktakeSnapshot(JSON.stringify(snapshot)), snapshot)
  assert.deepEqual(snapshot.placeIds, ["closet", "drawer"])
  assert.deepEqual(snapshot.expectedItemIds, ["coat", "shoes"])
})

test("stocktake progress separates missing and unexpected items", () => {
  const progress = stocktakeProgress(
    createStocktakeSnapshot({
      placeIds: ["closet"],
      expectedItemIds: ["coat", "shoes"],
      includeDescendants: false,
    }),
    ["coat", "hat"],
  )

  assert.deepEqual(progress.verifiedExpected, ["coat"])
  assert.deepEqual(progress.missing, ["shoes"])
  assert.deepEqual(progress.unexpected, ["hat"])
  assert.equal(progress.completePercent, 50)
})

test("a later observation resolves an earlier missing state", () => {
  const missingAt = new Date("2026-07-01T10:00:00Z")
  assert.equal(isMissingCurrent({ missingRecordedAt: missingAt }), true)
  assert.equal(isMissingCurrent({
    missingRecordedAt: missingAt,
    lastObservedAt: new Date("2026-07-02T10:00:00Z"),
  }), false)
})

test("scanner recognizes stable inventory URLs and asset lookups", () => {
  assert.deepEqual(
    resolveScannedValue("https://stuff.example/inventory/items/item_123"),
    { kind: "item", id: "item_123" },
  )
  assert.deepEqual(
    resolveScannedValue("/inventory/places/place_456"),
    { kind: "place", id: "place_456" },
  )
  assert.deepEqual(resolveScannedValue("#COA-001"), { kind: "lookup", id: "#COA-001" })
})

test("quantity adjustments preserve non-negative and serialized invariants", () => {
  assert.equal(validateQuantityAdjustment({
    currentQuantity: 10,
    delta: -3,
    trackingMode: "untracked",
  }), 7)
  assert.throws(
    () => validateQuantityAdjustment({ currentQuantity: 1, delta: -2, trackingMode: "untracked" }),
    /below zero/,
  )
  assert.throws(
    () => validateQuantityAdjustment({ currentQuantity: 1, delta: 1, trackingMode: "serial" }),
    /quantity one/,
  )
})

test("stock thresholds derive low stock and a replenishment suggestion", () => {
  assert.deepEqual(stockStatus({ quantity: 2, reorderPoint: 3, targetStock: 8 }), {
    low: true,
    suggestedOrder: 6,
  })
  assert.deepEqual(stockStatus({ quantity: 5, reorderPoint: 3, targetStock: 8 }), {
    low: false,
    suggestedOrder: 0,
  })
})

test("expiry status uses a thirty day attention window", () => {
  const now = new Date("2026-07-24T12:00:00Z")
  assert.deepEqual(expiryStatus(new Date("2026-07-20T12:00:00Z"), now), {
    status: "expired",
    daysRemaining: -4,
  })
  assert.deepEqual(expiryStatus(new Date("2026-08-01T12:00:00Z"), now), {
    status: "expiring",
    daysRemaining: 8,
  })
})

test("purchase progress is derived from receipt lines", () => {
  assert.deepEqual(purchaseOrderProgress([
    { id: "paper", orderedQuantity: 10, receivedQuantity: 10, unitCost: 250 },
    { id: "ink", orderedQuantity: 4, receivedQuantity: 1, unitCost: 1200 },
  ]), {
    ordered: 14,
    received: 11,
    complete: false,
    status: "partial",
    totalCost: 7300,
  })
})

test("receiving cannot silently over-receive an order line", () => {
  assert.equal(validateReceiptQuantity({
    orderedQuantity: 10,
    receivedQuantity: 6,
    receivingNow: 4,
  }), 0)
  assert.throws(
    () => validateReceiptQuantity({
      orderedQuantity: 10,
      receivedQuantity: 6,
      receivingNow: 5,
    }),
    /4 remaining/,
  )
})
