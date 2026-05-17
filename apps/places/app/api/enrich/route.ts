import { NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { enrichPendingVisits } from "@/server/domain/enrichment"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const actor = await requireAccess("ingest.write")
    const body = await request.json().catch(() => ({})) as { limit?: unknown }
    const limit = typeof body.limit === "number" ? body.limit : undefined
    return NextResponse.json(await enrichPendingVisits(actor.workspaceId, limit))
  } catch (error) {
    return handleRouteError(error)
  }
}
