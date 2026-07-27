import assert from "node:assert/strict"
import test from "node:test"
import { CaptureValidationError, normalizeCaptureInput } from "../capture"

test("normalizes whitespace and defaults unknown types to thought", () => {
  const value = normalizeCaptureInput({
    workspaceId: " default-workspace ",
    content: "  Remember this  ",
    type: "not-a-type",
    source: " home ",
    idempotencyKey: "capture_12345678",
  })
  assert.equal(value.workspaceId, "default-workspace")
  assert.equal(value.content, "Remember this")
  assert.equal(value.type, "thought")
  assert.equal(value.source, "home")
})

test("preserves supported semantic note types", () => {
  for (const type of ["thought", "observation", "declaration", "voice_transcript", "import", "theory_observation"]) {
    assert.equal(normalizeCaptureInput({
      workspaceId: "w",
      content: "Something",
      type,
      source: "test",
    }).type, type)
  }
})

test("rejects empty and excessively long capture content", () => {
  assert.throws(() => normalizeCaptureInput({
    workspaceId: "w",
    content: " ",
    source: "test",
  }), CaptureValidationError)
  assert.throws(() => normalizeCaptureInput({
    workspaceId: "w",
    content: "x".repeat(10_001),
    source: "test",
  }), /10,000/)
})

test("rejects unsafe idempotency keys", () => {
  assert.throws(() => normalizeCaptureInput({
    workspaceId: "w",
    content: "Something",
    source: "test",
    idempotencyKey: "not safe!",
  }), /idempotencyKey/)
})
