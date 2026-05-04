import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { updateInboxItem } from "@/server/domain/inbox"
import { handleRouteError, json } from "@/server/api/respond"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "inbox.review")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    return json(await updateInboxItem(id, await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
