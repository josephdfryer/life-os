import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { createPlan, ensureStateDefinition, recordState } from "@life-os/domain"
import {
  getOrGenerateTodaysBrief,
  refreshTodaysBrief,
  acceptAdaptiveIntervention,
  dismissAdaptiveIntervention,
  recordAdaptiveInterventionOutcome,
  AdaptiveDayError,
} from "../index"

// Run against a real (throwaway, migrated) database — brief persistence,
// the ReviewItem dual-write, and supersession are exactly the parts a pure
// unit test can't exercise honestly. Not part of `tsx --test
// tests/*.test.ts`; run manually, same convention as life-model.integration.ts.

const TZ = "America/Los_Angeles"

async function setCheckIn(personId: string, workspaceId: string, type: "energy" | "stress", value: number) {
  const definition = await ensureStateDefinition({ entityType: "Person", type, value: String(value) }, workspaceId)
  await recordState({ entityType: "Person", entityId: personId, definitionId: definition.id, severity: value, source: "test" }, workspaceId)
}

async function main() {
  // ── Workspace A: recover band (low energy + high stress), one unscheduled Plan ──
  const wsA = "adaptive-day-integration-a"
  await db.workspace.create({ data: { id: wsA, name: "Adaptive Day A", slug: wsA } })
  const personA = await db.person.create({ data: { workspaceId: wsA, first: "Owner", last: "A" } })
  await setCheckIn(personA.id, wsA, "energy", 1)
  await setCheckIn(personA.id, wsA, "stress", 5)
  const plan = await createPlan({ text: "Write the report" }, wsA)

  const brief1 = await getOrGenerateTodaysBrief(wsA, TZ, personA.id)
  assert.ok(brief1)
  assert.equal(brief1!.capacityBand, "recover")
  assert.equal(brief1!.interventions.length, 1)
  assert.equal(brief1!.interventions[0].category, "plan_schedule")
  assert.equal(brief1!.interventions[0].proposedCommand?.command, "plan.schedule")
  assert.ok(brief1!.interventions[0].reviewItemId, "an actionable intervention must be dual-written to a ReviewItem")

  const reviewItem = await db.reviewItem.findUnique({ where: { id: brief1!.interventions[0].reviewItemId! } })
  assert.ok(reviewItem)
  assert.equal(reviewItem!.source, "adaptive_day_brief")
  assert.equal(reviewItem!.sourceId, brief1!.interventions[0].id)

  // ── idempotent: calling again the same day returns the same brief, no duplicate row ──
  const brief1Again = await getOrGenerateTodaysBrief(wsA, TZ, personA.id)
  assert.equal(brief1Again!.id, brief1!.id)
  const dayCount = await db.adaptiveDayBrief.count({ where: { workspaceId: wsA, day: brief1!.day } })
  assert.equal(dayCount, 1)

  // ── accept: runs plan.schedule for real, Plan gets a scheduledStart ──
  const acceptResult = await acceptAdaptiveIntervention(brief1!.interventions[0].id, wsA)
  assert.equal(acceptResult.status, "accepted")
  assert.equal(acceptResult.resultType, "Plan")
  const scheduledPlan = await db.plan.findUnique({ where: { id: plan.id } })
  assert.ok(scheduledPlan?.scheduledStart, "accepting plan_schedule must actually schedule the Plan")

  const acceptedIntervention = await db.adaptiveIntervention.findUnique({ where: { id: brief1!.interventions[0].id } })
  assert.equal(acceptedIntervention?.status, "accepted")

  // ── replaying accept is idempotent, not a re-run ──
  const acceptAgain = await acceptAdaptiveIntervention(brief1!.interventions[0].id, wsA)
  assert.deepEqual(acceptAgain, acceptResult)

  // ── refresh: supersedes the brief, leaves the already-accepted intervention untouched ──
  const brief2 = await refreshTodaysBrief(wsA, TZ, personA.id)
  assert.notEqual(brief2!.id, brief1!.id)
  const oldBrief = await db.adaptiveDayBrief.findUnique({ where: { id: brief1!.id } })
  assert.equal(oldBrief?.status, "superseded")
  const stillAccepted = await db.adaptiveIntervention.findUnique({ where: { id: brief1!.interventions[0].id } })
  assert.equal(stillAccepted?.status, "accepted", "refresh must never touch an already-accepted intervention")

  // ── cross-workspace: resolving an intervention from the wrong workspace 404s ──
  const otherWs = "adaptive-day-integration-a-foreign"
  await db.workspace.create({ data: { id: otherWs, name: "Foreign", slug: otherWs } })
  await assert.rejects(
    () => acceptAdaptiveIntervention(brief1!.interventions[0].id, otherWs),
    (error: unknown) => error instanceof AdaptiveDayError && error.code === "not_found",
  )

  // ── Workspace B: adjust band via a heavy fixed day, nothing schedulable, no Level Up program — capacity_guidance fallback, no ReviewItem ──
  const wsB = "adaptive-day-integration-b"
  await db.workspace.create({ data: { id: wsB, name: "Adaptive Day B", slug: wsB } })
  const today = new Date().toISOString().slice(0, 10)
  await db.event.create({
    data: {
      workspaceId: wsB, name: "All-day offsite", type: "meeting",
      start: new Date(`${today}T09:00:00-08:00`), end: new Date(`${today}T15:00:00-08:00`),
      timestamp: new Date(`${today}T09:00:00-08:00`),
    },
  })

  const briefB = await getOrGenerateTodaysBrief(wsB, TZ, null)
  assert.ok(briefB)
  assert.equal(briefB!.capacityBand, "adjust")
  assert.equal(briefB!.interventions.length, 1)
  assert.equal(briefB!.interventions[0].category, "capacity_guidance")
  assert.equal(briefB!.interventions[0].reviewItemId, null, "capacity guidance has nothing to run — no ReviewItem")

  const dismissResult = await dismissAdaptiveIntervention(briefB!.interventions[0].id, wsB)
  assert.equal(dismissResult.status, "dismissed")
  const dismissed = await db.adaptiveIntervention.findUnique({ where: { id: briefB!.interventions[0].id } })
  assert.equal(dismissed?.status, "dismissed")

  // ── outcomes: append-only ──
  const outcome = await recordAdaptiveInterventionOutcome(
    briefB!.interventions[0].id,
    { source: "user_reported", outcome: "not_sure", note: "unsure yet" },
    wsB,
  )
  assert.equal(outcome.outcome, "not_sure")
  const outcomeCount = await db.adaptiveInterventionOutcome.count({ where: { interventionId: briefB!.interventions[0].id } })
  assert.equal(outcomeCount, 1)

  console.log("All adaptive-day-brief integration assertions passed.")

  await db.workspace.delete({ where: { id: otherWs } })
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
