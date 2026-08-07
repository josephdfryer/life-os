import { getAlignmentSignals } from "@life-os/alignment"
import type { LifeModelClaimKind, LifeModelClaimInput, LifeModelSynthesis } from "./types"

const DEFAULT_WORKSPACE = process.env.THEORY_WORKSPACE_ID ?? "default-workspace"

// Whole-life synthesis — "what's true across the whole graph right now",
// versioned the same way synthesizeTheoryOfPerson/createTheorySnapshot
// already prove out for a single person (src/synthesize.ts, src/snapshots.ts),
// just workspace-scoped instead of person-scoped.
//
// Honest about what's real today: tension claims are genuine and
// deterministic — packages/alignment already computes the declared-vs-
// observed gap from stored primitives, no AI involved, so there is nothing
// to stub there. observed/inferred/declared claims DO need an AI reading of
// the evidence base, which does not exist yet (same as Theory of Person's
// synthesizeTheoryOfPerson) — those sections are marked Unknown rather than
// invented, so this snapshot never claims more certainty than what's
// actually behind it.

export async function synthesizeLifeModel(workspaceId: string = DEFAULT_WORKSPACE): Promise<LifeModelSynthesis> {
  const signals = await getAlignmentSignals(workspaceId)

  const tensionClaims: LifeModelClaimInput[] = signals.map(signal => ({
    kind: "tension",
    statement: signal.detail,
    // Deterministic, not inferred — alignment signals are computed directly
    // from stored primitives, so this is as certain as the data itself.
    confidence: 1,
    subjectType: signal.personId ? "Person" : signal.planId ? "Plan" : null,
    subjectId: signal.personId ?? signal.planId ?? null,
    evidence: [{ sourceType: "alignment_signal", sourceId: signal.kind, detail: { severity: signal.severity, subject: signal.subject } }],
  }))

  const unknownClaims: LifeModelClaimInput[] = (["observed", "inferred", "declared"] as LifeModelClaimKind[]).map(kind => ({
    kind,
    statement: `Unknown — no ${kind} synthesis has run yet. AI-backed reading of the evidence base is not implemented.`,
    confidence: null,
    subjectType: null,
    subjectId: null,
    evidence: [],
  }))

  const claims = [...tensionClaims, ...unknownClaims]

  return {
    summary: tensionClaims.length
      ? `${tensionClaims.length} tension(s) between declared and observed. Observed/inferred/declared synthesis not yet implemented.`
      : "No tensions detected. Observed/inferred/declared synthesis not yet implemented.",
    claims,
  }
}

export async function regenerateLifeModel(workspaceId: string = DEFAULT_WORKSPACE): Promise<string> {
  const { createLifeModelSnapshot } = await import("./life-model-snapshots")
  const synthesis = await synthesizeLifeModel(workspaceId)
  return createLifeModelSnapshot(workspaceId, synthesis)
}
