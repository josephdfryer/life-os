import { NextRequest, NextResponse } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { auditLogList } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "audit.read")
  if (!auth) return unauthorized()

  const { searchParams } = new URL(req.url)
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)))
  const action = searchParams.get("action")
  const actorType = searchParams.get("actorType")

  try {
    const entries = await auditLogList({ workspaceId: auth.workspaceId, limit, action, actorType })
    return NextResponse.json({ data: entries, limit })
  } catch (error) {
    return handleRouteError(error)
  }
}
