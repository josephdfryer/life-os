import { deviceExchangeContract, contractIssues } from "@life-os/contracts"
import { DeviceAuthError, exchangeDeviceAuthorization } from "@life-os/access/device"
import { errorResponse } from "@/lib/respond"

export async function POST(request: Request) {
  try {
    const parsed = deviceExchangeContract.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return errorResponse(400, "validation", "Invalid device exchange request", contractIssues(parsed.error))
    return Response.json(await exchangeDeviceAuthorization(parsed.data))
  } catch (error) {
    if (error instanceof DeviceAuthError) return errorResponse(401, error.code, error.message)
    console.error("[device/auth/exchange] failed", error)
    return errorResponse(500, "internal_error", "Could not exchange device authorization")
  }
}
