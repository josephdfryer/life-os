import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { createPlan, updatePlan } from "@life-os/domain"
import { matchPassiveOutcomes, getPendingOutcomeQuestion } from "../index"
import { localDayString, addDays } from "../src/adaptive-day-time"

// Run against a real (throwaway, migrated) database — the day-window
// arithmetic and the DB-backed positive-evidence checks are exactly the
// parts a pure unit test can't exercise honestly. Not part of `tsx --test
// tests/*.test.ts`; run manually, same convention as
// adaptive-day-brief.integration.ts.

const workspaceId = "adaptive-day-outcomes-integration"
const TZ = "America/Los_Angeles"

async function makeBrief(day: string) {
  return db.adaptiveDayBrief.create({
    data: {
      workspaceId, day, timezone: TZ, rulesVersion: "v1", capacityBand: "adjust",
      inputSnapshot: "{}", missingSignals: "[]", status: "current",
    },
  })
}

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Outcomes", slug: workspaceId } })

  const todayLocal = localDayString(new Date(), TZ)
  const yesterday = addDays(todayLocal, -2)
  const longAgo = addDays(todayLocal, -10)

  // ── Scenario 1: plan_schedule whose Plan got completed -> followed_through ──
  const plan1 = await createPlan({ text: "Write the report" }, workspaceId)
  await updatePlan(plan1.id, { status: "completed" }, workspaceId)
  const brief1 = await makeBrief(yesterday)
  const iv1 = await db.adaptiveIntervention.create({
    data: {
      briefId: brief1.id, rank: 0, category: "plan_schedule", recommendationText: "Schedule it",
      status: "accepted", resultType: "Plan", resultId: plan1.id,
    },
  })

  // ── Scenario 2: plan_reschedule whose Plan has no evidence yet -> stays unresolved within the fallback window ──
  const plan2 = await createPlan({ text: "Review budget" }, workspaceId)
  const brief2 = await makeBrief(yesterday)
  const iv2 = await db.adaptiveIntervention.create({
    data: {
      briefId: brief2.id, rank: 0, category: "plan_reschedule", recommendationText: "Move it",
      status: "accepted", resultType: "Plan", resultId: plan2.id,
    },
  })

  // ── Scenario 3: capacity_guidance, accepted, no passive evidence is possible ──
  const brief3 = await makeBrief(yesterday)
  const iv3 = await db.adaptiveIntervention.create({
    data: { briefId: brief3.id, rank: 0, category: "capacity_guidance", recommendationText: "Protect your afternoon", status: "accepted" },
  })

  // ── Scenario 4: old enough (past the 7-day fallback) that "unknown" must be recorded even with zero evidence ──
  const brief4 = await makeBrief(longAgo)
  const iv4 = await db.adaptiveIntervention.create({
    data: { briefId: brief4.id, rank: 0, category: "capacity_guidance", recommendationText: "Old one", status: "accepted" },
  })

  // ── Scenario 5: a pending (never-accepted) intervention must never be touched ──
  const brief5 = await makeBrief(longAgo)
  const iv5 = await db.adaptiveIntervention.create({
    data: { briefId: brief5.id, rank: 0, category: "capacity_guidance", recommendationText: "Still pending", status: "pending" },
  })

  // ── Scenario 6: today's brief — too fresh to evaluate at all ──
  const brief6 = await makeBrief(todayLocal)
  const iv6 = await db.adaptiveIntervention.create({
    data: { briefId: brief6.id, rank: 0, category: "capacity_guidance", recommendationText: "Too fresh", status: "accepted" },
  })

  const results = await matchPassiveOutcomes(workspaceId, TZ)
  const byId = new Map(results.map(r => [r.interventionId, r.outcome]))

  assert.equal(byId.get(iv1.id), "followed_through", "a completed Plan is real evidence of follow-through")
  assert.equal(byId.get(iv4.id), "unknown", "past the fallback window, unresolved becomes unknown — never a negative verdict")
  assert.ok(!byId.has(iv2.id), "no evidence within the fallback window must stay unresolved, not marked failed")
  assert.ok(!byId.has(iv3.id), "capacity_guidance has no passive evidence and must stay unresolved within the window")
  assert.ok(!byId.has(iv5.id), "a still-pending (never accepted) intervention must never get an outcome")
  assert.ok(!byId.has(iv6.id), "today's brief is too fresh to evaluate at all")

  const outcome1 = await db.adaptiveInterventionOutcome.findFirst({ where: { interventionId: iv1.id } })
  assert.equal(outcome1?.source, "passive")

  // ── replaying the sweep must not double-write ──
  await matchPassiveOutcomes(workspaceId, TZ)
  const outcomeCount = await db.adaptiveInterventionOutcome.count({ where: { interventionId: iv1.id } })
  assert.equal(outcomeCount, 1, "a resolved intervention must never get a second passive outcome row")

  // ── the one allowed question: oldest unresolved, iv2 or iv3 ──
  const pending = await getPendingOutcomeQuestion(workspaceId, TZ)
  assert.ok(pending)
  assert.ok([iv2.id, iv3.id].includes(pending!.id))

  console.log("All adaptive-day-outcomes integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
