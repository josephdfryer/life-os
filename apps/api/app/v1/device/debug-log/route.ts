import { authorizeDeviceRequest } from "@/lib/device-auth"
import { errorResponse } from "@/lib/respond"

export async function POST(request: Request) {
  const auth = await authorizeDeviceRequest(request, "device.debug-log")
  if (!auth) return errorResponse(401, "unauthorized", "Device access token is invalid or expired")

  const body = await request.json().catch(() => null)
  const tag = body?.tag ?? "debug"
  const lines: string[] = Array.isArray(body?.lines) ? body.lines : []

  console.log(`[device/debug-log][${tag}] deviceId=${auth.deviceId} lines=${lines.length}`)
  for (const line of lines) {
    console.log(`[device/debug-log][${tag}]`, line)
  }

  return Response.json({ received: lines.length })
}
