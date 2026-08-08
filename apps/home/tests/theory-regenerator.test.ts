import assert from "node:assert/strict"
import test from "node:test"
import { errorMessage } from "../components/TheoryRegenerator"

test("theory regeneration reads canonical API error envelopes", () => {
  assert.equal(
    errorMessage({ error: { message: "Connect a Vercel AI Gateway key before synthesizing a theory." } }),
    "Connect a Vercel AI Gateway key before synthesizing a theory.",
  )
})

test("theory regeneration still understands legacy string errors", () => {
  assert.equal(errorMessage({ error: "Person not found" }), "Person not found")
})

test("theory regeneration has a safe fallback for malformed responses", () => {
  assert.equal(errorMessage({}), "The theory could not be regenerated.")
})
