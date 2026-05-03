import { handleRouteError, json } from "@/server/api/respond"
import { findPersonDuplicates } from "@/server/domain/merge"

export async function GET() {
  try {
    return json(await findPersonDuplicates())
  } catch (error) {
    return handleRouteError(error)
  }
}
