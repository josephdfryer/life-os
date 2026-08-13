// @life-os/intelligence — derived interpretation over the Life OS graph, at
// two scopes: Theory of Person (one person) and the whole-life model (the
// entire workspace). Interpretation is app-layer synthesis, never a life
// primitive — the primitives are the source of truth; everything here is
// derived, versioned, and auditable.
//
// Renamed from @life-os/theory (Track A6) — @life-os/theory now re-exports
// this package so nothing that already imports it needs to change.

export { getTheorySourcesForPerson } from "./src/sources"
export { synthesizeTheoryOfPerson, regenerateTheory, TheoryError, THEORY_PROMPT_VERSION } from "./src/synthesize"
export { buildEvidenceText } from "./src/evidence"
export {
  createTheorySnapshot,
  getCurrentTheorySnapshot,
  listTheorySnapshots,
  getTheorySnapshotById,
} from "./src/snapshots"
export { THEORY_STATUS } from "./src/types"
export type {
  TheorySource,
  TheorySourceType,
  TheorySynthesis,
  TheorySourceBundle,
  TheoryStatus,
  LifeModelClaimKind,
  LifeModelEvidenceRef,
  LifeModelClaimInput,
  LifeModelSynthesis,
  LifeModelFeedbackAction,
  LifeModelFeedbackActor,
} from "./src/types"

export {
  synthesizeLifeModel,
  synthesizeLifeModelWithAi,
  regenerateLifeModel,
  validateLifeModelResponse,
  LifeModelError,
  LIFE_MODEL_PROMPT_VERSION,
} from "./src/life-model"
export { buildLifeModelEvidence } from "./src/life-model-evidence"
export { recordLifeModelClaimFeedback } from "./src/life-model-feedback"
export type { RecordLifeModelClaimFeedbackInput } from "./src/life-model-feedback"
export {
  createLifeModelSnapshot,
  getCurrentLifeModelSnapshot,
  listLifeModelSnapshots,
  getLifeModelSnapshotById,
} from "./src/life-model-snapshots"

export { computeCapacityBand } from "./src/adaptive-day-capacity"
export { findCandidateSlot, longestFreeWindowMinutes, CANDIDATE_START_HOUR, CANDIDATE_END_HOUR, BUFFER_MINUTES, MAX_DAYS_AHEAD } from "./src/adaptive-day-scheduling"
export { generateAdaptiveDayBrief, ADAPTIVE_DAY_RULES_VERSION } from "./src/adaptive-day-engine"
export {
  getOrGenerateTodaysBrief,
  refreshTodaysBrief,
  getAdaptiveDayBriefForDay,
  listAdaptiveDayBriefs,
  acceptAdaptiveIntervention,
  editAndAcceptAdaptiveIntervention,
  dismissAdaptiveIntervention,
  recordAdaptiveInterventionOutcome,
  AdaptiveDayError,
  type RecordAdaptiveOutcomeInput,
} from "./src/adaptive-day-brief"
export { zonedTimeToUtc, localDayString, localHour, addDays, roundUpToQuarterHour, formatSlot } from "./src/adaptive-day-time"
export type {
  CapacityBand,
  CapacityBandInput,
  CapacityBandResult,
  FixedBlock,
  CandidateSlot,
  InterventionCategory,
  InterventionRiskTier,
  ProposedCommand,
  Intervention,
  UnscheduledPlanInput,
  ReschedulablePlanInput,
  WorkoutInput,
  AdaptiveDayEngineInput,
  AdaptiveDayResult,
} from "./src/adaptive-day-types"
