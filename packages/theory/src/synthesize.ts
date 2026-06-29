import { getTheorySourcesForPerson } from "./sources"
import type { TheorySourceBundle, TheorySynthesis } from "./types"

const DEFAULT_WORKSPACE = process.env.THEORY_WORKSPACE_ID ?? "default-workspace"

// STUB synthesis. It gathers the real evidence base and emits a scaffold theory
// that honestly marks everything Unknown rather than inventing interpretation.
// AI generation is intentionally deferred (see app README). Swapping this for a
// model-backed synthesizer later does not change the createTheorySnapshot contract.
export async function synthesizeTheoryOfPerson(
  personId: string,
  workspaceId: string = DEFAULT_WORKSPACE
): Promise<TheorySynthesis> {
  const bundle = await getTheorySourcesForPerson(personId, workspaceId)
  const name = displayName(bundle)

  return {
    title: `Theory of ${name}`,
    summary:
      `Scaffold theory for ${name}, generated from ${bundle.sources.length} source record(s). ` +
      `No interpretation has been synthesized yet — every section is marked Unknown until ` +
      `evidence is reviewed. This is the current best model based on available evidence, not truth.`,
    markdownBody: scaffoldBody(name, bundle),
    confidence: 0.1,
    sources: bundle.sources,
  }
}

function displayName(bundle: TheorySourceBundle): string {
  if (!bundle.person) return "this person"
  const { first, last, nickname } = bundle.person
  return nickname || [first, last].filter(Boolean).join(" ") || "this person"
}

function scaffoldBody(name: string, bundle: TheorySourceBundle): string {
  const counts =
    `Notes: ${bundle.noteIds.length} · Events: ${bundle.eventIds.length} · ` +
    `Interactions: ${bundle.interactionIds.length} · States: ${bundle.stateIds.length} · ` +
    `Plans: ${bundle.planIds.length}`

  return `# Theory of ${name}

## Current Best Model

_Unknown — not yet synthesized._

## Confidence

Overall confidence: 0.1 — scaffold only. This model is not yet mature enough to guide predictions.

## Observed

_Unknown — evidence not yet reviewed._

## Inferred

_Unknown._

## Hypotheses

_Unknown._

## Principles

_Unknown._

## Behavioral Patterns

_Unknown._

## Contradictions / Tensions

_Unknown._

## Unknowns

- A synthesized interpretation does not exist yet for ${name}.
- Evidence base available: ${counts}.

## Open Questions

- What does the available evidence actually suggest about ${name}?
- What additional records are needed before a confident model can form?

## Evidence Trail

Auto-collected from the Life OS graph: ${bundle.sources.length} source record(s).
`
}

// Convenience: synthesize and persist in one call. Returns the new snapshot id.
export async function regenerateTheory(
  personId: string,
  workspaceId: string = DEFAULT_WORKSPACE
): Promise<string> {
  // Imported lazily to keep the synthesis/persistence concerns separable.
  const { createTheorySnapshot } = await import("./snapshots")
  const synthesis = await synthesizeTheoryOfPerson(personId, workspaceId)
  return createTheorySnapshot(personId, synthesis, workspaceId)
}
