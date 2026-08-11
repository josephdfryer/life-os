import { NextRequest, NextResponse } from "next/server"
import { bulkUpdateInboxItems } from "@/server/domain/inbox"
import { handleRouteError } from "@/server/api/respond"
import { badRequest } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"

export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("inbox.review")
    const body = await req.json() as { action?: string; ids?: unknown; personId?: unknown }
    if (body.action !== "dismiss" && body.action !== "accept") {
      throw badRequest("action must be dismiss or accept", { action: body.action })
    }
    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : []
    const personId = typeof body.personId === "string" && body.personId.trim()
      ? body.personId.trim()
      : undefined
    return NextResponse.json(await bulkUpdateInboxItems(body.action, ids, actor.actor, personId))
  } catch (error) {
    return handleRouteError(error)
  }
}
