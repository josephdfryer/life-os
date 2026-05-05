import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { mergePersons } from "@/server/domain/merge"
import { handleRouteError, json } from "@/server/api/respond"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    const body = await req.json()
    return json(await mergePersons({ keepId: id, deleteId: body.targetId, fields: body.fields }, auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
