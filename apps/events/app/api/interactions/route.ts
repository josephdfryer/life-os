import { NextRequest, NextResponse } from "next/server"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError, created } from "@/server/api/respond"
import { db } from "@/lib/db"
import { badRequest, notFound, optionalString } from "@/server/api/errors"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.write")
    const body = await req.json()
    const workspaceId = actor.workspaceId

    const personId = optionalString(body.personId)
    const eventId = optionalString(body.eventId)
    const type = optionalString(body.type) ?? "meeting"
    if (!personId) throw badRequest("personId is required")
    if (!eventId) throw badRequest("eventId is required")

    const person = await db.person.findFirst({ where: { id: personId, workspaceId }, select: { id: true } })
    if (!person) throw notFound("Person not found", { personId })

    const event = await db.event.findFirst({ where: { id: eventId, workspaceId }, select: { id: true, start: true } })
    if (!event) throw notFound("Event not found", { eventId })

    const timestampRaw = body.timestamp ?? event.start
    const timestamp = new Date(String(timestampRaw))
    if (Number.isNaN(timestamp.getTime())) throw badRequest("timestamp is invalid")

    const interaction = await db.interaction.create({
      data: {
        workspaceId,
        personId,
        eventId,
        type,
        timestamp,
        summary: optionalString(body.summary),
        notes: optionalString(body.notes),
        emotionalWeight: optionalString(body.emotionalWeight),
        outcome: optionalString(body.outcome),
        duration: body.duration ? Number(body.duration) : null,
      },
      include: { person: { select: { id: true, first: true, last: true } } },
    })

    return created(interaction)
  } catch (error) {
    return handleRouteError(error)
  }
}