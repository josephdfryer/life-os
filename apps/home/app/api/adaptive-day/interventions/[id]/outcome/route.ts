import { NextResponse } from "next/server"
import { recordAdaptiveInterventionOutcome, AdaptiveDayError } from "@life-os/intelligence"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { resolveWorkspaceOwner } from "@/lib/owner"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await workspaceForHomeRequest()
    if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await context.params
    const body = await request.json() as Record<string, unknown>
    const outcome = typeof body.outcome === "string" ? body.outcome : null
    if (!outcome) return NextResponse.json({ error: "outcome is required" }, { status: 400 })
    const owner = await resolveWorkspaceOwner(workspaceId)
    const actor = { type: "user" as const, id: owner?.id, workspaceId }
    const result = await recordAdaptiveInterventionOutcome(id, {
      source: "user_reported",
      outcome,
      note: typeof body.note === "string" ? body.note : null,
    }, workspaceId, actor)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AdaptiveDayError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 })
    }
    console.error("Adaptive Day outcome recording failed", error)
    return NextResponse.json({ error: "Could not record outcome" }, { status: 500 })
  }
}
