import { badRequest, notFound } from "@/server/api/errors"
import type { DomainActor } from "./audit"
import { runRulesForTarget } from "./rules"
import {
  createEventPrimitive as sharedCreateEvent,
  updateEventPrimitive as sharedUpdateEvent,
  deleteEventPrimitive as sharedDeleteEvent,
  parseEventTimestamp,
  EventPrimitiveError,
  type EventPrimitiveInput,
} from "@life-os/domain"

export type EventInput = EventPrimitiveInput
export { parseEventTimestamp as parseTimestamp }

// Write operations moved to @life-os/domain/event-primitive.ts (Track C,
// phase C4) — same shim pattern as persons.ts/plans.ts. Fires new
// event.create/event.update triggers (packages/domain never depends on
// packages/automation).

function translate<T>(promise: Promise<T>): Promise<T> {
  return promise.catch(error => {
    if (error instanceof EventPrimitiveError) throw error.code === "not_found" ? notFound(error.message) : badRequest(error.message)
    throw error
  })
}

export async function createEvent(input: EventInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const event = await translate(sharedCreateEvent(input, workspaceId, actor))
  await runRulesForTarget({
    trigger: "event.create",
    targetType: "event",
    targetId: event.id,
    payload: { eventId: event.id, name: event.name, type: event.type },
    actor,
  })
  return event
}

export async function updateEvent(id: string, input: EventInput, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  const event = await translate(sharedUpdateEvent(id, input, workspaceId, actor))
  await runRulesForTarget({
    trigger: "event.update",
    targetType: "event",
    targetId: id,
    payload: { eventId: id, fields: Object.keys(input) },
    actor,
  })
  return event
}

export async function deleteEvent(id: string, actor?: DomainActor) {
  const workspaceId = actor?.workspaceId ?? "default-workspace"
  await translate(sharedDeleteEvent(id, workspaceId, actor))
}
