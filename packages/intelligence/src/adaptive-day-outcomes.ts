import type { GraphEventActor, AuditActor } from "@life-os/domain"
import { localDayString, addDays, zonedTimeToUtc } from "./adaptive-day-time"
import { recordAdaptiveInterventionOutcome } from "./adaptive-day-brief"

// Outcome learning — see docs/ADAPTIVE_DAY_PLAN.md §5. Two windows:
// - OUTCOME_WINDOW_DAYS: an accepted intervention isn't evaluated at all
//   until its brief day has fully passed (there's no "did it happen yet"
//   answer on the same day something was accepted).
// - UNKNOWN_FALLBACK_DAYS: if nothing — passive evidence or a user answer —
//   has resolved it by then, it's recorded "unknown" so it stops being
//   offered forever. Passive matching only ever writes "followed_through" or
//   "unknown", never a negative verdict — "lack of evidence becomes unknown,
//   never failed" is the plan's explicit rule.
const OUTCOME_WINDOW_DAYS = 1
const UNKNOWN_FALLBACK_DAYS = 7

type Actor = GraphEventActor & AuditActor

export type PassiveMatchResult = { interventionId: string; outcome: "followed_through" | "unknown" }

export async function matchPassiveOutcomes(workspaceId: string, timezone: string, actor?: Actor): Promise<PassiveMatchResult[]> {
  const { db } = await import("@life-os/db")
  const today = localDayString(new Date(), timezone)
  const cutoff = addDays(today, -OUTCOME_WINDOW_DAYS)

  const candidates = await db.adaptiveIntervention.findMany({
    where: {
      status: { in: ["accepted", "edited_accepted"] },
      brief: { workspaceId, day: { lte: cutoff } },
      outcomes: { none: {} },
    },
    select: { id: true, category: true, resultType: true, resultId: true, brief: { select: { day: true, timezone: true, workspaceId: true } } },
  })

  const results: PassiveMatchResult[] = []
  for (const iv of candidates) {
    const positive = await checkPositiveEvidence(iv)
    if (positive) {
      await recordAdaptiveInterventionOutcome(iv.id, { source: "passive", outcome: "followed_through", evidence: positive }, workspaceId, actor)
      results.push({ interventionId: iv.id, outcome: "followed_through" })
      continue
    }
    const daysSinceBrief = daysBetween(iv.brief.day, today)
    if (daysSinceBrief >= UNKNOWN_FALLBACK_DAYS) {
      await recordAdaptiveInterventionOutcome(iv.id, { source: "passive", outcome: "unknown" }, workspaceId, actor)
      results.push({ interventionId: iv.id, outcome: "unknown" })
    }
    // Otherwise: still within the fallback window — leave unresolved, so
    // it's eligible for getPendingOutcomeQuestion below.
  }
  return results
}

async function checkPositiveEvidence(iv: {
  category: string
  resultType: string | null
  resultId: string | null
  brief: { day: string; timezone: string; workspaceId: string }
}): Promise<Record<string, unknown> | null> {
  const { db } = await import("@life-os/db")

  if (iv.category === "plan_schedule" || iv.category === "plan_reschedule") {
    if (iv.resultType !== "Plan" || !iv.resultId) return null
    const plan = await db.plan.findUnique({
      where: { id: iv.resultId },
      select: { status: true, fulfilledBy: { select: { id: true } } },
    })
    if (!plan) return null
    if (plan.status === "completed") return { planStatus: "completed" }
    if (plan.fulfilledBy) return { fulfilledByEventId: plan.fulfilledBy.id }
    return null
  }

  if (iv.category === "workout_adjustment") {
    // Any completed Level Up session on the brief's day is evidence a
    // workout happened — matching Level Up's own "no explicit prescription
    // acceptance record yet" state (docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md).
    const dayStart = zonedTimeToUtc(iv.brief.day, 0, 0, iv.brief.timezone)
    const dayEnd = zonedTimeToUtc(addDays(iv.brief.day, 1), 0, 0, iv.brief.timezone)
    const session = await db.levelUpSession.findFirst({
      where: { workspaceId: iv.brief.workspaceId, endedAt: { not: null }, startedAt: { gte: dayStart, lt: dayEnd } },
      select: { id: true },
    })
    return session ? { sessionId: session.id } : null
  }

  // capacity_guidance has no concrete action — never has passive evidence.
  return null
}

function daysBetween(day: string, today: string): number {
  const a = Date.UTC(...(day.split("-").map(Number) as [number, number, number]))
  const b = Date.UTC(...(today.split("-").map(Number) as [number, number, number]))
  return Math.round((b - a) / 86_400_000)
}

export type PendingOutcomeQuestion = { id: string; recommendationText: string; category: string }

// The one intervention (oldest unresolved, if several) Evening Check-In may
// ask about today — never more than one question per day, and only ever
// interventions matchPassiveOutcomes couldn't already resolve. Callers
// should run matchPassiveOutcomes first so anything with real evidence is
// excluded before this is offered.
export async function getPendingOutcomeQuestion(workspaceId: string, timezone: string): Promise<PendingOutcomeQuestion | null> {
  const { db } = await import("@life-os/db")
  const today = localDayString(new Date(), timezone)
  const cutoff = addDays(today, -OUTCOME_WINDOW_DAYS)
  return db.adaptiveIntervention.findFirst({
    where: {
      status: { in: ["accepted", "edited_accepted"] },
      brief: { workspaceId, day: { lte: cutoff } },
      outcomes: { none: {} },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, recommendationText: true, category: true },
  })
}
