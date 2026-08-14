import { NextRequest } from "next/server"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError, json } from "@/server/api/respond"
import { connectGranola } from "@/server/domain/granola"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("settings.manage")
    const body = await req.json() as { apiKey?: unknown }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : ""
    const connection = await connectGranola({ workspaceId: actor.workspaceId, userId: actor.userId, apiKey })
    return json({ connected: true, status: connection.status })
  } catch (error) {
    return handleRouteError(error)
  }
}
