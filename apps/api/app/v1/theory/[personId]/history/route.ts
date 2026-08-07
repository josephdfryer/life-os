import { NextRequest, NextResponse } from "next/server"
import { listTheorySnapshots } from "@life-os/intelligence"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Every Theory of Person snapshot ever synthesized for this person, newest
 * version first — current and archived.
 *
 *   GET /v1/theory/<personId>/history
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ personId: string }> }) {
  const auth = await authorizeRequest(req, "intelligence.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { personId } = await params
    const snapshots = await listTheorySnapshots(personId, auth.workspaceId)
    return NextResponse.json({ snapshots })
  } catch (error) {
    return handleRouteError(error)
  }
}
