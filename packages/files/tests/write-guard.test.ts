import test from "node:test"
import assert from "node:assert/strict"
import { capabilityOrMostRestrictive, fileEvidenceAllowsCapability } from "../src/safety"

test("file evidence in a turn refuses every capability except read", () => {
  assert.equal(fileEvidenceAllowsCapability("read", true), true)
  assert.equal(fileEvidenceAllowsCapability("write", true), false)
  assert.equal(fileEvidenceAllowsCapability("destructive", true), false)
})

test("with no file evidence, nothing is restricted by this guard", () => {
  for (const capability of ["read", "write", "destructive"] as const) {
    assert.equal(fileEvidenceAllowsCapability(capability, false), true)
  }
})

test("an unclassified tool is treated as destructive, so the guard fails closed", () => {
  // This is the regression that matters. The previous guard named the two write
  // tools that existed, so a newly added write tool was allowed by default. Any
  // name the registry does not know must resolve to the most restrictive value.
  assert.equal(capabilityOrMostRestrictive(undefined), "destructive")
  assert.equal(capabilityOrMostRestrictive(null), "destructive")
  assert.equal(fileEvidenceAllowsCapability(capabilityOrMostRestrictive(undefined), true), false)
})
