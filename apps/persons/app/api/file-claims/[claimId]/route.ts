import { NextResponse } from "next/server"
import { reviewFileClaim } from "@life-os/files"
import { requireAccess } from "@/server/domain/access"
import { AppError } from "@/server/api/errors"

export async function PATCH(request: Request, { params }: { params: Promise<{ claimId: string }> }) {
  try {
    const actor = await requireAccess("people.write")
    const { claimId } = await params
    const body = await request.json().catch(() => null) as { action?: string; assertion?: string; reason?: string } | null
    if (body?.action !== "accept" && body?.action !== "dismiss" && body?.action !== "correct") return NextResponse.json({ error: "Choose accept, dismiss, or correct" }, { status: 400 })
    return NextResponse.json({ claim: await reviewFileClaim({ claimId, workspaceId: actor.workspaceId, actorId: actor.userId, action: body.action, assertion: body.assertion, reason: body.reason }) })
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status })
  }
}
