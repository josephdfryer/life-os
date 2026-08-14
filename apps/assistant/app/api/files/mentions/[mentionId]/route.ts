import { NextResponse } from "next/server"
import { updateFileMention } from "@life-os/files"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export async function PATCH(request: Request, { params }: { params: Promise<{ mentionId: string }> }) {
  try {
    const access = await requireWorkspaceAccess()
    const { mentionId } = await params
    const body = await request.json() as { action: "resolve" | "not_this_person"; personId?: string }
    return NextResponse.json({ mention: await updateFileMention({ mentionId, workspaceId: access.workspaceId, actorId: access.userId, ...body }) })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
