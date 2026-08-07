import { NextRequest, NextResponse } from "next/server"
import { listReviewItems, type ListReviewItemsParams } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * The universal review Inbox — one feed over every source queue
 * (StagedInteraction, NoteSuggestion, ImportStagedVisit, calendar
 * reconciliation) that dual-writes into ReviewItem, instead of a page per
 * legacy queue.
 *
 *   /v1/review-items?status=pending&source=staged_interaction
 *   /v1/review-items?itemType=plan&riskTier=review
 *   /v1/review-items?cursor=<nextCursor from the previous page>
 *
 * Ordered by priority ascending (1 = most urgent) then newest first. Pages
 * with a keyset cursor, same reasoning as /v1/stream.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "review.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const number = (key: string) => {
      const raw = searchParams.get(key)
      return raw === null || raw === "" ? null : Number(raw)
    }
    const params: ListReviewItemsParams = {
      cursor: searchParams.get("cursor"),
      limit: number("limit") ?? undefined,
      status: searchParams.get("status"),
      source: searchParams.get("source"),
      itemType: searchParams.get("itemType"),
      riskTier: searchParams.get("riskTier"),
    }
    return NextResponse.json(await listReviewItems(params, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
