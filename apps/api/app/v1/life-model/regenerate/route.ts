import { NextRequest, NextResponse } from "next/server"
import { regenerateLifeModel } from "@life-os/intelligence"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Re-run whole-life synthesis and persist it as a new snapshot version.
 *
 *   POST /v1/life-model/regenerate
 *
 * This is a real, billed AI Gateway call and therefore remains manual and
 * human-triggered. Passive Home reads use synthesizeLifeModel's free,
 * deterministic alignment preview and never call this route.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "intelligence.write")
  if (!auth) return unauthorizedResponse()

  try {
    const snapshotId = await regenerateLifeModel(auth.workspaceId)
    return NextResponse.json({ snapshotId })
  } catch (error) {
    return handleRouteError(error)
  }
}
