import { NextRequest, NextResponse } from "next/server"
import { contractIssues, planCreateContract } from "@life-os/contracts"
import { createPlan } from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"
import { authorizeRequest } from "@/lib/auth"
import { formatPlanResource, listPlans } from "@/lib/plans"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "plans.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const rawLimit = searchParams.get("limit")
    return NextResponse.json(await listPlans({
      cursor: searchParams.get("cursor"),
      limit: rawLimit === null || rawLimit === "" ? undefined : Number(rawLimit),
      personId: searchParams.get("personId"),
      status: searchParams.get("status"),
      q: searchParams.get("q") ?? searchParams.get("search"),
    }, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "plans.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = planCreateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid plan.", contractIssues(parsed.error))
    const plan = await createPlan(parsed.data, auth.workspaceId, auth.actor)
    await runRulesForTarget({
      trigger: "plan.create",
      targetType: "plan",
      targetId: plan.id,
      payload: { planId: plan.id, text: plan.text, status: plan.status },
      actor: auth.actor,
    })
    return NextResponse.json(formatPlanResource(plan), { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
