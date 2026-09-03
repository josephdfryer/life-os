import assert from "node:assert/strict"
import test from "node:test"
import {
  MAX_FOCUS,
  STALE_DEFER_COUNT,
  canPullIntoFocus,
  compareDue,
  compareFocus,
  dayToDate,
  daysBetween,
  isStale,
  markActionItem,
  rankSuggestions,
  snoozeTarget,
  suggestionReason,
  type Commitment,
} from "../lib/commitments"
import { dayKey } from "../lib/daily"

const TZ = "America/Los_Angeles"

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "plan-1",
    text: "Send the contract",
    status: "active",
    dueOn: null,
    deferCount: 0,
    createdAt: "2026-07-01T12:00:00.000Z",
    personId: null,
    personName: null,
    ageDays: 0,
    stale: false,
    focusedAt: null,
    ...overrides,
  }
}

test("staleness begins at the configured defer count", () => {
  assert.equal(isStale(STALE_DEFER_COUNT - 1), false)
  assert.equal(isStale(STALE_DEFER_COUNT), true)
  assert.equal(isStale(STALE_DEFER_COUNT + 1), true)
})

test("the snooze ladder pushes further each time", () => {
  const now = new Date("2026-07-28T18:00:00.000Z")
  assert.equal(snoozeTarget(0, now, TZ), "2026-07-29")
  assert.equal(snoozeTarget(1, now, TZ), "2026-07-31")
  assert.equal(snoozeTarget(2, now, TZ), "2026-08-04")
})

test("a due date round-trips through the user's zone", () => {
  const stored = dayToDate("2026-07-28", TZ)
  assert.equal(dayKey(stored, TZ), "2026-07-28")
})

test("the backlog sorts most overdue first, then the longest wait", () => {
  const rows = [
    commitment({ id: "undated-new", dueOn: null, ageDays: 2 }),
    commitment({ id: "due-today", dueOn: "2026-07-28" }),
    commitment({ id: "undated-old", dueOn: null, ageDays: 40 }),
    commitment({ id: "overdue", dueOn: "2026-07-20" }),
  ]
  assert.deepEqual(
    [...rows].sort(compareDue).map(row => row.id),
    ["overdue", "due-today", "undated-old", "undated-new"],
  )
})

test("wait length is whole days and never negative", () => {
  const from = new Date("2026-07-20T00:00:00.000Z")
  assert.equal(daysBetween(from, new Date("2026-07-28T06:00:00.000Z")), 8)
  assert.equal(daysBetween(from, new Date("2026-07-20T23:00:00.000Z")), 0)
  assert.equal(daysBetween(from, new Date("2026-07-19T00:00:00.000Z")), 0)
})

test("resolving one action item leaves its siblings untouched", () => {
  const items = [
    { description: "Send the contract", completed: false },
    { description: "Book the room", completed: false },
  ]
  const next = markActionItem(items, 1, true)
  assert.deepEqual(JSON.parse(next as string), [
    { description: "Send the contract", completed: false },
    { description: "Book the room", completed: true },
  ])
})

test("an out-of-range action item index resolves to nothing rather than corrupting the blob", () => {
  const items = [{ description: "Send the contract", completed: false }]
  assert.equal(markActionItem(items, 3, true), null)
  assert.equal(markActionItem(items, -1, true), null)
})

test("focus never admits more than MAX_FOCUS", () => {
  for (let count = 0; count < MAX_FOCUS; count += 1) {
    assert.equal(canPullIntoFocus(count), true)
  }
  assert.equal(canPullIntoFocus(MAX_FOCUS), false)
  assert.equal(canPullIntoFocus(MAX_FOCUS + 1), false)
})

test("focus order is oldest pull first, independent of dueOn", () => {
  const rows = [
    commitment({ id: "newest", dueOn: "2026-07-01", focusedAt: "2026-07-28T00:00:00.000Z" }),
    commitment({ id: "oldest", dueOn: null, focusedAt: "2026-07-20T00:00:00.000Z" }),
    commitment({ id: "middle", dueOn: "2099-01-01", focusedAt: "2026-07-24T00:00:00.000Z" }),
  ]
  assert.deepEqual(
    [...rows].sort(compareFocus).map(row => row.id),
    ["oldest", "middle", "newest"],
  )
})

test("suggestions rank by longest wait and explain why", () => {
  const candidates = [
    commitment({ id: "a", ageDays: 2, personName: "Connell" }),
    commitment({ id: "b", ageDays: 9, personName: "Jilli" }),
    commitment({ id: "c", ageDays: 0 }),
  ]
  const ranked = rankSuggestions(candidates)
  assert.deepEqual(ranked.map(row => row.id), ["b", "a", "c"])
  assert.equal(suggestionReason(ranked[0]), "Jilli has waited 9d")
  assert.equal(suggestionReason(commitment({ ageDays: 3, personName: null })), "captured 3d ago")
  assert.equal(suggestionReason(commitment({ ageDays: 0, personName: null })), "captured today")
})
