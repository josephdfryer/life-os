import { NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { updateStagedVisit, type StagedVisitAction } from "@/server/domain/import"

export const dynamic = "force-dynamic"

export async function PATCH(request: Request, ctx: RouteContext<"/api/import/[jobId]/staged/[visitId]">) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId, visitId } = await ctx.params
    const body = await request.json().catch(() => ({})) as { action?: StagedVisitAction }
    const action = body.action === "accept" || body.action === "reject" || body.action === "skip" ? body.action : "skip"
    return NextResponse.json(await updateStagedVisit(jobId, visitId, actor.workspaceId, action, actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
