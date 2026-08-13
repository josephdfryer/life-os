import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleRouteError, json } from "@/server/api/respond"
import { badRequest } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"

export async function GET() {
  try {
    const access = await requireAccess("people.read")
    const workspace = await db.workspace.findUnique({ where: { id: access.workspaceId }, select: { autoMergeEnabled: true } })
    return json({ autoMergeEnabled: workspace?.autoMergeEnabled ?? false })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const access = await requireAccess("settings.manage")
    const body = await req.json()
    if (typeof body?.autoMergeEnabled !== "boolean") throw badRequest("autoMergeEnabled must be a boolean", { field: "autoMergeEnabled" })
    await db.workspace.update({ where: { id: access.workspaceId }, data: { autoMergeEnabled: body.autoMergeEnabled } })
    return NextResponse.json({ autoMergeEnabled: body.autoMergeEnabled })
  } catch (error) {
    return handleRouteError(error)
  }
}
