import { NextRequest } from "next/server"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError, json } from "@/server/api/respond"
import { syncGranolaConnection } from "@/server/domain/granola"

export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.write")
    const body = await req.json().catch(() => ({})) as { fullBackfill?: unknown }
    return json(await syncGranolaConnection({ workspaceId: actor.workspaceId, fullBackfill: body.fullBackfill === true }))
  } catch (error) {
    return handleRouteError(error)
  }
}
