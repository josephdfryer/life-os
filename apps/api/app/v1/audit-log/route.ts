import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { listAuditLog } from "@/lib/audit-log"
import { handleRouteError, unauthorizedResponse } from "@/lib/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "audit.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const rawLimit = searchParams.get("limit")
    return NextResponse.json(await listAuditLog({
      cursor: searchParams.get("cursor"),
      limit: rawLimit === null || rawLimit === "" ? undefined : Number(rawLimit),
      action: searchParams.get("action"),
      actorType: searchParams.get("actorType"),
      targetType: searchParams.get("targetType"),
      targetId: searchParams.get("targetId"),
    }, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
