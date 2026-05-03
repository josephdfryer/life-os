import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { auditLogList, requireAccess } from "@/server/domain/access"

export async function GET(req: NextRequest) {
  try {
    await requireAccess("audit.read")
    const { searchParams } = new URL(req.url)
    return json(await auditLogList({
      limit: Number(searchParams.get("limit") ?? 100),
      action: searchParams.get("action"),
      actorType: searchParams.get("actorType"),
    }))
  } catch (error) {
    return handleRouteError(error)
  }
}
