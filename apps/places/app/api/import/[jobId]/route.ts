import { NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { getImportJob } from "@/server/domain/import"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, ctx: RouteContext<"/api/import/[jobId]">) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId } = await ctx.params
    return NextResponse.json(await getImportJob(jobId, actor.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
