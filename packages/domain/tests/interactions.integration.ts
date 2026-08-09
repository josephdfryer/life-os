import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { setInteractionField, InteractionFieldError } from "../interactions"

// Run against a real (throwaway, migrated) database — the transactional
// GraphEvent publish is exactly the part a pure unit test cannot exercise
// honestly. Not part of `tsx --test tests/*.test.ts`; run manually, same
// convention as staged-interactions.integration.ts.

const workspaceId = "interactions-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Interactions integration", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Integration", last: "Person" } })
  const interaction = await db.interaction.create({
    data: { workspaceId, personId: person.id, type: "call", timestamp: new Date(), summary: "Initial summary" },
  })

  // ── a whitelisted field updates and publishes a GraphEvent ──
  const updated = await setInteractionField({
    id: interaction.id,
    field: "outcome",
    value: "Resolved",
    workspaceId,
    actor: { type: "rule", label: "test-rule" },
  })
  assert.equal(updated.outcome, "Resolved")

  const persisted = await db.interaction.findUniqueOrThrow({ where: { id: interaction.id } })
  assert.equal(persisted.outcome, "Resolved")
  assert.equal(persisted.summary, "Initial summary", "only the targeted field changes")

  const events = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Interaction", subjectId: interaction.id } })
  assert.equal(events.length, 1)
  assert.equal(events[0].eventType, "interaction.field_set")
  const payload = JSON.parse(events[0].payload)
  assert.equal(payload.field, "outcome")
  assert.equal(payload.value, "Resolved")

  // ── a non-whitelisted field is rejected, not silently applied ──
  await assert.rejects(
    () => setInteractionField({ id: interaction.id, field: "amount", value: 100, workspaceId }),
    (error: unknown) => error instanceof InteractionFieldError && error.code === "validation",
  )

  // ── a target from another workspace (or that doesn't exist) 404s ──
  await assert.rejects(
    () => setInteractionField({ id: interaction.id, field: "outcome", value: "x", workspaceId: "some-other-workspace" }),
    (error: unknown) => error instanceof InteractionFieldError && error.code === "not_found",
  )
  await assert.rejects(
    () => setInteractionField({ id: "does-not-exist", field: "outcome", value: "x", workspaceId }),
    (error: unknown) => error instanceof InteractionFieldError && error.code === "not_found",
  )

  console.log("All interactions integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
