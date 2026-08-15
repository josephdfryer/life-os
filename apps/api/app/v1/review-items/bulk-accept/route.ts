import { NextRequest, NextResponse } from "next/server"
import { reviewItemBulkAcceptContract } from "@life-os/contracts"
import { bulkAcceptReviewItems } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Accept a same-source, same-itemType group of low-risk ReviewItems in one action.
 * Same guard as bulk-dismiss: refuses review/confirm tiers, which exist because
 * they need individual judgment.
 *
 *   POST /v1/review-items/bulk-accept  { "ids": ["...", "..."] }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "review.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = reviewItemBulkAcceptContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid bulk accept request")
    const result = await bulkAcceptReviewItems({
      ids: parsed.data.ids,
      workspaceId: auth.workspaceId,
      actor: auth.actor,
    })
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error)
  }
}
