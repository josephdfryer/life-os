import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ personId: string }> }

// "Add Theory Note" creates a NORMAL Life OS Note — not a theory-specific
// primitive. The subject person is recorded in metadata so the next synthesis
// can pick it up as a source.
export async function POST(request: Request, { params }: Params) {
  try {
    const access = await requireWorkspaceAccess()
    const { personId } = await params
    const payload = await request.json().catch(() => null)
    const body = typeof payload?.body === "string" ? payload.body.trim() : ""
    if (!body) {
      return NextResponse.json({ error: "Note body is required" }, { status: 400 })
    }

    // Person must belong to the caller's own workspace — otherwise a
    // caller could attach a note to someone else's tenant graph.
    const person = await db.person.findFirst({
      where: { id: personId, workspaceId: access.workspaceId },
      select: { id: true, workspaceId: true },
    })
    if (!person) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 })
    }

    const note = await db.note.create({
      data: {
        workspaceId: person.workspaceId,
        timestamp: new Date(),
        type: "theory_observation",
        content: body,
        metadata: JSON.stringify({ subjectPersonId: personId }),
      },
      select: { id: true },
    })

    return NextResponse.json({ ok: true, noteId: note.id })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
