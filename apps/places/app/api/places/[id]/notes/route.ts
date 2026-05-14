import { NextRequest } from "next/server"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { createPlaceNote } from "@/server/domain/places"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("places.write")
    const body = await req.json()
    const note = await createPlaceNote(id, actor.workspaceId, body.body, {
      eventId: body.eventId,
      actor: actor.actor,
    })
    return created(note)
  } catch (error) {
    return handleRouteError(error)
  }
}
