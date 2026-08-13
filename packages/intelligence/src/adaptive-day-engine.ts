import type { AdaptiveDayEngineInput, AdaptiveDayResult, Intervention } from "./adaptive-day-types"
import { computeCapacityBand } from "./adaptive-day-capacity"
import { findCandidateSlot } from "./adaptive-day-scheduling"
import { formatSlot } from "./adaptive-day-time"

// Bump this whenever the rules below change in a way that should make an
// already-generated brief stale (get-or-generate treats a rulesVersion
// mismatch as "regenerate"). See AdaptiveDayBrief.rulesVersion.
export const ADAPTIVE_DAY_RULES_VERSION = "v1"

const MAX_INTERVENTIONS = 3

// Deterministic, versioned, pure — no I/O. The caller (packages/domain) is
// responsible for resolving all inputs (pre-filtering eligible Plans,
// fetching the latest States, reading Level Up readiness) and for actually
// persisting the result. See docs/ADAPTIVE_DAY_PLAN.md §2.
export function generateAdaptiveDayBrief(input: AdaptiveDayEngineInput): AdaptiveDayResult {
  const { band, reasonCodes: capacityReasonCodes } = computeCapacityBand(input.capacity)

  const missingSignals: string[] = []
  if (input.capacity.levelUpBand == null) missingSignals.push("levelUpReadiness")
  if (input.capacity.energy == null) missingSignals.push("energyCheckIn")
  if (input.capacity.stress == null) missingSignals.push("stressCheckIn")

  const interventions: Intervention[] = []

  // Prefer one schedule proposal: reschedule something off a constrained day
  // if there's a movable candidate, otherwise offer to place an unscheduled
  // Plan — never both, never neither if either was available.
  if (band !== "full" && input.reschedulable.length > 0) {
    const plan = input.reschedulable[0]
    const slot = findCandidateSlot(plan.estimatedMinutes, input.fixedBlocksByDay, input.day, input.timezone, input.now)
    if (slot) {
      interventions.push({
        rank: 0,
        category: "plan_reschedule",
        recommendationText: `Move "${plan.text}" to ${formatSlot(slot, input.timezone)} — today looks tight.`,
        reasonCodes: [...capacityReasonCodes, "reschedule_candidate"],
        evidence: {
          planId: plan.id,
          originalStart: plan.scheduledStart.toISOString(),
          proposedStart: slot.start.toISOString(),
          proposedEnd: slot.end.toISOString(),
          capacityBand: band,
        },
        proposedCommand: {
          command: "plan.reschedule",
          input: { planId: plan.id, scheduledStart: slot.start.toISOString(), scheduledEnd: slot.end.toISOString() },
        },
        riskTier: "confirm",
      })
    }
  } else if (input.unscheduledPlans.length > 0) {
    const plan = input.unscheduledPlans[0]
    const slot = findCandidateSlot(plan.estimatedMinutes, input.fixedBlocksByDay, input.day, input.timezone, input.now)
    if (slot) {
      interventions.push({
        rank: 0,
        category: "plan_schedule",
        recommendationText: `Schedule "${plan.text}" for ${formatSlot(slot, input.timezone)}.`,
        reasonCodes: ["unscheduled_plan", `capacity_${band}`],
        evidence: { planId: plan.id, proposedStart: slot.start.toISOString(), proposedEnd: slot.end.toISOString(), capacityBand: band },
        proposedCommand: {
          command: "plan.schedule",
          input: { planId: plan.id, scheduledStart: slot.start.toISOString(), scheduledEnd: slot.end.toISOString() },
        },
        riskTier: "confirm",
      })
    }
  }

  // One workout proposal — never an increase because capacity is high; a
  // full-capacity day with a scheduled workout gets no intervention at all.
  if (input.workout?.scheduledToday) {
    if (band === "recover") {
      interventions.push({
        rank: 0,
        category: "workout_adjustment",
        recommendationText: "Today's capacity suggests a lighter session — consider an easier version of today's workout.",
        reasonCodes: [...capacityReasonCodes, "workout_scheduled"],
        evidence: { capacityBand: band, levelUpBand: input.capacity.levelUpBand },
        proposedCommand: { command: "level_up.record_recommendation", input: { recommendation: "lighten", capacityBand: band } },
        riskTier: "confirm",
      })
    } else if (band === "adjust") {
      interventions.push({
        rank: 0,
        category: "workout_adjustment",
        recommendationText: "Capacity is constrained today — today's planned session is still reasonable, but keep an eye on how it feels.",
        reasonCodes: [...capacityReasonCodes, "workout_scheduled"],
        evidence: { capacityBand: band, levelUpBand: input.capacity.levelUpBand },
        proposedCommand: null,
        riskTier: "observe",
      })
    }
  }

  // Capacity guidance is the fallback, not the default — only surfaced when
  // nothing more concrete could be proposed, so it's never filler stacked on
  // top of a real recommendation.
  if (interventions.length === 0 && band !== "full") {
    interventions.push({
      rank: 0,
      category: "capacity_guidance",
      recommendationText: band === "recover"
        ? "Today looks like a recovery day — consider protecting time rather than adding to it."
        : "Today is constrained — consider deferring anything that isn't essential.",
      reasonCodes: capacityReasonCodes,
      evidence: { capacityBand: band },
      proposedCommand: null,
      riskTier: "observe",
    })
  }

  const ranked = interventions.slice(0, MAX_INTERVENTIONS).map((intervention, rank) => ({ ...intervention, rank }))

  return {
    rulesVersion: ADAPTIVE_DAY_RULES_VERSION,
    capacityBand: band,
    capacityReasonCodes,
    interventions: ranked,
    missingSignals,
  }
}
