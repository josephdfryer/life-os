import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { handleRouteError, noContent } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { auditAction } from "@/server/domain/audit"
import { revalidatePersonsCache } from "@/server/domain/persons"
import { bulkDeletePeopleContract, BULK_DELETE_CONFIRM_THRESHOLD } from "@life-os/contracts"
import { parseJsonBody } from "@/server/api/contracts"
import { badRequest } from "@/server/api/errors"

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAccess("people.write")
    const { ids: stringIds, confirm } = await parseJsonBody(req, bulkDeletePeopleContract)
    if (stringIds.length > BULK_DELETE_CONFIRM_THRESHOLD && confirm !== "DELETE") {
      throw badRequest(`deleting more than ${BULK_DELETE_CONFIRM_THRESHOLD} people requires confirm: "DELETE"`)
    }

    await db.person.deleteMany({
      where: { id: { in: stringIds }, workspaceId: actor.workspaceId },
    })

    await auditAction({ actor: actor.actor, action: "person.delete", targetType: "person", targetId: stringIds.join(",") })
    revalidatePersonsCache(actor.workspaceId)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
