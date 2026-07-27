import assert from "node:assert/strict"
import test from "node:test"
import {
  NoteSuggestionError,
  normalizeTimestamp,
  parseSuggestionPayload,
  validateGatewaySuggestions,
} from "../note-suggestions"

test("keeps only supported, titled suggestions and bounds model-controlled fields", () => {
  const suggestions = validateGatewaySuggestions({
    suggestions: [
      {
        kind: "plan",
        title: "  Call Rowan  ",
        timestamp: "2026-07-27T17:00:00.000Z",
        personNames: ["Rowan", 42],
        confidence: 4,
        reason: "Explicit future commitment",
      },
      { kind: "state", title: "Invented mood" },
      { kind: "event", title: " " },
    ],
  })

  assert.deepEqual(suggestions, [{
    kind: "plan",
    title: "Call Rowan",
    timestamp: "2026-07-27T17:00:00.000Z",
    personNames: ["Rowan"],
    confidence: 1,
    reason: "Explicit future commitment",
  }])
})

test("rejects an invalid response envelope", () => {
  assert.throws(
    () => validateGatewaySuggestions({ result: [] }),
    (error: unknown) => error instanceof NoteSuggestionError && error.code === "provider",
  )
})

test("payload parsing fails closed and timestamps normalize safely", () => {
  assert.deepEqual(parseSuggestionPayload("not-json"), {
    timestamp: null,
    personNames: [],
    matchedPeople: [],
    reason: "",
  })
  assert.equal(normalizeTimestamp("not-a-date"), null)
  assert.equal(normalizeTimestamp("2026-07-27T17:00:00Z"), "2026-07-27T17:00:00.000Z")
})
