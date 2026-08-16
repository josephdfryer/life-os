import { deviceHeartbeatContract, contractIssues } from "@life-os/contracts"
import { db } from "@life-os/db"
import { authorizeDeviceRequest } from "@/lib/device-auth"
import { errorResponse } from "@/lib/respond"

export async function POST(request: Request) {
  const auth = await authorizeDeviceRequest(request, "device.heartbeat")
  if (!auth) return errorResponse(401, "unauthorized", "Device access token is invalid or expired")
  const parsed = deviceHeartbeatContract.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    console.warn("[device/heartbeat] invalid payload", {
      requestId: request.headers.get("x-vercel-id"),
      issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), code: issue.code, message: issue.message })),
    })
    return errorResponse(400, "validation", "Invalid device heartbeat", contractIssues(parsed.error))
  }
  const now = new Date()
  await db.$transaction(async tx => {
    await tx.device.update({ where: { id: auth.deviceId }, data: { appVersion: parsed.data.appVersion, lastSeenAt: now } })
    for (const source of parsed.data.sources) {
      await tx.deviceSource.upsert({
        where: { deviceId_source: { deviceId: auth.deviceId, source: source.source } },
        update: { enabled: source.enabled, permissionStatus: source.permissionStatus, healthStatus: source.healthStatus, lastSuccessAt: source.lastSuccessAt ? new Date(source.lastSuccessAt) : null, lastErrorCode: source.lastErrorCode, schemaVersion: source.schemaVersion },
        create: { deviceId: auth.deviceId, source: source.source, enabled: source.enabled, permissionStatus: source.permissionStatus, healthStatus: source.healthStatus, lastSuccessAt: source.lastSuccessAt ? new Date(source.lastSuccessAt) : null, lastErrorCode: source.lastErrorCode, schemaVersion: source.schemaVersion },
      })
    }
  })
  return Response.json({ receivedAt: now.toISOString() })
}
