import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { getWorkspaceId } from "@/lib/workspace"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const workspaceId = await getWorkspaceId(session.user.email)
  const { id } = await params

  const event = await db.event.findFirst({
    where: { id, workspaceId },
    include: {
      place: { select: { id: true, name: true } },
      sourcePlan: { select: { id: true, text: true } },
      parentEvent: { select: { id: true, name: true, start: true } },
      childEvents: { select: { id: true, name: true, start: true }, orderBy: { start: "asc" } },
      interactions: {
        include: { person: { select: { id: true, first: true, last: true } } },
        orderBy: { timestamp: "asc" },
      },
      calendarLinks: { select: { externalEventId: true, provider: true } },
    },
  })

  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(event)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const workspaceId = await getWorkspaceId(session.user.email)
  const { id } = await params

  const existing = await db.event.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 })
    patch.name = name
  }
  if (body.type !== undefined) {
    const type = typeof body.type === "string" ? body.type.trim() : ""
    if (!type) return NextResponse.json({ error: "Type cannot be empty" }, { status: 400 })
    patch.type = type
  }
  if (body.start !== undefined || body.timestamp !== undefined) {
    const raw = body.start ?? body.timestamp
    const start = new Date(String(raw))
    if (Number.isNaN(start.getTime())) return NextResponse.json({ error: "Invalid start time" }, { status: 400 })
    patch.start = start
    patch.timestamp = start
  }
  if (body.end !== undefined) {
    if (body.end === null || body.end === "") {
      patch.end = null
    } else {
      const end = new Date(String(body.end))
      if (Number.isNaN(end.getTime())) return NextResponse.json({ error: "Invalid end time" }, { status: 400 })
      patch.end = end
    }
  }
  if (body.notes !== undefined) patch.notes = body.notes === null ? null : String(body.notes)
  if (body.transcript !== undefined) patch.transcript = body.transcript === null ? null : String(body.transcript)
  if (body.placeId !== undefined) patch.placeId = body.placeId === null || body.placeId === "" ? null : String(body.placeId)

  const event = await db.event.update({ where: { id }, data: patch })
  return NextResponse.json(event)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const workspaceId = await getWorkspaceId(session.user.email)
  const { id } = await params

  const existing = await db.event.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await db.event.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
