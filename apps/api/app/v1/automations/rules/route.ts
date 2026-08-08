import { NextRequest, NextResponse } from "next/server"
import { listRules, createRule } from "@life-os/automation"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Rule definitions — what the system is allowed to do, and under what
 * conditions. The canonical home of the CRUD apps/persons/app/api/v1/rules
 * has served against apps/persons/server/domain/rules.ts (itself a shim
 * over this same @life-os/automation package since Track A5); this is the
 * cross-app surface, so Home's Automation page can manage rules without
 * growing a second write path.
 *
 *   GET  /v1/automations/rules
 *   POST /v1/automations/rules  { name, trigger, conditions, actions, ... }
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "automations.read")
  if (!auth) return unauthorizedResponse()

  try {
    return NextResponse.json(await listRules(auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "rules.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const rule = await createRule(await req.json(), toAccessActor(auth))
    return NextResponse.json(rule, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
