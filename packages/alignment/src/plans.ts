// Stalled-plan detection — an active, non-scheduled Plan tied to a specific
// person is a declared intention ("call Mike more"). If there has been no
// Interaction with that person since the Plan was declared, the declared and
// behavioral layers have diverged. Scheduled Plans (scheduledStart set) are
// calendar-backed predictions with their own natural resolution via a
// fulfilling Event, so they're excluded here — this only covers goal-type
// Plans, which have no other way to signal follow-through.
//
// Deliberately narrow scope: a Plan with no personId (e.g. "get in better
// shape") has no clean behavioral proxy without inventing extra structure, so
// it's left out rather than guessed at.

import type { AlignmentSignal } from "./types"

const STALLED_PLAN_MIN_AGE_DAYS = 14

export async function getStalledPlanSignals(workspaceId: string): Promise<AlignmentSignal[]> {
  const { db } = await import("@life-os/db")
  const cutoff = new Date(Date.now() - STALLED_PLAN_MIN_AGE_DAYS * 86400000)

  const plans = await db.plan.findMany({
    where: {
      workspaceId,
      status: "active",
      scheduledStart: null,
      personId: { not: null },
      createdAt: { lte: cutoff },
    },
    select: {
      id: true,
      text: true,
      createdAt: true,
      personId: true,
      person: { select: { first: true, last: true } },
    },
    // Same reasoning as getRelationshipGaps: WHERE already bounds this to
    // active, unscheduled, person-tied Plans, but this now runs on every
    // Home Intelligence request, so cap it explicitly rather than trust
    // that stays small forever.
    take: 500,
  })
  if (!plans.length) return []

  const personIds = [...new Set(plans.flatMap(plan => plan.personId ? [plan.personId] : []))]
  const latestInteractions = await db.interaction.groupBy({
    by: ["personId"],
    where: {
      workspaceId,
      personId: { in: personIds },
      // Every relevant Plan is at least this old. Keeping the predicate makes
      // the grouped lookup use the recent part of the interaction index while
      // still preserving enough history to compare against every Plan below.
      timestamp: { gte: plans.reduce(
        (earliest, plan) => plan.createdAt < earliest ? plan.createdAt : earliest,
        plans[0].createdAt,
      ) },
    },
    _max: { timestamp: true },
  })
  const latestByPerson = new Map(
    latestInteractions.flatMap(row => row.personId && row._max.timestamp
      ? [[row.personId, row._max.timestamp] as const]
      : []),
  )

  const signals: AlignmentSignal[] = []
  for (const plan of plans) {
    if (!plan.personId || !plan.person) continue
    const latestInteraction = latestByPerson.get(plan.personId)
    if (latestInteraction && latestInteraction >= plan.createdAt) continue

    const ageDays = Math.floor((Date.now() - plan.createdAt.getTime()) / 86400000)
    signals.push({
      kind: "stalled_plan",
      severity: ageDays / STALLED_PLAN_MIN_AGE_DAYS,
      subject: plan.text,
      detail: `Declared ${ageDays} days ago about ${plan.person.first} ${plan.person.last} — no interaction with them since`,
      planId: plan.id,
      personId: plan.personId,
    })
  }
  return signals
}
