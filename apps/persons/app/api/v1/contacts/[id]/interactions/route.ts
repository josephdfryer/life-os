import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { parseTags } from "@/lib/utils"
import { created, handleRouteError } from "@/server/api/respond"
import { createInteraction } from "@/server/domain/interactions"
import { cursorPage, dateKeysetSeek, parsePageRequest } from "@/server/api/date-keyset"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "interactions.read")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    const person = await db.person.findFirst({ where: { id, workspaceId: auth.workspaceId } })
    if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { searchParams } = new URL(req.url)
    const { cursor, limit } = parsePageRequest(searchParams, { limit: 100 })
    const interactions = await db.interaction.findMany({
      where: {
        personId: id,
        workspaceId: auth.workspaceId,
        ...(cursor ? { AND: [dateKeysetSeek("timestamp", cursor, "desc")] } : {}),
      },
      include: { event: true, sourceFile: true },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: limit + 1,
    })
    const page = cursorPage(interactions, limit, interaction => interaction.timestamp)

    return NextResponse.json({
      ...page,
      data: page.data.map((ix: typeof interactions[number]) => ({
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
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "interactions.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    const body = await req.json()
    const interaction = await createInteraction({
      personId: id,
      type: body.type ?? "other",
      timestamp: body.date,
      summary: body.summary,
      emotionalWeight: body.emotionalWeight,
      outcome: body.outcome,
      actionItems: body.keyTopics,
      duration: body.duration,
      notes: body.notes,
    }, auth.actor)

    return created({
      id: interaction.id,
      type: interaction.type,
      timestamp: interaction.timestamp,
      summary: interaction.summary,
      emotionalWeight: interaction.emotionalWeight,
      outcome: interaction.outcome,
      keyTopics: parseTags(interaction.actionItems),
      eventId: interaction.eventId,
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
