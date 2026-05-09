import { NextRequest, NextResponse } from "next/server"
import { requireAccess } from "@/server/domain/access"
import { googleCalendarAuthUrl } from "@/server/domain/google-calendar"
import { handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.write")
    const url = new URL(req.url)
    const returnTo = url.searchParams.get("returnTo") ?? "/admin"
    return NextResponse.redirect(googleCalendarAuthUrl(actor, url.origin, returnTo))
  } catch (error) {
    return handleRouteError(error)
  }
}
