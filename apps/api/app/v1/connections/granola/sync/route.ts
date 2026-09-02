import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"
import { syncGranolaConnection } from "@life-os/domain/granola"

/**
 * Manual Granola sync for the current workspace.
 *
 *   POST /v1/connections/granola/sync  { fullBackfill?: boolean }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "connections.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = await req.json().catch(() => ({}))
    const fullBackfill = body?.fullBackfill === true
    const result = await syncGranolaConnection({
      workspaceId: auth.workspaceId,
      fullBackfill,
    })
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error)
  }
}
