import { NextResponse } from "next/server"
import {
  CalendarReconciliationError,
  reconcileCalendarPlan,
  type CalendarReconciliationAction,
} from "@life-os/domain"
import { workspaceForHomeRequest } from "@/lib/request-access"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await workspaceForHomeRequest()
    if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await context.params
    const body = await request.json() as Record<string, unknown>
    const action = body.action
    if (!["happened", "changed", "cancelled", "skip"].includes(String(action))) {
      return NextResponse.json({ error: "Unsupported reconciliation action" }, { status: 400 })
    }
    const result = await reconcileCalendarPlan({
      workspaceId,
      planId: id,
      action: action as CalendarReconciliationAction,
      title: typeof body.title === "string" ? body.title : undefined,
      start: typeof body.start === "string" ? body.start : undefined,
      end: body.end === null || typeof body.end === "string" ? body.end : undefined,
      personIds: Array.isArray(body.personIds) ? body.personIds.filter((value): value is string => typeof value === "string") : undefined,
      placeId: body.placeId === null || typeof body.placeId === "string" ? body.placeId : undefined,
      outcome: body.outcome === null || typeof body.outcome === "string" ? body.outcome : undefined,
      emotionalWeight: body.emotionalWeight === null || typeof body.emotionalWeight === "string" ? body.emotionalWeight : undefined,
      followUps: Array.isArray(body.followUps) ? body.followUps.filter((value): value is string => typeof value === "string") : undefined,
      note: body.note === null || typeof body.note === "string" ? body.note : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CalendarReconciliationError) {
      const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("Calendar reconciliation failed", error)
    return NextResponse.json({ error: "Calendar reconciliation failed" }, { status: 500 })
  }
}
