import assert from "node:assert/strict"
import { test } from "node:test"

// Regression guard for a bug that silently lost money.
//
// Turso stores DateTime as "2026-08-01T07:00:00.000+00:00". Date.toISOString()
// produces "2026-08-01T07:00:00.000Z". The two are the same instant but NOT the
// same string, and SQLite compares TEXT lexicographically. They agree on every
// character up to the offset, where '+' (0x2B) sorts before 'Z' (0x5A).
//
// Consequence when a raw query binds an ISO *string* instead of a Date:
//   WHERE timestamp >= '<start>Z'  drops every row at exactly <start>
//   WHERE timestamp <  '<end>Z'    wrongly INCLUDES every row at exactly <end>
//
// Era transactions are date-only and land on local midnight, so "the first
// instant of the range" is not an edge case — it is an entire day of spending.
// "How much did I spend yesterday?" returned $0.00 with 225 transactions loaded.
//
// The fix is to bind Date objects; these assertions pin the underlying string
// facts so the reasoning stays visible if anyone reintroduces string binding.

const STORED = "2026-08-01T07:00:00.000+00:00"
const ISO = new Date("2026-08-01T07:00:00.000Z").toISOString()

test("the two encodings are the same instant", () => {
  assert.equal(new Date(STORED).getTime(), new Date(ISO).getTime())
})

test("but they are not the same string, and sort the wrong way", () => {
  assert.notEqual(STORED, ISO)
  // '+' sorts before 'Z', so the stored value compares as LESS than the ISO
  // string for the same moment.
  assert.ok(STORED < ISO, "stored form must sort before the ISO form")
  assert.ok("+" < "Z")
})

test("a >= range start bound would drop the boundary row", () => {
  // The comparison SQLite actually performs for `timestamp >= ?`.
  assert.equal(STORED >= ISO, false, "boundary row is excluded — this was the bug")
})

test("a < range end bound would wrongly admit the boundary row", () => {
  assert.equal(STORED < ISO, true, "next range's first day leaks into this range")
})

test("comparing stored-form to stored-form behaves correctly", () => {
  // What binding a Date object produces, and why the fix works.
  const startOfDay = "2026-08-01T07:00:00.000+00:00"
  const endOfDay = "2026-08-02T07:00:00.000+00:00"
  assert.ok(STORED >= startOfDay, "boundary row is included")
  assert.ok(STORED < endOfDay, "and does not leak past the end")
})
