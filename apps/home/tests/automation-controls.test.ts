import assert from "node:assert/strict"
import test from "node:test"
import { isAllowed } from "../app/api/automations/[...path]/route"
import { jsonArray } from "../components/AutomationRuleControls"

test("the Home automation proxy exposes only canonical automation paths", () => {
  assert.equal(isAllowed("GET", "rules"), true)
  assert.equal(isAllowed("GET", "runs"), true)
  assert.equal(isAllowed("POST", "rules/rule-1/test"), true)
  assert.equal(isAllowed("PATCH", "rules/rule-1"), true)
  assert.equal(isAllowed("DELETE", "rules/rule-1"), true)
  assert.equal(isAllowed("POST", "../../people/delete"), false)
  assert.equal(isAllowed("DELETE", "rules/rule-1/test"), false)
})

test("rule editors require JSON arrays before sending commands", () => {
  assert.deepEqual(jsonArray('[{"field":"source","operator":"equals","value":"imessage"}]', "Conditions"), [
    { field: "source", operator: "equals", value: "imessage" },
  ])
  assert.throws(() => jsonArray('{"type":"block"}', "Actions"), /valid JSON array/)
  assert.throws(() => jsonArray('not-json', "Conditions"), /valid JSON array/)
})
