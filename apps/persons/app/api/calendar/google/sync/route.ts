import { requireAccess } from "@/server/domain/access"
import { syncGoogleCalendar } from "@/server/domain/google-calendar"
import { handleRouteError, json } from "@/server/api/respond"

export async function POST() {
  try {
    const actor = await requireAccess("interactions.write")
    return json(await syncGoogleCalendar(actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
