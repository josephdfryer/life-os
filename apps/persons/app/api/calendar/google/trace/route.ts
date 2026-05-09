import { NextRequest } from "next/server"
import { requireAccess } from "@/server/domain/access"
import { googleCalendarTrace } from "@/server/domain/google-calendar"
import { handleRouteError, json } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.read")
    const { searchParams } = new URL(req.url)
    return json(await googleCalendarTrace(actor, { limit: Number(searchParams.get("limit") ?? 50) }))
  } catch (error) {
    return handleRouteError(error)
  }
}
