import { requireAccess } from "@/server/domain/access"
import { googleCalendarStatus } from "@/server/domain/google-calendar"
import { handleRouteError, json } from "@/server/api/respond"

export async function GET() {
  try {
    const actor = await requireAccess("interactions.write")
    return json(await googleCalendarStatus(actor))
  } catch (error) {
    return handleRouteError(error)
  }
}