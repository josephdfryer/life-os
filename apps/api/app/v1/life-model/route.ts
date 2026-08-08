import { NextRequest, NextResponse } from "next/server"
import { getCurrentLifeModelSnapshot } from "@life-os/intelligence"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * The current whole-life model snapshot for this workspace, if any
 * synthesis has run yet — "what's true across the whole graph right now",
 * the workspace-scoped counterpart to /v1/theory/<personId>.
 *
 *   GET /v1/life-model
 *
 * Returns `{ snapshot: null }` (200) rather than 404 when no synthesis has
 * run yet, same reasoning as /v1/theory.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "intelligence.read")
  if (!auth) return unauthorizedResponse()

  try {
    const snapshot = await getCurrentLifeModelSnapshot(auth.workspaceId)
    return NextResponse.json({ snapshot })
  } catch (error) {
    return handleRouteError(error)
  }
}
