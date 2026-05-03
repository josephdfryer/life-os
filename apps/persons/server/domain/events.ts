import { db } from "@/lib/db"
import { badRequest, optionalString, requiredString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"

export type EventInput = {
  name?: unknown
  type?: unknown
  timestamp?: unknown
  placeId?: unknown
  notes?: unknown
  transcript?: unknown
  metadata?: unknown
}

export async function createEvent(input: EventInput, actor?: DomainActor) {
  const name = requiredString(input.name, "name")
  const type = requiredString(input.type, "type")
  const timestamp = parseTimestamp(input.timestamp)

  const event = await db.event.create({
    data: {
      name,
      type,
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

export function parseTimestamp(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()
  if (Number.isNaN(date.getTime())) throw badRequest("timestamp is invalid", { field: "timestamp" })
  return date
}
