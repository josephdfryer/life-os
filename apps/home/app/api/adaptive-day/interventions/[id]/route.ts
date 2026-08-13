import { NextResponse } from "next/server"
import {
  acceptAdaptiveIntervention,
  editAndAcceptAdaptiveIntervention,
  dismissAdaptiveIntervention,
  AdaptiveDayError,
} from "@life-os/intelligence"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { resolveWorkspaceOwner } from "@/lib/owner"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await workspaceForHomeRequest()
    if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await context.params
    const body = await request.json() as Record<string, unknown>
    const action = body.action
    const owner = await resolveWorkspaceOwner(workspaceId)
    const actor = { type: "user" as const, id: owner?.id, workspaceId }

    if (action === "accept") {
      return NextResponse.json(await acceptAdaptiveIntervention(id, workspaceId, actor))
    }
    if (action === "edit_and_accept") {
      const editedInput = body.editedInput
      if (!editedInput || typeof editedInput !== "object") {
        return NextResponse.json({ error: "editedInput is required" }, { status: 400 })
      }
      return NextResponse.json(await editAndAcceptAdaptiveIntervention(id, editedInput as Record<string, unknown>, workspaceId, actor))
    }
    if (action === "dismiss") {
      const reason = typeof body.reason === "string" ? body.reason : undefined
      return NextResponse.json(await dismissAdaptiveIntervention(id, workspaceId, reason, actor))
    }
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 })
  } catch (error) {
    if (error instanceof AdaptiveDayError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 })
    }
    console.error("Adaptive Day intervention resolution failed", error)
    return NextResponse.json({ error: "Could not resolve this recommendation" }, { status: 500 })
  }
}
