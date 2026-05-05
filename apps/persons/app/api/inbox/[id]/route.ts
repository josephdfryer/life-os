import { NextRequest, NextResponse } from "next/server"
import { applyInboxSuggestions, updateInboxItem } from "@/server/domain/inbox"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

type Params = { params: Promise<{ id: string }> }

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
