import { db } from "@/lib/db"
import { dollarsToCents } from "@life-os/db"
import { badRequest, notFound, optionalString, optionalStringArray, requiredString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { formatInteraction, jsonList } from "./dto"
import { runRulesForTarget } from "./rules"

export type InteractionInput = {
  personId?: unknown
  type?: unknown
  timestamp?: unknown
  duration?: unknown
  summary?: unknown
  notes?: unknown
  emotionalWeight?: unknown
  outcome?: unknown
  actionItems?: unknown
  billable?: unknown
  amount?: unknown
  direction?: unknown
  eventId?: unknown
  sourceFileId?: unknown
}

// An Interaction must have at least one participant. SQLite CHECK constraints
// can't reference a related table, so this is enforced here rather than at
// the database level (the InteractionParticipant rows below are the
// forward-looking participant model; personId/eventId/placeId are the
// legacy direct fields, dual-written into InteractionParticipant on create).
function assertHasParticipant(fields: { personId?: string | null; eventId?: string | null; placeId?: string | null }) {
  if (!fields.personId && !fields.eventId && !fields.placeId) {
    throw badRequest("Interaction must have at least one participant (personId, eventId, or placeId)", { field: "participants" })
  }
}

async function writeInteractionParticipants(
  interactionId: string,
  fields: { personId?: string | null; eventId?: string | null; placeId?: string | null },
  workspaceId: string,
) {
  const rows: { entityType: string; entityId: string }[] = []
  if (fields.personId) rows.push({ entityType: "Person", entityId: fields.personId })
  if (fields.eventId) rows.push({ entityType: "Event", entityId: fields.eventId })
  if (fields.placeId) rows.push({ entityType: "Place", entityId: fields.placeId })
  if (!rows.length) return
  await db.interactionParticipant.createMany({
    data: rows.map(row => ({ ...row, interactionId, workspaceId })),
  })
}

export async function createInteraction(input: InteractionInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const type = requiredString(input.type, "type")
  const timestamp = parseTimestamp(input.timestamp)
  const summary = optionalString(input.summary)
  const personId = optionalString(input.personId)
  const eventId = optionalString(input.eventId)

  if (personId) {
    const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { id: true } })
    if (!person) throw notFound("Person not found", { personId })
  }

  let resolvedEventId = eventId
  if (!resolvedEventId) {
    const event = await db.event.create({
      data: {
        name: summary ? summary.slice(0, 80) : `${type} interaction`,
        workspaceId,
        type,
        start: timestamp,
        timestamp,
      },
    })
    resolvedEventId = event.id
  } else {
    const event = await db.event.findFirst({ where: { id: resolvedEventId, workspaceId }, select: { id: true } })
    if (!event) throw notFound("Event not found", { eventId: resolvedEventId })
  }

  assertHasParticipant({ personId, eventId: resolvedEventId })

  const interaction = await db.interaction.create({
    data: {
      personId,
      workspaceId,
      eventId: resolvedEventId,
      type,
      timestamp,
      duration: input.duration ? Number(input.duration) : null,
      summary,
      notes: optionalString(input.notes),
      emotionalWeight: optionalString(input.emotionalWeight),
      outcome: optionalString(input.outcome),
      actionItems: Array.isArray(input.actionItems) ? jsonList(optionalStringArray(input.actionItems)) : null,
      billable: Boolean(input.billable),
      amount: dollarsToCents(input.amount),
      direction: optionalString(input.direction),
      sourceFileId: optionalString(input.sourceFileId),
    },
    include: { event: true, sourceFile: true },
  })

  await writeInteractionParticipants(interaction.id, { personId, eventId: resolvedEventId }, workspaceId)

  await auditAction({ actor, action: "interaction.create", targetType: "interaction", targetId: interaction.id })
  await runRulesForTarget({
    trigger: "interaction.create",
    targetType: "interaction",
    targetId: interaction.id,
    payload: {
      interactionId: interaction.id,
      personId,
      eventId: resolvedEventId,
      type,
      timestamp: timestamp.toISOString(),
      summary,
      emotionalWeight: interaction.emotionalWeight,
      outcome: interaction.outcome,
      direction: interaction.direction,
      sourceFileId: interaction.sourceFileId,
    },
    actor,
  })
  return formatInteraction(interaction)
}

export async function updateInteraction(id: string, input: Partial<InteractionInput>, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const existing = await db.interaction.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw notFound("Interaction not found", { id })

  const patch: Record<string, unknown> = {}
  if (input.summary !== undefined) patch.summary = optionalString(input.summary)
  if (input.notes !== undefined) patch.notes = optionalString(input.notes)
  if (input.emotionalWeight !== undefined) patch.emotionalWeight = optionalString(input.emotionalWeight)
  if (input.outcome !== undefined) patch.outcome = optionalString(input.outcome)
  if (input.actionItems !== undefined) patch.actionItems = Array.isArray(input.actionItems) ? jsonList(optionalStringArray(input.actionItems)) : null
  if (input.direction !== undefined) patch.direction = optionalString(input.direction)
  if (input.billable !== undefined) patch.billable = Boolean(input.billable)
  if (input.amount !== undefined) patch.amount = dollarsToCents(input.amount)
  if (input.duration !== undefined) patch.duration = input.duration ? Number(input.duration) : null

  const interaction = await db.interaction.update({
    where: { id },
    data: patch,
    include: { event: true, sourceFile: true },
  })
  await auditAction({ actor, action: "interaction.update", targetType: "interaction", targetId: id, metadata: { fields: Object.keys(patch) } })
  return formatInteraction(interaction)
}

export async function deleteInteraction(id: string, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const existing = await db.interaction.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw notFound("Interaction not found", { id })
  await db.interaction.delete({ where: { id } })
  await auditAction({ actor, action: "interaction.delete", targetType: "interaction", targetId: id })
}

// Moved to @life-os/domain (packages/domain/staged-interactions.ts) so
// apps/home can call the exact same write instead of maintaining its own
// re-implementation — Home's independent copy had already drifted (missing
// "gmail" from the no-Event source list). The function now also publishes a
// GraphEvent transactionally with the write it makes; nothing else changed
// about its behavior or signature, so every existing caller here and in
// gmail.ts keeps working unmodified.
export { appendDailySourceInteraction } from "@life-os/domain"

function parseTimestamp(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()
  if (Number.isNaN(date.getTime())) throw badRequest("timestamp is invalid", { field: "timestamp" })
  return date
}
