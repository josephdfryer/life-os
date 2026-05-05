import { NextRequest, NextResponse } from "next/server"
import { applyInboxSuggestions, updateInboxItem } from "@/server/domain/inbox"
import { handleRouteError } from "@/server/api/respond"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json() as Record<string, unknown>
    if (body.action === "apply_suggestions") {
      const ruleRunIds = Array.isArray(body.ruleRunIds) ? body.ruleRunIds.filter((v): v is string => typeof v === "string") : []
      return NextResponse.json(await applyInboxSuggestions(id, ruleRunIds))
    }
    return NextResponse.json(await updateInboxItem(id, body))
  } catch (error) {
    return handleRouteError(error)
  }
}
