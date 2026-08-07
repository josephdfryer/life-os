import { NextResponse } from "next/server"
import { db } from "@life-os/db"
import { AcceptStagedInteractionError, acceptStagedInteraction } from "@life-os/domain"
import { workspaceForHomeRequest } from "@/lib/request-access"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await context.params
  const body = await request.json().catch(() => null) as { action?: unknown; personId?: unknown } | null
  if (body?.action !== "accept" && body?.action !== "dismiss") {
    return NextResponse.json({ error: "Action must be accept or dismiss" }, { status: 400 })
  }

  const item = await db.stagedInteraction.findFirst({
    where: {
      id,
      workspaceId,
      status: { in: ["pending", "blocked"] },
      source: { in: ["imessage", "gmail", "whatsapp"] },
      type: { not: "financial" },
    },
  })
  if (!item) return NextResponse.json({ error: "Communication was not found or was already reviewed" }, { status: 404 })

  if (body.action === "dismiss") {
    await db.$transaction([
      db.stagedInteraction.update({ where: { id: item.id }, data: { status: "dismissed" } }),
      db.auditLog.create({
        data: {
          workspaceId,
          action: "inbox.dismiss",
          targetType: "stagedInteraction",
          targetId: item.id,
          actorType: "user",
          actorLabel: "Home",
        },
      }),
    ])
    return NextResponse.json({ status: "dismissed" })
  }

  try {
    const result = await acceptStagedInteraction({
      id: item.id,
      workspaceId,
      personId: typeof body.personId === "string" && body.personId.trim() ? body.personId.trim() : item.candidatePersonId,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AcceptStagedInteractionError) {
      const status = error.code === "not_found" ? 404 : error.code === "invalid_state" ? 409 : 400
      return NextResponse.json({ error: error.message }, { status })
    }
    console.error("Home communication accept failed", error)
    return NextResponse.json({ error: "Could not accept this communication" }, { status: 500 })
  }
}
