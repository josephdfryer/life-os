import { db } from "@life-os/db"
import { authorizeDeviceRequest } from "@/lib/device-auth"
import { errorResponse } from "@/lib/respond"

export async function GET(request: Request) {
  const auth = await authorizeDeviceRequest(request, "device.self")
  if (!auth) return errorResponse(401, "unauthorized", "Device access token is invalid or expired")
  const device = await db.device.findFirst({
    where: { id: auth.deviceId, workspaceId: auth.workspaceId },
    select: { id: true, platform: true, displayName: true, appVersion: true, createdAt: true, lastSeenAt: true, revokedAt: true, sources: { orderBy: { source: "asc" }, select: { source: true, enabled: true, permissionStatus: true, healthStatus: true, lastSuccessAt: true, lastErrorCode: true, schemaVersion: true } } },
  })
  return device ? Response.json(device) : errorResponse(404, "not_found", "Device not found")
}
