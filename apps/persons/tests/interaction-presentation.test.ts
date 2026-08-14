import assert from "node:assert/strict"
import test from "node:test"
import { granolaMeetingDetails } from "../lib/interaction-presentation"

test("Granola meeting presentation reads the canonical Event summary and transcript state", () => {
  assert.deepEqual(granolaMeetingDetails({
    id: "event-1",
    name: "Readiness sync",
    transcript: "Joseph: Hello",
    metadata: { granola: { summary: "  Covered launch readiness and next steps.  " } },
  }), {
    eventId: "event-1",
    name: "Readiness sync",
    summary: "Covered launch readiness and next steps.",
    hasTranscript: true,
  })
})

test("non-Granola events do not masquerade as imported meeting summaries", () => {
  assert.equal(granolaMeetingDetails({
    id: "event-2",
    name: "Dinner",
    transcript: null,
    metadata: { source: "manual" },
  }), null)
})
