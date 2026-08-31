import { NextRequest } from "next/server"
import { parseOwnerAttendance } from "@life-os/domain"
import { requireAccess } from "@/server/domain/access"
import { updateCalendarOwnerAttendanceDefault } from "@/server/domain/google-calendar"
import { badRequest } from "@/server/api/errors"
import { handleRouteError, json } from "@/server/api/respond"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("interactions.write")
    const body = await req.json() as { connectionId?: unknown; attendance?: unknown }
    const connectionId = typeof body.connectionId === "string" ? body.connectionId : ""
    const attendance = parseOwnerAttendance(body.attendance)
    if (!connectionId) throw badRequest("connectionId is required")
    if (!attendance) throw badRequest("attendance must be going or not_going")
    return json(await updateCalendarOwnerAttendanceDefault(actor, connectionId, attendance))
  } catch (error) {
    return handleRouteError(error)
  }
}
