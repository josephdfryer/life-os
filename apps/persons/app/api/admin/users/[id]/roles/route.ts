import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess, updateUserRoles } from "@/server/domain/access"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireAccess("roles.manage")
    const { id } = await params
    return json(await updateUserRoles(id, await req.json(), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
