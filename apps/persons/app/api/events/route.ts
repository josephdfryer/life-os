import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { createEvent } from "@/server/domain/events"

export async function GET() {
  const actor = await requireAccess("people.read")
  const events = await db.event.findMany({
    where: { workspaceId: actor.workspaceId },
    include: { place: true, interactions: { include: { person: true } } },
    orderBy: { timestamp: "desc" },
  })
  return NextResponse.json(events)
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
