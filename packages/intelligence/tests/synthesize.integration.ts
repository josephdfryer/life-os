import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { encrypt } from "@life-os/db/crypto"
import { synthesizeTheoryOfPerson, regenerateTheory, TheoryError, THEORY_PROMPT_VERSION } from "../src/synthesize"
import { getCurrentTheorySnapshot } from "../src/snapshots"

// Run against a real (throwaway, migrated) database with a fixture fetch
// injected — no real network call, no real API key, no cost. Not part of
// `tsx --test tests/*.test.ts`; run manually, same convention as every
// other package's *.integration.ts file this cycle.

const workspaceId = "theory-synthesize-integration-workspace"

const FIXTURE_RESPONSE_BODY = {
  choices: [{
    message: {
      content: JSON.stringify({
        summary: "Ada is a frequent, engaged collaborator based on recent messages.",
        confidence: 0.68,
        observed: ["Exchanged messages twice in the last week"],
        inferred: ["Tends to respond same-day"],
        hypotheses: [],
        principles: [],
        behavioralPatterns: [],
        contradictions: [],
        unknowns: ["No in-person meeting on record"],
        openQuestions: ["Has an in-person meeting ever happened?"],
      }),
    },
  }],
  usage: { prompt_tokens: 512, completion_tokens: 128, cost: 0.0031 },
}

function fixtureFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify(FIXTURE_RESPONSE_BODY), { status: 200 })) as unknown as typeof fetch
}

function failingFetch(status: number, message: string): typeof fetch {
  return (async () => new Response(JSON.stringify({ error: { message } }), { status })) as unknown as typeof fetch
}

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Theory synthesize integration", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Ada", last: "Lovelace" } })
  await db.interaction.create({
    data: { workspaceId, personId: person.id, type: "message", timestamp: new Date(), summary: "Quick catch-up about the project" },
  })
  await db.note.create({
    data: { workspaceId, type: "observation", timestamp: new Date(), content: "Ada mentioned she's been swamped with the new job." },
  })

  const rawKey = "sk-fixture-key"
  const credential = await db.aiProviderCredential.create({
    data: { workspaceId, provider: "vercel-ai-gateway", apiKeyEncrypted: encrypt(rawKey), modelId: "openai/gpt-5.4-mini", status: "active" },
  })

  // ── happy path: synthesizeTheoryOfPerson with an injected fixture fetch ──
  const synthesis = await synthesizeTheoryOfPerson(person.id, workspaceId, fixtureFetch())
  assert.equal(synthesis.title, "Theory of Ada Lovelace")
  assert.equal(synthesis.confidence, 0.68)
  assert.ok(synthesis.markdownBody.includes("Exchanged messages twice in the last week"))
  assert.ok(synthesis.markdownBody.includes("## Open Questions"))

  const run = await db.theoryAnalysisRun.findFirstOrThrow({ where: { workspaceId, subjectPersonId: person.id } })
  assert.equal(run.status, "completed")
  assert.equal(run.promptVersion, THEORY_PROMPT_VERSION)
  assert.equal(run.inputTokens, 512)
  assert.equal(run.outputTokens, 128)
  assert.equal(run.estimatedCost, 0.0031)
  assert.equal(run.credentialId, credential.id)

  const credentialAfter = await db.aiProviderCredential.findUniqueOrThrow({ where: { id: credential.id } })
  assert.ok(credentialAfter.lastUsedAt, "a successful run must update the credential's lastUsedAt")

  // ── regenerateTheory persists a real TheorySnapshot — monkey-patch global fetch since regenerateTheory doesn't accept an injected one ──
  const originalFetch = globalThis.fetch
  globalThis.fetch = fixtureFetch()
  try {
    const snapshotId = await regenerateTheory(person.id, workspaceId)
    const current = await getCurrentTheorySnapshot(person.id)
    assert.equal(current?.id, snapshotId)
    assert.equal(current?.confidence, 0.68)
    assert.ok(current?.markdownBody.includes("## Current Best Model"))
  } finally {
    globalThis.fetch = originalFetch
  }

  // ── concurrency guard: a running row for this person must block a new synthesis ──
  const inFlight = await db.theoryAnalysisRun.create({
    data: { workspaceId, subjectPersonId: person.id, provider: "vercel-ai-gateway", modelId: "x", status: "running", promptVersion: THEORY_PROMPT_VERSION },
  })
  await assert.rejects(
    () => synthesizeTheoryOfPerson(person.id, workspaceId, fixtureFetch()),
    (error: unknown) => error instanceof TheoryError && error.code === "conflict",
  )
  await db.theoryAnalysisRun.update({ where: { id: inFlight.id }, data: { status: "completed" } }) // clear it so it doesn't leak into later assertions

  // ── missing credential: a workspace with no AiProviderCredential ──
  const noCredWorkspace = "theory-synthesize-no-credential-workspace"
  await db.workspace.create({ data: { id: noCredWorkspace, name: "No credential", slug: noCredWorkspace } })
  const strangePerson = await db.person.create({ data: { workspaceId: noCredWorkspace, first: "No", last: "Credential" } })
  await assert.rejects(
    () => synthesizeTheoryOfPerson(strangePerson.id, noCredWorkspace, fixtureFetch()),
    (error: unknown) => error instanceof TheoryError && error.code === "configuration",
  )

  // ── provider error: AI Gateway returns non-ok, run row must end up failed with the error message ──
  await assert.rejects(
    () => synthesizeTheoryOfPerson(person.id, workspaceId, failingFetch(429, "rate limited")),
    (error: unknown) => error instanceof TheoryError && error.code === "provider" && error.message === "rate limited",
  )
  const failedRuns = await db.theoryAnalysisRun.findMany({ where: { workspaceId, subjectPersonId: person.id, status: "failed" } })
  assert.equal(failedRuns.length, 1)
  assert.equal(failedRuns[0].error, "rate limited")

  console.log("All theory synthesize integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
