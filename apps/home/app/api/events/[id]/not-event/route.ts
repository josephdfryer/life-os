import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { declassifyEvent, PlanError } from "@life-os/domain"
import { workspaceForHomeRequest } from "@/lib/request-access"

// "This was never an occasion." The plan-scoped attendance route cannot answer
// this once a row has already been promoted to an Event, which is exactly the
// case for a standing 1:1 that is really an ongoing interaction.
export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await workspaceForHomeRequest()
    if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await context.params
    const result = await declassifyEvent({ workspaceId, eventId: id })
    revalidateTag("home-schedule", "max")
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof PlanError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 400 })
    }
    console.error("Event declassification failed", error)
    return NextResponse.json({ error: "Event declassification failed" }, { status: 500 })
  }
}
