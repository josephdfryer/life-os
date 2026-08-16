import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"
import { OuraError, createOuraAuthorizeUrl } from "@/lib/oura"

/**
 * Starts Oura authorization-code OAuth. Home redirects the browser here
 * (via its connect route) so the CSRF state is signed by the API that will
 * later exchange the code. Scope is `daily` only.
 *
 *   GET /v1/connections/oura/authorize
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "connections.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const returnTo = req.nextUrl.searchParams.get("returnTo") || "/connections"
    const { url } = createOuraAuthorizeUrl(auth.workspaceId, returnTo)
    return NextResponse.json({ url })
  } catch (error) {
    if (error instanceof OuraError) {
      return errorResponse(error.code === "not_configured" ? 503 : 400, error.code, error.message)
    }
    return handleRouteError(error)
  }
}
