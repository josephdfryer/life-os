import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { validateApiKey, unauthorized } from "@/lib/api-auth"
import { parseTags } from "@/lib/utils"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!validateApiKey(req)) return unauthorized()
  const { id } = await params

  const person = await db.person.findUnique({ where: { id } })
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const interactions = await db.interaction.findMany({
    where: { personId: id },
    include: { event: true, sourceFile: true },
    orderBy: { timestamp: "desc" },
  })

  return NextResponse.json(interactions.map(ix => ({
    id: ix.id,
    type: ix.type,
    timestamp: ix.timestamp,
    summary: ix.summary,
    emotionalWeight: ix.emotionalWeight,
    outcome: ix.outcome,
    keyTopics: parseTags(ix.actionItems),
    duration: ix.duration,
    event: ix.event ? { id: ix.event.id, name: ix.event.name, type: ix.event.type } : null,
    file: ix.sourceFile
      ? { id: ix.sourceFile.id, filename: ix.sourceFile.filename, retrieveUrl: `/api/v1/files/${ix.sourceFile.id}` }
      : null,
  })))
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!validateApiKey(req)) return unauthorized()
  const { id } = await params

  const person = await db.person.findUnique({ where: { id } })
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const {
    type = "other",
    date,
    summary,
    emotionalWeight,
    outcome,
    keyTopics,
    duration,
    notes,
  } = body

  const timestamp = date ? new Date(date) : new Date()

  const event = await db.event.create({
    data: {
      name: summary?.slice(0, 80) ?? `${type} with ${person.first} ${person.last}`,
      type,
      timestamp,
    },
  })

  const interaction = await db.interaction.create({
    data: {
      personId: id,
      eventId: event.id,
      type,
      timestamp,
      summary: summary || null,
      emotionalWeight: emotionalWeight || null,
      outcome: outcome || null,
      duration: duration ? Number(duration) : null,
      notes: notes || null,
      actionItems: keyTopics?.length ? JSON.stringify(keyTopics) : null,
    },
  })

  return NextResponse.json({
    id: interaction.id,
    type: interaction.type,
    timestamp: interaction.timestamp,
    summary: interaction.summary,
    emotionalWeight: interaction.emotionalWeight,
    outcome: interaction.outcome,
    keyTopics: parseTags(interaction.actionItems),
    eventId: event.id,
  }, { status: 201 })
}
