// Shared types for the Adaptive Day / Capacity Brief deterministic engine.
// See docs/ADAPTIVE_DAY_PLAN.md. Everything here is pure data — no I/O, no
// Prisma types — so the engine in adaptive-day-engine.ts stays a plain
// function callers can unit test without a database.

// Matches LevelUpReadinessSnapshot.band exactly (packages/level-up) so
// Adaptive Day and Level Up never disagree about what a band means.
export type CapacityBand = "full" | "adjust" | "recover"

export type CapacityBandInput = {
  // null = Level Up readiness isn't connected yet (synthetic) — a missing
  // signal, never treated as negative.
  levelUpBand: CapacityBand | null
  fixedCommitmentMinutes: number
  // Longest uninterrupted window among today's fixed blocks, in minutes.
  // null = unknown/no fixed blocks today.
  longestFreeWindowMinutes: number | null
  fixedBlockCount: number
  // 1-5 self-ratings from the latest check-in. null = missing.
  energy: number | null
  stress: number | null
}

export type CapacityBandResult = {
  band: CapacityBand
  reasonCodes: string[]
}

export type FixedBlock = { start: Date; end: Date }

export type CandidateSlot = { start: Date; end: Date; day: string }

export type InterventionCategory =
  | "plan_schedule"
  | "plan_reschedule"
  | "workout_adjustment"
  | "capacity_guidance"

export type InterventionRiskTier = "observe" | "safe_auto" | "review" | "confirm"

export type ProposedCommand = { command: string; input: Record<string, unknown> }

export type Intervention = {
  rank: number
  category: InterventionCategory
  recommendationText: string
  reasonCodes: string[]
  evidence: Record<string, unknown>
  proposedCommand: ProposedCommand | null
  riskTier: InterventionRiskTier
}

export type UnscheduledPlanInput = {
  id: string
  text: string
  estimatedMinutes: number
}

export type ReschedulablePlanInput = {
  id: string
  text: string
  estimatedMinutes: number
  scheduledStart: Date
  scheduledEnd: Date
}

export type WorkoutInput = {
  scheduledToday: boolean
  levelUpBand: CapacityBand | null
}

export type AdaptiveDayEngineInput = {
  day: string
  timezone: string
  now: Date
  capacity: CapacityBandInput
  // Calendar-backed fixed commitments/confirmed Events, keyed by local day
  // string, covering `day` through `day` + 3 (the reschedule search window).
  fixedBlocksByDay: Record<string, FixedBlock[]>
  // Eligible flexible Plans with no scheduled slot yet — caller has already
  // excluded calendar-imported/completed/confirmed Plans.
  unscheduledPlans: UnscheduledPlanInput[]
  // Eligible flexible Plans that already have a slot today but could move —
  // pre-sorted by the caller (priority/dueOn), most-movable first.
  reschedulable: ReschedulablePlanInput[]
  workout: WorkoutInput | null
}

export type AdaptiveDayResult = {
  rulesVersion: string
  capacityBand: CapacityBand
  capacityReasonCodes: string[]
  interventions: Intervention[]
  missingSignals: string[]
}
