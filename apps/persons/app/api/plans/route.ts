import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { created, handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { createPlan } from "@/server/domain/plans"

export async function GET(req: NextRequest) {
  const actor = await requireAccess("people.read")
  const { searchParams } = new URL(req.url)
  const personId = searchParams.get("personId")

  const plans = await db.plan.findMany({
    where: { workspaceId: actor.workspaceId, ...(personId ? { personId } : {}) },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(plans)
}

export async function POST(req: NextRequest) {
  const actor = await requireAccess("people.write")
  try {
    const plan = await createPlan(await req.json(), actor.actor)
    return created(plan)
  } catch (error) {
    return handleRouteError(error)
  }
}
