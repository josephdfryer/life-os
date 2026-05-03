import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { listRuleRuns } from "@/server/domain/rules"

export async function GET(req: NextRequest) {
  try {
    await requireAccess("rules.manage")
    const { searchParams } = new URL(req.url)
    return json(await listRuleRuns(searchParams.get("ruleId")))
  } catch (error) {
    return handleRouteError(error)
  }
}
