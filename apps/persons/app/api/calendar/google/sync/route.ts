import { requireAccess } from "@/server/domain/access"
import { handleRouteError, json } from "@/server/api/respond"

export async function POST() {
  try {
    await requireAccess("interactions.write")
    return json({
      error: "Google Calendar sync is owned by the Events app.",
      settingsUrl: "https://events.lacollecteur.com/settings/calendar",
    }, { status: 410 })
  } catch (error) {
    return handleRouteError(error)
  }
}
