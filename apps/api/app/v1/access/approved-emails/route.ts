import { NextRequest, NextResponse } from "next/server"
import { approvedEmailContract, contractIssues } from "@life-os/contracts"
import { addApprovedEmail } from "@life-os/access"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Approve an email for workspace invitation.
 *
 *   POST /v1/access/approved-emails  { email }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "settings.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = approvedEmailContract.safeParse(await req.json())
    if (!body.success) return errorResponse(400, "validation", "Invalid approved email.", contractIssues(body.error))
    const result = await addApprovedEmail(body.data, toAccessActor(auth))
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
