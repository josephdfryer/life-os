import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { mergePersons } from "@/server/domain/merge"

export async function POST(req: NextRequest) {
  try {
    const access = await requireAccess("people.write")
    return json(await mergePersons(await req.json(), access.workspaceId, access.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
