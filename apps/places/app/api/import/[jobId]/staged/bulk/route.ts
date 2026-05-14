import { NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { bulkUpdateStagedVisits, type StagedVisitAction } from "@/server/domain/import"

export const dynamic = "force-dynamic"

export async function POST(request: Request, ctx: RouteContext<"/api/import/[jobId]/staged/bulk">) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId } = await ctx.params
    const body = await request.json().catch(() => ({})) as { action?: StagedVisitAction; minConfidence?: number; visitIds?: string[] }
    const action = body.action === "accept" || body.action === "reject" || body.action === "skip" ? body.action : "skip"
    return NextResponse.json(await bulkUpdateStagedVisits(jobId, actor.workspaceId, { action, minConfidence: body.minConfidence, visitIds: body.visitIds }, actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
