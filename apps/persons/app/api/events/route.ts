import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { createEvent } from "@/server/domain/events"

export async function GET() {
  const actor = await requireAccess("people.read")
  // Bounded to the most recent 500 — unbounded here scaled with total
  // workspace Event count (1,000+ and growing) plus a full interactions+
  // person join per event, on every call.
  const events = await db.event.findMany({
    where: { workspaceId: actor.workspaceId },
    include: { place: true, interactions: { include: { person: true } } },
    orderBy: { timestamp: "desc" },
    take: 500,
  })
  return NextResponse.json(events.map(event => ({
    ...event,
    interactions: event.interactions.map(ix => ({ ...ix, amount: centsToDollars(ix.amount) })),
  })))
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
