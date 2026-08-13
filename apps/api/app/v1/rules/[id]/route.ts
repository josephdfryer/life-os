import { NextRequest, NextResponse } from "next/server"
import { contractIssues, ruleUpdateContract } from "@life-os/contracts"
import { updateRule, deleteRule } from "@life-os/automation"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { formatRuleResource } from "@/lib/rules"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "rules.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = ruleUpdateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid rule update.", contractIssues(parsed.error))
    const { id } = await params
    const rule = await updateRule(id, parsed.data, toAccessActor(auth))
    return NextResponse.json(formatRuleResource(rule))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "rules.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    await deleteRule(id, toAccessActor(auth))
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleRouteError(error)
  }
}
