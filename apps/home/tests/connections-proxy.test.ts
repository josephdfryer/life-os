import assert from "node:assert/strict"
import test from "node:test"
import { isAllowedConnectionMutation, isAllowedConnectionRead } from "../app/api/connections/[...path]/route"

test("connections proxy allows only Era connect, Oura OAuth/sync, and one-id disconnect", () => {
  assert.equal(isAllowedConnectionRead("list"), true)
  assert.equal(isAllowedConnectionRead("oura/authorize"), true)
  assert.equal(isAllowedConnectionRead("oura/callback"), false)
  assert.equal(isAllowedConnectionMutation("POST", "era"), true)
  assert.equal(isAllowedConnectionMutation("POST", "granola"), true)
  assert.equal(isAllowedConnectionRead("google/gmail/authorize"), true)
  assert.equal(isAllowedConnectionRead("google/calendar/authorize"), true)
  assert.equal(isAllowedConnectionMutation("POST", "google/gmail/callback"), true)
  assert.equal(isAllowedConnectionMutation("POST", "google/calendar/callback"), true)
  assert.equal(isAllowedConnectionMutation("POST", "oura/callback"), true)
  assert.equal(isAllowedConnectionMutation("POST", "oura/sync"), true)
  assert.equal(isAllowedConnectionMutation("DELETE", "connection-1"), true)
  assert.equal(isAllowedConnectionMutation("POST", "calendar"), false)
  assert.equal(isAllowedConnectionMutation("POST", "oura"), false)
  assert.equal(isAllowedConnectionMutation("DELETE", "connection-1/extra"), false)
  assert.equal(isAllowedConnectionMutation("DELETE", "../../persons"), false)
})
