import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access"

export const dynamic = "force-dynamic"

const NOTE_TYPES = ["thought", "observation", "declaration", "voice_transcript", "import", "theory_observation"]

// Lean paginated list. Full provenance is served by GET /api/notes/[id].
export async function GET(req: NextRequest) {
  try {
    const access = await requireWorkspaceAccess()
    const { searchParams } = new URL(req.url)
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50)))
    const cursor = searchParams.get("cursor")
    const type = searchParams.get("type")
    const q = searchParams.get("q")?.trim()

    const where = {
      workspaceId: access.workspaceId,
      ...(type ? { type } : {}),
      ...(q ? { content: { contains: q } } : {}),
    }

    const [rows, total] = await Promise.all([
      db.note.findMany({
        where,
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          timestamp: true,
          createdAt: true,
          type: true,
          content: true,
          sourceFileId: true,
          _count: { select: { plans: true, events: true, interactions: true, states: true, groups: true } },
        },
      }),
      cursor ? Promise.resolve(null) : db.note.count({ where }),
    ])

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return NextResponse.json({
      notes: page.map(note => ({
        ...note,
        content: note.content.length > 500 ? `${note.content.slice(0, 500)}…` : note.content,
        truncated: note.content.length > 500,
        derivedCount:
          note._count.plans + note._count.events + note._count.interactions +
          note._count.states + note._count.groups,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      total,
    })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    const access = await requireWorkspaceAccess()
    const payload = await req.json().catch(() => null)
    const content = typeof payload?.content === "string" ? payload.content.trim() : ""
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 })
    }
    const type = NOTE_TYPES.includes(payload?.type) ? payload.type : "thought"
    const timestamp = payload?.timestamp ? new Date(payload.timestamp) : new Date()
    if (Number.isNaN(timestamp.getTime())) {
      return NextResponse.json({ error: "timestamp is invalid" }, { status: 400 })
    }

    const note = await db.note.create({
      data: {
        workspaceId: access.workspaceId,
        timestamp,
        type,
        content,
        metadata: payload?.metadata ? JSON.stringify(payload.metadata) : null,
      },
    })

    return NextResponse.json(note, { status: 201 })
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
