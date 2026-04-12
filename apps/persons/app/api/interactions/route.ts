import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const personId = searchParams.get("personId")

  const interactions = await db.interaction.findMany({
    where: personId ? { personId } : undefined,
    include: { event: true, sourceFile: true },
    orderBy: { timestamp: "desc" },
  })

  return NextResponse.json(interactions)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    personId, type, timestamp, duration, summary, notes,
    emotionalWeight, outcome, actionItems, billable,
    amount, direction, eventId, sourceFileId,
  } = body

  // Create an event if no eventId provided
  let resolvedEventId = eventId
  if (!resolvedEventId) {
    const event = await db.event.create({
      data: {
        name: summary ? summary.slice(0, 80) : `${type} with person`,
        type,
        timestamp: new Date(timestamp),
      },
    })
    resolvedEventId = event.id
  }

  const interaction = await db.interaction.create({
    data: {
      personId,
      eventId: resolvedEventId,
      type,
      timestamp: new Date(timestamp),
      duration: duration ? Number(duration) : null,
      summary: summary?.trim() || null,
      notes: notes?.trim() || null,
      emotionalWeight: emotionalWeight || null,
      outcome: outcome || null,
      actionItems: Array.isArray(actionItems) ? JSON.stringify(actionItems) : null,
      billable: Boolean(billable),
      amount: amount ? Number(amount) : null,
      direction: direction || null,
      sourceFileId: sourceFileId || null,
    },
    include: { event: true, sourceFile: true },
  })

  return NextResponse.json(interaction, { status: 201 })
}
