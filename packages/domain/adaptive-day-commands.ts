// Registers the commands Adaptive Day's dual-written ReviewItem rows name
// in their proposedCommand — see docs/ADAPTIVE_DAY_PLAN.md §3. Importing
// this module (transitively, via packages/domain/index.ts) is what makes
// these commands resolvable through resolveReviewItem; it has no exports of
// its own, only registration side effects, same shape as
// calendar-reconciliation.ts's registerReviewCommand call.

import { registerReviewCommand, type ReviewItemActorContext, type ReviewItemCommandResult } from "./review"
import { reschedulePlan } from "./plans"
import { publishGraphEvent } from "./events"
import { writeAuditLog } from "./audit"

// plan_schedule and plan_reschedule both resolve to the same write —
// reschedulePlan doesn't care whether the Plan already had a slot, only
// that it isn't calendar-imported/confirmed/completed.
async function scheduleOrReschedule(input: Record<string, unknown>, ctx: ReviewItemActorContext): Promise<ReviewItemCommandResult> {
  const plan = await reschedulePlan(
    input.planId as string,
    { scheduledStart: input.scheduledStart, scheduledEnd: input.scheduledEnd },
    ctx.workspaceId,
    ctx.actor,
  )
  return { resultType: "Plan", resultId: plan.id }
}

registerReviewCommand("plan.schedule", scheduleOrReschedule)
registerReviewCommand("plan.reschedule", scheduleOrReschedule)

// Level Up has no recommendation-acceptance table yet — readiness is still
// synthetic (docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md). Accepting this records
// the acknowledgment against the intervention itself; handing the user into
// the actual workout flow is a UI-layer navigation, not a domain write.
registerReviewCommand("level_up.record_recommendation", async (input, ctx): Promise<ReviewItemCommandResult> => {
  const { db } = await import("@life-os/db")
  const interventionId = input.interventionId as string
  await db.$transaction(async tx => {
    await publishGraphEvent(tx, {
      workspaceId: ctx.workspaceId,
      subjectType: "AdaptiveIntervention",
      subjectId: interventionId,
      eventType: "adaptive_intervention.workout_recommendation_accepted",
      actor: ctx.actor,
      idempotencyKey: `adaptive-workout-ack:${interventionId}`,
      payload: { recommendation: input.recommendation ?? null, capacityBand: input.capacityBand ?? null },
    })
  })
  await writeAuditLog({
    actor: ctx.actor,
    action: "adaptive_intervention.workout_recommendation_accepted",
    targetType: "adaptiveIntervention",
    targetId: interventionId,
  })
  return { resultType: "AdaptiveIntervention", resultId: interventionId }
})
