import { handleRouteError, json } from "@/server/api/respond"
import { mergeSameEmailPersons } from "@/server/domain/merge"

export async function POST() {
  try {
    return json(await mergeSameEmailPersons())
  } catch (error) {
    return handleRouteError(error)
  }
}
