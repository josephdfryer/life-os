import { NextRequest } from "next/server"
import { addPlaceAffiliation } from "@/server/domain/groups"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.write")
    const affiliation = await addPlaceAffiliation(id, await req.json(), actor.actor)
    return created(affiliation)
  } catch (error) {
    return handleRouteError(error)
  }
}
