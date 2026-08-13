import { NextRequest, NextResponse } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { handleRouteError } from "@/server/api/respond"
import { analyzeContactHistory } from "@/server/domain/import-analysis"

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "ingest.write")
  if (!auth) return unauthorized()

  try {
    const body = await req.json()
    const { content, filename, source } = body as { content: string; filename?: string; source?: string }

    if (!content?.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 })
    }

    const results = await analyzeContactHistory({ workspaceId: auth.workspaceId, content, filename, source })

    return NextResponse.json({ results })
  } catch (error) {
    return handleRouteError(error)
  }
}
