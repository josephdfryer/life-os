import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export const dynamic = "force-dynamic"

const NOTE_TYPES = ["thought", "observation", "declaration", "voice_transcript", "import", "theory_observation"]

type Params = { params: Promise<{ id: string }> }

// Full note with provenance: every node derived from this Note.
// "Provenance is sacred" — the note is the raw thing conclusions trace back to.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const access = await requireWorkspaceAccess()
    const { id } = await params
    const note = await db.note.findFirst({
      where: { id, workspaceId: access.workspaceId },
      include: {
        sourceFile: { select: { id: true, filename: true, format: true } },
        plans: { select: { id: true, text: true, status: true } },
        events: { select: { id: true, name: true, start: true } },
        interactions: {
          select: {
            id: true, type: true, timestamp: true, summary: true,
            person: { select: { id: true, first: true, last: true } },
          },
        },
        states: {
          select: {
            id: true, entityType: true, entityId: true, recordedAt: true,
            definition: { select: { type: true, value: true } },
          },
        },
        groups: { select: { id: true, name: true } },
      },
    })
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 })

    return NextResponse.json({
      ...note,
      metadata: parseJson(note.metadata),
    })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const access = await requireWorkspaceAccess()
    const { id } = await params
    const existing = await db.note.findFirst({ where: { id, workspaceId: access.workspaceId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: "Note not found" }, { status: 404 })

    const payload = await req.json().catch(() => null)
    const data: Record<string, unknown> = {}
    if (typeof payload?.content === "string" && payload.content.trim()) data.content = payload.content.trim()
    if (NOTE_TYPES.includes(payload?.type)) data.type = payload.type
    if (payload?.timestamp) {
      const ts = new Date(payload.timestamp)
      if (Number.isNaN(ts.getTime())) return NextResponse.json({ error: "timestamp is invalid" }, { status: 400 })
      data.timestamp = ts
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    // updateMany (not update) so the workspace filter guards the write
    // itself, not just the preceding existence check.
    await db.note.updateMany({ where: { id, workspaceId: access.workspaceId }, data })
    const note = await db.note.findUnique({ where: { id } })
    return NextResponse.json(note)
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

// Deleting a Note orphans nothing: derived nodes keep living, their
// provenance link just becomes null (SetNull relations).
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const access = await requireWorkspaceAccess()
    const { id } = await params
    const existing = await db.note.findFirst({ where: { id, workspaceId: access.workspaceId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: "Note not found" }, { status: 404 })
    await db.note.deleteMany({ where: { id, workspaceId: access.workspaceId } })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

function parseJson(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
