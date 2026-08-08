import { NextRequest, NextResponse } from "next/server"
import { lifeModelClaimFeedbackContract, contractIssues } from "@life-os/contracts"
import { recordLifeModelClaimFeedback } from "@life-os/intelligence"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

export async function POST(req: NextRequest, { params }: { params: Promise<{ claimId: string }> }) {
  const auth = await authorizeRequest(req, "intelligence.write")
  if (!auth) return unauthorizedResponse()

  try {
    const body = lifeModelClaimFeedbackContract.safeParse(await req.json())
    if (!body.success) return errorResponse(400, "validation", "Invalid claim feedback.", contractIssues(body.error))
    const { claimId } = await params
    const feedback = await recordLifeModelClaimFeedback({
      workspaceId: auth.workspaceId,
      claimId,
      ...body.data,
      actor: auth.actor,
    })
    return NextResponse.json({ feedback }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
