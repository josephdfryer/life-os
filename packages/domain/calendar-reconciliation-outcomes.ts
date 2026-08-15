import { reconcileCalendarPlan } from "./calendar-reconciliation"
import { syncReviewItemStatus } from "./review"

// Passive reconciliation. See docs/INBOX_TRIAGE_ANALYSIS.md.
//
// Every synced calendar Plan without a linked Event became a review item asking
// "did this happen?". At ~10 a day that queue cannot be cleared by hand, and the
// question is close to unanswerable once an event is a week old.
//
// This is the same technique packages/intelligence/src/adaptive-day-outcomes.ts
// already uses for interventions: look for positive evidence that the thing
// happened, resolve it without asking, and retire anything still unresolved after
// a fallback window so it stops being offered forever.
//
// Two rules carried over from that implementation, both deliberate:
//   - Nothing is evaluated until its day has passed. There is no "did it happen"
//     answer on the day itself.
//   - Absence of evidence is never a negative verdict. An unresolved Plan is
//     retired as "skip" (unknown), never as "cancelled".

// "system", not "user": nobody decided these, so they must not read as though
// Joseph did when the audit trail is reviewed later.
const PASSIVE_ACTOR = { type: "system" as const, label: "Passive calendar reconciliation" }

const OUTCOME_WINDOW_DAYS = 1
const UNKNOWN_FALLBACK_DAYS = 10

export type PassiveReconciliation = {
  planId: string
  outcome: "happened" | "skipped"
  reason: string
}

type Evidence = { reason: string } | null

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/**
 * Resolve what can be resolved without asking, and retire what has gone stale.
 * Returns what it did, so a caller can report "cleared 47 of 59".
 */
export async function matchCalendarOutcomes(
  workspaceId = "default-workspace",
): Promise<PassiveReconciliation[]> {
  const { db } = await import("@life-os/db")

  const candidates = await db.plan.findMany({
    where: {
      workspaceId,
      externalSource: "google-calendar",
      fulfilledBy: null,
      OR: [{ reconciliationStatus: null }, { reconciliationStatus: "pending" }],
      scheduledStart: { lte: daysAgo(OUTCOME_WINDOW_DAYS) },
    },
    select: {
      id: true, scheduledStart: true, scheduledEnd: true, status: true,
      expectedPeople: { select: { personId: true } },
    },
    take: 500,
  })

  const results: PassiveReconciliation[] = []
  for (const plan of candidates) {
    if (!plan.scheduledStart) continue
    const evidence = await positiveEvidence(db, workspaceId, plan)
    if (evidence) {
      await reconcileCalendarPlan({ workspaceId, planId: plan.id, action: "happened" })
      // Close the queue entry too, or the Plan is resolved while the question
      // keeps being asked — the failure mode that let 59 items accumulate.
      await syncReviewItemStatus({
        workspaceId, source: "calendar_reconciliation", sourceId: plan.id,
        status: "accepted", resultType: "Plan", resultId: plan.id,
        actor: PASSIVE_ACTOR,
      })
      results.push({ planId: plan.id, outcome: "happened", reason: evidence.reason })
      continue
    }
    if (plan.scheduledStart <= daysAgo(UNKNOWN_FALLBACK_DAYS)) {
      // Retired, not denied. "skip" leaves the Plan's own status untouched and
      // simply stops asking — an event this old is a guess, not a decision.
      await reconcileCalendarPlan({ workspaceId, planId: plan.id, action: "skip" })
      await syncReviewItemStatus({
        workspaceId, source: "calendar_reconciliation", sourceId: plan.id,
        status: "superseded", resultType: "Plan", resultId: plan.id,
        actor: PASSIVE_ACTOR,
      })
      results.push({ planId: plan.id, outcome: "skipped", reason: `unresolved after ${UNKNOWN_FALLBACK_DAYS} days` })
    }
  }
  return results
}

/**
 * Did something corroborate that this slot was real? Any one signal is enough —
 * this only ever produces a positive verdict, so a false negative just means the
 * question still gets asked.
 */
async function positiveEvidence(
  db: Awaited<typeof import("@life-os/db")>["db"],
  workspaceId: string,
  plan: { id: string; scheduledStart: Date | null; scheduledEnd: Date | null; expectedPeople: Array<{ personId: string }> },
): Promise<Evidence> {
  if (!plan.scheduledStart) return null
  // Widen slightly: things start late and receipts land after the fact.
  const from = new Date(plan.scheduledStart.getTime() - 60 * 60 * 1000)
  const to = new Date((plan.scheduledEnd ?? plan.scheduledStart).getTime() + 3 * 60 * 60 * 1000)

  const spend = await db.interaction.findFirst({
    where: { workspaceId, type: "financial", timestamp: { gte: from, lte: to } },
    select: { id: true },
  })
  if (spend) return { reason: "money was spent during this window" }

  const expectedIds = plan.expectedPeople.map(p => p.personId)
  if (expectedIds.length) {
    const contact = await db.interaction.findFirst({
      where: { workspaceId, personId: { in: expectedIds }, timestamp: { gte: from, lte: to } },
      select: { id: true },
    })
    if (contact) return { reason: "an interaction with an expected attendee falls in this window" }
  }

  const anyContact = await db.interaction.findFirst({
    where: { workspaceId, type: { not: "financial" }, timestamp: { gte: from, lte: to } },
    select: { id: true },
  })
  if (anyContact) return { reason: "other recorded contact falls in this window" }

  const photo = await db.note.findFirst({
    where: { workspaceId, type: "import", timestamp: { gte: from, lte: to } },
    select: { id: true },
  })
  if (photo) return { reason: "captured media falls in this window" }

  return null
}
