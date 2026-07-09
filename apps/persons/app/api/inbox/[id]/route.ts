import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { applyInboxSuggestions, updateInboxItem } from "@/server/domain/inbox"
import { handleRouteError } from "@/server/api/respond"
import { notFound } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"

type Params = { params: Promise<{ id: string }> }

// Full detail for one item — body, metadata-derived fields, and rule runs.
// The list endpoint deliberately omits these.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("inbox.review")
    const item = await db.stagedInteraction.findFirst({
      where: { id, workspaceId: actor.workspaceId },
      include: {
        candidatePerson: {
          select: { id: true, first: true, last: true, title: true, company: true, emails: true, phones: true },
        },
      },
    })
    if (!item) throw notFound("Inbox item not found", { id })

    const runs = await db.ruleRun.findMany({
      where: { targetType: "stagedInteraction", targetId: id, workspaceId: actor.workspaceId },
      include: { rule: { select: { id: true, name: true, trigger: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    })

    return NextResponse.json({
      ...item,
      candidatePerson: item.candidatePerson ? {
        ...item.candidatePerson,
        emails: parseTags(item.candidatePerson.emails),
        phones: parseTags(item.candidatePerson.phones),
      } : null,
      ruleRuns: runs.map(run => ({
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
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("inbox.review")
    const body = await req.json() as Record<string, unknown>
    if (body.action === "apply_suggestions") {
      const ruleRunIds = Array.isArray(body.ruleRunIds) ? body.ruleRunIds.filter((v): v is string => typeof v === "string") : []
      return NextResponse.json(await applyInboxSuggestions(id, ruleRunIds, actor.actor))
    }
    return NextResponse.json(await updateInboxItem(id, body, actor.actor))
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
