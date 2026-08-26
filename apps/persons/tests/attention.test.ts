import assert from "node:assert/strict"
import test from "node:test"
import { daysSince, lastInteractionDate } from "../lib/attention"
import { personListInclude } from "../server/queries/person-list"
import type { Interaction } from "../types"

function interaction(timestamp: string) {
  return { timestamp } as unknown as Interaction
}

test("future appointments do not become the last completed contact", () => {
  const now = new Date("2026-08-22T18:00:00.000Z")
  const last = lastInteractionDate([
    interaction("2026-08-25T18:00:00.000Z"),
    interaction("2026-08-10T18:00:00.000Z"),
  ], now)

  assert.equal(last?.toISOString(), "2026-08-10T18:00:00.000Z")
})

test("a person with only future appointments has no completed contact", () => {
  const now = new Date("2026-08-22T18:00:00.000Z")
  assert.equal(lastInteractionDate([
    interaction("2026-08-25T18:00:00.000Z"),
  ], now), null)
})

test("day arithmetic cannot produce a negative recency", () => {
  assert.equal(daysSince(
    new Date("2026-08-25T18:00:00.000Z"),
    new Date("2026-08-22T18:00:00.000Z"),
  ), 0)
})

test("the compact People query asks the database only for completed contact", () => {
  const now = new Date("2026-08-22T18:00:00.000Z")
  assert.deepEqual(personListInclude(now).interactions.where, {
    timestamp: { lte: now },
  })
})
