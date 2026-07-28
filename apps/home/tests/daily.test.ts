import assert from "node:assert/strict"
import test from "node:test"
import {
  dayKey,
  greetingForHour,
  isProviderScheduledEvent,
  parseActionItems,
  parseReviewDay,
  reviewDayBounds,
  shiftDay,
} from "../lib/daily"

test("parseActionItems supports legacy strings and completion-aware objects", () => {
  assert.deepEqual(parseActionItems(JSON.stringify([
    "Send the deck",
    { description: "Book dinner", completed: true },
    { text: "Call Alex", completed: false },
  ])), [
    { description: "Send the deck", completed: false },
    { description: "Book dinner", completed: true },
    { description: "Call Alex", completed: false },
  ])
})

test("parseActionItems preserves plain-text legacy values", () => {
  assert.deepEqual(parseActionItems("Follow up tomorrow"), [
    { description: "Follow up tomorrow", completed: false },
  ])
})

test("greetingForHour follows the local day", () => {
  assert.equal(greetingForHour(8), "Good morning")
  assert.equal(greetingForHour(14), "Good afternoon")
  assert.equal(greetingForHour(20), "Good evening")
})

test("provider-backed calendar records are presented as scheduled context", () => {
  assert.equal(isProviderScheduledEvent({ type: "calendar", calendarLinks: [] }), true)
  assert.equal(isProviderScheduledEvent({ type: "meeting", calendarLinks: [{}] }), true)
  assert.equal(isProviderScheduledEvent({ type: "dinner", calendarLinks: [] }), false)
})

test("daily review uses Los Angeles calendar days across daylight saving time", () => {
  assert.equal(dayKey(new Date("2026-07-27T07:30:00Z")), "2026-07-27")
  assert.equal(dayKey(new Date("2026-07-27T06:30:00Z")), "2026-07-26")
  assert.deepEqual(reviewDayBounds("2026-07-27"), {
    start: new Date("2026-07-27T07:00:00.000Z"),
    end: new Date("2026-07-28T07:00:00.000Z"),
  })
  assert.deepEqual(reviewDayBounds("2026-01-27"), {
    start: new Date("2026-01-27T08:00:00.000Z"),
    end: new Date("2026-01-28T08:00:00.000Z"),
  })
})

test("daily review validates and moves between date keys", () => {
  const now = new Date("2026-07-27T20:00:00Z")
  assert.equal(parseReviewDay(undefined, now), "2026-07-27")
  assert.equal(parseReviewDay("not-a-day", now), "2026-07-27")
  assert.equal(parseReviewDay("2026-07-20", now), "2026-07-20")
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28")
})
