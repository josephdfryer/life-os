import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { badRequest } from "@/server/api/errors"
import { auditAction } from "@/server/domain/audit"
import { revalidatePeopleCache } from "@/server/domain/people"

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAccess("people.write")
    const body = await req.json()
    if (body.confirm !== "DELETE") throw badRequest("confirm must be the string DELETE")

    const { count } = await db.person.deleteMany({
      where: { workspaceId: actor.workspaceId },
    })

    await auditAction({ actor: actor.actor, action: "person.delete", targetType: "person", targetId: `workspace:${actor.workspaceId}` })
    revalidatePeopleCache(actor.workspaceId)
    return NextResponse.json({ deleted: count })
  } catch (error) {
    return handleRouteError(error)
  }
}
