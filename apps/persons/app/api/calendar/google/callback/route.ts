import { NextRequest, NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { handleGoogleCalendarCallback } from "@/server/domain/google-calendar"

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) return NextResponse.redirect(new URL("/admin?calendar=error", url.origin))

  try {
    const result = await handleGoogleCalendarCallback({ code, state, origin: url.origin })
    const redirect = new URL(result.returnTo || "/admin", url.origin)
    redirect.searchParams.set("calendar", "connected")
    return NextResponse.redirect(redirect)
  } catch (error) {
    return handleRouteError(error)
  }
}
