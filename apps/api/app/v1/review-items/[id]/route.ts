import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { reviewItemActionContract } from "@life-os/contracts"
import { resolveReviewItem } from "@life-os/domain"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"
import { registerFileReviewHandlers } from "@life-os/files"

registerFileReviewHandlers()

/**
 * Resolve a single ReviewItem — accept the proposed command as-is,
 * edit-and-accept with a corrected input, or dismiss.
 *
 *   POST /v1/review-items/<id>  { "action": "accept" }
 *   POST /v1/review-items/<id>  { "action": "edit_and_accept", "input": { ... } }
 *   POST /v1/review-items/<id>  { "action": "dismiss", "reason": "..." }
 *
 * Idempotent: resolving an already-resolved item returns its recorded result
 * rather than erroring or re-running the command.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(req, "review.write")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    const parsed = reviewItemActionContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid review action", z.treeifyError(parsed.error))
    const body = parsed.data

    const result = await resolveReviewItem({
      id,
      workspaceId: auth.workspaceId,
      action: body.action,
      editedInput: body.action === "edit_and_accept" ? body.input : undefined,
      reason: body.action === "dismiss" ? body.reason : undefined,
      actor: auth.actor,
    })
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error)
  }
}
