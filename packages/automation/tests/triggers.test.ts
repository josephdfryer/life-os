import assert from "node:assert/strict"
import test from "node:test"
import { getTriggerSchema, listRegisteredTriggers } from "../triggers"

// Track C promised a trigger per life primitive. This pins the registry so a
// primitive cannot silently lose its automation hook again (Note had none
// until 2026-09-06 even though captureNote published a GraphEvent).
test("every life primitive has at least one registered trigger", () => {
  const triggers = listRegisteredTriggers()
  for (const prefix of ["person.", "place.", "item.", "event.", "plan.", "group.", "state.", "note.", "interaction."]) {
    assert.ok(triggers.some(name => name.startsWith(prefix)), `no trigger registered for ${prefix}*`)
  }
})

test("note.create and place.create validate their minimal payloads", () => {
  assert.ok(getTriggerSchema("note.create").safeParse({ noteId: "n1", type: "note", aboutPersonId: "p1" }).success)
  assert.ok(!getTriggerSchema("note.create").safeParse({ type: "note" }).success, "noteId is required")
  assert.ok(getTriggerSchema("place.create").safeParse({ placeId: "pl1", name: "Blue Bottle" }).success)
  assert.ok(!getTriggerSchema("place.create").safeParse({ placeId: "pl1" }).success, "name is required")
})
