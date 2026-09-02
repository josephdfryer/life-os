import { NextRequest, NextResponse } from "next/server"
import { declassifyEvent, PlanError } from "@life-os/domain"
import { auth } from "@/auth"
import { getWorkspaceId } from "@/lib/workspace"

type Params = { params: Promise<{ id: string }> }

// "This was never an occasion." The plan-scoped attendance route cannot answer
// this once a row has already been promoted to an Event, which is exactly the
// case for a standing 1:1 that is really an ongoing interaction.
export async function PATCH(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const workspaceId = await getWorkspaceId(session.user.email)
    const { id } = await params
    return NextResponse.json(await declassifyEvent({ workspaceId, eventId: id }))
  } catch (error) {
    if (error instanceof PlanError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 400 })
    }
    console.error("Event declassification failed", error)
    return NextResponse.json({ error: "Event declassification failed" }, { status: 500 })
  }
}
