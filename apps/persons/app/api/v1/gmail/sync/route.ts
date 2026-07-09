import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { syncGmail } from "@/server/domain/gmail"
import { handleRouteError, json } from "@/server/api/respond"
import type { AccessActor } from "@/server/domain/access"

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "ingest.write")
  if (!auth) return unauthorized()
  try {
    const actor: AccessActor = {
      userId: auth.actor.id ?? "api",
      email: "",
      workspaceId: auth.workspaceId,
      workspaceName: "",
      actor: auth.actor,
      scopes: auth.scopes,
    }
    return json(await syncGmail(actor, { unmatchedMode: "stage" }))
  } catch (error) {
    return handleRouteError(error)
  }
}
