import test from "node:test"
import assert from "node:assert/strict"

import {
  acceptLabel,
  activeSnoozes,
  blockedReason,
  canAccept,
  canCancel,
  canDismiss,
  confirmationCount,
  dismissLabel,
  expandPlaceGroups,
  filterItems,
  groupItems,
  isActionable,
  matchesQuery,
  mergeQueues,
  normalizeSource,
  occurrenceDetail,
  rangeKeys,
  rowKey,
  snoozeUntil,
  sourceLabel,
  EMPTY_FILTERS,
  type InboxItem,
} from "../lib/inbox-model"
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
// just unfindable: normalizeSource had no case for them.

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
  assert.equal(occurrenceDetail({}), "A message looks like it refers to a real event")
  assert.equal(occurrenceDetail({ reason: "Just the reason" }), "Just the reason")
  // An unparseable date must not reach the row as "Invalid Date".
  assert.equal(occurrenceDetail({ occurredAt: "not-a-date", reason: "why" }), "why")
})

// Every legacy queue already had a resolver behind it; the inbox just never
// called one, so 1,290 of 1,490 rows rendered with no buttons under a
// "Needs individual review" label. These pin the capability map that fixed it.

test("a legacy calendar plan is resolvable without the canonical queue", () => {
  const plan = item("plan-1", "calendar_reconciliation")
  assert.ok(canAccept(plan), "reconcileCalendarPlan has always existed behind this row")
  assert.ok(canDismiss(plan))
  assert.ok(canCancel(plan), "cancelled is a real third outcome, not a flavour of dismiss")
  assert.equal(acceptLabel(plan), "Happened")
  assert.equal(dismissLabel(plan), "Skip")
})

test("a communication is acceptable only once there is a person to file it under", () => {
  const orphan = item("msg-1", "staged_interaction")
  assert.equal(canAccept(orphan), false)
  assert.ok(canDismiss(orphan), "dismissing an unmatched message never needed a person")
  assert.equal(blockedReason(orphan), "Pick a person to file this under")

  const matched = item("msg-2", "staged_interaction", { candidatePersonId: "p1", candidatePersonName: "Ada" })
  assert.ok(canAccept(matched))
  assert.equal(acceptLabel(matched), "Accept → Ada", "the button has to name what it will write")
  assert.equal(blockedReason(matched), null)
})

test("an unresolved file identity asks for the person; a claim only asks for a yes", () => {
  const identity = item("m-1", "file_evidence", { primitive: "identity" })
  assert.equal(canAccept(identity), false)
  assert.ok(canDismiss(identity))
  assert.equal(blockedReason(identity), "Pick the person this refers to")

  const claim = item("c-1", "file_evidence", { primitive: "claim" })
  assert.ok(canAccept(claim))
})

test("a canonical row is always resolvable, whatever queue it came from", () => {
  for (const key of ["staged_interaction", "file_evidence", "communication_occurrence"] as const) {
    const row = item(`ri-${key}`, key, { canonical: true })
    assert.ok(canAccept(row) && canDismiss(row) && isActionable(row))
  }
})

// Grouping is what makes 500 identical calendar rows one decision instead of
// five hundred.

test("place visits collapse to one decision per place, not one per visit", () => {
  const place = { googlePlaceId: "ChIJ1", name: "Red Rock Villas", address: "1 Red Rock", latitude: 1, longitude: 2 }
  const visits = Array.from({ length: 154 }, (_, index) => item(`v${index}`, "import_staged_visit", { place }))
  const [group] = groupItems(visits)

  assert.equal(group.items.length, 154)
  assert.equal(group.label, "Red Rock Villas")
  assert.ok(group.acceptable, "the whole point is answering this once")
  assert.equal(group.needsConfirmation, false, "a place group is one decision by construction")
})

test("accepting one visit takes the rest of its place with it", () => {
  // The resolver answers per place. If the list only drops the row that was
  // clicked, the other 153 stay on screen describing work already done.
  const place = { googlePlaceId: "ChIJ1", name: "Red Rock Villas", address: "1 Red Rock", latitude: 1, longitude: 2 }
  const other = { googlePlaceId: "ChIJ2", name: "Gym", address: "2 Elm", latitude: 3, longitude: 4 }
  const universe = [
    ...Array.from({ length: 5 }, (_, index) => item(`v${index}`, "import_staged_visit", { place })),
    item("g1", "import_staged_visit", { place: other }),
    item("n1", "note_suggestion"),
  ]

  const expanded = expandPlaceGroups([universe[0]], universe)

  assert.deepEqual(expanded.map(r => r.id), ["v0", "v1", "v2", "v3", "v4"])
})

