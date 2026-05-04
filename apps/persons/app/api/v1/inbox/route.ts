import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { parseTags } from "@/lib/utils"

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
  if (!(await authorizeApiRequest(req, "inbox.review"))) return unauthorized()

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") ?? "pending"
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 100)))
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0))

  const where = inboxStatusWhere(status)
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

  const itemIds = items.map(item => item.id)
  const runs = itemIds.length
    ? await db.ruleRun.findMany({
        where: { targetType: "stagedInteraction", targetId: { in: itemIds } },
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
    data: items.map(item => ({
      ...item,
      candidatePerson: item.candidatePerson
        ? { ...item.candidatePerson, emails: parseTags(item.candidatePerson.emails), phones: parseTags(item.candidatePerson.phones) }
        : null,
      ruleRuns: (runsByTarget.get(item.id) ?? []).map(run => ({
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
