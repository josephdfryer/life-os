import { NextRequest, NextResponse } from "next/server"
import { updateRule, deleteRule } from "@life-os/automation"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Edit or retire a single rule.
 *
 *   PATCH  /v1/automations/rules/<id>  { status, priority, conditions, actions, ... }
 *   DELETE /v1/automations/rules/<id>
 *
 * Any real edit bumps Rule.version — every RuleRun from that point on
 * denormalizes the version it ran under, so history stays interpretable
 * even after the rule is later changed.
 */
type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "rules.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    const rule = await updateRule(id, await req.json(), toAccessActor(auth))
    return NextResponse.json(rule)
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
