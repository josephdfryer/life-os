import assert from "node:assert/strict"
import test from "node:test"
import { parseEventSignalAction } from "../event-signals"

test("parseEventSignalAction accepts the three reinforcement labels", () => {
  assert.equal(parseEventSignalAction("not_event"), "not_event")
  assert.equal(parseEventSignalAction("went"), "went")
  assert.equal(parseEventSignalAction("didnt_go"), "didnt_go")
  assert.equal(parseEventSignalAction("going"), null)
  assert.equal(parseEventSignalAction(null), null)
})
