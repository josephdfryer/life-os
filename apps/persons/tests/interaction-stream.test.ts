import assert from "node:assert/strict"
import { test } from "node:test"
import { encodeCursor, decodeCursor } from "../server/domain/interaction-stream"

// The cursor is the whole correctness story of the stream. If it round-trips
// wrong, pages silently drop or repeat rows — a failure nobody notices until
// they are reconciling numbers that do not add up.

test("a cursor round-trips exactly", () => {
  const timestamp = new Date("2026-08-02T07:00:00.000Z")
  const decoded = decodeCursor(encodeCursor(timestamp, "cm123abc"))
  assert.equal(decoded.timestamp.getTime(), timestamp.getTime())
  assert.equal(decoded.id, "cm123abc")
})

test("the cursor is url-safe", () => {
  // It travels in a query string; +, / and = would need escaping and get
  // mangled by anything that forgets.
  const cursor = encodeCursor(new Date("2026-01-15T08:00:00.000Z"), "cmsf8h00g0000fd4spms601cj")
  assert.doesNotMatch(cursor, /[+/=]/)
  assert.equal(cursor, encodeURIComponent(cursor))
})

test("ids containing the separator survive", () => {
  // The timestamp is split off at the LAST separator, so a pipe inside an id
  // cannot corrupt the boundary.
  const timestamp = new Date("2026-08-02T07:00:00.000Z")
  const decoded = decodeCursor(encodeCursor(timestamp, "weird|id|value"))
  assert.equal(decoded.id, "weird|id|value")
  assert.equal(decoded.timestamp.getTime(), timestamp.getTime())
})

test("sub-second precision is preserved", () => {
  // Two interactions in the same second must remain orderable.
  const timestamp = new Date("2026-08-02T07:00:00.123Z")
  assert.equal(decodeCursor(encodeCursor(timestamp, "a")).timestamp.toISOString(), "2026-08-02T07:00:00.123Z")
})

test("malformed cursors are rejected, not silently reinterpreted", () => {
  // Guessing here would restart the walk from the top and duplicate a page.
  for (const bad of ["", "!!!not-base64!!!", Buffer.from("nopipe").toString("base64url"), Buffer.from("|abc").toString("base64url"), Buffer.from("not-a-date|abc").toString("base64url")]) {
    assert.throws(() => decodeCursor(bad), /cursor/i, `should reject: ${JSON.stringify(bad)}`)
  }
})

test("a cursor with a timestamp but no id is rejected", () => {
  assert.throws(() => decodeCursor(Buffer.from("2026-08-02T07:00:00.000Z|").toString("base64url")), /cursor/i)
})
