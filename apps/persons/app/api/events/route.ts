import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { createEvent } from "@/server/domain/events"
import { cursorPage, dateKeysetSeek, parsePageRequest } from "@/server/api/date-keyset"

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAccess("people.read")
    const { searchParams } = new URL(req.url)
    const { cursor, limit } = parsePageRequest(searchParams, { limit: 100 })
    const events = await db.event.findMany({
      where: {
        workspaceId: actor.workspaceId,
        ...(cursor ? { AND: [dateKeysetSeek("timestamp", cursor, "desc")] } : {}),
      },
      include: { place: true, interactions: { include: { person: true } } },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: limit + 1,
    })
    const page = cursorPage(events, limit, event => event.timestamp)
    return NextResponse.json({
      ...page,
      data: page.data.map(event => ({
        ...event,
        interactions: event.interactions.map(ix => ({ ...ix, amount: centsToDollars(ix.amount) })),
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireAccess("people.write")
  try {
    const event = await createEvent(await req.json(), actor.actor)
    return created(event)
  } catch (error) {
    return handleRouteError(error)
  }
}
