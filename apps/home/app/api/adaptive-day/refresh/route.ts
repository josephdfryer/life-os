import { NextResponse } from "next/server"
import { refreshTodaysBrief } from "@life-os/intelligence"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { resolveWorkspaceOwner } from "@/lib/owner"
import { HOME_TIME_ZONE } from "@/lib/daily"

export async function POST(request: Request) {
  try {
    const workspaceId = await workspaceForHomeRequest()
    if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const owner = await resolveWorkspaceOwner(workspaceId)
    const body = await request.json().catch(() => ({})) as { timezone?: unknown }
    const timezone = typeof body.timezone === "string" && body.timezone ? body.timezone : HOME_TIME_ZONE
    const actor = { type: "user" as const, id: owner?.id, workspaceId }
    const brief = await refreshTodaysBrief(workspaceId, timezone, owner?.personId ?? null, actor)
    return NextResponse.json(brief)
  } catch (error) {
    console.error("Adaptive Day refresh failed", error)
    return NextResponse.json({ error: "Could not refresh today's brief" }, { status: 500 })
  }
}
