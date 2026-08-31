import { publishGraphEvent, type GraphEventActor } from "./events"
import { registerReviewCommand, registerReviewDismiss } from "./review"

export type CommunicationOccurrenceInput = {
  stagedInteractionId: string
  title: string
  occurredAt: string
  personId?: string | null
}

export class CommunicationOccurrenceError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "CommunicationOccurrenceError"
  }
}

export async function confirmCommunicationOccurrence(input: {
  workspaceId: string
  stagedInteractionId: string
  title?: string
  occurredAt?: string
  personId?: string | null
  actor?: GraphEventActor
}) {
  const { db } = await import("@life-os/db")
  const item = await db.stagedInteraction.findFirst({
    where: {
      id: input.stagedInteractionId,
      workspaceId: input.workspaceId,
      source: { in: ["imessage", "gmail", "whatsapp"] },
    },
    select: {
      id: true,
      source: true,
      sourceId: true,
      summary: true,
      body: true,
      timestamp: true,
      candidatePersonId: true,
      metadata: true,
    },
  })
  if (!item) throw new CommunicationOccurrenceError("Communication not found", "not_found")

  const hint = parseOccurrenceHint(item.metadata)
  const title = (input.title ?? hint?.title ?? item.summary ?? "Event from message").trim()
  if (!title) throw new CommunicationOccurrenceError("A title is required", "validation")

  const whenRaw = input.occurredAt ?? hint?.occurredAt ?? item.timestamp.toISOString()
  const occurredAt = new Date(whenRaw)
  if (Number.isNaN(occurredAt.getTime())) {
    throw new CommunicationOccurrenceError("Occurrence time is invalid", "validation")
  }

  const personId = input.personId ?? item.candidatePersonId
  return db.$transaction(async tx => {
    const event = await tx.event.create({
      data: {
        workspaceId: input.workspaceId,
        name: title,
        type: "communication",
        start: occurredAt,
        timestamp: occurredAt,
        metadata: JSON.stringify({
          source: "communication_occurrence",
          stagedInteractionId: item.id,
          messageSource: item.source,
        }),
      },
      select: { id: true },
    })

    if (personId) {
      const person = await tx.person.findFirst({
        where: { id: personId, workspaceId: input.workspaceId },
        select: { id: true },
      })
      if (person) {
        const interaction = await tx.interaction.create({
          data: {
            workspaceId: input.workspaceId,
            personId: person.id,
            eventId: event.id,
            type: item.source,
            timestamp: occurredAt,
            summary: title,
            source: item.source,
            sourceId: item.sourceId,
          },
          select: { id: true },
        })
        await tx.interactionParticipant.createMany({
          data: [
            { interactionId: interaction.id, entityType: "Person", entityId: person.id, role: "participant", workspaceId: input.workspaceId },
            { interactionId: interaction.id, entityType: "Event", entityId: event.id, role: "context", workspaceId: input.workspaceId },
          ],
        })
      }
    }

    await tx.stagedInteraction.update({
      where: { id: item.id },
      data: {
        metadata: JSON.stringify({
          ...parseMetadata(item.metadata),
          occurrenceConfirmed: true,
          eventId: event.id,
        }),
      },
    })

    await publishGraphEvent(tx, {
      workspaceId: input.workspaceId,
      subjectType: "Event",
      subjectId: event.id,
      eventType: "communication_occurrence.confirmed",
      actor: input.actor ?? { type: "user" },
      sourceConnector: item.source,
      idempotencyKey: `communication-occurrence:${item.id}`,
      payload: { stagedInteractionId: item.id, eventId: event.id, personId },
    })

    return { eventId: event.id }
  })
}

export function parseOccurrenceHint(raw: string | null | undefined): {
  title: string
  occurredAt: string | null
  reason: string
  confidence: number
} | null {
  const metadata = parseMetadata(raw)
  const hint = metadata.suggestedOccurrence
  if (!hint || typeof hint !== "object") return null
  const record = hint as Record<string, unknown>
  const title = typeof record.title === "string" ? record.title.trim() : ""
  if (!title) return null
  return {
    title,
    occurredAt: typeof record.occurredAt === "string" ? record.occurredAt : null,
    reason: typeof record.reason === "string" ? record.reason : "",
    confidence: typeof record.confidence === "number" ? record.confidence : 0,
  }
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

registerReviewCommand("communication_occurrence.confirm", async (input, ctx) => {
  const result = await confirmCommunicationOccurrence({
    workspaceId: ctx.workspaceId,
    stagedInteractionId: input.stagedInteractionId as string,
    title: input.title as string | undefined,
    occurredAt: input.occurredAt as string | undefined,
    personId: input.personId as string | null | undefined,
    actor: ctx.actor,
  })
  return { resultType: "Event", resultId: result.eventId }
})

registerReviewDismiss("communication_occurrence", async (sourceId, ctx) => {
  const { db } = await import("@life-os/db")
  const item = await db.stagedInteraction.findFirst({
    where: { id: sourceId, workspaceId: ctx.workspaceId },
    select: { id: true, metadata: true },
  })
  if (!item) return
  await db.stagedInteraction.update({
    where: { id: item.id },
    data: {
      metadata: JSON.stringify({
        ...parseMetadata(item.metadata),
        suggestedOccurrenceDismissed: true,
      }),
    },
  })
})

export async function stageCommunicationOccurrence(input: {
  workspaceId: string
  stagedInteractionId: string
  title: string
  occurredAt?: string | null
  reason?: string
  confidence: number
  personId?: string | null
  messageSource?: string
}) {
  const { createReviewItem } = await import("./review")
  const title = input.title.trim()
  if (!title || input.confidence < 0.55) return null

  return createReviewItem({
    workspaceId: input.workspaceId,
    source: "communication_occurrence",
    sourceId: input.stagedInteractionId,
    itemType: "event",
    command: "communication_occurrence.confirm",
    commandInput: {
      stagedInteractionId: input.stagedInteractionId,
      title,
      occurredAt: input.occurredAt ?? null,
      personId: input.personId ?? null,
    },
    targetType: "Event",
    confidence: input.confidence,
    evidence: {
      title,
      occurredAt: input.occurredAt ?? null,
      reason: input.reason ?? "",
      messageSource: input.messageSource ?? null,
    },
    riskTier: input.confidence >= 0.8 ? "safe_auto" : "review",
    priority: input.confidence >= 0.8 ? 4 : 2,
  })
}
