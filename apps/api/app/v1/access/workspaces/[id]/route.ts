import { NextRequest, NextResponse } from "next/server"
import { updateWorkspaceStatus } from "@life-os/access"
import { authorizeRequest, toAccessActor } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError } from "@/lib/respond"

/**
 * Suspend or reactivate a workspace. Instance-owner only — enforced inside
 * updateWorkspaceStatus, not just by the settings.manage scope check here,
 * since every workspace owner has that scope inside their own workspace.
 *
 *   PATCH /v1/access/workspaces/<id>  { status: "active" | "suspended" }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(req, "settings.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    const result = await updateWorkspaceStatus(id, await req.json(), toAccessActor(auth))
    return NextResponse.json(result)
  } catch (error) {
    return handleRouteError(error)
  }
}
