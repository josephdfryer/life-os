import { NextRequest } from "next/server"
import { requireAccess } from "@/server/domain/access"
import { saveGoogleCalendarSelection } from "@/server/domain/google-calendar"
import { handleRouteError, json } from "@/server/api/respond"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.write")
    const body = await req.json() as { calendarIds?: unknown }
    const calendarIds = Array.isArray(body.calendarIds)
      ? body.calendarIds.filter((value): value is string => typeof value === "string")
      : []
    return json(await saveGoogleCalendarSelection(actor, calendarIds))
  } catch (error) {
    return handleRouteError(error)
  }
}
