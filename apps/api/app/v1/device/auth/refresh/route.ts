import { deviceRefreshContract, contractIssues } from "@life-os/contracts"
import { DeviceAuthError, refreshDeviceCredential } from "@life-os/access/device"
import { errorResponse } from "@/lib/respond"

export async function POST(request: Request) {
  try {
    const parsed = deviceRefreshContract.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return errorResponse(400, "validation", "Invalid device refresh request", contractIssues(parsed.error))
    return Response.json(await refreshDeviceCredential(parsed.data.refreshToken))
  } catch (error) {
    if (error instanceof DeviceAuthError) return errorResponse(401, error.code, error.message)
    console.error("[device/auth/refresh] failed", error)
    return errorResponse(500, "internal_error", "Could not refresh device credential")
  }
}
