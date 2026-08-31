import { NextRequest } from "next/server"
import { EventSignalError, parseEventSignalAction, resolveEventSignal } from "@life-os/domain"
import { requireAccess } from "@/server/domain/access"
import { badRequest, conflict, notFound } from "@/server/api/errors"
import { handleRouteError, json } from "@/server/api/respond"

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAccess("interactions.write")
    const { id } = await context.params
    const body = await req.json() as { action?: unknown }
    const action = parseEventSignalAction(body.action)
    if (!action) throw badRequest("action must be not_event, went, or didnt_go")

    return json(await resolveEventSignal({
      workspaceId: actor.workspaceId,
      reviewItemId: id,
      action,
      actor: { type: "user", id: actor.userId, label: actor.email ?? "Events" },
    }))
  } catch (error) {
    if (error instanceof EventSignalError) {
      if (error.code === "not_found") throw notFound(error.message)
      if (error.code === "unsupported") throw conflict(error.message)
      throw badRequest(error.message)
    }
    return handleRouteError(error)
  }
}
