import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { GoogleOAuthError, resolveConnectionUserId } from "@/lib/google-oauth"
import { createGmailAuthorizeUrl } from "@/lib/gmail-oauth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "connections.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const userId = await resolveConnectionUserId(auth.workspaceId)
    if (!userId) return errorResponse(400, "validation", "No user found to own the Gmail connection")

    const returnTo = req.nextUrl.searchParams.get("returnTo") || "/admin/connections"
    const { url } = createGmailAuthorizeUrl(auth.workspaceId, userId, returnTo)
    return NextResponse.json({ url })
  } catch (error) {
    if (error instanceof GoogleOAuthError) {
      return errorResponse(error.code === "not_configured" ? 503 : 400, error.code, error.message)
    }
    return handleRouteError(error)
  }
}
