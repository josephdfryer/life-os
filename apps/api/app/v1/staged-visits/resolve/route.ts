import { NextRequest, NextResponse } from "next/server"
import { stagedVisitGroupResolveContract } from "@life-os/contracts"
import { resolveVisitGroup } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Resolve every pending staged visit at one place in a single decision.
 *
 * The inbox holds 165 pending visits describing three places — 154 of them one
 * address the phone sees daily. Answering per visit is the same answer typed
 * over and over; this answers per place, and the Place it creates carries the
 * googlePlaceId that keeps the importer from asking again.
 *
 *   POST /v1/staged-visits/resolve  { "googlePlaceId": "ChIJ...", "action": "accept" }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "review.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = stagedVisitGroupResolveContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid visit group request")
    const { action, ...selector } = parsed.data
    return NextResponse.json(await resolveVisitGroup({
      selector,
      action,
      workspaceId: auth.workspaceId,
      actor: auth.actor,
    }))
  } catch (error) {
    return handleRouteError(error)
  }
}
