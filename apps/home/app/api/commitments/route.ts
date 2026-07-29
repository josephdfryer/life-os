import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { db } from "@life-os/db"
import { resolveTimeZone, TZ_COOKIE } from "@life-os/ui"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { dayKey, parseActionItems } from "@/lib/daily"
import { dayToDate, markActionItem } from "@/lib/commitments"

/**
 * Triage for unclaimed action items — the raw lines extracted from
 * Interactions. `commit` promotes one into a Plan (declared intent, with
 * provenance back to the Interaction's Note and Person); `dismiss` marks it
 * complete in place so it stops surfacing. Either way it leaves the inbox,
 * which is the only reason the inbox ever drains.
 */
export async function POST(request: Request) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    interactionId?: unknown
    index?: unknown
    action?: unknown
  } | null

  const interactionId = typeof body?.interactionId === "string" ? body.interactionId : null
  const index = typeof body?.index === "number" ? body.index : null
  const action = body?.action
  if (!interactionId || index === null) {
    return NextResponse.json({ error: "interactionId and index are required" }, { status: 400 })
  }
  if (action !== "commit" && action !== "dismiss") {
    return NextResponse.json({ error: "Action must be commit or dismiss" }, { status: 400 })
  }

  const interaction = await db.interaction.findFirst({
    where: { id: interactionId, workspaceId },
    select: { id: true, actionItems: true, personId: true, sourceNoteId: true },
  })
  if (!interaction) {
    return NextResponse.json({ error: "Interaction was not found" }, { status: 404 })
  }

  const items = parseActionItems(interaction.actionItems)
  const item = items[index]
  // Claiming an item always resolves it in the source blob — a committed item
  // now lives as a Plan, and leaving it open would surface it twice.
  const actionItems = markActionItem(items, index, true)
  if (!item || actionItems === null) {
    return NextResponse.json({ error: "That action item no longer exists" }, { status: 404 })
  }

  if (action === "dismiss") {
    await db.$transaction([
      db.interaction.update({ where: { id: interaction.id }, data: { actionItems } }),
      db.auditLog.create({
        data: {
          workspaceId,
          action: "commitment.dismiss",
          targetType: "interaction",
          targetId: interaction.id,
          actorType: "user",
          actorLabel: "Home",
        },
      }),
    ])
    return NextResponse.json({ status: "dismissed" })
  }

  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  const [plan] = await db.$transaction([
    db.plan.create({
      data: {
        workspaceId,
        text: item.description,
        status: "active",
        // Claiming something means claiming it for today. Snooze is how it
        // moves — deliberately, and at a cost.
        dueOn: dayToDate(dayKey(new Date(), tz), tz),
        personId: interaction.personId,
        sourceNoteId: interaction.sourceNoteId,
      },
      select: { id: true },
    }),
    db.interaction.update({ where: { id: interaction.id }, data: { actionItems } }),
  ])
  await db.auditLog.create({
    data: {
      workspaceId,
      action: "commitment.create",
      targetType: "plan",
      targetId: plan.id,
      actorType: "user",
      actorLabel: "Home",
    },
  })

  return NextResponse.json({ status: "committed", planId: plan.id })
}
