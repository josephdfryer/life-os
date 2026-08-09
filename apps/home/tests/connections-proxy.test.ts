import assert from "node:assert/strict"
import test from "node:test"
import { isAllowedConnectionMutation } from "../app/api/connections/[...path]/route"

test("connections proxy allows only Era connect and one-id disconnect", () => {
  assert.equal(isAllowedConnectionMutation("POST", "era"), true)
  assert.equal(isAllowedConnectionMutation("DELETE", "connection-1"), true)
  assert.equal(isAllowedConnectionMutation("POST", "calendar"), false)
  assert.equal(isAllowedConnectionMutation("DELETE", "connection-1/extra"), false)
  assert.equal(isAllowedConnectionMutation("DELETE", "../../persons"), false)
})
