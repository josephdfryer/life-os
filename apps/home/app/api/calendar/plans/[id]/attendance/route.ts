import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import {
  CalendarReconciliationError,
  parseOwnerAttendanceAction,
  PlanError,
  recordOwnerAttendance,
} from "@life-os/domain"
import { workspaceForHomeRequest } from "@/lib/request-access"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await workspaceForHomeRequest()
    if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await context.params
    const body = await request.json() as Record<string, unknown>
    const action = parseOwnerAttendanceAction(body.action)
    if (!action) {
      return NextResponse.json({ error: "action must be going, not_going, did_go, did_not_go, or not_event" }, { status: 400 })
    }
    const result = await recordOwnerAttendance({ workspaceId, planId: id, action })
    revalidateTag("home-schedule", "max")
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof PlanError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 400 })
    }
    if (error instanceof CalendarReconciliationError) {
      const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("Calendar attendance failed", error)
    return NextResponse.json({ error: "Calendar attendance failed" }, { status: 500 })
  }
}
