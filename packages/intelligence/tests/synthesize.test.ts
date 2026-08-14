import { test } from "node:test"
import assert from "node:assert/strict"
import { validateSynthesisResponse, formatMarkdown, type SynthesisResponse } from "../src/synthesize"
import type { TheorySourceBundle } from "../src/types"

const bundle: TheorySourceBundle = {
  personId: "person-1",
  workspaceId: "ws-1",
  person: { id: "person-1", first: "Ada", last: "Lovelace", nickname: null, headline: null },
  noteIds: ["n1"],
  eventIds: ["e1", "e2"],
  interactionIds: ["i1"],
  stateIds: [],
  planIds: ["p1"],
  evidenceClaimIds: [],
  sources: [
    { sourceType: "note", sourceId: "n1" },
    { sourceType: "event", sourceId: "e1" },
    { sourceType: "event", sourceId: "e2" },
    { sourceType: "interaction", sourceId: "i1" },
    { sourceType: "plan", sourceId: "p1" },
  ],
}

test("validateSynthesisResponse degrades a malformed response instead of throwing", () => {
  const result = validateSynthesisResponse({ summary: 42, confidence: "high", observed: "not an array", inferred: null })
  assert.equal(result.summary, "No summary returned.")
  assert.equal(result.confidence, 0)
  assert.deepEqual(result.observed, [])
  assert.deepEqual(result.inferred, [])
})

test("validateSynthesisResponse clamps confidence to [0, 1]", () => {
  assert.equal(validateSynthesisResponse({ confidence: 5 }).confidence, 1)
  assert.equal(validateSynthesisResponse({ confidence: -3 }).confidence, 0)
})

test("validateSynthesisResponse filters non-string and empty array entries", () => {
  const result = validateSynthesisResponse({ observed: ["real claim", "", "  ", 42, null, "another claim"] })
  assert.deepEqual(result.observed, ["real claim", "another claim"])
})

test("validateSynthesisResponse passes well-formed input through unchanged", () => {
  const input = {
    summary: "Ada is a frequent, engaged collaborator.",
    confidence: 0.72,
    observed: ["Messaged 3 times this week"],
    inferred: ["Tends to reach out on weekday evenings"],
    hypotheses: ["May prefer async communication"],
    principles: [],
    behavioralPatterns: [],
    contradictions: [],
    unknowns: ["No data on in-person meetings"],
    openQuestions: ["Has an in-person meeting ever happened?"],
  }
  const result = validateSynthesisResponse(input)
  assert.deepEqual(result, input)
})

const sampleResponse: SynthesisResponse = {
  summary: "Ada is a frequent, engaged collaborator.",
  confidence: 0.72,
  observed: ["Messaged 3 times this week"],
  inferred: [],
  hypotheses: [],
  principles: [],
  behavioralPatterns: [],
  contradictions: [],
  unknowns: [],
  openQuestions: ["Has an in-person meeting ever happened?"],
}

test("formatMarkdown produces the exact section headers the sidebar parser depends on", () => {
  const markdown = formatMarkdown("Ada Lovelace", sampleResponse, bundle)
  for (const header of [
    "## Current Best Model", "## Confidence", "## Observed", "## Inferred", "## Hypotheses",
    "## Principles", "## Behavioral Patterns", "## Contradictions / Tensions", "## Unknowns",
    "## Open Questions", "## Evidence Trail",
  ]) {
    assert.ok(markdown.includes(header), `missing header: ${header}`)
  }
})

test("formatMarkdown's Open Questions section is parseable by extractSectionItems's exact rule (## header, then '- ' bullets)", () => {
  const markdown = formatMarkdown("Ada Lovelace", sampleResponse, bundle)
  const items = extractSectionItems(markdown, "Open Questions")
  assert.deepEqual(items, ["Has an in-person meeting ever happened?"])
})

test("formatMarkdown falls back to an honest Unknown line for an empty section, not a bare empty header", () => {
  const empty: SynthesisResponse = { ...sampleResponse, inferred: [] }
  const markdown = formatMarkdown("Ada Lovelace", empty, bundle)
  assert.ok(markdown.includes("_Unknown — evidence does not support this section yet._"))
})

test("formatMarkdown includes the confidence value and source count", () => {
  const markdown = formatMarkdown("Ada Lovelace", sampleResponse, bundle)
  assert.ok(markdown.includes("0.72"))
  assert.ok(markdown.includes(`${bundle.sources.length} source record(s)`))
})

// Copy of apps/theory-of/lib/markdown.ts's extractSectionItems — that file
// isn't importable from a package (app-internal), so this pins the exact
// same parsing rule here to verify compatibility without a cross-boundary
// import.
function extractSectionItems(markdown: string, section: string): string[] {
  const lines = markdown.split("\n")
  const items: string[] = []
  let inSection = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith("## ")) {
      inSection = line.slice(3).trim().toLowerCase() === section.toLowerCase()
      continue
    }
    if (inSection && line.startsWith("- ")) items.push(line.slice(2).trim())
  }
  return items
}
