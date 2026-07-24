import { NextResponse } from "next/server"
import { requireStuffAccess } from "@/lib/access"
import { analyzeGarments } from "@/lib/garment-analysis"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: Request) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json() as { fileId?: string }
  if (!body.fileId) return NextResponse.json({ error: "A photograph is required." }, { status: 400 })

  try {
    return NextResponse.json(await analyzeGarments(access.workspaceId, body.fileId))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Garment analysis failed."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
