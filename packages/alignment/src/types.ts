// Alignment signals — the derived gap between the declared layer (closeness,
// active Plans) and the behavioral layer (Interactions, Events) of the Life OS
// graph. Never stored: every signal is computed fresh from the primitives on
// each call, so it can never drift out of sync with the underlying truth.

export type AlignmentSignalKind = "relationship_gap" | "stalled_plan" | "birthday"

export type AlignmentSignal = {
  kind: AlignmentSignalKind
  // >= 1.0 means the gap has crossed its threshold; higher is more overdue.
  severity: number
  subject: string
  detail: string
  personId?: string
  planId?: string
}
