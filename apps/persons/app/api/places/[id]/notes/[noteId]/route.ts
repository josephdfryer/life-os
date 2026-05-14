import { NextRequest, NextResponse } from "next/server"
import { handleRouteError, noContent } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { deletePlaceNote, updatePlaceNote } from "@/server/domain/places"

type Params = { params: Promise<{ id: string; noteId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { noteId } = await params
    const actor = await requireAccess("places.write")
    const body = await req.json()
    return NextResponse.json(await updatePlaceNote(noteId, actor.workspaceId, body.body, actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { noteId } = await params
    const actor = await requireAccess("places.write")
    await deletePlaceNote(noteId, actor.workspaceId, actor.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
