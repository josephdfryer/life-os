import assert from "node:assert/strict"
import { db } from "@life-os/db"
import {
  ensureStateDefinition,
  recordState,
  replaceStatesForSourceNoteInTransaction,
  StateError,
} from "../states"

const workspaceId = "states-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "States integration", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "State", last: "Subject" } })
  const note = await db.note.create({
    data: { workspaceId, type: "observation", content: "Daily state fixture", timestamp: new Date() },
  })

  const definition = await ensureStateDefinition({
    entityType: "Person",
    type: "mood",
    value: "4",
    description: "Mood rating",
  }, workspaceId)
  const sameDefinition = await ensureStateDefinition({
    entityType: "Person",
    type: "mood",
    value: "4",
    description: "Updated mood rating",
  }, workspaceId)
  assert.equal(sameDefinition.id, definition.id)
  assert.equal(sameDefinition.description, "Updated mood rating")

  const recorded = await recordState({
    entityType: "Person",
    entityId: person.id,
    definitionId: definition.id,
    severity: 4,
    source: "integration",
    sourceNoteId: note.id,
  }, workspaceId)
  assert.equal(recorded.state.entityId, person.id)
  assert.equal(await db.graphEvent.count({
    where: { workspaceId, subjectType: "State", subjectId: recorded.state.id, eventType: "state.record" },
  }), 1)

  await db.$transaction(tx => replaceStatesForSourceNoteInTransaction(tx, note.id, [{
    entityType: "Person",
    entityId: person.id,
    definitionId: definition.id,
    severity: 5,
    source: "integration-refresh",
  }], workspaceId))
  const refreshed = await db.state.findMany({ where: { workspaceId, sourceNoteId: note.id } })
  assert.equal(refreshed.length, 1)
  assert.equal(refreshed[0].severity, 5)

  const otherWorkspace = await db.workspace.create({
    data: { id: "states-other-workspace", name: "Other", slug: "states-other-workspace" },
  })
  await assert.rejects(
    () => recordState({ entityType: "Person", entityId: person.id, definitionId: definition.id }, otherWorkspace.id),
    (error: unknown) => error instanceof StateError && error.code === "not_found",
  )

  console.log("All State integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
