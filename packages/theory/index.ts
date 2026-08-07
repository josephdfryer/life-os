// Renamed to @life-os/intelligence (Track A6) — this package is a thin
// re-export so apps/theory-of's existing imports keep working unchanged.
// New code should import @life-os/intelligence directly.

export {
  getTheorySourcesForPerson,
  synthesizeTheoryOfPerson,
  regenerateTheory,
  createTheorySnapshot,
  getCurrentTheorySnapshot,
  listTheorySnapshots,
  getTheorySnapshotById,
  THEORY_STATUS,
} from "@life-os/intelligence"
export type {
  TheorySource,
  TheorySourceType,
  TheorySynthesis,
  TheorySourceBundle,
  TheoryStatus,
} from "@life-os/intelligence"
