import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess, updateApiKey } from "@/server/domain/access"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireAccess("apiKeys.manage")
    const { id } = await params
    return json(await updateApiKey(id, await req.json(), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
