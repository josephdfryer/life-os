import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { findPersonDuplicates } from "@/server/domain/merge"
import { handleRouteError, json } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    return json(await findPersonDuplicates(auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
