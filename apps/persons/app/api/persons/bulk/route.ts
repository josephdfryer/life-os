import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { handleRouteError, noContent } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { auditAction } from "@/server/domain/audit"
import { revalidatePeopleCache } from "@/server/domain/people"
import { bulkDeletePeopleContract } from "@life-os/contracts"
import { parseJsonBody } from "@/server/api/contracts"

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAccess("people.write")
    const { ids: stringIds } = await parseJsonBody(req, bulkDeletePeopleContract)

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
