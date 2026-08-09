import assert from "node:assert/strict"
import test from "node:test"
import {
  cursorPage,
  dateKeysetSeek,
  decodeDateKeysetCursor,
  encodeDateKeysetCursor,
  parsePageRequest,
} from "../server/api/date-keyset"

test("date keyset cursor round-trips ties without unsafe query characters", () => {
  const date = new Date("2026-08-08T12:34:56.789Z")
  const encoded = encodeDateKeysetCursor(date, "person|with|pipes")
  assert.equal(encoded, encodeURIComponent(encoded))
  assert.deepEqual(decodeDateKeysetCursor(encoded), { date, id: "person|with|pipes" })
})

test("date keyset cursor rejects malformed input", () => {
  for (const cursor of ["not-base64!!!", Buffer.from("no-separator").toString("base64url"), Buffer.from("bad-date|id").toString("base64url")]) {
    assert.throws(() => decodeDateKeysetCursor(cursor), /cursor/i)
  }
})

test("page request defaults, clamps, and rejects invalid limits", () => {
  assert.deepEqual(parsePageRequest(new URLSearchParams(), { limit: 100 }), { cursor: null, limit: 100 })
  assert.equal(parsePageRequest(new URLSearchParams("limit=999"), { limit: 100, maxLimit: 500 }).limit, 500)
  assert.throws(() => parsePageRequest(new URLSearchParams("limit=0"), { limit: 100 }), /limit/i)
  assert.throws(() => parsePageRequest(new URLSearchParams("limit=1.5"), { limit: 100 }), /limit/i)
})

test("seek predicates and page cursors use date plus id tie breakers", () => {
  const date = new Date("2026-08-08T12:34:56.789Z")
  assert.deepEqual(dateKeysetSeek("timestamp", { date, id: "row-2" }, "desc"), {
    OR: [
      { timestamp: { lt: date } },
      { timestamp: date, id: { lt: "row-2" } },
    ],
  })

  const page = cursorPage([
    { id: "row-3", timestamp: date },
    { id: "row-2", timestamp: date },
    { id: "row-1", timestamp: new Date("2026-08-07T12:34:56.789Z") },
  ], 2, row => row.timestamp)
  assert.equal(page.hasMore, true)
  assert.deepEqual(page.data.map(row => row.id), ["row-3", "row-2"])
  assert.deepEqual(decodeDateKeysetCursor(page.nextCursor!), { date, id: "row-2" })
})
