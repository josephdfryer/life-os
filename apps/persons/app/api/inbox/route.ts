import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { requireAccess } from "@/server/domain/access"

// List endpoint is intentionally lean: no bodies, no metadata, no rule runs.
// Full detail is served per item by GET /api/inbox/[id] when a row expands.

export async function GET(req: NextRequest) {
  const actor = await requireAccess("inbox.review")
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") ?? "review"
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50)))
  const cursor = searchParams.get("cursor")

  // This inbox reviews person-communication items (gmail, krisp, imports).
  // Financial staging (source: era) has its own review surface — keep it out.
  const where = {
    ...inboxStatusWhere(status),
    workspaceId: actor.workspaceId,
    type: { not: "financial" },
  }

  const [rows, total] = await Promise.all([
    db.stagedInteraction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        source: true,
        sourceId: true,
        status: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        candidatePersonId: true,
        type: true,
        timestamp: true,
        summary: true,
        direction: true,
        createdAt: true,
        candidatePerson: {
          select: { id: true, first: true, last: true, title: true, company: true, emails: true, phones: true },
        },
      },
    }),
    // Total only on the first page — the client keeps it in state after that.
    cursor ? Promise.resolve(null) : db.stagedInteraction.count({ where }),
  ])

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const ids = page.map(item => item.id)
  const suggested = ids.length
    ? await db.ruleRun.findMany({
      where: {
        targetType: "stagedInteraction",
        targetId: { in: ids },
        workspaceId: actor.workspaceId,
        mode: "suggest",
        status: "suggested",
      },
      select: { targetId: true },
    })
    : []
  const suggestedSet = new Set(suggested.map(run => run.targetId))

  return NextResponse.json({
    items: page.map(item => ({
      ...item,
      summary: truncate(item.summary, 240),
      candidatePerson: item.candidatePerson ? {
        ...item.candidatePerson,
        emails: parseTags(item.candidatePerson.emails),
        phones: parseTags(item.candidatePerson.phones),
      } : null,
      hasSuggestions: suggestedSet.has(item.id),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total,
  })
}

function truncate(value: string | null, max: number) {
  if (!value) return value
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function inboxStatusWhere(status: string) {
  if (status === "all") return undefined
  if (status === "review") return { status: { in: ["pending", "blocked"] } }
  return { status }
}
