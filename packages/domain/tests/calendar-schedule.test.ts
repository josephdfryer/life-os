import assert from "node:assert/strict"
import test from "node:test"
import { timelineWindow } from "../calendar-schedule"

test("today is the half-open local day, upcoming starts there, past is before it", () => {
  const dayStart = new Date("2026-08-31T07:00:00.000Z")
  const dayEnd = new Date("2026-09-01T07:00:00.000Z")
  assert.deepEqual(timelineWindow("today", dayStart, dayEnd), { gte: dayStart, lt: dayEnd })
  assert.deepEqual(timelineWindow("upcoming", dayStart, dayEnd), { gte: dayStart })
  assert.deepEqual(timelineWindow("past", dayStart, dayEnd), { lt: dayStart })
  assert.equal(timelineWindow("all", dayStart, dayEnd), undefined)
})
