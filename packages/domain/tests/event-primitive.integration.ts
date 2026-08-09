import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { createEventPrimitive, updateEventPrimitive, deleteEventPrimitive, EventPrimitiveError } from "../event-primitive"

// Run against a real (throwaway, migrated) database — the transactional
// GraphEvent publish is exactly the part a pure unit test cannot exercise
// honestly. Not part of `tsx --test tests/*.test.ts`; run manually, same
// convention as plans.integration.ts.

const workspaceId = "event-primitive-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Event primitive integration", slug: workspaceId } })

  // ── create: publishes a GraphEvent under subjectType "Event" ──
  const created = await createEventPrimitive({ name: "Team sync", type: "meeting", timestamp: "2026-08-01T18:00:00Z" }, workspaceId, { type: "system" })
  assert.equal(created.name, "Team sync")
  assert.ok(created.start)

  const createEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Event", subjectId: created.id, eventType: "event.create" } })
  assert.equal(createEvents.length, 1)

  // ── create: a missing name is rejected ──
  await assert.rejects(
    () => createEventPrimitive({ type: "meeting" }, workspaceId),
    (error: unknown) => error instanceof EventPrimitiveError && error.code === "validation",
  )

  // ── create: an invalid timestamp is rejected ──
  await assert.rejects(
    () => createEventPrimitive({ name: "Bad time", type: "meeting", timestamp: "not-a-date" }, workspaceId),
    (error: unknown) => error instanceof EventPrimitiveError && error.code === "validation",
  )

  // ── update: keeps the canonical timestamp/start pair aligned and applies end ──
  const movedTo = new Date("2026-08-02T18:00:00Z")
  const movedEnd = new Date("2026-08-02T19:30:00Z")
  const updated = await updateEventPrimitive(created.id, {
    notes: "Ran long",
    timestamp: movedTo.toISOString(),
    end: movedEnd.toISOString(),
  }, workspaceId)
  assert.equal(updated.notes, "Ran long")
  assert.equal(updated.timestamp.toISOString(), movedTo.toISOString())
  assert.equal(updated.start?.toISOString(), movedTo.toISOString())
  assert.equal(updated.end?.toISOString(), movedEnd.toISOString())
  const updateEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Event", subjectId: created.id, eventType: "event.update" } })
  assert.equal(updateEvents.length, 1)

  await assert.rejects(
    () => updateEventPrimitive("does-not-exist", { notes: "x" }, workspaceId),
    (error: unknown) => error instanceof EventPrimitiveError && error.code === "not_found",
  )

  // ── delete: removes the row, publishes a GraphEvent, then 404s on retry ──
  await deleteEventPrimitive(created.id, workspaceId)
  assert.equal(await db.event.findUnique({ where: { id: created.id } }), null)
  const deleteEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Event", subjectId: created.id, eventType: "event.delete" } })
  assert.equal(deleteEvents.length, 1)
  await assert.rejects(
    () => deleteEventPrimitive(created.id, workspaceId),
    (error: unknown) => error instanceof EventPrimitiveError && error.code === "not_found",
  )

  console.log("All event-primitive integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
