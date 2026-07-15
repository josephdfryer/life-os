import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { mergeSameEmailPersons } from "@/server/domain/merge"

export async function POST() {
  try {
    const access = await requireAccess("people.write")
    return json(await mergeSameEmailPersons(access.workspaceId, access.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
