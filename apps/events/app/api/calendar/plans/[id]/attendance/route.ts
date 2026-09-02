import { NextRequest } from "next/server"
import {
  CalendarReconciliationError,
  parseOwnerAttendanceAction,
  PlanError,
  recordOwnerAttendance,
} from "@life-os/domain"
import { requireAccess } from "@/server/domain/access"
import { badRequest, conflict, notFound } from "@/server/api/errors"
import { handleRouteError, json } from "@/server/api/respond"

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAccess("interactions.write")
    const { id } = await context.params
    const body = await req.json() as { action?: unknown }
    const action = parseOwnerAttendanceAction(body.action)
    if (!action) throw badRequest("action must be going, not_going, did_go, did_not_go, or not_event")
    try {
      return json(await recordOwnerAttendance({
        workspaceId: actor.workspaceId,
        planId: id,
        action,
      }))
    } catch (error) {
      if (error instanceof PlanError) {
        throw error.code === "not_found" ? notFound(error.message) : badRequest(error.message)
      }
      if (error instanceof CalendarReconciliationError) {
        if (error.code === "not_found") throw notFound(error.message)
        if (error.code === "conflict") throw conflict(error.message)
        throw badRequest(error.message)
      }
      throw error
    }
  } catch (error) {
    return handleRouteError(error)
  }
}
