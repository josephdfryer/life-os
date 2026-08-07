import assert from "node:assert/strict"
import { db } from "@life-os/db"
import {
  synthesizeLifeModel,
  createLifeModelSnapshot,
  getCurrentLifeModelSnapshot,
  listLifeModelSnapshots,
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

  console.log("All life-model integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
