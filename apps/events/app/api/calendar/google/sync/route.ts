import { NextRequest } from "next/server"
import { requireAccess } from "@/server/domain/access"
import { syncGoogleCalendar } from "@/server/domain/google-calendar"
import { handleRouteError, json } from "@/server/api/respond"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.write")
    const body = await safeJson(req)
    return json(await syncGoogleCalendar(actor, { backfillDays: body.backfillDays }))
  } catch (error) {
    return handleRouteError(error)
  }
}

async function safeJson(req: NextRequest) {
  try {
    const body = await req.json()
    return typeof body === "object" && body ? (body as { backfillDays?: number | null }) : {}
  } catch {
    return {}
  }
}