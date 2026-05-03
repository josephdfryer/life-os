import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const action = body.action as "accept" | "dismiss" | "update"

  const item = await db.stagedInteraction.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: "Inbox item not found" }, { status: 404 })

  if (action === "dismiss") {
    const updated = await db.stagedInteraction.update({
      where: { id },
      data: { status: "dismissed" },
    })
    return NextResponse.json(updated)
  }

  if (action === "update") {
    const updated = await db.stagedInteraction.update({
      where: { id },
      data: {
        candidatePersonId: body.personId || null,
        summary: typeof body.summary === "string" ? body.summary.trim() || null : undefined,
        direction: typeof body.direction === "string" ? body.direction.trim() || null : undefined,
        status: body.status === "pending" ? "pending" : undefined,
      },
    })
    return NextResponse.json(updated)
  }

  if (action !== "accept") {
    return NextResponse.json({ error: "Unsupported inbox action" }, { status: 400 })
  }

  const personId = (body.personId ?? item.candidatePersonId) as string | null
  if (!personId) return NextResponse.json({ error: "Choose a Person before accepting this item" }, { status: 400 })

  const person = await db.person.findUnique({ where: { id: personId }, select: { id: true, first: true, last: true } })
  if (!person) return NextResponse.json({ error: "Selected Person does not exist" }, { status: 404 })

  const summary = typeof body.summary === "string" ? body.summary.trim() : item.summary
  const timestamp = body.timestamp ? new Date(body.timestamp) : item.timestamp
  const sourceMarker = `${item.source}:${item.sourceId}`

  const existing = await db.interaction.findFirst({
    where: { notes: sourceMarker },
    select: { id: true },
  })

  let interactionId = existing?.id ?? null
  if (!interactionId) {
    const event = await db.event.create({
      data: {
        name: (summary || item.body || `${item.type} with ${person.first} ${person.last}`).slice(0, 80),
        type: item.type,
        timestamp,
        metadata: JSON.stringify({ source: item.source, sourceId: item.sourceId, stagedInteractionId: item.id }),
      },
    })

    const interaction = await db.interaction.create({
      data: {
        personId,
        eventId: event.id,
        type: item.type,
        timestamp,
        summary: summary || item.body || null,
        notes: sourceMarker,
        direction: body.direction || item.direction || null,
      },
      select: { id: true },
    })
    interactionId = interaction.id
  }

  const updated = await db.stagedInteraction.update({
    where: { id },
    data: {
      status: "accepted",
      acceptedAt: new Date(),
      acceptedPersonId: personId,
      interactionId,
      summary: summary || item.summary,
    },
  })

  return NextResponse.json(updated)
}
