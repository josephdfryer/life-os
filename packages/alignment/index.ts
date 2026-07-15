// @life-os/alignment — the derived gap between what's declared (closeness,
// active Plans) and what's actually happened (Interactions). App-layer
// synthesis, never a life primitive; nothing here is ever persisted.

export { relationshipGapScore, daysSince } from "./src/scoring"
export { getRelationshipGaps } from "./src/relationships"
export { getStalledPlanSignals } from "./src/plans"
export { getAlignmentSignals } from "./src/signals"
export type { AlignmentSignal, AlignmentSignalKind } from "./src/types"
