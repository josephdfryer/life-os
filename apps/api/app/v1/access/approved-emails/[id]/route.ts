import { NextRequest, NextResponse } from "next/server"
import { updateApprovedEmailContract, contractIssues } from "@life-os/contracts"
import { updateApprovedEmail } from "@life-os/access"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Update an approved email's status or pre-sign-in role.
 *
 *   PATCH /v1/access/approved-emails/<id>  { status?, roleId? }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(req, "settings.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = updateApprovedEmailContract.safeParse(await req.json())
    if (!body.success) return errorResponse(400, "validation", "Invalid approved email update.", contractIssues(body.error))
    const { id } = await params
    const result = await updateApprovedEmail(id, body.data, toAccessActor(auth))
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error)
  }
}
