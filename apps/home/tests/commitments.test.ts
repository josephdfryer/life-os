import assert from "node:assert/strict"
import test from "node:test"
import {
  STALE_DEFER_COUNT,
  compareDue,
  dayToDate,
  daysBetween,
  isDueToday,
  isStale,
  markActionItem,
  snoozeTarget,
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
    ...overrides,
  }
}

test("a commitment is due when its day has arrived or passed", () => {
  assert.equal(isDueToday("2026-07-28", "2026-07-28"), true)
  assert.equal(isDueToday("2026-07-20", "2026-07-28"), true)
  assert.equal(isDueToday("2026-07-29", "2026-07-28"), false)
  assert.equal(isDueToday(null, "2026-07-28"), false)
})

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

test("today's list puts the most overdue first, then the longest wait", () => {
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
