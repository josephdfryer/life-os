import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

type Params = { params: Promise<{ id: string }> }
const DAY_TIME_ZONE = "America/Los_Angeles"

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
    where: {
      personId,
      notes: { contains: sourceMarker },
    },
    select: { id: true },
  })

  let interactionId = existing?.id ?? null
  if (!interactionId) {
    const dayMarker = `${item.source}-day:${dayKey(timestamp)}`
    const dailyInteraction = await db.interaction.findFirst({
      where: {
        personId,
        type: item.type,
        notes: { contains: dayMarker },
      },
      select: { id: true, summary: true, notes: true, direction: true },
      orderBy: { timestamp: "asc" },
    })

    const direction = body.direction || item.direction || null
    const line = messageLine(timestamp, direction, summary || item.body || "(no text)")

    if (dailyInteraction) {
      const interaction = await db.interaction.update({
        where: { id: dailyInteraction.id },
        data: {
          summary: appendLine(dailyInteraction.summary, line),
          notes: appendLine(dailyInteraction.notes, sourceMarker),
          direction: dailyInteraction.direction === direction ? dailyInteraction.direction : "mixed",
        },
        select: { id: true },
      })
      interactionId = interaction.id
    } else {
      const event = await db.event.create({
        data: {
          name: `${item.source} ${dayKey(timestamp)} with ${person.first} ${person.last}`.slice(0, 80),
          type: item.type,
          timestamp,
          metadata: JSON.stringify({ source: item.source, day: dayKey(timestamp), stagedInteractionId: item.id }),
        },
      })

      const interaction = await db.interaction.create({
        data: {
          personId,
          eventId: event.id,
          type: item.type,
          timestamp,
          summary: line,
          notes: `${dayMarker}\n${sourceMarker}`,
          direction,
        },
        select: { id: true },
      })
      interactionId = interaction.id
    }
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

function dayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function messageLine(timestamp: Date, direction: string | null, summary: string) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: DAY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp)
  return `[${time}${direction ? ` ${direction}` : ""}] ${summary}`
}

function appendLine(existing: string | null | undefined, next: string) {
  const clean = existing?.trim()
  if (!clean) return next
  if (clean.includes(next)) return clean
  return `${clean}\n${next}`
}
