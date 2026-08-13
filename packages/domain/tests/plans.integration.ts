import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { createPlan, updatePlan, deletePlan, reschedulePlan, PlanError } from "../plans"

// Run against a real (throwaway, migrated) database — the transactional
// GraphEvent publish is exactly the part a pure unit test cannot exercise
// honestly. Not part of `tsx --test tests/*.test.ts`; run manually, same
// convention as persons.integration.ts.

const workspaceId = "plans-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Plans integration", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Integration", last: "Person" } })
  const foreignWorkspaceId = `${workspaceId}-foreign`
  await db.workspace.create({ data: { id: foreignWorkspaceId, name: "Plans integration foreign", slug: foreignWorkspaceId } })
  const foreignParent = await db.plan.create({ data: { workspaceId: foreignWorkspaceId, text: "Foreign parent" } })

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

  // ── create: a parent Plan must belong to the same workspace ──
  await assert.rejects(
    () => createPlan({ text: "Cross-workspace child", parentId: foreignParent.id }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "not_found",
  )

  // ── update: status transition publishes its own GraphEvent ──
  const updated = await updatePlan(created.id, { status: "completed" }, workspaceId)
  assert.equal(updated.status, "completed")
  const updateEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Plan", subjectId: created.id, eventType: "plan.update" } })
  assert.equal(updateEvents.length, 1)
  assert.deepEqual(JSON.parse(updateEvents[0].payload).fields, ["status"])

  await assert.rejects(
    () => updatePlan(created.id, { parentId: foreignParent.id }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "not_found",
  )
  await assert.rejects(
    () => updatePlan(created.id, { parentId: created.id }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "validation",
  )

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

  // ── reschedulePlan: moves a flexible Plan's slot, publishes a GraphEvent ──
  const flexible = await createPlan({ text: "Write the report" }, workspaceId)
  const start = new Date("2026-09-01T14:00:00Z")
  const end = new Date("2026-09-01T15:00:00Z")
  const rescheduled = await reschedulePlan(flexible.id, { scheduledStart: start, scheduledEnd: end }, workspaceId)
  assert.equal(rescheduled.scheduledStart?.toISOString(), start.toISOString())
  assert.equal(rescheduled.scheduledEnd?.toISOString(), end.toISOString())
  const rescheduleEvents = await db.graphEvent.findMany({ where: { workspaceId, subjectType: "Plan", subjectId: flexible.id, eventType: "plan.reschedule" } })
  assert.equal(rescheduleEvents.length, 1)

  // ── reschedulePlan: scheduledEnd must be after scheduledStart ──
  await assert.rejects(
    () => reschedulePlan(flexible.id, { scheduledStart: end, scheduledEnd: start }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "validation",
  )

  // ── reschedulePlan: never moves a calendar-imported Plan ──
  const calendarPlan = await db.plan.create({ data: { workspaceId, text: "Standup", externalSource: "google-calendar" } })
  await assert.rejects(
    () => reschedulePlan(calendarPlan.id, { scheduledStart: start }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "validation",
  )

  // ── reschedulePlan: never moves a Plan already confirmed as an Event ──
  const fulfilledPlan = await createPlan({ text: "Dentist" }, workspaceId)
  await db.event.create({
    data: { workspaceId, name: "Dentist", type: "appointment", start, timestamp: start, sourcePlanId: fulfilledPlan.id },
  })
  await assert.rejects(
    () => reschedulePlan(fulfilledPlan.id, { scheduledStart: start }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "validation",
  )

  // ── reschedulePlan: never moves a Plan mid calendar-occurrence review ──
  const reviewPlan = await db.plan.create({ data: { workspaceId, text: "Team sync", reconciliationStatus: "pending" } })
  await assert.rejects(
    () => reschedulePlan(reviewPlan.id, { scheduledStart: start }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "validation",
  )

  // ── reschedulePlan: never moves a completed Plan ──
  const completedPlan = await createPlan({ text: "Already done" }, workspaceId)
  await updatePlan(completedPlan.id, { status: "completed" }, workspaceId)
  await assert.rejects(
    () => reschedulePlan(completedPlan.id, { scheduledStart: start }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "validation",
  )

  // ── reschedulePlan: a not-found id 404s ──
  await assert.rejects(
    () => reschedulePlan("does-not-exist", { scheduledStart: start }, workspaceId),
    (error: unknown) => error instanceof PlanError && error.code === "not_found",
  )

  console.log("All plans integration assertions passed.")

  await db.workspace.delete({ where: { id: foreignWorkspaceId } })
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
