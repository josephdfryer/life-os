import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"

type InboxItemCandidate = { id: string; first: string; last: string; title: string | null; company: string | null; emails: string; phones: string }
type InboxItem = { id: string; status: string; source: string; sourceId: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; candidatePersonId: string | null; type: string; timestamp: Date; summary: string | null; body: string | null; direction: string | null; acceptedAt: Date | null; acceptedPersonId: string | null; interactionId: string | null; createdAt: Date; updatedAt: Date; candidatePerson: InboxItemCandidate | null }
type RuleRunResult = { id: string; createdAt: Date; trigger: string; matched: boolean; mode: string; status: string; message: string | null; actionsPlanned: string | null; actionsApplied: string | null; targetId: string | null; rule: { id: string; name: string; trigger: string } | null }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") ?? "pending"
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 100)))

  const items = await db.stagedInteraction.findMany({
    where: inboxStatusWhere(status),
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    include: {
      candidatePerson: {
        select: {
          id: true,
          first: true,
          last: true,
          title: true,
          company: true,
          emails: true,
          phones: true,
        },
      },
    },
  }) as InboxItem[]
  const itemIds = items.map((item: InboxItem) => item.id)
  const runs: RuleRunResult[] = itemIds.length
    ? await db.ruleRun.findMany({
      where: { targetType: "stagedInteraction", targetId: { in: itemIds } },
      include: { rule: { select: { id: true, name: true, trigger: true } } },
      orderBy: { createdAt: "desc" },
      take: itemIds.length * 5,
    }) as RuleRunResult[]
    : []
  const runsByTarget = new Map<string, RuleRunResult[]>()
  for (const run of runs) {
    if (!run.targetId) continue
    const current = runsByTarget.get(run.targetId) ?? []
    if (current.length < 5) current.push(run)
    runsByTarget.set(run.targetId, current)
  }

  return NextResponse.json({
    items: items.map((item: InboxItem) => ({
      ...item,
      candidatePerson: item.candidatePerson ? {
        ...item.candidatePerson,
        emails: parseTags(item.candidatePerson.emails),
        phones: parseTags(item.candidatePerson.phones),
      } : null,
      ruleRuns: (runsByTarget.get(item.id) ?? []).map((run: RuleRunResult) => ({
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
  })
}

function inboxStatusWhere(status: string) {
  if (status === "all") return undefined
  if (status === "review") return { status: { in: ["pending", "blocked"] } }
  return { status }
}

function parseJson(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
