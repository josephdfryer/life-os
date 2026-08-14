import { NextResponse } from "next/server"
import { reviewFileClaim } from "@life-os/files"
import { undoSafeFileClaimPromotion } from "@life-os/domain"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export async function PATCH(request: Request, { params }: { params: Promise<{ claimId: string }> }) {
  try {
    const access = await requireWorkspaceAccess()
    const { claimId } = await params
    const body = await request.json() as { action: "accept" | "dismiss" | "correct" | "undo"; assertion?: string; reason?: string }
    if (body.action === "undo") return NextResponse.json({ result: await undoSafeFileClaimPromotion(claimId, access.workspaceId, { type: "user", id: access.userId }) })
    return NextResponse.json({ claim: await reviewFileClaim({ claimId, workspaceId: access.workspaceId, actorId: access.userId, action: body.action, assertion: body.assertion, reason: body.reason }) })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
