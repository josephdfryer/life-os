import { randomUUID } from "node:crypto"
import { dollarsToCents, type Prisma } from "@life-os/db"
import { publishGraphEvent, type GraphEventActor } from "./events"
import { writeAuditLog, type AuditActor } from "./audit"

export class InteractionError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "InteractionError"
  }
}

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
  amountCents?: unknown
  direction?: unknown
  eventId?: unknown
  sourceFileId?: unknown
}

type InteractionActor = GraphEventActor & AuditActor

const interactionInclude = { event: true, sourceFile: true } as const

export async function createInteraction(
  input: InteractionInput,
  workspaceId = "default-workspace",
  actor?: InteractionActor,
) {
  const { db } = await import("@life-os/db")
  const type = requiredString(input.type, "type")
  const timestamp = validDate(input.timestamp)
  const personId = optionalString(input.personId)
  const requestedEventId = optionalString(input.eventId)
  const sourceFileId = optionalString(input.sourceFileId)

  const interaction = await db.$transaction(async tx => {
    await validateReference(tx, "person", personId, workspaceId)
    await validateReference(tx, "event", requestedEventId, workspaceId)
    await validateReference(tx, "importedFile", sourceFileId, workspaceId)

    const eventId = requestedEventId ?? (await tx.event.create({
      data: {
        name: (optionalString(input.summary) ?? `${type} interaction`).slice(0, 80),
        workspaceId,
        type,
        start: timestamp,
        timestamp,
      },
      select: { id: true },
    })).id

    const created = await tx.interaction.create({
      data: {
        personId,
        workspaceId,
        eventId,
        type,
        timestamp,
        duration: optionalInteger(input.duration, "duration"),
        summary: optionalString(input.summary),
        notes: optionalString(input.notes),
        emotionalWeight: optionalString(input.emotionalWeight),
        outcome: optionalString(input.outcome),
        actionItems: optionalStringList(input.actionItems),
        billable: Boolean(input.billable),
        amount: input.amountCents !== undefined
          ? optionalInteger(input.amountCents, "amountCents")
          : dollarsToCents(input.amount),
        direction: optionalString(input.direction),
        sourceFileId,
      },
      include: interactionInclude,
    })

    await tx.interactionParticipant.createMany({
      data: [
        ...(personId ? [{ interactionId: created.id, workspaceId, entityType: "Person", entityId: personId }] : []),
        { interactionId: created.id, workspaceId, entityType: "Event", entityId: eventId },
      ],
    })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Interaction",
      subjectId: created.id,
      eventType: "interaction.created",
      actor,
      idempotencyKey: `interaction-create:${created.id}`,
      payload: { personId, eventId, type, timestamp: timestamp.toISOString(), sourceFileId },
    })
    return created
  })

  await writeAuditLog({ actor: { ...actor, workspaceId, type: actor?.type ?? "system" }, action: "interaction.create", targetType: "interaction", targetId: interaction.id })
  return interaction
}

export async function updateInteraction(
  id: string,
  input: Partial<InteractionInput>,
  workspaceId = "default-workspace",
  actor?: InteractionActor,
) {
  const { db } = await import("@life-os/db")
  const patch: Record<string, unknown> = {}
  if (input.summary !== undefined) patch.summary = optionalString(input.summary)
  if (input.notes !== undefined) patch.notes = optionalString(input.notes)
  if (input.emotionalWeight !== undefined) patch.emotionalWeight = optionalString(input.emotionalWeight)
  if (input.outcome !== undefined) patch.outcome = optionalString(input.outcome)
  if (input.actionItems !== undefined) patch.actionItems = optionalStringList(input.actionItems)
  if (input.direction !== undefined) patch.direction = optionalString(input.direction)
  if (input.billable !== undefined) patch.billable = Boolean(input.billable)
  if (input.amountCents !== undefined) patch.amount = optionalInteger(input.amountCents, "amountCents")
  else if (input.amount !== undefined) patch.amount = dollarsToCents(input.amount)
  if (input.duration !== undefined) patch.duration = optionalInteger(input.duration, "duration")
  if (!Object.keys(patch).length) throw new InteractionError("At least one field is required", "validation")

  const existing = await db.interaction.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new InteractionError("Interaction not found", "not_found")
  const interaction = await db.$transaction(async tx => {
    const updated = await tx.interaction.update({ where: { id }, data: patch, include: interactionInclude })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Interaction",
      subjectId: id,
      eventType: "interaction.updated",
      actor,
      idempotencyKey: `interaction-update:${id}:${randomUUID()}`,
      payload: { fields: Object.keys(patch) },
    })
    return updated
  })
  await writeAuditLog({ actor: { ...actor, workspaceId, type: actor?.type ?? "system" }, action: "interaction.update", targetType: "interaction", targetId: id, metadata: { fields: Object.keys(patch) } })
  return interaction
}

