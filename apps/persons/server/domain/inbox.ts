import { db } from "@/lib/db"
import { badRequest, notFound, optionalString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { appendDailySourceInteraction } from "./interactions"
import { runRulesForTarget } from "./rules"

type InboxAction = "accept" | "dismiss" | "update"

export type StageRecordInput = {
  source: string
  sourceId: string
  itemType?: string
  type?: string
  timestamp: Date | string
  summary?: string | null
  body?: string | null
  direction?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  candidatePersonId?: string | null
  confidence?: number | null
  matchReason?: string | null
  metadata?: Record<string, unknown> | null
  trigger?: string
}

export async function stageRecord(input: StageRecordInput, actor?: DomainActor) {
  const timestamp = input.timestamp instanceof Date ? input.timestamp : new Date(input.timestamp)
  if (Number.isNaN(timestamp.getTime())) throw badRequest("timestamp is invalid", { field: "timestamp" })

  const itemType = input.itemType ?? "interaction"
  const metadataStr = input.metadata ? JSON.stringify(input.metadata) : null

  const staged = await db.stagedInteraction.upsert({
    where: { source_sourceId: { source: input.source, sourceId: input.sourceId } },
    update: {
      itemType,
      contactName: input.contactName ?? undefined,
      contactEmail: input.contactEmail ?? undefined,
      contactPhone: input.contactPhone ?? undefined,
      candidatePersonId: input.candidatePersonId ?? undefined,
      confidence: input.confidence ?? undefined,
      matchReason: input.matchReason ?? undefined,
      timestamp,
      summary: input.summary ?? undefined,
      body: input.body ?? undefined,
      direction: input.direction ?? undefined,
      metadata: metadataStr ?? undefined,
    },
    create: {
      source: input.source,
      sourceId: input.sourceId,
      itemType,
      status: "pending",
      type: input.type ?? "message",
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      candidatePersonId: input.candidatePersonId ?? null,
      confidence: input.confidence ?? null,
      matchReason: input.matchReason ?? null,
      timestamp,
      summary: input.summary ?? null,
      body: input.body ?? null,
      direction: input.direction ?? null,
      metadata: metadataStr,
    },
    select: { id: true, status: true, createdAt: true, updatedAt: true },
  })

  await auditAction({
    actor,
    action: "inbox.stage",
    targetType: "stagedInteraction",
    targetId: staged.id,
    metadata: { source: input.source, sourceId: input.sourceId, itemType },
  })

  await runRulesForTarget({
    trigger: input.trigger ?? "inbox.stage",
    targetType: "stagedInteraction",
    targetId: staged.id,
    payload: {
      stagedInteractionId: staged.id,
      source: input.source,
      sourceId: input.sourceId,
      itemType,
      type: input.type ?? "message",
      timestamp: timestamp.toISOString(),
      summary: input.summary,
      body: input.body,
      direction: input.direction,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      candidatePersonId: input.candidatePersonId,
      metadata: input.metadata,
    },
    actor,
  })

  return staged
}

export async function updateInboxItem(id: string, body: Record<string, unknown>, actor?: DomainActor) {
  const action = body.action as InboxAction
  const item = await db.stagedInteraction.findUnique({ where: { id } })
  if (!item) throw notFound("Inbox item not found", { id })

  if (action === "dismiss") {
    const updated = await db.stagedInteraction.update({
      where: { id },
      data: { status: "dismissed" },
    })
    await auditAction({ actor, action: "inbox.dismiss", targetType: "stagedInteraction", targetId: id })
    return updated
  }

  if (action === "update") {
    const updated = await db.stagedInteraction.update({
      where: { id },
      data: {
        candidatePersonId: optionalString(body.personId),
        summary: body.summary === undefined ? undefined : optionalString(body.summary),
        direction: body.direction === undefined ? undefined : optionalString(body.direction),
        status: body.status === "pending" ? "pending" : undefined,
      },
    })
    await auditAction({ actor, action: "inbox.update", targetType: "stagedInteraction", targetId: id })
    return updated
  }

  if (action !== "accept") throw badRequest("Unsupported inbox action", { action })
  return acceptInboxItem(item.id, body, actor)
}

async function acceptInboxItem(id: string, body: Record<string, unknown>, actor?: DomainActor) {
  const item = await db.stagedInteraction.findUnique({ where: { id } })
  if (!item) throw notFound("Inbox item not found", { id })

  const personId = optionalString(body.personId) ?? item.candidatePersonId
  if (!personId) throw badRequest("Choose a Person before accepting this item", { field: "personId" })

  const person = await db.person.findUnique({ where: { id: personId }, select: { id: true } })
  if (!person) throw notFound("Selected Person does not exist", { personId })

  const summary = body.summary === undefined ? item.summary : optionalString(body.summary)
  const timestamp = body.timestamp ? new Date(String(body.timestamp)) : item.timestamp
  if (Number.isNaN(timestamp.getTime())) throw badRequest("timestamp is invalid", { field: "timestamp" })

  const result = await appendDailySourceInteraction({
    personId,
    source: item.source,
    sourceId: item.sourceId,
    type: item.type,
    timestamp,
    summary: summary || item.body || "(no text)",
    body: item.body,
    direction: optionalString(body.direction) ?? item.direction,
    actor,
  })

  const updated = await db.stagedInteraction.update({
    where: { id },
    data: {
      status: "accepted",
      acceptedAt: new Date(),
      acceptedPersonId: personId,
      interactionId: result.interactionId,
      summary: summary || item.summary,
    },
  })
  await auditAction({ actor, action: "inbox.accept", targetType: "stagedInteraction", targetId: id, metadata: result })
  await runRulesForTarget({
    trigger: "inbox.accept",
    targetType: "stagedInteraction",
    targetId: id,
    payload: {
      stagedInteractionId: id,
      interactionId: result.interactionId,
      personId,
      source: item.source,
      sourceId: item.sourceId,
      itemType: item.itemType,
      type: item.type,
      timestamp: timestamp.toISOString(),
      summary: summary || item.body || "(no text)",
      direction: optionalString(body.direction) ?? item.direction,
      contactName: item.contactName,
      contactEmail: item.contactEmail,
      contactPhone: item.contactPhone,
    },
    actor,
  })
  return updated
}
