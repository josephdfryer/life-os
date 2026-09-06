import { NextRequest, NextResponse } from "next/server"
import { getAttentionQueue } from "@life-os/alignment"
import { attentionQueueContract } from "@life-os/contracts"
import { authorizeRequest } from "@/lib/auth"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

// The push side of relationship cadence. Persons has computed "who is
// overdue" for months, but only as a pull filter; this exposes the same
// computation (@life-os/alignment) so Home's card and the iOS Today deck read
// one list instead of re-deriving it.
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "people.read")
  if (!auth) return unauthorizedResponse()

  try {
    const rawLimit = new URL(req.url).searchParams.get("limit")
    const limit = rawLimit === null || rawLimit === "" ? 50 : Number(rawLimit)
    if (!Number.isFinite(limit)) return errorResponse(400, "validation", "limit must be a number")
    const now = new Date()
    const queue = await getAttentionQueue(auth.workspaceId, { limit, now })
    return NextResponse.json(attentionQueueContract.parse({
      data: queue.map(item => ({
        ...item,
        lastInteractionAt: item.lastInteractionAt?.toISOString() ?? null,
      })),
      limit: Math.min(500, Math.max(1, Math.round(limit))),
      generatedAt: now.toISOString(),
    }))
  } catch (error) {
    return handleRouteError(error)
  }
}
