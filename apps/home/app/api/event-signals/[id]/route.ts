import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { EventSignalError, parseEventSignalAction, resolveEventSignal } from "@life-os/domain"
import { workspaceForHomeRequest } from "@/lib/request-access"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await workspaceForHomeRequest()
    if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await context.params
    const body = await request.json().catch(() => null) as { action?: unknown } | null
    const action = parseEventSignalAction(body?.action)
    if (!action) {
      return NextResponse.json({ error: "action must be not_event, went, or didnt_go" }, { status: 400 })
    }

    const result = await resolveEventSignal({
      workspaceId,
      reviewItemId: id,
      action,
      actor: { type: "user", label: "Home" },
    })
    revalidateTag("home-event-signals", "max")
    revalidateTag("home-schedule", "max")
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof EventSignalError) {
      const status = error.code === "not_found" ? 404 : error.code === "unsupported" ? 409 : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("Event signal resolution failed", error)
    return NextResponse.json({ error: "Event signal resolution failed" }, { status: 500 })
  }
}
