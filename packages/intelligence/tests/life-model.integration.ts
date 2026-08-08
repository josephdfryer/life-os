import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { encrypt } from "@life-os/db/crypto"
import {
  synthesizeLifeModel,
  createLifeModelSnapshot,
  getCurrentLifeModelSnapshot,
  listLifeModelSnapshots,
  recordLifeModelClaimFeedback,
  LifeModelError,
  synthesizeLifeModelWithAi,
  LIFE_MODEL_PROMPT_VERSION,
} from "../index"

// Run against a real (throwaway, migrated) database — the versioning
// transaction (demote-current-then-insert) and the alignment-signal-to-claim
// mapping are exactly the parts a pure unit test can't exercise honestly.
// Not part of `tsx --test tests/*.test.ts`; run manually, same convention as
// packages/domain's *.integration.ts files.

const workspaceId = "life-model-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Life model integration", slug: workspaceId } })
  // Inner Circle (closeness 4, 10-day threshold), no interaction ever —
  // guaranteed to trip getRelationshipGaps' >= 1.0 threshold.
  const person = await db.person.create({ data: { workspaceId, first: "Overdue", last: "Contact", closeness: 4 } })

  const synthesis = await synthesizeLifeModel(workspaceId)
  const tensionClaims = synthesis.claims.filter(c => c.kind === "tension")
  assert.ok(tensionClaims.length >= 1, "an Inner Circle person with zero interactions must produce a tension claim")
  const gapClaim = tensionClaims.find(c => c.subjectId === person.id)
  assert.ok(gapClaim, "the tension claim must reference the actual overdue Person")
  assert.equal(gapClaim!.confidence, 1, "alignment signals are deterministic, not inferred — confidence must be 1, not a stand-in for severity")

  const stubKinds = synthesis.claims.filter(c => c.kind !== "tension").map(c => c.kind).sort()
  assert.deepEqual(stubKinds, ["declared", "inferred", "observed"], "observed/inferred/declared must stay honestly marked Unknown, not silently fabricated")

  // ── versioning: first snapshot is version 1 and current ──
  const id1 = await createLifeModelSnapshot(workspaceId, synthesis)
  const current1 = await getCurrentLifeModelSnapshot(workspaceId)
  assert.equal(current1?.id, id1)
  assert.equal(current1?.version, 1)
  assert.equal(current1?.claims.length, synthesis.claims.length)

  const persistedTension = current1!.claims.find(c => c.kind === "tension" && c.subjectId === person.id)
  assert.ok(persistedTension)
  assert.ok(persistedTension!.evidence, "a tension claim must carry its evidence trail")
  const evidence = JSON.parse(persistedTension!.evidence!)
  assert.equal(evidence[0].sourceType, "alignment_signal")

  // ── a second snapshot demotes the first, in one transaction ──
  const synthesis2 = await synthesizeLifeModel(workspaceId)
  const id2 = await createLifeModelSnapshot(workspaceId, synthesis2)
  assert.notEqual(id2, id1)

  const current2 = await getCurrentLifeModelSnapshot(workspaceId)
  assert.equal(current2?.id, id2)
  assert.equal(current2?.version, 2)

  const snapshot1After = await db.lifeModelSnapshot.findUniqueOrThrow({ where: { id: id1 } })
  assert.equal(snapshot1After.status, "archived", "creating a new current snapshot must archive the prior one")

  // Claim ids are per-snapshot rows, not stable across regenerations — feedback below must target
  // a claim on the current (version 2) snapshot, not the now-archived version 1 claim captured above.
  const currentTension = current2!.claims.find(c => c.kind === "tension" && c.subjectId === person.id)
  assert.ok(currentTension, "the current snapshot must still carry the person's tension claim")

  const list = await listLifeModelSnapshots(workspaceId)
  assert.equal(list.length, 2)
  assert.equal(list[0].version, 2, "listLifeModelSnapshots must order newest-first")

  // ── resolving the tension: interacting with the person must clear the signal on the next synthesis ──
  await db.interaction.create({
    data: { workspaceId, personId: person.id, type: "call", timestamp: new Date(), summary: "caught up" },
  })
  const synthesis3 = await synthesizeLifeModel(workspaceId)
  const stillOverdue = synthesis3.claims.some(c => c.kind === "tension" && c.subjectId === person.id)
  assert.equal(stillOverdue, false, "a fresh interaction must clear that person's relationship-gap tension")

  // ── claim feedback: dismiss ──
  const dismissed = await recordLifeModelClaimFeedback({
    workspaceId,
    claimId: currentTension!.id,
    action: "dismiss",
    reason: "Already reconnected outside the app",
    actor: { type: "system", label: "integration-test" },
  })
  assert.equal(dismissed.action, "dismiss")
  assert.equal(dismissed.sourceNoteId, null, "a dismissal must not create a Note — only a correction does")

  const afterDismiss = await getCurrentLifeModelSnapshot(workspaceId)
  const claimAfterDismiss = afterDismiss!.claims.find(c => c.id === currentTension!.id)
  assert.equal(claimAfterDismiss!.feedback[0]?.id, dismissed.id, "the snapshot read must surface the latest feedback for its claim")

  // ── claim feedback: correct — must create a Note and link it back ──
  const corrected = await recordLifeModelClaimFeedback({
    workspaceId,
    claimId: currentTension!.id,
    action: "correct",
    replacementStatement: "Actually already back in regular contact — the graph is stale here",
    reason: "Talked yesterday, just not logged yet",
    actor: { type: "user", id: "u1", label: "joseph" },
  })
  assert.ok(corrected.sourceNoteId, "a correction must create and link a Note")
  const sourceNote = await db.note.findUniqueOrThrow({ where: { id: corrected.sourceNoteId! } })
  assert.equal(sourceNote.type, "intelligence_correction")
  assert.equal(sourceNote.content, "Actually already back in regular contact — the graph is stale here")

  // ── claim feedback: validation — correct without a replacement statement must reject ──
  await assert.rejects(
    () => recordLifeModelClaimFeedback({ workspaceId, claimId: persistedTension!.id, action: "correct", actor: { type: "system" } }),
    (error: unknown) => error instanceof LifeModelError && error.code === "validation",
  )

  // ── claim feedback: not_found — an unknown or cross-workspace claim id must 404, not silently no-op ──
  await assert.rejects(
    () => recordLifeModelClaimFeedback({ workspaceId, claimId: "does-not-exist", action: "dismiss", actor: { type: "system" } }),
    (error: unknown) => error instanceof LifeModelError && error.code === "not_found",
  )

  const graphEvents = await db.graphEvent.findMany({
    where: { workspaceId, subjectType: "LifeModelClaim", subjectId: currentTension!.id },
    orderBy: { occurredAt: "asc" },
  })
  assert.deepEqual(graphEvents.map(event => event.eventType), ["intelligence.claim.dismissed", "intelligence.claim.corrected"])

  // ── AI synthesis: grounded fixture output, run receipt, and snapshot link ──
  const evidenceNote = await db.note.create({
    data: { workspaceId, type: "observation", timestamp: new Date(), content: "Weekly long runs have been logged consistently." },
  })
  const credential = await db.aiProviderCredential.create({
    data: { workspaceId, provider: "vercel-ai-gateway", apiKeyEncrypted: encrypt("fixture-key"), modelId: "openai/gpt-5.4-mini", status: "active" },
  })
  const fixtureFetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      summary: "Training is currently consistent.",
      claims: [{
        kind: "observed", statement: "Weekly long runs are being logged consistently.", confidence: 0.86,
        subjectType: null, subjectId: null, windowStart: null, windowEnd: null,
        evidence: [{ sourceType: "note", sourceId: evidenceNote.id }],
      }],
    }) } }],
    usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.0042 },
  }), { status: 200 })) as unknown as typeof fetch

  const aiSynthesis = await synthesizeLifeModelWithAi(workspaceId, fixtureFetch)
  assert.equal(aiSynthesis.claims.find(claim => claim.kind === "observed")?.evidence[0]?.sourceId, evidenceNote.id)
  assert.equal(aiSynthesis.promptVersion, LIFE_MODEL_PROMPT_VERSION)
  const aiSnapshotId = await createLifeModelSnapshot(workspaceId, aiSynthesis)
  const analysisRun = await db.lifeModelAnalysisRun.findUniqueOrThrow({ where: { id: aiSynthesis.analysisRunId! } })
  assert.equal(analysisRun.status, "completed")
  assert.equal(analysisRun.snapshotId, aiSnapshotId)
  assert.equal(analysisRun.credentialId, credential.id)
  assert.equal(analysisRun.estimatedCost, 0.0042)

  console.log("All life-model integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
