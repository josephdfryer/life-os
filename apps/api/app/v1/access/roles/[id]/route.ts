import { NextRequest, NextResponse } from "next/server"
import { updateRole } from "@life-os/access"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Update a role's name, description, or granted scopes.
 *
 *   PATCH /v1/access/roles/<id>  { name?, description?, scopes? }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(req, "roles.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    const role = await updateRole(id, await req.json(), toAccessActor(auth))
    return NextResponse.json(role)
  } catch (error) {
    return handleRouteError(error)
  }
}
