import { NextRequest, NextResponse } from "next/server"
import { updateApiKey } from "@life-os/access"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Update an API key's name, status, expiry, or scopes.
 *
 *   PATCH /v1/access/api-keys/<id>  { name?, status?, expiresAt?, scopes? }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(req, "apiKeys.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    const apiKey = await updateApiKey(id, await req.json(), toAccessActor(auth))
    return NextResponse.json(apiKey)
  } catch (error) {
    return handleRouteError(error)
  }
}
