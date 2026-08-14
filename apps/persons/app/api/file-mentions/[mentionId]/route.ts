import { NextResponse } from "next/server"
import { updateFileMention } from "@life-os/files"
import { requireAccess } from "@/server/domain/access"
import { AppError } from "@/server/api/errors"

export async function PATCH(request: Request, { params }: { params: Promise<{ mentionId: string }> }) {
  try {
    const actor = await requireAccess("people.write")
    const { mentionId } = await params
    const body = await request.json().catch(() => null) as { action?: string; personId?: string } | null
    if (body?.action !== "resolve" && body?.action !== "not_this_person") return NextResponse.json({ error: "Choose resolve with a Person or not_this_person" }, { status: 400 })
    return NextResponse.json({ mention: await updateFileMention({ mentionId, workspaceId: actor.workspaceId, actorId: actor.userId, action: body.action, personId: body.personId }) })
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status })
  }
}
