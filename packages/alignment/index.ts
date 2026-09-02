// @life-os/alignment — the derived gap between what's declared (closeness,
// active Plans) and what's actually happened (Interactions). App-layer
// synthesis, never a life primitive; nothing here is ever persisted.

export { relationshipGapScore, daysSince, isUnreviewedBulkContact } from "./src/scoring"
export { getRelationshipGaps } from "./src/relationships"
export { getStalledPlanSignals } from "./src/plans"
export { getBirthdaySignals } from "./src/birthday-signals"
export { getAlignmentSignals } from "./src/signals"
// Pure birthday parsing/date-math also available client-safe via
// @life-os/alignment/pure — import from there in "use client" components.
export {
  normalizeBirthday,
  birthdayMonthDay,
  formatBirthday,
  daysUntilBirthday,
  isBirthdayToday,
  isBirthdayThisWeek,
  birthdayTurningAge,
} from "./src/birthday"
export type { AlignmentSignal, AlignmentSignalKind } from "./src/types"
