import { z } from "zod"
import type { NextRequest } from "next/server"
import { createDeviceAuthorization, DeviceAuthError } from "@life-os/access/device"
import { db } from "@life-os/db"
import { authorizeRequest } from "@/lib/auth"
import { errorResponse, unauthorizedResponse } from "@/lib/respond"

const requestContract = z.object({
  email: z.string().email().max(320),
  platform: z.enum(["macos", "ios"]),
  displayName: z.string().trim().min(1).max(200),
  appVersion: z.string().trim().min(1).max(64),
  redirectUri: z.string().trim().min(1).max(256),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
}).strict()

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request)
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = requestContract.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return errorResponse(400, "validation", "Invalid device authorization request")

    const user = await db.user.findFirst({
      where: {
        email: parsed.data.email,
        status: "active",
        OR: [
          { ownedWorkspaces: { some: { id: auth.workspaceId } } },
          { workspaceMemberships: { some: { workspaceId: auth.workspaceId, status: "active" } } },
        ],
      },
      select: { id: true },
    })
    if (!user) return errorResponse(409, "account_not_provisioned", "Account is not provisioned for this workspace")

    return Response.json(await createDeviceAuthorization({
      workspaceId: auth.workspaceId,
      userId: user.id,
      platform: parsed.data.platform,
      displayName: parsed.data.displayName,
      appVersion: parsed.data.appVersion,
      redirectUri: parsed.data.redirectUri,
      codeChallenge: parsed.data.codeChallenge,
    }))
  } catch (error) {
    if (error instanceof DeviceAuthError) return errorResponse(400, error.code, error.message)
    console.error("[device/auth/authorize] failed", error)
    return errorResponse(500, "internal_error", "Could not authorize device")
  }
}
