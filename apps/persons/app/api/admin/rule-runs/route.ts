import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { listRuleRuns } from "@/server/domain/rules"

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAccess("rules.manage")
    const { searchParams } = new URL(req.url)
    return json(await listRuleRuns({
      ruleId: searchParams.get("ruleId"),
      trigger: searchParams.get("trigger"),
      matched: searchParams.get("matched"),
      status: searchParams.get("status"),
      targetType: searchParams.get("targetType"),
      targetId: searchParams.get("targetId"),
    }, actor.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
