import { NextRequest, NextResponse } from "next/server"
import { applyRuleRunSuggestions } from "@life-os/automation"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"

/**
 * Apply one or more "suggested" RuleRuns — the review/confirm-tier actions a
 * matched rule planned but held back from executing. Scoped to a single
 * target so a caller can't accidentally apply a suggestion meant for a
 * different record.
 *
 *   POST /v1/automations/runs/apply  { ruleRunIds: ["..."], targetId: "..." }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "rules.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = await req.json()
    const ruleRunIds = Array.isArray(body?.ruleRunIds) ? body.ruleRunIds.filter((id: unknown) => typeof id === "string") : []
    const targetId = typeof body?.targetId === "string" ? body.targetId : ""
    if (!ruleRunIds.length || !targetId) {
      return errorResponse(400, "validation", "ruleRunIds (non-empty string array) and targetId (string) are required")
    }

    const result = await applyRuleRunSuggestions(ruleRunIds, targetId, { ...auth.actor, workspaceId: auth.workspaceId })
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error)
  }
}
