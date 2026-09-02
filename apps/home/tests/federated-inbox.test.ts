import test from "node:test"
import assert from "node:assert/strict"

import {
  acceptLabel,
  dismissLabel,
  mergeQueues,
  normalizeSource,
  occurrenceDetail,
  sourceLabel,
  type InboxItem,
} from "../components/FederatedInbox"
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

// Message-suggested events were reaching the inbox all along — listReviewItems
// filters no sources and FederatedInbox merges the canonical feed in. They were
// just unfindable: normalizeSource had no case for them, so they fell through to
// the staged_interaction default and sat in Communications wearing a labelize()
// string. These pin the queue they actually belong to.

test("a message-suggested event gets its own queue, not the communications default", () => {
  assert.equal(normalizeSource("communication_occurrence"), "communication_occurrence")
  assert.equal(sourceLabel("communication_occurrence"), "Events")
})

test("the fallthrough default still catches genuinely unknown sources", () => {
  assert.equal(normalizeSource("something_new"), "staged_interaction")
})

test("existing queues keep their mapping", () => {
  assert.equal(normalizeSource("calendar_reconciliation"), "calendar_reconciliation")
  assert.equal(normalizeSource("evidence_claim"), "file_evidence")
  assert.equal(sourceLabel("calendar_reconciliation"), "Calendar")
  assert.equal(sourceLabel("evidence_claim"), "File evidence")
})

test("the detail line says where it came from, when, and why", () => {
  const detail = occurrenceDetail({
    messageSource: "imessage",
    occurredAt: "2026-09-04T19:00:00.000Z",
    reason: "Mentions dinner on Thursday at 7",
  })
  assert.match(detail, /Imessage/i, "the source of the message has to be visible")
  assert.match(detail, /Mentions dinner/, "the reason it looks like an event has to survive")
})

test("the detail line degrades rather than printing a proposed command", () => {
  assert.equal(
    occurrenceDetail({}),
    "A message looks like it refers to a real event",
  )
  assert.equal(occurrenceDetail({ reason: "Just the reason" }), "Just the reason")
  // An unparseable date must not reach the row as "Invalid Date".
  assert.equal(occurrenceDetail({ occurredAt: "not-a-date", reason: "why" }), "why")
})

test("the verbs match the judgement being made", () => {
  const occurrence = item("ri-1", "communication_occurrence", { canonical: true })
  assert.equal(acceptLabel(occurrence), "Confirm event")
  assert.equal(dismissLabel(occurrence), "Not an event")
  const other = item("ri-2", "calendar_reconciliation", { canonical: true })
  assert.equal(acceptLabel(other), "Accept")
  assert.equal(dismissLabel(other), "Dismiss")
})
