import { NextRequest, NextResponse } from "next/server"
import { createApiKey } from "@life-os/access"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Create an API key for this workspace. The raw secret is returned exactly
 * once in the response — same convention as scripts/create-api-key.ts and
 * the legacy Persons Admin API Keys tab this replaces.
 *
 *   POST /v1/access/api-keys  { name, scopes: string[], expiresAt? }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "apiKeys.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const result = await createApiKey(await req.json(), toAccessActor(auth))
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
