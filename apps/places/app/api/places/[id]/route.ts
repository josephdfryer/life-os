import { NextRequest, NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { updatePlaceMeaning } from "@/server/domain/places"

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAccess("places.write")
    const { id } = await ctx.params
    const body = await req.json()
    const place = await updatePlaceMeaning(id, actor.workspaceId, body.meaning, actor.actor)
    return NextResponse.json(place)
  } catch (error) {
    return handleRouteError(error)
  }
}
