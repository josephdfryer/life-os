import { db } from "@/lib/db"
import { badRequest, notFound, optionalString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { appendDailySourceInteraction } from "./interactions"

type InboxAction = "accept" | "dismiss" | "update"

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
  return updated
}
