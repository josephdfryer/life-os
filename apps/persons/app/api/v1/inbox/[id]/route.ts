import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { applyInboxSuggestions, updateInboxItem } from "@/server/domain/inbox"
import { handleRouteError, json } from "@/server/api/respond"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "inbox.review")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    const body = await req.json() as Record<string, unknown>
    if (body.action === "apply_suggestions") {
      const ruleRunIds = Array.isArray(body.ruleRunIds) ? body.ruleRunIds.filter((v): v is string => typeof v === "string") : []
      return json(await applyInboxSuggestions(id, ruleRunIds, auth.actor))
    }
    return json(await updateInboxItem(id, body, auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
