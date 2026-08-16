// Thin re-export of @life-os/intelligence. New code should import
// @life-os/intelligence directly.

export {
  getTheorySourcesForPerson,
  synthesizeTheoryOfPerson,
  regenerateTheory,
  createTheorySnapshot,
  getCurrentTheorySnapshot,
  listTheorySnapshots,
  getTheorySnapshotById,
  THEORY_STATUS,
  TheoryError,
} from "@life-os/intelligence"
export type {
  TheorySource,
  TheorySourceType,
  TheorySynthesis,
  TheorySourceBundle,
  TheoryStatus,
} from "@life-os/intelligence"
