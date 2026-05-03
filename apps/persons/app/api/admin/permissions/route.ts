import { handleRouteError, json } from "@/server/api/respond"
import { accessOverview, requireAccess } from "@/server/domain/access"

export async function GET() {
  try {
    const actor = await requireAccess("permissions.manage")
    const overview = await accessOverview(actor)
    return json({ permissions: overview.permissions })
  } catch (error) {
    return handleRouteError(error)
  }
}
