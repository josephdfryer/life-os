import test from "node:test"
import assert from "node:assert/strict"

import { mergeQueues, type InboxItem } from "../components/FederatedInbox"
import { unitConfidence } from "../lib/confidence"

// The inbox showed 231 items, then swapped them for the 43 in the canonical
// queue the moment the fetch resolved — so selecting Places emptied the list and
// removed the tab you had just clicked. These pin the merge that replaced it.

function item(id: string, sourceKey: InboxItem["sourceKey"], extra: Partial<InboxItem> = {}): InboxItem {
  return {
    id, sourceKey, source: sourceKey, primitive: "thing", title: id, detail: "",
    timestamp: "2026-08-14T00:00:00.000Z", confidence: null, priority: 3, ...extra,
  }
}

test("queues the canonical feed does not cover survive the fetch", () => {
  const legacy = [item("visit-1", "import_staged_visit"), item("claim-1", "file_evidence")]
  const canonical = [item("ri-1", "calendar_reconciliation", { canonical: true, sourceId: "plan-1" })]

  const merged = mergeQueues(legacy, canonical)

  assert.equal(merged.length, 3, "the canonical response must not delete the queues it says nothing about")
  assert.ok(merged.some(i => i.id === "visit-1"), "place visits have no ReviewItem row and must be kept")
  assert.ok(merged.some(i => i.id === "claim-1"))
})

test("a decision staged into the canonical queue is listed once, not twice", () => {
  const legacy = [item("plan-1", "calendar_reconciliation"), item("visit-1", "import_staged_visit")]
  const canonical = [item("ri-1", "calendar_reconciliation", { canonical: true, sourceId: "plan-1" })]

  const merged = mergeQueues(legacy, canonical)

  assert.equal(merged.filter(i => i.sourceKey === "calendar_reconciliation").length, 1)
  // The actionable row is the one that wins — the legacy copy has no buttons.
  assert.equal(merged.find(i => i.sourceKey === "calendar_reconciliation")?.canonical, true)
})

test("merging twice changes nothing, so pagination cannot duplicate rows", () => {
  const legacy = [item("plan-1", "calendar_reconciliation"), item("visit-1", "import_staged_visit")]
  const canonical = [item("ri-1", "calendar_reconciliation", { canonical: true, sourceId: "plan-1" })]

  const once = mergeQueues(legacy, canonical)
  const twice = mergeQueues(once.filter(i => !i.canonical), once.filter(i => i.canonical))

  assert.deepEqual(twice.map(i => i.id), once.map(i => i.id))
})

// "7370% confidence" on a place visit. ImportStagedVisit scores out of 100 while
// the rest of the platform stores a fraction, and the inbox multiplied by 100
// regardless.

test("a place visit scored out of 100 reads as a percentage, not 7370%", () => {
  assert.equal(unitConfidence(73.7, "percent"), 0.737)
  assert.equal(Math.round(unitConfidence(73.7, "percent")! * 100), 74)
})

test("a fraction is left alone", () => {
  assert.equal(unitConfidence(0.95, "unit"), 0.95)
  assert.equal(unitConfidence(0, "unit"), 0)
})

test("legacy rows carrying the wrong scale are read as the scale they are on", () => {
  // 11 dismissed gmail rows sit at 15–95 in a column that is otherwise 0–1.
  assert.equal(unitConfidence(95, "unit"), 0.95)
})

test("no input can produce a confidence outside 0–100%", () => {
  for (const [value, scale] of [[9_999, "unit"], [-4, "percent"], [1e6, "percent"]] as const) {
    const result = unitConfidence(value, scale)
    assert.ok(result !== null && result >= 0 && result <= 1, `${value} on the ${scale} scale escaped the range`)
  }
  assert.equal(unitConfidence(null, "unit"), null, "absent stays absent — it must not read as 0% certainty")
  assert.equal(unitConfidence(Number.NaN, "unit"), null)
})
