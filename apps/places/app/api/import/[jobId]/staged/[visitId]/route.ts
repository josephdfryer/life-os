import { NextResponse } from "next/server"
import { badRequest } from "@/server/api/errors"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { updateStagedVisit, type StagedVisitAction } from "@/server/domain/import"

export const dynamic = "force-dynamic"

export async function PATCH(request: Request, ctx: RouteContext<"/api/import/[jobId]/staged/[visitId]">) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId, visitId } = await ctx.params
    const body = await request.json()
    const action = stagedVisitAction(body?.action)
    return NextResponse.json(await updateStagedVisit(jobId, visitId, actor.workspaceId, action, actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

function stagedVisitAction(value: unknown): StagedVisitAction {
  if (value === "accept" || value === "reject" || value === "skip") return value
  throw badRequest("action must be accept, reject, or skip")
}
