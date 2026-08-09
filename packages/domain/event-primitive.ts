import { publishGraphEvent, type GraphEventActor } from "./events"
import { writeAuditLog, type AuditActor } from "./audit"

// Extracted from apps/persons/server/domain/events.ts (Track C, phase C4).
// Named event-primitive.ts, not events.ts, because that name is already
// taken by this package's GraphEvent spine (publishGraphEvent) — this file
// is the life-primitive Event (a calendar/meeting occurrence), a completely
// different concept that happens to share the English word. Same split as
// persons.ts/plans.ts: no trigger firing (packages/domain never depends on
// packages/automation) and no response formatting.

export class EventPrimitiveError extends Error {
  constructor(message: string, readonly code: "not_found" | "validation") {
    super(message)
    this.name = "EventPrimitiveError"
  }
}

export type EventPrimitiveInput = {
  name?: unknown
  type?: unknown
  timestamp?: unknown
  end?: unknown
  placeId?: unknown
  notes?: unknown
  transcript?: unknown
  metadata?: unknown
}

export function parseEventTimestamp(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date()
  if (Number.isNaN(date.getTime())) throw new EventPrimitiveError("timestamp is invalid", "validation")
  return date
}

export async function createEventPrimitive(input: EventPrimitiveInput, workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const name = requiredString(input.name, "name")
  const type = requiredString(input.type, "type")
  const timestamp = parseEventTimestamp(input.timestamp)

  const event = await db.$transaction(async tx => {
    const created = await tx.event.create({
      data: {
        workspaceId,
        name,
        type,
        start: timestamp,
        end: input.end ? parseEventTimestamp(input.end) : null,
        timestamp,
        placeId: optionalString(input.placeId),
        notes: optionalString(input.notes),
        transcript: optionalString(input.transcript),
        metadata: input.metadata === undefined || input.metadata === null ? null : JSON.stringify(input.metadata),
      },
    })

    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Event",
      subjectId: created.id,
      eventType: "event.create",
      actor,
      idempotencyKey: `event-create:${created.id}`,
      payload: { name: created.name, type: created.type },
    })

    return created
  })

  await writeAuditLog({ actor, action: "event.create", targetType: "event", targetId: event.id })
  return event
}

export async function updateEventPrimitive(id: string, input: EventPrimitiveInput, workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.event.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new EventPrimitiveError("Event not found", "not_found")

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = requiredString(input.name, "name")
  if (input.type !== undefined) patch.type = requiredString(input.type, "type")
  if (input.timestamp !== undefined) {
    const timestamp = parseEventTimestamp(input.timestamp)
    patch.timestamp = timestamp
    patch.start = timestamp
  }
  if (input.end !== undefined) patch.end = input.end ? parseEventTimestamp(input.end) : null
  if (input.placeId !== undefined) patch.placeId = optionalString(input.placeId)
  if (input.notes !== undefined) patch.notes = optionalString(input.notes)
  if (input.transcript !== undefined) patch.transcript = optionalString(input.transcript)
  if (input.metadata !== undefined) patch.metadata = input.metadata === null ? null : JSON.stringify(input.metadata)

  const event = await db.$transaction(async tx => {
    const updated = await tx.event.update({ where: { id }, data: patch })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Event",
      subjectId: id,
      eventType: "event.update",
      actor,
      idempotencyKey: `event-update:${id}:${Date.now()}`,
      payload: { fields: Object.keys(patch) },
    })
    return updated
  })

  await writeAuditLog({ actor, action: "event.update", targetType: "event", targetId: id, metadata: { fields: Object.keys(patch) } })
  return event
}

export async function deleteEventPrimitive(id: string, workspaceId = "default-workspace", actor?: GraphEventActor & AuditActor) {
  const { db } = await import("@life-os/db")
  const existing = await db.event.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw new EventPrimitiveError("Event not found", "not_found")

  await db.$transaction(async tx => {
    await tx.event.delete({ where: { id } })
    await publishGraphEvent(tx, {
      workspaceId,
      subjectType: "Event",
      subjectId: id,
      eventType: "event.delete",
      actor,
      idempotencyKey: `event-delete:${id}`,
      payload: {},
    })
  })

  await writeAuditLog({ actor, action: "event.delete", targetType: "event", targetId: id })
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new EventPrimitiveError(`${field} is required`, "validation")
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
