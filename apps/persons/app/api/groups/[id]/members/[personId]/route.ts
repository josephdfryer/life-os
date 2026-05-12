import { NextRequest } from "next/server"
import { removeMember } from "@/server/domain/groups"
import { handleRouteError, noContent } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

type Params = { params: Promise<{ id: string; personId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id, personId } = await params
    const actor = await requireAccess("people.write")
    await removeMember(id, personId, actor.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
