import { NextRequest } from "next/server"
import { revokeDevice, DeviceAuthError } from "@life-os/access/device"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, errorResponse } from "@/lib/respond"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(request, "devices.manage")
  if (!auth) return unauthorizedResponse()
  try {
    const { id } = await params
    await revokeDevice(id, auth.workspaceId)
    return Response.json({ revoked: true })
  } catch (error) {
    if (error instanceof DeviceAuthError) return errorResponse(404, error.code, error.message)
    throw error
  }
}
