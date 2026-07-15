import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { findPersonDuplicates } from "@/server/domain/merge"

export async function GET() {
  try {
    const access = await requireAccess("people.read")
    return json(await findPersonDuplicates(access.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
