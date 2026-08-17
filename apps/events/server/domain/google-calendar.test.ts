import assert from "node:assert/strict"
import test from "node:test"
import { isCalendarDbContention, mapPool, prioritizeCalendarConnections, withCalendarDbRetry } from "./google-calendar-sync"

test("calendar sync retries Turso transaction-start failures", () => {
  assert.equal(isCalendarDbContention(new Error("Transaction API error: Unable to start a transaction in the given time.")), true)
  assert.equal(isCalendarDbContention(new Error("prisma:error SQLITE_BUSY: database is locked")), true)
  assert.equal(isCalendarDbContention({ code: "P2034", message: "Transaction failed due to a write conflict" }), true)
  assert.equal(isCalendarDbContention(new Error("Google Calendar events request failed (403)")), false)
})

test("calendar sync retries contention then succeeds", async () => {
  let attempts = 0
  const value = await withCalendarDbRetry(async () => {
    attempts += 1
    if (attempts < 3) throw new Error("Unable to start a transaction in the given time.")
    return "ok"
  })
  assert.equal(value, "ok")
  assert.equal(attempts, 3)
})

test("failed calendars sync before healthy ones so Sightmachine is not always last", () => {
  const ordered = prioritizeCalendarConnections([
    { calendarSummary: "Fryer den", lastError: null, lastSyncedAt: new Date("2026-08-16T20:00:00Z") },
    { calendarSummary: "JDF247", lastError: null, lastSyncedAt: new Date("2026-08-16T20:00:00Z") },
    { calendarSummary: "Qin", lastError: "Unable to start a transaction in the given time.", lastSyncedAt: new Date("2026-08-16T19:00:00Z") },
    { calendarSummary: "jfryer@sightmachine.com", lastError: "Unable to start a transaction in the given time.", lastSyncedAt: new Date("2026-08-15T12:00:00Z") },
  ]).map(connection => connection.calendarSummary)

  assert.deepEqual(ordered, ["jfryer@sightmachine.com", "Qin", "Fryer den", "JDF247"])
})

test("mapPool preserves order with limited concurrency", async () => {
  const seen: number[] = []
  const results = await mapPool([1, 2, 3, 4, 5], 2, async item => {
    seen.push(item)
    await new Promise(resolve => setTimeout(resolve, 5))
    return item * 10
  })
  assert.deepEqual(results, [10, 20, 30, 40, 50])
  assert.equal(seen.length, 5)
})
