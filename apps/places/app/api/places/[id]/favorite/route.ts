import { NextRequest, NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { togglePlaceFavorite } from "@/server/domain/places"

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("places.write")
    return NextResponse.json(await togglePlaceFavorite(id, actor.workspaceId, actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
