import { NextRequest } from "next/server"
import { addSubgroup } from "@/server/domain/groups"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.write")
    const link = await addSubgroup(id, await req.json(), actor.actor)
    return created(link)
  } catch (error) {
    return handleRouteError(error)
  }
}
