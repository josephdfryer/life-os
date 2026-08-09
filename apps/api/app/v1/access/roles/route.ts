import { NextRequest, NextResponse } from "next/server"
import { createRoleContract, contractIssues } from "@life-os/contracts"
import { createRole } from "@life-os/access"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Create a role with a set of granted scopes.
 *
 *   POST /v1/access/roles  { key, name, description?, scopes: string[] }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "roles.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = createRoleContract.safeParse(await req.json())
    if (!body.success) return errorResponse(400, "validation", "Invalid role.", contractIssues(body.error))
    const role = await createRole(body.data, toAccessActor(auth))
    return NextResponse.json(role, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
