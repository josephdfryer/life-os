// @life-os/intelligence — derived interpretation over the Life OS graph, at
// two scopes: Theory of Person (one person) and the whole-life model (the
// entire workspace). Interpretation is app-layer synthesis, never a life
// primitive — the primitives are the source of truth; everything here is
// derived, versioned, and auditable.
//
// Renamed from @life-os/theory (Track A6) — @life-os/theory now re-exports
// this package so nothing that already imports it needs to change.

export { getTheorySourcesForPerson } from "./src/sources"
export { synthesizeTheoryOfPerson, regenerateTheory } from "./src/synthesize"
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
} from "./src/types"

export { synthesizeLifeModel, regenerateLifeModel } from "./src/life-model"
export {
  createLifeModelSnapshot,
  getCurrentLifeModelSnapshot,
  listLifeModelSnapshots,
  getLifeModelSnapshotById,
} from "./src/life-model-snapshots"
