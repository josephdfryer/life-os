import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { mergePersonPairs } from "@/server/domain/merge"

export async function POST(req: NextRequest) {
  try {
    const access = await requireAccess("people.write")
    const { pairs } = await req.json() as { pairs: { keepId: string; deleteId: string }[] }
    return json(await mergePersonPairs(pairs, access.workspaceId, access.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
