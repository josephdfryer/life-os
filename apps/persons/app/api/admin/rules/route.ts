import { NextRequest } from "next/server"
import { created, handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { createRule, listRules } from "@/server/domain/rules"

export async function GET() {
  try {
    const actor = await requireAccess("rules.manage")
    return json(await listRules(actor.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("rules.manage")
    return created(await createRule(await req.json(), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
