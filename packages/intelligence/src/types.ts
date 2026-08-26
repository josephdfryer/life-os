// Theory of Person — derived interpretation types.
// These describe the *output* of synthesis. The canonical stored truth stays in
// the LifeOS primitives (Person · Note · Event · Plan · State · Interaction).

export type TheorySourceType =
  | "note"
  | "event"
  | "interaction"
  | "state"
  | "plan"
  | "person"
  | "evidence_claim"

export type TheorySource = {
  sourceType: TheorySourceType
  sourceId: string
  contribution?: string
  weight?: number
  evidenceClaimId?: string
  evidenceClassification?: "explicit" | "inferred"
  evidenceStatus?: string
  citation?: { fileId: string; filename: string; chunkId: string; locator: string; exactQuote: string }
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
  evidenceClaimIds: string[]
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

// Whole-life model — derived interpretation across the entire graph, not one
// person. Same status vocabulary as Theory of Person; reusing THEORY_STATUS
// rather than declaring a second identical const.

export type LifeModelClaimKind = "observed" | "inferred" | "declared" | "tension"

export type LifeModelEvidenceRef = {
  sourceType: string
  sourceId: string
  detail?: Record<string, unknown>
}

export type LifeModelClaimInput = {
  kind: LifeModelClaimKind
  statement: string
  confidence: number | null
  subjectType: string | null
  subjectId: string | null
  windowStart?: Date | null
  windowEnd?: Date | null
  evidence: LifeModelEvidenceRef[]
}

// The shape produced by synthesizeLifeModel and consumed by
// createLifeModelSnapshot.
export type LifeModelSynthesis = {
  summary: string
  claims: LifeModelClaimInput[]
  modelId?: string
  promptVersion?: string
  analysisRunId?: string
}

export type LifeModelFeedbackAction = "dismiss" | "correct"

export type LifeModelFeedbackActor = {
  type: "user" | "api_key" | "system"
  id?: string | null
  label?: string | null
}
