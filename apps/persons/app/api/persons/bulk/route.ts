import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { handleRouteError, noContent } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { badRequest } from "@/server/api/errors"
import { auditAction } from "@/server/domain/audit"
import { revalidatePeopleCache } from "@/server/domain/people"

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAccess("people.write")
    const body = await req.json()
    const ids: unknown = body.ids
    if (!Array.isArray(ids) || ids.length === 0) throw badRequest("ids must be a non-empty array")
    if (ids.length > 500) throw badRequest("Cannot delete more than 500 people at once")
    const stringIds = ids.map(String)

    await db.person.deleteMany({
      where: { id: { in: stringIds }, workspaceId: actor.workspaceId },
    })

    await auditAction({ actor: actor.actor, action: "person.delete", targetType: "person", targetId: stringIds.join(",") })
    revalidatePeopleCache(actor.workspaceId)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
