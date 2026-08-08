import { NextRequest, NextResponse } from "next/server"
import { testRule } from "@life-os/automation"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Dry-run an existing rule against a sample payload — evaluates conditions
 * and reports which actions would fire, without applying anything. Writes a
 * `dry_run` RuleRun row so the rule's run history reflects the test.
 *
 *   POST /v1/automations/rules/<id>/test  { payload, targetType?, targetId? }
 */
type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "rules.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    const body = await req.json()
    const result = await testRule({ ruleId: id, ...body }, toAccessActor(auth))
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error)
  }
}
