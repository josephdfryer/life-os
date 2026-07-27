import assert from "node:assert/strict"
import test from "node:test"
import { greetingForHour, isProviderScheduledEvent, parseActionItems } from "../lib/daily"

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
