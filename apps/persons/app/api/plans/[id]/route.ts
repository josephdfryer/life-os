import { NextRequest, NextResponse } from "next/server"
import { handleRouteError, json, noContent } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { deletePlan, updatePlan } from "@/server/domain/plans"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const actor = await requireAccess("people.write")
  try {
    const { id } = await params
    return json(await updatePlan(id, await req.json(), actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const actor = await requireAccess("people.write")
  try {
    const { id } = await params
    await deletePlan(id, actor.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
