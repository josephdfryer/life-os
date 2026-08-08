import { NextRequest, NextResponse } from "next/server"
import { listRuleRuns, type RuleRunFilters } from "@life-os/automation"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Recorded automation decisions — every time a rule evaluated a trigger,
 * matched or not, and what it planned/applied. Most recent 150 first.
 *
 *   GET /v1/automations/runs?ruleId=<id>&trigger=<name>&matched=true&status=applied
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "automations.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const filters: RuleRunFilters = {
      ruleId: searchParams.get("ruleId"),
      trigger: searchParams.get("trigger"),
      matched: searchParams.get("matched"),
      status: searchParams.get("status"),
      targetType: searchParams.get("targetType"),
      targetId: searchParams.get("targetId"),
    }
    return NextResponse.json(await listRuleRuns(filters, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
