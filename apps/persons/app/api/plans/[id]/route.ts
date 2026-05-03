import { NextRequest, NextResponse } from "next/server"
import { handleRouteError, json, noContent } from "@/server/api/respond"
import { deletePlan, updatePlan } from "@/server/domain/plans"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    return json(await updatePlan(id, await req.json()))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    await deletePlan(id)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
