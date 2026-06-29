// @life-os/theory — derived "Theory of Person" synthesis over the Life OS graph.
// Theory is app-layer interpretation, never a life primitive. Person is the
// source entity; the theory is the derived, versioned, auditable interpretation.

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
} from "./src/types"
