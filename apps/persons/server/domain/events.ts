import { db } from "@/lib/db"
import { badRequest, optionalString, requiredString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"

export type EventInput = {
  name?: unknown
  type?: unknown
  timestamp?: unknown
  end?: unknown
  placeId?: unknown
  notes?: unknown
  transcript?: unknown
  metadata?: unknown
}

export async function createEvent(input: EventInput, actor?: DomainActor) {
  const name = requiredString(input.name, "name")
  const type = requiredString(input.type, "type")
  const timestamp = parseTimestamp(input.timestamp)
  const workspaceId = actor?.workspaceId ?? "default-workspace"

  const event = await db.event.create({
    data: {
      workspaceId,
      name,
      type,
      start: timestamp,
      end: input.end ? parseTimestamp(input.end) : null,
      timestamp,
      placeId: optionalString(input.placeId),
      notes: optionalString(input.notes),
      transcript: optionalString(input.transcript),
      metadata: input.metadata === undefined || input.metadata === null ? null : JSON.stringify(input.metadata),
    },
  })

  await auditAction({ actor, action: "event.create", targetType: "event", targetId: event.id })
  return event
}

export async function updateEvent(id: string, input: EventInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const existing = await db.event.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw badRequest("Event not found")

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = requiredString(input.name, "name")
  if (input.type !== undefined) patch.type = requiredString(input.type, "type")
  if (input.timestamp !== undefined) patch.timestamp = parseTimestamp(input.timestamp)
  if (input.placeId !== undefined) patch.placeId = optionalString(input.placeId)
  if (input.notes !== undefined) patch.notes = optionalString(input.notes)
  if (input.transcript !== undefined) patch.transcript = optionalString(input.transcript)
  if (input.metadata !== undefined) patch.metadata = input.metadata === null ? null : JSON.stringify(input.metadata)

  const event = await db.event.update({ where: { id }, data: patch })
  await auditAction({ actor, action: "event.update", targetType: "event", targetId: id, metadata: { fields: Object.keys(patch) } })
  return event
}

export async function deleteEvent(id: string, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const existing = await db.event.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) throw badRequest("Event not found")
  await db.event.delete({ where: { id } })
  await auditAction({ actor, action: "event.delete", targetType: "event", targetId: id })
}

export function parseTimestamp(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()
  if (Number.isNaN(date.getTime())) throw badRequest("timestamp is invalid", { field: "timestamp" })
  return date
}
