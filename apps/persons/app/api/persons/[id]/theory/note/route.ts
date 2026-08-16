import { NextResponse } from "next/server"
import { captureNote, CaptureValidationError } from "@life-os/domain"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAccess("notes.write")
    const { id } = await params
    const payload = await request.json().catch(() => null)
    const body = typeof payload?.body === "string" ? payload.body.trim() : ""
    if (!body) {
      return NextResponse.json({ error: { code: "validation", message: "Note body is required" } }, { status: 400 })
    }

    const { note } = await captureNote({
      workspaceId: actor.workspaceId,
      content: body,
      type: "theory_observation",
      source: "persons",
      aboutPersonId: id,
    })

    return NextResponse.json({ ok: true, noteId: note.id })
  } catch (error) {
    if (error instanceof CaptureValidationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === "not_found" ? 404 : 400 },
      )
    }
    return handleRouteError(error)
  }
}
