import { NextRequest, NextResponse } from "next/server"
import { captureNote, CaptureValidationError } from "@life-os/domain"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"

export const dynamic = "force-dynamic"

const NOTE_TYPES = ["thought", "observation", "declaration", "voice_transcript", "import", "theory_observation"]

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAccess("notes.read")
    const { searchParams } = new URL(req.url)
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50)))
    const cursor = searchParams.get("cursor")
    const type = searchParams.get("type")
    const q = searchParams.get("q")?.trim()

    const where = {
      workspaceId: actor.workspaceId,
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
          aboutPersonId: true,
          aboutPlaceId: true,
          aboutItemId: true,
          aboutGroupId: true,
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
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("notes.write")
    const payload = await req.json().catch(() => null)
    const content = typeof payload?.content === "string" ? payload.content.trim() : ""
    if (!content) {
      return NextResponse.json({ error: { code: "validation", message: "content is required" } }, { status: 400 })
    }
    const type = NOTE_TYPES.includes(payload?.type) ? payload.type : "thought"
    const timestamp = payload?.timestamp ? new Date(payload.timestamp) : new Date()
    if (Number.isNaN(timestamp.getTime())) {
      return NextResponse.json({ error: { code: "validation", message: "timestamp is invalid" } }, { status: 400 })
    }

    const { note } = await captureNote({
      workspaceId: actor.workspaceId,
      timestamp,
      type,
      content,
      source: "persons",
      idempotencyKey: typeof payload?.idempotencyKey === "string" ? payload.idempotencyKey : null,
      metadata: payload?.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? payload.metadata
        : null,
      aboutPersonId: typeof payload?.aboutPersonId === "string" ? payload.aboutPersonId : payload?.personId,
      aboutPlaceId: typeof payload?.aboutPlaceId === "string" ? payload.aboutPlaceId : payload?.placeId,
      aboutItemId: typeof payload?.aboutItemId === "string" ? payload.aboutItemId : payload?.itemId,
      aboutEventId: typeof payload?.aboutEventId === "string" ? payload.aboutEventId : payload?.eventId,
      aboutPlanId: typeof payload?.aboutPlanId === "string" ? payload.aboutPlanId : payload?.planId,
      aboutGroupId: typeof payload?.aboutGroupId === "string" ? payload.aboutGroupId : payload?.groupId,
      aboutStateId: typeof payload?.aboutStateId === "string" ? payload.aboutStateId : payload?.stateId,
    })

    return NextResponse.json(note, { status: 201 })
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
