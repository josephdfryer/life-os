import { NextRequest } from "next/server"
import { removePlaceAffiliation } from "@/server/domain/groups"
import { handleRouteError, noContent } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

type Params = { params: Promise<{ id: string; placeId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id, placeId } = await params
    const actor = await requireAccess("people.write")
    await removePlaceAffiliation(id, placeId, actor.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
