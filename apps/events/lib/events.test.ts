import assert from "node:assert/strict"
import test from "node:test"
import { eventListWindow } from "./events"

test("today uses the owner's timezone day, not the server clock", () => {
  const now = new Date("2026-09-01T06:30:00.000Z")
  const window = eventListWindow("today", "America/Los_Angeles", now)
  assert.deepEqual(window, {
    gte: new Date("2026-08-31T07:00:00.000Z"),
    lt: new Date("2026-09-01T07:00:00.000Z"),
  })
})
