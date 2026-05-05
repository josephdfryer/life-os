import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { updateEvent, deleteEvent } from "@/server/domain/events"
import { handleRouteError, noContent } from "@/server/api/respond"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!(await authorizeApiRequest(req, "people.read"))) return unauthorized()
  const { id } = await params

  const event = await db.event.findUnique({
    where: { id },
    include: { place: true, interactions: { include: { person: true } } },
  })

  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({
    ...event,
    metadata: event.metadata ? JSON.parse(event.metadata) : null,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    return NextResponse.json(await updateEvent(id, await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    await deleteEvent(id, auth.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
