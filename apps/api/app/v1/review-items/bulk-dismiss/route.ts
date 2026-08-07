import { NextRequest, NextResponse } from "next/server"
import { reviewItemBulkDismissContract } from "@life-os/contracts"
import { bulkDismissReviewItems } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Bulk-dismiss a same-source, same-itemType group of low-risk ReviewItems.
 * Deliberately narrower than single-item resolve — review/confirm tier
 * items exist precisely because they need individual judgment, so this
 * refuses anything but observe/safe_auto tiers.
 *
 *   POST /v1/review-items/bulk-dismiss  { "ids": ["...", "..."], "reason": "..." }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "review.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = reviewItemBulkDismissContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid bulk dismiss request")
    const result = await bulkDismissReviewItems({
      ids: parsed.data.ids,
      reason: parsed.data.reason,
      workspaceId: auth.workspaceId,
      actor: auth.actor,
    })
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error)
  }
}
