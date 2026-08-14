import { requireAccess } from "@/server/domain/access"
import { handleRouteError, json } from "@/server/api/respond"
import { granolaStatus } from "@/server/domain/granola"

export async function GET() {
  try {
    const actor = await requireAccess("interactions.read")
    return json(await granolaStatus(actor.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
