import { NextRequest, NextResponse } from "next/server"
import { contractIssues, ruleInputContract, rulesListContract } from "@life-os/contracts"
import { listRules, createRule } from "@life-os/automation"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { formatRuleResource } from "@/lib/rules"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "rules.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { rules, runCount } = await listRules(auth.workspaceId)
    return NextResponse.json(rulesListContract.parse({ rules: rules.map(formatRuleResource), runCount }))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "rules.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = ruleInputContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid rule.", contractIssues(parsed.error))
    const rule = await createRule(parsed.data, toAccessActor(auth))
    return NextResponse.json(formatRuleResource(rule), { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
