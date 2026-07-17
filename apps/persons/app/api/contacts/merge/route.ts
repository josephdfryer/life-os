import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { mergePersons } from "@/server/domain/merge"
import { mergePersonContract } from "@life-os/contracts"
import { parseJsonBody } from "@/server/api/contracts"

export async function POST(req: NextRequest) {
  try {
    const access = await requireAccess("people.write")
    return json(await mergePersons(await parseJsonBody(req, mergePersonContract), access.workspaceId, access.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