test("expansion leaves non-place work exactly as it was", () => {
  const rows = [item("n1", "note_suggestion"), item("n2", "note_suggestion")]
  assert.deepEqual(expandPlaceGroups([rows[0]], rows).map(r => r.id), ["n1"])
})

test("a sweep over judgment-tier rows is flagged for confirmation, not blocked", () => {
  const rows = Array.from({ length: 12 }, (_, index) => item(`p${index}`, "calendar_reconciliation", { riskTier: "review" }))
  const [group] = groupItems(rows)
  assert.ok(group.acceptable, "the operator can still clear them")
  assert.ok(group.needsConfirmation, "but not without being told what they are")
  assert.equal(confirmationCount(rows), 12)
})

test("observe-tier rows sweep without a prompt", () => {
  const rows = Array.from({ length: 12 }, (_, index) => item(`o${index}`, "note_suggestion", { riskTier: "observe" }))
  assert.equal(confirmationCount(rows), 0)
  assert.equal(groupItems(rows)[0].needsConfirmation, false)
})

test("legacy rows with no tier count as needing a look", () => {
  assert.equal(confirmationCount([item("x", "calendar_reconciliation")]), 1)
})

// Search and filters

test("search is a tokenised AND over what the row actually shows", () => {
  const row = item("r1", "calendar_reconciliation", { title: "Hauke's B-day", detail: "Calendar Plan needs a decision" })
  assert.ok(matchesQuery(row, "hauke"))
  assert.ok(matchesQuery(row, "hauke calendar"), "every token has to match, in any order")
  assert.equal(matchesQuery(row, "hauke dentist"), false)
  assert.ok(matchesQuery(row, "   "), "an empty query matches everything")
})

test("the actionable filter hides exactly the rows with no button", () => {
  const rows = [
    item("a", "staged_interaction"),
    item("b", "staged_interaction", { candidatePersonId: "p1" }),
  ]
  // Dismiss alone still counts as actionable — the row is not a dead end.
  assert.deepEqual(filterItems(rows, { ...EMPTY_FILTERS, actionable: true }).map(r => r.id), ["a", "b"])

  const stuck = item("c", "communication_occurrence")
  assert.deepEqual(filterItems([stuck], { ...EMPTY_FILTERS, actionable: true }), [])
})

test("age filters against a fixed now, so a test is not a clock race", () => {
  const now = Date.parse("2026-09-06T00:00:00.000Z")
  const old = item("old", "note_suggestion", { timestamp: "2026-08-01T00:00:00.000Z" })
  const fresh = item("fresh", "note_suggestion", { timestamp: "2026-09-05T00:00:00.000Z" })
  const kept = filterItems([old, fresh], { ...EMPTY_FILTERS, age: "7" }, now)
  assert.deepEqual(kept.map(r => r.id), ["old"])
})

// Selection

test("shift selects the whole span between the anchor and the target", () => {
  const rows = ["a", "b", "c", "d"].map(id => item(id, "note_suggestion"))
  assert.deepEqual(rangeKeys(rows, rowKey(rows[0]), rowKey(rows[2])), ["note_suggestion:a", "note_suggestion:b", "note_suggestion:c"])
  // Backwards spans the same rows — direction is not part of the question.
  assert.deepEqual(rangeKeys(rows, rowKey(rows[2]), rowKey(rows[0])), ["note_suggestion:a", "note_suggestion:b", "note_suggestion:c"])
})

test("a shift-click with no anchor selects just the row clicked", () => {
  const rows = ["a", "b"].map(id => item(id, "note_suggestion"))
  assert.deepEqual(rangeKeys(rows, null, rowKey(rows[1])), ["note_suggestion:b"])
  assert.deepEqual(rangeKeys(rows, "note_suggestion:a", "gone:z"), [], "a target that left the list selects nothing")
})

test("row keys are unique across the two id spaces", () => {
  // A legacy row and the canonical row staged from it can share an id.
  assert.notEqual(rowKey(item("1", "calendar_reconciliation")), rowKey(item("1", "note_suggestion")))
})

// Snooze

test("a snooze expires on its own rather than needing cleanup", () => {
  const now = Date.parse("2026-09-06T00:00:00.000Z")
  const map = { "a:1": new Date(now - 1_000).toISOString(), "b:2": new Date(now + 60_000).toISOString() }
  assert.deepEqual(Object.keys(activeSnoozes(map, now)), ["b:2"])
})

test("snooze presets land in the future and differ from each other", () => {
  const now = Date.parse("2026-09-06T00:00:00.000Z")
  const later = Date.parse(snoozeUntil("later", now))
  const week = Date.parse(snoozeUntil("week", now))
  assert.ok(later > now && week > later)
  // An unknown preset must still produce a usable date, not NaN.
  assert.ok(Date.parse(snoozeUntil("nonsense", now)) > now)
})
