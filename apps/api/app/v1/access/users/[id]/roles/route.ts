import { NextRequest, NextResponse } from "next/server"
import { updateUserRolesContract, contractIssues } from "@life-os/contracts"
import { updateUserRoles } from "@life-os/access"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Replace a user's role assignments.
 *
 *   PATCH /v1/access/users/<id>/roles  { roleIds: string[] }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(req, "roles.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = updateUserRolesContract.safeParse(await req.json())
    if (!body.success) return errorResponse(400, "validation", "Invalid role assignment.", contractIssues(body.error))
    const { id } = await params
    const user = await updateUserRoles(id, body.data, toAccessActor(auth))
    return NextResponse.json(user)
  } catch (error) {
    return handleRouteError(error)
  }
}
