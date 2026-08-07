import assert from "node:assert/strict"
import { db } from "@life-os/db"
import {
  createReviewItem,
  listReviewItems,
  resolveReviewItem,
  bulkDismissReviewItems,
  syncReviewItemStatus,
  ReviewItemError,
  acceptStagedInteraction,
  reviewNoteSuggestion,
} from "../index"

// Run against a real (throwaway, migrated) database — the command-registry
// dispatch, the keyset pagination, and bulk-dismiss's same-source/low-risk
// guard are exactly the parts a pure unit test cannot exercise honestly. Not
// part of `tsx --test tests/*.test.ts`; run manually, same convention as
// capture.integration.ts and staged-interactions.integration.ts.

const workspaceId = "review-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Review integration", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Review", last: "Person" } })

  // ── staged_interaction: create dual-writes a ReviewItem, accept resolves it through the shared registry ──
  const staged = await db.stagedInteraction.create({
    data: {
      workspaceId, source: "imessage", sourceId: "review-msg-1", status: "pending",
      itemType: "interaction", type: "message", timestamp: new Date(),
      summary: "Hey there", direction: "received", candidatePersonId: person.id,
    },
  })
  const created = await createReviewItem({
    workspaceId, source: "staged_interaction", sourceId: staged.id, itemType: "interaction",
    command: "staged_interaction.accept", commandInput: { stagedInteractionId: staged.id },
    targetType: "Person", targetId: person.id, confidence: 0.8, riskTier: "review",
  })
  assert.ok(created)
  assert.equal(created!.status, "pending")

  const resolved = await resolveReviewItem({ id: created!.id, workspaceId, action: "accept", actor: { type: "system" } })
  assert.equal(resolved.status, "accepted")
  assert.equal(resolved.resultType, "Interaction")
  assert.ok(resolved.resultId)

  const stagedAfter = await db.stagedInteraction.findUniqueOrThrow({ where: { id: staged.id } })
  assert.equal(stagedAfter.status, "accepted", "resolving through ReviewItem must also resolve the legacy StagedInteraction row")

  // Idempotent: resolving again returns the recorded result, doesn't re-run the command.
  const retry = await resolveReviewItem({ id: created!.id, workspaceId, action: "accept" })
  assert.equal(retry.resultId, resolved.resultId)

  // ── the reverse direction: acceptStagedInteraction called directly (the human-accept path, bypassing ReviewItem) still syncs the ReviewItem ──
  const staged2 = await db.stagedInteraction.create({
    data: {
      workspaceId, source: "imessage", sourceId: "review-msg-2", status: "pending",
      itemType: "interaction", type: "message", timestamp: new Date(),
      summary: "Another one", direction: "received", candidatePersonId: person.id,
    },
  })
  const item2 = await createReviewItem({
    workspaceId, source: "staged_interaction", sourceId: staged2.id, itemType: "interaction",
    command: "staged_interaction.accept", commandInput: { stagedInteractionId: staged2.id },
    riskTier: "review",
  })
  await acceptStagedInteraction({ id: staged2.id, workspaceId, actor: { type: "system" } })
  const item2After = await db.reviewItem.findUniqueOrThrow({ where: { id: item2!.id } })
  assert.equal(item2After.status, "accepted", "acceptStagedInteraction must sync the ReviewItem even when called directly")

  // ── dismiss path ──
  const staged3 = await db.stagedInteraction.create({
    data: {
      workspaceId, source: "imessage", sourceId: "review-msg-3", status: "pending",
      itemType: "interaction", type: "message", timestamp: new Date(), summary: "Spam", candidatePersonId: person.id,
    },
  })
  const item3 = await createReviewItem({
    workspaceId, source: "staged_interaction", sourceId: staged3.id, itemType: "interaction",
    command: "staged_interaction.accept", commandInput: { stagedInteractionId: staged3.id }, riskTier: "observe",
  })
  const dismissed = await resolveReviewItem({ id: item3!.id, workspaceId, action: "dismiss", reason: "spam" })
  assert.equal(dismissed.status, "dismissed")
  const staged3After = await db.stagedInteraction.findUniqueOrThrow({ where: { id: staged3.id } })
  assert.equal(staged3After.status, "dismissed", "dismissing a ReviewItem must dismiss the legacy StagedInteraction row too")
  const item3After = await db.reviewItem.findUniqueOrThrow({ where: { id: item3!.id } })
  assert.match(item3After.evidence ?? "", /spam/)

  // ── note_suggestion: the same generic resolveReviewItem dispatch, exercised against the real note_suggestion.accept handler ──
  const note = await db.note.create({ data: { workspaceId, type: "observation", content: "Lunch with Review Person next week", timestamp: new Date() } })
  const run = await db.noteAnalysisRun.create({
    data: { workspaceId, noteId: note.id, provider: "test", modelId: "test", status: "completed", promptVersion: "test" },
  })
  const suggestion = await db.noteSuggestion.create({
    data: {
      workspaceId, noteId: note.id, analysisRunId: run.id, kind: "plan", status: "pending",
      title: "Lunch with Review Person", payload: JSON.stringify({ timestamp: null, personNames: [], matchedPeople: [], reason: "explicit plan" }),
      confidence: 0.7,
    },
  })
  const noteReviewItem = await createReviewItem({
    workspaceId, source: "note_suggestion", sourceId: suggestion.id, itemType: "plan",
    command: "note_suggestion.accept", commandInput: { suggestionId: suggestion.id }, riskTier: "review",
  })
  const noteResolved = await resolveReviewItem({ id: noteReviewItem!.id, workspaceId, action: "accept" })
  assert.equal(noteResolved.status, "accepted")
  assert.equal(noteResolved.resultType, "Plan")
  const suggestionAfter = await db.noteSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })
  assert.equal(suggestionAfter.status, "accepted", "resolving through ReviewItem must also resolve the legacy NoteSuggestion row")
  assert.equal(suggestionAfter.acceptedEntityId, noteResolved.resultId)

  // note_suggestion dismiss, called directly (bypassing ReviewItem) — must still sync
  const suggestion2 = await db.noteSuggestion.create({
    data: {
      workspaceId, noteId: note.id, analysisRunId: run.id, kind: "event", status: "pending",
      title: "Coffee yesterday", payload: JSON.stringify({ timestamp: null, personNames: [], matchedPeople: [], reason: "explicit event" }),
      confidence: 0.4,
    },
  })
  const noteReviewItem2 = await createReviewItem({
    workspaceId, source: "note_suggestion", sourceId: suggestion2.id, itemType: "event",
    command: "note_suggestion.accept", commandInput: { suggestionId: suggestion2.id }, riskTier: "review",
  })
  await reviewNoteSuggestion({ workspaceId, suggestionId: suggestion2.id, action: "dismiss" })
  const noteReviewItem2After = await db.reviewItem.findUniqueOrThrow({ where: { id: noteReviewItem2!.id } })
  assert.equal(noteReviewItem2After.status, "dismissed", "reviewNoteSuggestion's dismiss branch must sync the ReviewItem even when called directly")

  // re-analysis (delete + recreate under the same analysisRunId) supersedes a still-pending ReviewItem from the prior run
  const suggestion3 = await db.noteSuggestion.create({
    data: {
      workspaceId, noteId: note.id, analysisRunId: run.id, kind: "plan", status: "pending",
      title: "Stale suggestion from a prior run", payload: JSON.stringify({ timestamp: null, personNames: [], matchedPeople: [], reason: "x" }),
      confidence: 0.5,
    },
  })
  const noteReviewItem3 = await createReviewItem({
    workspaceId, source: "note_suggestion", sourceId: suggestion3.id, itemType: "plan",
    command: "note_suggestion.accept", commandInput: { suggestionId: suggestion3.id }, riskTier: "review",
  })
  await db.noteSuggestion.delete({ where: { id: suggestion3.id } })
  await syncReviewItemStatus({ source: "note_suggestion", sourceId: suggestion3.id, workspaceId, status: "superseded" })
  const noteReviewItem3After = await db.reviewItem.findUniqueOrThrow({ where: { id: noteReviewItem3!.id } })
  assert.equal(noteReviewItem3After.status, "superseded", "re-analysis must mark a still-pending old ReviewItem superseded")

  // ── error paths ──
  await assert.rejects(
    () => resolveReviewItem({ id: "does-not-exist", workspaceId, action: "accept" }),
    (error: unknown) => error instanceof ReviewItemError && error.code === "not_found",
  )

  const unregisteredSource = await createReviewItem({
    workspaceId, source: "not_a_real_source", sourceId: "x", itemType: "interaction",
    command: "not_a_real_command", commandInput: {}, riskTier: "review",
  })
  await assert.rejects(
    () => resolveReviewItem({ id: unregisteredSource!.id, workspaceId, action: "accept" }),
    (error: unknown) => error instanceof ReviewItemError && error.code === "unsupported_command",
  )

  // ── listReviewItems: filters, ordering, keyset pagination ──
  const page1 = await listReviewItems({ status: "pending", limit: 1 }, workspaceId)
  assert.equal(page1.data.length, 1)
  assert.equal(page1.hasMore, false, "only the unregistered-source item is still pending at this point")

  // ── bulkDismissReviewItems: same-source/same-itemType/low-risk group ──
  const bulkA = await createReviewItem({
    workspaceId, source: "staged_interaction", sourceId: "bulk-a", itemType: "interaction",
    command: "staged_interaction.accept", commandInput: {}, riskTier: "observe",
  })
  const bulkB = await createReviewItem({
    workspaceId, source: "staged_interaction", sourceId: "bulk-b", itemType: "interaction",
    command: "staged_interaction.accept", commandInput: {}, riskTier: "observe",
  })
  const bulkResult = await bulkDismissReviewItems({ ids: [bulkA!.id, bulkB!.id], workspaceId, reason: "cleanup" })
  assert.equal(bulkResult.processed, 2)

  // Mixed risk tiers must be rejected outright, not partially applied.
  const highRisk = await createReviewItem({
    workspaceId, source: "staged_interaction", sourceId: "bulk-c", itemType: "interaction",
    command: "staged_interaction.accept", commandInput: {}, riskTier: "confirm",
  })
  const lowRisk = await createReviewItem({
    workspaceId, source: "staged_interaction", sourceId: "bulk-d", itemType: "interaction",
    command: "staged_interaction.accept", commandInput: {}, riskTier: "observe",
  })
  await assert.rejects(
    () => bulkDismissReviewItems({ ids: [highRisk!.id, lowRisk!.id], workspaceId }),
    (error: unknown) => error instanceof ReviewItemError && error.code === "validation",
  )
  const highRiskAfter = await db.reviewItem.findUniqueOrThrow({ where: { id: highRisk!.id } })
  assert.equal(highRiskAfter.status, "pending", "a rejected mixed-tier bulk dismiss must not partially apply")

  // ── syncReviewItemStatus is a true no-op once already resolved ──
  await syncReviewItemStatus({ source: "staged_interaction", sourceId: staged.id, workspaceId, status: "dismissed" })
  const stagedReviewItemStillAccepted = await db.reviewItem.findUniqueOrThrow({ where: { id: created!.id } })
  assert.equal(stagedReviewItemStillAccepted.status, "accepted", "sync must never overwrite an already-resolved item")

  console.log("All review integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
