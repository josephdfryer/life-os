import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ personId: string }> }

// "Add Theory Note" creates a NORMAL Life OS Note — not a theory-specific
// primitive. The subject person is recorded in metadata so the next synthesis
// can pick it up as a source.
export async function POST(request: Request, { params }: Params) {
  try {
    const { personId } = await params
    const payload = await request.json().catch(() => null)
    const body = typeof payload?.body === "string" ? payload.body.trim() : ""
    if (!body) {
      return NextResponse.json({ error: "Note body is required" }, { status: 400 })
    }

    const person = await db.person.findFirst({
      where: { id: personId },
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save note" },
      { status: 500 }
    )
  }
}
