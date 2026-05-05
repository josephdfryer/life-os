import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized, type ApiAuthResult } from "@/lib/api-auth"
import { listRules, createRule } from "@/server/domain/rules"
import { handleRouteError, json, created } from "@/server/api/respond"
import type { AccessActor } from "@/server/domain/access"

function toAccessActor(auth: ApiAuthResult): AccessActor {
  return {
    userId: null as unknown as string,
    email: auth.actor.label ?? "api-key",
    workspaceId: auth.workspaceId,
    workspaceName: "API Workspace",
    actor: auth.actor,
    scopes: auth.scopes,
  }
}

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "rules.manage")
  if (!auth) return unauthorized()
  try {
    return json(await listRules(auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "rules.manage")
  if (!auth) return unauthorized()
  try {
    return created(await createRule(await req.json(), toAccessActor(auth)))
  } catch (error) {
    return handleRouteError(error)
  }
}
