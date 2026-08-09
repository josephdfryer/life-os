import { NextRequest, NextResponse } from "next/server"
import { updateApprovedEmail } from "@life-os/access"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Update an approved email's status.
 *
 *   PATCH /v1/access/approved-emails/<id>  { status }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(req, "settings.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    const result = await updateApprovedEmail(id, await req.json(), toAccessActor(auth))
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error)
  }
}
