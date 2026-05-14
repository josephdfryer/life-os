import { NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { listStagedVisits } from "@/server/domain/import"

export const dynamic = "force-dynamic"

export async function GET(request: Request, ctx: RouteContext<"/api/import/[jobId]/staged">) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId } = await ctx.params
    const url = new URL(request.url)
    return NextResponse.json(await listStagedVisits(jobId, actor.workspaceId, {
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? 25),
      status: url.searchParams.get("status") ?? "pending",
    }))
  } catch (error) {
    return handleRouteError(error)
  }
}
