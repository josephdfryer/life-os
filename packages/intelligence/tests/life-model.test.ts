import { test } from "node:test"
import assert from "node:assert/strict"
import { validateLifeModelResponse } from "../src/life-model"

test("validateLifeModelResponse degrades a malformed response instead of throwing", () => {
  const result = validateLifeModelResponse({ summary: 42, claims: "not an array" })
  assert.equal(result.summary, "No summary returned.")
  assert.deepEqual(result.claims, [])
})

test("validateLifeModelResponse drops a claim with no evidence — never persist an unsupported claim", () => {
  const result = validateLifeModelResponse({
    summary: "ok",
    claims: [{ kind: "observed", statement: "Something happens often", confidence: 0.8, evidence: [] }],
  })
  assert.deepEqual(result.claims, [])
})

test("validateLifeModelResponse drops a claim with an unrecognized kind (e.g. a hallucinated 'tension')", () => {
  const result = validateLifeModelResponse({
    summary: "ok",
    claims: [{ kind: "tension", statement: "AI must not author tensions", confidence: 1, evidence: [{ sourceType: "note", sourceId: "n1" }] }],
  })
  assert.deepEqual(result.claims, [])
})

test("validateLifeModelResponse clamps confidence to [0, 1] and defaults a missing one to null", () => {
  const withHigh = validateLifeModelResponse({
    claims: [{ kind: "observed", statement: "a", confidence: 5, evidence: [{ sourceType: "note", sourceId: "n1" }] }],
  })
  assert.equal(withHigh.claims[0].confidence, 1)

  const withMissing = validateLifeModelResponse({
    claims: [{ kind: "observed", statement: "a", evidence: [{ sourceType: "note", sourceId: "n1" }] }],
  })
  assert.equal(withMissing.claims[0].confidence, null)
})

test("validateLifeModelResponse filters out an evidence ref missing sourceType or sourceId instead of failing the whole claim", () => {
  const result = validateLifeModelResponse({
    claims: [{
      kind: "inferred",
      statement: "a",
      confidence: 0.5,
      evidence: [{ sourceType: "note", sourceId: "n1" }, { sourceType: "", sourceId: "n2" }, { sourceId: "n3" }],
    }],
  })
  assert.deepEqual(result.claims[0].evidence, [{ sourceType: "note", sourceId: "n1" }])
})

test("validateLifeModelResponse passes well-formed input through, including subjectType/subjectId and window bounds", () => {
  const result = validateLifeModelResponse({
    summary: "A grounded reading.",
    claims: [{
      kind: "declared",
      statement: "Wants to run a marathon this year",
      confidence: 0.9,
      subjectType: "Person",
      subjectId: "person-1",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: null,
      evidence: [{ sourceType: "plan", sourceId: "plan-1" }],
    }],
  })
  assert.equal(result.summary, "A grounded reading.")
  assert.equal(result.claims.length, 1)
  assert.equal(result.claims[0].subjectType, "Person")
  assert.equal(result.claims[0].subjectId, "person-1")
  assert.equal(result.claims[0].windowStart?.toISOString(), "2026-01-01T00:00:00.000Z")
  assert.equal(result.claims[0].windowEnd, null)
})

test("validateLifeModelResponse ignores an invalid windowStart rather than throwing", () => {
  const result = validateLifeModelResponse({
    claims: [{ kind: "observed", statement: "a", confidence: 0.5, windowStart: "not-a-date", evidence: [{ sourceType: "note", sourceId: "n1" }] }],
  })
  assert.equal(result.claims[0].windowStart, null)
})

test("validateLifeModelResponse rejects citations that were not present in the prompt evidence", () => {
  const result = validateLifeModelResponse({
    claims: [{ kind: "observed", statement: "a", confidence: 0.5, evidence: [{ sourceType: "note", sourceId: "invented" }] }],
  }, new Set(["note:n1"]))
  assert.deepEqual(result.claims, [])
})
