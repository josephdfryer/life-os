import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"

export const dynamic = "force-dynamic"

const NOTE_TYPES = ["thought", "observation", "declaration", "voice_transcript", "import", "theory_observation"]

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireAccess("notes.read")
    const { id } = await params
    const note = await db.note.findFirst({
      where: { id, workspaceId: actor.workspaceId },
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
    if (!note) return NextResponse.json({ error: { code: "not_found", message: "Note not found" } }, { status: 404 })

    return NextResponse.json({
      ...note,
      metadata: parseJson(note.metadata),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireAccess("notes.write")
    const { id } = await params
    const existing = await db.note.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: { code: "not_found", message: "Note not found" } }, { status: 404 })

    const payload = await req.json().catch(() => null)
    const data: Record<string, unknown> = {}
    if (typeof payload?.content === "string" && payload.content.trim()) data.content = payload.content.trim()
    if (NOTE_TYPES.includes(payload?.type)) data.type = payload.type
    if (payload?.timestamp) {
      const ts = new Date(payload.timestamp)
      if (Number.isNaN(ts.getTime())) {
        return NextResponse.json({ error: { code: "validation", message: "timestamp is invalid" } }, { status: 400 })
      }
      data.timestamp = ts
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: { code: "validation", message: "Nothing to update" } }, { status: 400 })
    }

    await db.note.updateMany({ where: { id, workspaceId: actor.workspaceId }, data })
    const note = await db.note.findUnique({ where: { id } })
    return NextResponse.json(note)
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireAccess("notes.write")
    const { id } = await params
    const existing = await db.note.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: { code: "not_found", message: "Note not found" } }, { status: 404 })
    await db.note.deleteMany({ where: { id, workspaceId: actor.workspaceId } })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleRouteError(error)
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