export async function deleteInteraction(id: string, workspaceId = "default-workspace", actor?: InteractionActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.interaction.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new InteractionError("Interaction not found", "not_found")
  await db.$transaction(async tx => {
    await tx.interaction.delete({ where: { id } })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Interaction",
      subjectId: id,
      eventType: "interaction.deleted",
      actor,
      idempotencyKey: `interaction-delete:${id}`,
      payload: {},
    })
  })
  await writeAuditLog({ actor: { ...actor, workspaceId, type: actor?.type ?? "system" }, action: "interaction.delete", targetType: "interaction", targetId: id })
}

async function validateReference(
  tx: Prisma.TransactionClient,
  model: "person" | "event" | "importedFile",
  id: string | null,
  workspaceId: string,
) {
  if (!id) return
  const row = model === "person"
    ? await tx.person.findFirst({ where: { id, workspaceId }, select: { id: true } })
    : model === "event"
      ? await tx.event.findFirst({ where: { id, workspaceId }, select: { id: true } })
      : await tx.importedFile.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!row) throw new InteractionError(`${model === "importedFile" ? "Source file" : `${model[0].toUpperCase()}${model.slice(1)}`} not found`, "not_found")
}

function requiredString(value: unknown, field: string) {
  const parsed = optionalString(value)
  if (!parsed) throw new InteractionError(`${field} is required`, "validation")
  return parsed
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value !== "string") throw new InteractionError("Expected a string", "validation")
  return value.trim() || null
}

function optionalInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new InteractionError(`${field} must be an integer`, "validation")
  return number
}

function optionalStringList(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new InteractionError("actionItems must be an array of strings", "validation")
  }
  return JSON.stringify(value.map(item => item.trim()).filter(Boolean))
}

function validDate(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()
  if (Number.isNaN(date.getTime())) throw new InteractionError("timestamp is invalid", "validation")
  return date
}

// The canonical Interaction's own safe-to-automate field patch — the
// generalized counterpart to staged-interactions.ts's setStagedInteractionField,
// now that Track C wires automation actions to the primitives beyond
// StagedInteraction. Whitelisted the same way: only reversible enrichment
// fields, never anything relationship- or money-critical (personId, amount,
// direction stay confirm-tier/human-only).

const INTERACTION_SAFE_FIELDS = new Set(["emotionalWeight", "outcome", "actionItems", "summary"])

export class InteractionFieldError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "InteractionFieldError"
  }
}

export type SetInteractionFieldInput = {
  id: string
  field: string
  value: unknown
  workspaceId?: string
  actor?: GraphEventActor
}

export async function setInteractionField(input: SetInteractionFieldInput) {
  const { db } = await import("@life-os/db")
  const workspaceId = input.workspaceId ?? "default-workspace"

  if (!INTERACTION_SAFE_FIELDS.has(input.field)) {
    throw new InteractionFieldError(`"${input.field}" is not a safe-to-automate Interaction field`, "validation")
  }

  const existing = await db.interaction.findFirst({ where: { id: input.id, workspaceId }, select: { id: true } })
  if (!existing) throw new InteractionFieldError("Interaction not found", "not_found")

  const value = typeof input.value === "string" ? input.value : String(input.value ?? "")

  const updated = await db.$transaction(async tx => {
    const interaction = await tx.interaction.update({
      where: { id: input.id },
      data: { [input.field]: value },
      select: { id: true, [input.field]: true },
    })

    // Unlike accept/create commands, "set this field" has no natural stable
    // idempotency boundary — the caller (a rule's action executor) doesn't
    // pass one, and setting the same field to the same value twice on
    // purpose is a real, distinct occurrence, not a retry to dedupe. A
    // random key means a genuine network-level retry could double-publish;
    // acceptable here since nothing upstream retries this call today.
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Interaction",
      subjectId: input.id,
      eventType: "interaction.field_set",
      actor: input.actor,
      idempotencyKey: `interaction-field-set:${input.id}:${input.field}:${randomUUID()}`,
      payload: { field: input.field, value },
    })

    return interaction
  })

  return updated
}
