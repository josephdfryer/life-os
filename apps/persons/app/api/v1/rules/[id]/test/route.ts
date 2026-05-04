import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized, type ApiAuthResult } from "@/lib/api-auth"
import { testRule } from "@/server/domain/rules"
import { handleRouteError, json } from "@/server/api/respond"
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

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "rules.manage")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    const body = await req.json()
    return json(await testRule({ ruleId: id, ...body }, toAccessActor(auth)))
  } catch (error) {
    return handleRouteError(error)
  }
}
