import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { parseTags } from "@/lib/utils"
import { stageRecord } from "@/server/domain/inbox"
import { created, handleRouteError, json } from "@/server/api/respond"

function inboxStatusWhere(status: string) {
  if (status === "all") return undefined
  if (status === "review") return { status: { in: ["pending", "blocked"] } }
  return { status }
}

function parseJson(value: string | null) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return value }
}

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "inbox.review")
  if (!auth) return unauthorized()

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") ?? "pending"
  const source = searchParams.get("source") ?? undefined
  const itemType = searchParams.get("itemType") ?? undefined
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 100)))
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0))

  const baseWhere = inboxStatusWhere(status)
  const where = { ...baseWhere, workspaceId: auth.workspaceId, ...(source ? { source } : {}), ...(itemType ? { itemType } : {}) }
  const [items, total] = await Promise.all([
    db.stagedInteraction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      skip: offset,
      include: {
        candidatePerson: {
          select: { id: true, first: true, last: true, title: true, company: true, emails: true, phones: true },
        },
      },
    }),
    db.stagedInteraction.count({ where }),
  ])

  const itemIds = items.map((item: typeof items[number]) => item.id)
  const runs = itemIds.length
    ? await db.ruleRun.findMany({
        where: { targetType: "stagedInteraction", targetId: { in: itemIds }, workspaceId: auth.workspaceId },
        include: { rule: { select: { id: true, name: true, trigger: true } } },
        orderBy: { createdAt: "desc" },
        take: itemIds.length * 5,
      })
    : []

  const runsByTarget = new Map<string, typeof runs>()
  for (const run of runs) {
    if (!run.targetId) continue
    const current = runsByTarget.get(run.targetId) ?? []
    if (current.length < 5) current.push(run)
    runsByTarget.set(run.targetId, current)
  }

  return NextResponse.json({
    data: items.map((item: typeof items[number]) => ({
      ...item,
      candidatePerson: item.candidatePerson
        ? { ...item.candidatePerson, emails: parseTags(item.candidatePerson.emails), phones: parseTags(item.candidatePerson.phones) }
        : null,
      ruleRuns: (runsByTarget.get(item.id) ?? []).map((run: typeof runs[number]) => ({
        id: run.id,
        createdAt: run.createdAt,
        trigger: run.trigger,
        matched: run.matched,
        mode: run.mode,
        status: run.status,
        message: run.message,
        actionsPlanned: parseJson(run.actionsPlanned),
        actionsApplied: parseJson(run.actionsApplied),
        rule: run.rule,
      })),
    })),
    total,
    limit,
    offset,
  })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "ingest.write")
  if (!auth) return unauthorized()
  try {
    const body = await req.json() as Record<string, unknown>
    const source = String(body.source ?? "")
    const sourceId = String(body.sourceId ?? "")
    if (!source) return NextResponse.json({ error: "source is required" }, { status: 400 })
    if (!sourceId) return NextResponse.json({ error: "sourceId is required" }, { status: 400 })

    const timestamp = body.timestamp ? new Date(String(body.timestamp)) : new Date()
    const staged = await stageRecord({
      source,
      sourceId,
      itemType: body.itemType ? String(body.itemType) : "interaction",
      type: body.type ? String(body.type) : undefined,
      timestamp,
      summary: body.summary ? String(body.summary) : null,
      body: body.body ? String(body.body) : null,
      direction: body.direction ? String(body.direction) : null,
      contactName: body.contactName ? String(body.contactName) : null,
      contactEmail: body.contactEmail ? String(body.contactEmail) : null,
      contactPhone: body.contactPhone ? String(body.contactPhone) : null,
      candidatePersonId: body.candidatePersonId ? String(body.candidatePersonId) : null,
      confidence: body.confidence != null ? Number(body.confidence) : null,
      matchReason: body.matchReason ? String(body.matchReason) : null,
      metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata as Record<string, unknown>
        : null,
      trigger: body.trigger ? String(body.trigger) : undefined,
    }, auth.actor)
    return created(staged)
  } catch (error) {
    return handleRouteError(error)
  }
}
