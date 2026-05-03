import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { updateRule } from "@/server/domain/rules"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireAccess("rules.manage")
    const { id } = await params
    return json(await updateRule(id, await req.json(), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
