import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"
import { connectGranola } from "@life-os/domain/granola"

/**
 * Connect (or rotate) Granola's API key. Credentials live on Connection
 * directly (kind=meetings, provider=granola) — no dual-write mirror.
 *
 *   POST /v1/connections/granola  { apiKey: string }
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "connections.manage")
  if (!auth) return unauthorizedResponse()

  try {
    const body = await req.json()
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : ""
    if (!apiKey) return errorResponse(400, "validation", "apiKey is required")

    const { db } = await import("@life-os/db")
    const workspace = await db.workspace.findUnique({
      where: { id: auth.workspaceId },
      select: {
        ownerUserId: true,
        members: {
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { userId: true },
        },
      },
    })
    const userId = workspace?.ownerUserId ?? workspace?.members[0]?.userId
    if (!userId) return errorResponse(400, "validation", "No user found to own the Granola connection")

    const connection = await connectGranola({
      workspaceId: auth.workspaceId,
      userId,
      apiKey,
    })

    return NextResponse.json({
      connection: {
        id: connection.id,
        kind: connection.kind,
        status: connection.status,
      },
    }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
