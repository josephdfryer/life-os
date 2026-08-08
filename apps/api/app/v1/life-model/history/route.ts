import { NextRequest, NextResponse } from "next/server"
import { listLifeModelSnapshots } from "@life-os/intelligence"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Every whole-life model snapshot ever synthesized for this workspace,
 * newest version first — current and archived.
 *
 *   GET /v1/life-model/history
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "intelligence.read")
  if (!auth) return unauthorizedResponse()

  try {
    const snapshots = await listLifeModelSnapshots(auth.workspaceId)
    return NextResponse.json({ snapshots })
  } catch (error) {
    return handleRouteError(error)
  }
}
