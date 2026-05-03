import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { created, handleRouteError } from "@/server/api/respond"
import { createEvent } from "@/server/domain/events"

export async function GET() {
  const events = await db.event.findMany({
    include: { place: true, interactions: { include: { person: true } } },
    orderBy: { timestamp: "desc" },
  })
  return NextResponse.json(events)
}

export async function POST(req: NextRequest) {
  try {
    const event = await createEvent(await req.json())
    return created(event)
  } catch (error) {
    return handleRouteError(error)
  }
}
