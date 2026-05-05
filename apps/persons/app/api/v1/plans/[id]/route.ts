import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { updatePlan, deletePlan } from "@/server/domain/plans"
import { handleRouteError, json, noContent } from "@/server/api/respond"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    return json(await updatePlan(id, await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    await deletePlan(id, auth.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
