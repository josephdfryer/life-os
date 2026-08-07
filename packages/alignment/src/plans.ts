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

  const signals: AlignmentSignal[] = []
  for (const plan of plans) {
    if (!plan.personId || !plan.person) continue
    const sinceCount = await db.interaction.count({
      where: { workspaceId, personId: plan.personId, timestamp: { gte: plan.createdAt } },
    })
    if (sinceCount > 0) continue

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
