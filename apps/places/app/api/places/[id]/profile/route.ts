import { NextRequest, NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { getPlaceProfile } from "@/server/domain/places"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("places.read")
    return NextResponse.json(await getPlaceProfile(id, actor.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
