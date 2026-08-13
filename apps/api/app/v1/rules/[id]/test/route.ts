import { NextRequest, NextResponse } from "next/server"
import { contractIssues, ruleTestInputContract, ruleTestResultContract } from "@life-os/contracts"
import { testRule } from "@life-os/automation"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { formatRuleRunResource } from "@/lib/rules"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "rules.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = ruleTestInputContract.safeParse({ ...body, ruleId: id })
    if (!parsed.success) return errorResponse(400, "validation", "Invalid rule test payload.", contractIssues(parsed.error))
    const result = await testRule(parsed.data, toAccessActor(auth))
    return NextResponse.json(ruleTestResultContract.parse({ ...result, run: formatRuleRunResource(result.run) }))
  } catch (error) {
    return handleRouteError(error)
  }
}
