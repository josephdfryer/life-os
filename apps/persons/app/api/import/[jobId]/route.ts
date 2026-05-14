import { NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { getImportJob } from "@/server/domain/import"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ jobId: string }> }

export async function GET(_request: Request, { params }: Params) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId } = await params
    return NextResponse.json(await getImportJob(jobId, actor.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}
