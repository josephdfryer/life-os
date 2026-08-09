import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { createPlan, updatePlan, deletePlan, PlanError } from "../plans"

// Run against a real (throwaway, migrated) database — the transactional
// GraphEvent publish is exactly the part a pure unit test cannot exercise
// honestly. Not part of `tsx --test tests/*.test.ts`; run manually, same
// convention as persons.integration.ts.

const workspaceId = "plans-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Plans integration", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Integration", last: "Person" } })

  // ── create: defaults to active status, links a real Person, publishes a GraphEvent ──
  const created = await createPlan({ personId: person.id, text: "Follow up next week" }, workspaceId, { type: "system" })
  assert.equal(created.status, "active")
  assert.equal(created.personId, person.id)

  const createEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Plan", subjectId: created.id, eventType: "plan.create" } })
  assert.equal(createEvents.length, 1)

  // ── create: an unknown status is rejected ──
  await assert.rejects(
    () => createPlan({ text: "Bad status", status: "not-a-real-status" }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "validation",
  )

  // ── create: a personId that doesn't exist in this workspace 404s ──
  await assert.rejects(
    () => createPlan({ text: "Ghost person", personId: "does-not-exist" }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "not_found",
  )

  // ── update: status transition publishes its own GraphEvent ──
  const updated = await updatePlan(created.id, { status: "completed" }, workspaceId)
  assert.equal(updated.status, "completed")
  const updateEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Plan", subjectId: created.id, eventType: "plan.update" } })
  assert.equal(updateEvents.length, 1)
  assert.deepEqual(JSON.parse(updateEvents[0].payload).fields, ["status"])

  // ── update: a not-found id 404s ──
  await assert.rejects(
    () => updatePlan("does-not-exist", { status: "active" }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "not_found",
  )

  // ── delete: removes the row, publishes a GraphEvent, then 404s on retry ──
  await deletePlan(created.id, workspaceId)
  assert.equal(await db.plan.findUnique({ where: { id: created.id } }), null)
  const deleteEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Plan", subjectId: created.id, eventType: "plan.delete" } })
  assert.equal(deleteEvents.length, 1)
  await assert.rejects(
    () => deletePlan(created.id, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "not_found",
  )

  console.log("All plans integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
