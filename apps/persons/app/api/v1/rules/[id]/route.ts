import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized, type ApiAuthResult } from "@/lib/api-auth"
import { updateRule, deleteRule } from "@/server/domain/rules"
import { handleRouteError, json, noContent } from "@/server/api/respond"
import type { AccessActor } from "@/server/domain/access"

function toAccessActor(auth: ApiAuthResult): AccessActor {
  return {
    userId: null as unknown as string,
    email: auth.actor.label ?? "api-key",
    actor: auth.actor,
    scopes: auth.scopes,
  }
}

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "rules.manage")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    return json(await updateRule(id, await req.json(), toAccessActor(auth)))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "rules.manage")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    await deleteRule(id, toAccessActor(auth))
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
