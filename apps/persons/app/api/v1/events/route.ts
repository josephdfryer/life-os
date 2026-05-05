import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { createEvent } from "@/server/domain/events"
import { created, handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "people.read")
  if (!auth) return unauthorized()

  const { searchParams } = new URL(req.url)
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? 100)))
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0))

  const [events, total] = await Promise.all([
    db.event.findMany({
      where: { workspaceId: auth.workspaceId },
      include: { place: true },
      orderBy: { timestamp: "desc" },
      take: limit,
      skip: offset,
    }),
    db.event.count({ where: { workspaceId: auth.workspaceId } }),
  ])

  return NextResponse.json({ data: events, total, limit, offset })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    return created(await createEvent(await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
