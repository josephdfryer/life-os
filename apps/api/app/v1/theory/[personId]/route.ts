import { NextRequest, NextResponse } from "next/server"
import { getCurrentTheorySnapshot } from "@life-os/intelligence"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * The current Theory of Person snapshot for one person, if any synthesis
 * has run yet.
 *
 *   GET /v1/theory/<personId>
 *
 * Returns `{ snapshot: null }` (200) rather than 404 when no synthesis has
 * run yet — "nothing synthesized" is an expected, normal state, not an
 * error.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ personId: string }> }) {
  const auth = await authorizeRequest(req, "intelligence.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { personId } = await params
    const snapshot = await getCurrentTheorySnapshot(personId, auth.workspaceId)
    return NextResponse.json({ snapshot })
  } catch (error) {
    return handleRouteError(error)
  }
}
