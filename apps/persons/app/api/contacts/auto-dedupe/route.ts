import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { autoDedupePersons } from "@/server/domain/merge"

export const maxDuration = 300

export async function POST() {
  try {
    const access = await requireAccess("people.write")
    return json(await autoDedupePersons(access.workspaceId, access.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
