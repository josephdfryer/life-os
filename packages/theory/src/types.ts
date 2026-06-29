// Theory of Person — derived interpretation types.
// These describe the *output* of synthesis. The canonical stored truth stays in
// the Life OS primitives (Person · Note · Event · Plan · State · Interaction).

export type TheorySourceType =
  | "note"
  | "event"
  | "interaction"
  | "state"
  | "plan"
  | "person"

export type TheorySource = {
  sourceType: TheorySourceType
  sourceId: string
  contribution?: string
  weight?: number
}

// The shape produced by synthesizeTheoryOfPerson and consumed by
// createTheorySnapshot. markdownBody holds the human-readable theory; structured
// JSON fields may be added later without breaking this contract.
export type TheorySynthesis = {
  title: string
  summary: string
  markdownBody: string
  confidence?: number
  sources: TheorySource[]
}

// Everything gathered from the stored graph for a single person, before any
// interpretation is applied. This is the raw material synthesis reasons over.
export type TheorySourceBundle = {
  personId: string
  workspaceId: string
  person: {
    id: string
    first: string
    last: string
    nickname: string | null
    headline: string | null
  } | null
  noteIds: string[]
  eventIds: string[]
  interactionIds: string[]
  stateIds: string[]
  planIds: string[]
  // Flattened, de-duplicated provenance trail for TheorySnapshotSource rows.
  sources: TheorySource[]
}

export const THEORY_STATUS = {
  current: "current",
  archived: "archived",
  draft: "draft",
  rejected: "rejected",
} as const

export type TheoryStatus = (typeof THEORY_STATUS)[keyof typeof THEORY_STATUS]
