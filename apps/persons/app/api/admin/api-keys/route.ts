import { NextRequest } from "next/server"
import { created, handleRouteError, json } from "@/server/api/respond"
import { accessOverview, createApiKey, requireAccess } from "@/server/domain/access"

export async function GET() {
  try {
    const actor = await requireAccess("apiKeys.manage")
    const overview = await accessOverview(actor)
    return json({ apiKeys: overview.apiKeys, permissions: overview.permissions })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("apiKeys.manage")
    return created(await createApiKey(await req.json(), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
