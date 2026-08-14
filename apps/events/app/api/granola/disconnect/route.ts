import { requireAccess } from "@/server/domain/access"
import { handleRouteError, json } from "@/server/api/respond"
import { disconnectGranola } from "@/server/domain/granola"

export async function POST() {
  try {
    const actor = await requireAccess("settings.manage")
    await disconnectGranola(actor.workspaceId)
    return json({ connected: false })
  } catch (error) {
    return handleRouteError(error)
  }
}
