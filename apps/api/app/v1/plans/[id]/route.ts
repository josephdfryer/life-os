import { NextRequest, NextResponse } from "next/server"
import { contractIssues, planUpdateContract } from "@life-os/contracts"
import { deletePlan, updatePlan } from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"
import { authorizeRequest } from "@/lib/auth"
import { formatPlanResource, getPlanResource } from "@/lib/plans"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "plans.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    return NextResponse.json(await getPlanResource(id, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "plans.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = planUpdateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid plan update.", contractIssues(parsed.error))
    const { id } = await params
    const plan = await updatePlan(id, parsed.data, auth.workspaceId, auth.actor)
    await runRulesForTarget({
      trigger: "plan.update",
      targetType: "plan",
      targetId: id,
      payload: { planId: id, fields: Object.keys(parsed.data) },
      actor: auth.actor,
    })
    return NextResponse.json(formatPlanResource(plan))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "plans.write")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    await deletePlan(id, auth.workspaceId, auth.actor)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleRouteError(error)
  }
}
