import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { mergePersonPairs } from "@/server/domain/merge"
import { mergePersonPairsContract } from "@life-os/contracts"
import { parseJsonBody } from "@/server/api/contracts"

export async function POST(req: NextRequest) {
  try {
    const access = await requireAccess("people.write")
    const { pairs } = await parseJsonBody(req, mergePersonPairsContract)
    return json(await mergePersonPairs(pairs, access.workspaceId, access.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
