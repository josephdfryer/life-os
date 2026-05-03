import { handleRouteError, json } from "@/server/api/respond"
import { autoDedupePersons } from "@/server/domain/merge"

export const maxDuration = 120

export async function POST() {
  try {
    return json(await autoDedupePersons())
  } catch (error) {
    return handleRouteError(error)
  }
}
