import { NextResponse } from "next/server"
import { db } from "@life-os/db"
import { AcceptStagedInteractionError, acceptStagedInteraction } from "@life-os/domain"
import { workspaceForHomeRequest } from "@/lib/request-access"

const MAX_BULK_ITEMS = 200

export async function POST(request: Request) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null) as { action?: unknown; ids?: unknown; personId?: unknown } | null
  if (body?.action !== "dismiss" && body?.action !== "accept") {
    return NextResponse.json({ error: "Action must be accept or dismiss" }, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : []
  if (ids.length === 0) return NextResponse.json({ error: "Choose at least one communication" }, { status: 400 })
  if (ids.length > MAX_BULK_ITEMS) {
    return NextResponse.json({ error: `Choose no more than ${MAX_BULK_ITEMS} communications` }, { status: 400 })
  }

  if (body.action === "accept") {
    const personId = typeof body.personId === "string" ? body.personId.trim() : ""
    if (!personId) return NextResponse.json({ error: "Choose a Person" }, { status: 400 })

    const person = await db.person.findFirst({
      where: { id: personId, workspaceId },
      select: { id: true },
    })
    if (!person) return NextResponse.json({ error: "Person was not found" }, { status: 404 })

    const items = await db.stagedInteraction.findMany({
      where: {
        id: { in: ids },
        workspaceId,
        status: { in: ["pending", "blocked"] },
        source: { in: ["imessage", "gmail", "whatsapp"] },
        type: { not: "financial" },
      },
      select: { id: true },
    })
    let processed = 0
    const errors: string[] = []
    for (const item of items) {
      try {
        await acceptStagedInteraction({ id: item.id, workspaceId, personId })
        processed += 1
      } catch (error) {
        errors.push(error instanceof AcceptStagedInteractionError ? error.message : "Could not accept communication")
      }
    }
    return NextResponse.json({ processed, skipped: ids.length - items.length, errors })
  }

  const processed = await db.$transaction(async transaction => {
    let count = 0
    for (const id of ids) {
      const update = await transaction.stagedInteraction.updateMany({
        where: {
          id,
          workspaceId,
          status: { in: ["pending", "blocked"] },
          source: { in: ["imessage", "gmail", "whatsapp"] },
          type: { not: "financial" },
        },
        data: { status: "dismissed" },
      })
      if (update.count === 0) continue
      await transaction.auditLog.create({
        data: {
          workspaceId,
          action: "inbox.dismiss",
          targetType: "stagedInteraction",
          targetId: id,
          actorType: "user",
          actorLabel: "Home",
        },
      })
      count += 1
    }
    return count
  })

  return NextResponse.json({ processed, skipped: ids.length - processed })
}
