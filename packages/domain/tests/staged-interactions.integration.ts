import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { acceptStagedInteraction, AcceptStagedInteractionError } from "../staged-interactions"

// Run against a real (throwaway, migrated) database — the transaction shape,
// the upsert-based GraphEvent idempotency, and the day-bucketing logic are
// exactly the parts a pure unit test cannot exercise honestly. Not part of
// `tsx --test tests/*.test.ts`; run manually, same convention as
// capture.integration.ts.

const workspaceId = "staged-interactions-integration-workspace"

async function main() {
  await db.workspace.create({ data: { id: workspaceId, name: "Staged interactions integration", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Integration", last: "Person" } })

  // ── create path: first accept writes a new Interaction + Event + participants + GraphEvent ──
  const staged1 = await db.stagedInteraction.create({
    data: {
      workspaceId, source: "imessage", sourceId: "msg-1", status: "pending",
      itemType: "interaction", type: "message",
      timestamp: new Date("2026-08-01T18:00:00Z"),
      summary: "Hey, are we still on for lunch?",
      direction: "received", candidatePersonId: person.id,
    },
  })

  const first = await acceptStagedInteraction({ id: staged1.id, workspaceId, actor: { type: "system", label: "integration-test" } })
  assert.equal(first.status, "accepted")
  assert.equal(first.created, true)

  const stagedAfter1 = await db.stagedInteraction.findUniqueOrThrow({ where: { id: staged1.id } })
  assert.equal(stagedAfter1.status, "accepted")
  assert.equal(stagedAfter1.interactionId, first.interactionId)
  assert.equal(stagedAfter1.acceptedPersonId, person.id)

  // imessage is a NO_EVENT_SOURCES source — this is the exact bug apps/home's
  // independent reimplementation had for "gmail" (missing from its list), so
  // pin the correct behavior directly.
  const interaction1 = await db.interaction.findUniqueOrThrow({ where: { id: first.interactionId } })
  assert.equal(interaction1.eventId, null, "imessage-sourced accepts must not create an Event")

  const participants1 = await db.interactionParticipant.findMany({ where: { interactionId: first.interactionId } })
  assert.deepEqual(participants1.map(p => p.entityType).sort(), ["Person"])

  // Two distinct facts about the same subject: the write primitive publishes
  // "an interaction was created", and the accept command publishes "a staged
  // item was accepted" — both reference the same Interaction.
  const events1 = await db.graphEvent.findMany({ where: { workspaceId, subjectId: first.interactionId } })
  assert.equal(events1.length, 2)
  const createdEvent = events1.find(e => e.eventType === "interaction.created")
  const acceptedEvent = events1.find(e => e.eventType === "staged_interaction.accepted")
  assert.ok(createdEvent, "expected an interaction.created event")
  assert.ok(acceptedEvent, "expected a staged_interaction.accepted event")
  assert.equal(createdEvent!.actorType, "system")

  // ── idempotent retry: same staged item accepted again returns the SAME result, writes nothing new ──
  const retry = await acceptStagedInteraction({ id: staged1.id, workspaceId })
  assert.equal(retry.interactionId, first.interactionId)
  assert.equal(retry.created, false)
  assert.equal(await db.interaction.count({ where: { workspaceId } }), 1, "retry must not create a second Interaction")
  assert.equal(await db.graphEvent.count({ where: { workspaceId } }), 2, "retry must not publish any new GraphEvent")

  // ── append path: a second staged item, same person, same day -> appends to the existing Interaction ──
  const staged2 = await db.stagedInteraction.create({
    data: {
      workspaceId, source: "imessage", sourceId: "msg-2", status: "pending",
      itemType: "interaction", type: "message",
      timestamp: new Date("2026-08-01T18:05:00Z"),
      summary: "Yes! See you at noon.",
      direction: "sent", candidatePersonId: person.id,
    },
  })
  const second = await acceptStagedInteraction({ id: staged2.id, workspaceId })
  assert.equal(second.interactionId, first.interactionId, "same person + same day must append, not create a second Interaction")
  assert.equal(second.created, false)
  assert.equal(await db.interaction.count({ where: { workspaceId } }), 1)

  const interaction1After = await db.interaction.findUniqueOrThrow({ where: { id: first.interactionId } })
  assert.match(interaction1After.summary ?? "", /lunch/)
  assert.match(interaction1After.summary ?? "", /noon/)
  assert.equal(interaction1After.direction, "mixed", "received + sent on the same day must merge to mixed")

  const appendEvents = await db.graphEvent.findMany({ where: { workspaceId, eventType: "interaction.appended" } })
  assert.equal(appendEvents.length, 1)

  // ── a source that DOES get an Event (era, unlike imessage/gmail/whatsapp) ──
  const staged3 = await db.stagedInteraction.create({
    data: {
      workspaceId, source: "era", sourceId: "txn-1", status: "pending",
      itemType: "interaction", type: "financial",
      timestamp: new Date("2026-08-02T00:00:00Z"),
      summary: "Coffee shop", direction: "paid", candidatePersonId: person.id,
    },
  })
  const third = await acceptStagedInteraction({ id: staged3.id, workspaceId })
  const interaction3 = await db.interaction.findUniqueOrThrow({ where: { id: third.interactionId } })
  assert.notEqual(interaction3.eventId, null, "era-sourced accepts DO create an Event")

  // ── error paths ──
  await assert.rejects(
    () => acceptStagedInteraction({ id: "does-not-exist", workspaceId }),
    (error: unknown) => error instanceof AcceptStagedInteractionError && error.code === "not_found",
  )

  const noCandidateStaged = await db.stagedInteraction.create({
    data: {
      workspaceId, source: "imessage", sourceId: "msg-no-candidate", status: "pending",
      itemType: "interaction", type: "message", timestamp: new Date(), summary: "Unmatched",
    },
  })
  await assert.rejects(
    () => acceptStagedInteraction({ id: noCandidateStaged.id, workspaceId }),
    (error: unknown) => error instanceof AcceptStagedInteractionError && error.code === "validation",
  )

  console.log("All staged-interactions integration assertions passed.")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
