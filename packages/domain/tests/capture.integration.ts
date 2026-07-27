import assert from "node:assert/strict"
import { captureNote } from "../capture"
import { reviewNoteSuggestion } from "../note-suggestions"
import { reconcileCalendarPlan } from "../calendar-reconciliation"
import { db } from "@life-os/db"

const workspaceId = "capture-integration-workspace"
const idempotencyKey = "capture_integration_12345678"

async function main() {
  await db.workspace.create({
    data: {
      id: workspaceId,
      name: "Capture integration",
      slug: workspaceId,
    },
  })

  const first = await captureNote({
    workspaceId,
    content: "A durable captured thought",
    type: "observation",
    source: "integration-test",
    idempotencyKey,
  })
  const retry = await captureNote({
    workspaceId,
    content: "A durable captured thought",
    type: "observation",
    source: "integration-test",
    idempotencyKey,
  })

  assert.equal(first.created, true)
  assert.equal(retry.created, false)
  assert.equal(retry.note.id, first.note.id)
  assert.equal(await db.note.count({ where: { workspaceId } }), 1)
  assert.match(first.note.metadata ?? "", /integration-test/)

  const person = await db.person.create({
    data: { workspaceId, first: "Rowan", last: "Example" },
  })
  const run = await db.noteAnalysisRun.create({
    data: {
      workspaceId,
      noteId: first.note.id,
      provider: "test",
      modelId: "test",
      status: "completed",
      promptVersion: "integration-test",
    },
  })
  const eventSuggestion = await db.noteSuggestion.create({
    data: {
      workspaceId,
      noteId: first.note.id,
      analysisRunId: run.id,
      kind: "event",
      title: "Met Rowan",
      payload: JSON.stringify({
        timestamp: "2026-07-26T18:00:00.000Z",
        personNames: ["Rowan"],
        matchedPeople: [{ id: person.id, name: "Rowan Example" }],
        reason: "Explicit past occurrence",
      }),
    },
  })

  const acceptedEvent = await reviewNoteSuggestion({
    workspaceId,
    suggestionId: eventSuggestion.id,
    action: "accept",
  })
  const acceptedEventRetry = await reviewNoteSuggestion({
    workspaceId,
    suggestionId: eventSuggestion.id,
    action: "accept",
  })
  assert.equal(acceptedEvent.status, "accepted")
  assert.equal(acceptedEvent.entityType, "Event")
  assert.equal(acceptedEventRetry.entityId, acceptedEvent.entityId)
  assert.equal(await db.event.count({
    where: { workspaceId, sourceNoteId: first.note.id },
  }), 1)
  assert.equal(await db.interaction.count({
    where: { workspaceId, sourceNoteId: first.note.id, eventId: acceptedEvent.entityId },
  }), 1)
  assert.equal(await db.interactionParticipant.count({
    where: { workspaceId, entityType: "Person", entityId: person.id },
  }), 1)

  const planSuggestion = await db.noteSuggestion.create({
    data: {
      workspaceId,
      noteId: first.note.id,
      analysisRunId: run.id,
      kind: "plan",
      title: "Call Rowan",
      payload: JSON.stringify({
        timestamp: "2026-07-27T18:00:00.000Z",
        personNames: ["Rowan"],
        matchedPeople: [{ id: person.id, name: "Rowan Example" }],
        reason: "Explicit future commitment",
      }),
    },
  })
  const acceptedPlan = await reviewNoteSuggestion({
    workspaceId,
    suggestionId: planSuggestion.id,
    action: "accept",
    title: "Call Rowan tomorrow",
  })
  assert.equal(acceptedPlan.entityType, "Plan")
  const plan = await db.plan.findUniqueOrThrow({
    where: { id: acceptedPlan.entityId! },
    include: { expectedPeople: true },
  })
  assert.equal(plan.sourceNoteId, first.note.id)
  assert.equal(plan.text, "Call Rowan tomorrow")
  assert.equal(plan.expectedPeople[0]?.personId, person.id)

  const dismissedSuggestion = await db.noteSuggestion.create({
    data: {
      workspaceId,
      noteId: first.note.id,
      analysisRunId: run.id,
      kind: "plan",
      title: "Ignore this",
      payload: "{}",
    },
  })
  const dismissed = await reviewNoteSuggestion({
    workspaceId,
    suggestionId: dismissedSuggestion.id,
    action: "dismiss",
  })
  assert.equal(dismissed.status, "dismissed")
  assert.equal(await db.plan.count({
    where: { workspaceId, text: "Ignore this" },
  }), 0)

  const calendarPlan = await db.plan.create({
    data: {
      workspaceId,
      text: "Calendar meeting",
      status: "active",
      scheduledStart: new Date("2026-07-26T18:00:00.000Z"),
      scheduledEnd: new Date("2026-07-26T19:00:00.000Z"),
      externalSource: "google-calendar",
      externalInstanceId: "google-calendar:primary:integration",
      reconciliationStatus: "pending",
      expectedPeople: { create: { workspaceId, personId: person.id } },
    },
  })
  const reconciliation = await reconcileCalendarPlan({
    workspaceId,
    planId: calendarPlan.id,
    action: "changed",
    title: "Actual meeting",
    start: "2026-07-26T18:15:00.000Z",
    end: "2026-07-26T19:10:00.000Z",
    personIds: [person.id],
    outcome: "Follow-up needed",
    emotionalWeight: "Positive",
    followUps: ["Send the summary"],
    note: "The meeting started late.",
  })
  const reconciliationRetry = await reconcileCalendarPlan({
    workspaceId,
    planId: calendarPlan.id,
    action: "happened",
  })
  assert.equal(reconciliation.eventId, reconciliationRetry.eventId)
  const reconciledEvent = await db.event.findUniqueOrThrow({
    where: { id: reconciliation.eventId },
    include: { interactions: true, sourceNote: true },
  })
  assert.equal(reconciledEvent.name, "Actual meeting")
  assert.equal(reconciledEvent.sourcePlanId, calendarPlan.id)
  assert.equal(reconciledEvent.interactions.length, 1)
  assert.equal(reconciledEvent.interactions[0].emotionalWeight, "Positive")
  assert.match(reconciledEvent.interactions[0].actionItems ?? "", /Send the summary/)
  assert.equal(reconciledEvent.sourceNote?.content, "The meeting started late.")
  assert.equal(await db.event.count({ where: { sourcePlanId: calendarPlan.id } }), 1)

  const cancelledPlan = await db.plan.create({
    data: {
      workspaceId,
      text: "Cancelled calendar item",
      status: "active",
      scheduledStart: new Date("2026-07-26T20:00:00.000Z"),
      externalSource: "google-calendar",
      externalInstanceId: "google-calendar:primary:cancelled",
      reconciliationStatus: "pending",
    },
  })
  await reconcileCalendarPlan({ workspaceId, planId: cancelledPlan.id, action: "cancelled" })
  assert.equal(await db.event.count({ where: { sourcePlanId: cancelledPlan.id } }), 0)
  assert.equal((await db.plan.findUniqueOrThrow({ where: { id: cancelledPlan.id } })).status, "abandoned")
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
