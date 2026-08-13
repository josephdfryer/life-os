import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { badRequest } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import { undoMerge } from "@/server/domain/merge"

export async function POST(req: NextRequest) {
  try {
    const access = await requireAccess("people.write")
    const body = await req.json()
    const auditLogId = typeof body?.auditLogId === "string" ? body.auditLogId : null
    const deleteId = typeof body?.deleteId === "string" ? body.deleteId : null
    if (!auditLogId || !deleteId) throw badRequest("auditLogId and deleteId are required", { auditLogId, deleteId })
    return json(await undoMerge(auditLogId, deleteId, access.workspaceId, access.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
