import { test } from "node:test"
import assert from "node:assert/strict"
import { evaluateConditions } from "../conditions"
import { replayRule } from "../rules"
import { getRegisteredAction } from "../actions"

test("equals/not_equals compare case-insensitively after trimming", () => {
  const payload = { source: " iMessage " }
  assert.equal(evaluateConditions([{ field: "source", operator: "equals", value: "imessage" }], payload).matched, true)
  assert.equal(evaluateConditions([{ field: "source", operator: "not_equals", value: "imessage" }], payload).matched, false)
})

test("contains checks a normalized substring", () => {
  const payload = { summary: "Lunch at Nene Bistro" }
  assert.equal(evaluateConditions([{ field: "summary", operator: "contains", value: "nene" }], payload).matched, true)
  assert.equal(evaluateConditions([{ field: "summary", operator: "contains", value: "sushi" }], payload).matched, false)
})

test("in matches against a normalized value list", () => {
  const payload = { source: "gmail" }
  assert.equal(evaluateConditions([{ field: "source", operator: "in", value: ["imessage", "GMAIL", "whatsapp"] }], payload).matched, true)
  assert.equal(evaluateConditions([{ field: "source", operator: "in", value: ["imessage"] }], payload).matched, false)
})

test("exists/not_exists treat undefined, null, and empty string as absent", () => {
  assert.equal(evaluateConditions([{ field: "x", operator: "exists" }], {}).matched, false)
  assert.equal(evaluateConditions([{ field: "x", operator: "exists" }], { x: null }).matched, false)
  assert.equal(evaluateConditions([{ field: "x", operator: "exists" }], { x: "" }).matched, false)
  assert.equal(evaluateConditions([{ field: "x", operator: "exists" }], { x: "y" }).matched, true)
  assert.equal(evaluateConditions([{ field: "x", operator: "not_exists" }], {}).matched, true)
})

test("gte/lte compare numerically, not lexically", () => {
  assert.equal(evaluateConditions([{ field: "confidence", operator: "gte", value: 9 }], { confidence: 10 }).matched, true)
  assert.equal(evaluateConditions([{ field: "confidence", operator: "gte", value: 9 }], { confidence: 8 }).matched, false)
  assert.equal(evaluateConditions([{ field: "confidence", operator: "lte", value: 9 }], { confidence: 9 }).matched, true)
})

test("a field path reaches into nested objects", () => {
  assert.equal(evaluateConditions([{ field: "metadata.priority", operator: "equals", value: "high" }], { metadata: { priority: "high" } }).matched, true)
  assert.equal(evaluateConditions([{ field: "metadata.priority", operator: "equals", value: "high" }], {}).matched, false)
})

test("multiple conditions are AND'd — one failure fails the whole rule", () => {
  const conditions = [
    { field: "source", operator: "equals" as const, value: "imessage" },
    { field: "confidence", operator: "gte" as const, value: 80 },
  ]
  assert.equal(evaluateConditions(conditions, { source: "imessage", confidence: 90 }).matched, true)
  assert.equal(evaluateConditions(conditions, { source: "imessage", confidence: 50 }).matched, false)
})

test("an empty condition list always matches — a trigger-only rule", () => {
  assert.equal(evaluateConditions([], {}).matched, true)
})

test("replayRule reports planned actions only when matched, and never touches state", () => {
  const matched = replayRule([{ field: "source", operator: "equals", value: "imessage" }], [{ type: "block" }], { source: "imessage" })
  assert.equal(matched.matched, true)
  assert.deepEqual(matched.actionsPlanned, [{ type: "block" }])

  const unmatched = replayRule([{ field: "source", operator: "equals", value: "imessage" }], [{ type: "block" }], { source: "gmail" })
  assert.equal(unmatched.matched, false)
  assert.deepEqual(unmatched.actionsPlanned, [])
})

test("built-in action authority matches the consequence of the write", () => {
  for (const type of ["block", "set", "set_field", "assign", "add_tag", "remove_tag", "interaction_set_field", "event_set_field", "item_set_field"]) {
    const action = getRegisteredAction(type)
    assert.ok(action, `expected "${type}" to be registered`)
    assert.equal(action!.authorityTier, "safe_auto")
  }
  assert.equal(getRegisteredAction("plan_set_status")?.authorityTier, "review")
  assert.equal(getRegisteredAction("state_record")?.authorityTier, "review")
})

test("an unregistered action type resolves to nothing, not a crash", () => {
  assert.equal(getRegisteredAction("delete_everything"), undefined)
})
