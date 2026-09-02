import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { GoogleOAuthError } from "@/lib/google-oauth"
import { handleCalendarOAuthCallback } from "@/lib/calendar-oauth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "connections.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = await req.json()
    const code = typeof body?.code === "string" ? body.code.trim() : ""
    const state = typeof body?.state === "string" ? body.state.trim() : ""
    const origin = typeof body?.origin === "string" ? body.origin : null
    if (!code || !state) return errorResponse(400, "validation", "code and state are required")

    const result = await handleCalendarOAuthCallback({ code, state, origin })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof GoogleOAuthError) {
      return errorResponse(400, error.code, error.message)
    }
    return handleRouteError(error)
  }
}
