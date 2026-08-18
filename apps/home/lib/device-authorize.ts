import { workspaceForHomeRequest } from "@/lib/request-access"

export type DeviceAuthorizeInput = {
  email: string
  platform: string
  displayName: string
  appVersion: string
  redirectUri: string
  codeChallenge: string
}

export type DeviceAuthorizeResult =
  | { ok: true; callbackUrl: string }
  | { ok: false; error: string }

// Shared by the /device/authorize page (auto-approves once signed in, no
// visible consent screen) and the /api/device/authorize form fallback.
export async function authorizeDevice(input: DeviceAuthorizeInput, state: string): Promise<DeviceAuthorizeResult> {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return { ok: false, error: "No workspace found for this account" }

  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) return { ok: false, error: "Device authorization service is not configured" }

  const response = await fetch(new URL("/v1/device/auth/authorize", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "x-workspace-override": workspaceId },
    cache: "no-store",
    body: JSON.stringify({
      email: input.email,
      platform: input.platform,
      displayName: input.displayName,
      appVersion: input.appVersion,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
    }),
  })
  const body = await response.json().catch(() => null) as { code?: string; deviceId?: string; error?: { message?: string } } | null
  if (!response.ok || !body?.code || !body.deviceId) {
    console.error("[device/authorize] canonical API refused request", { status: response.status, error: body?.error?.message })
    return { ok: false, error: body?.error?.message ?? "Could not authorize device" }
  }

  const callback = new URL(input.redirectUri)
  callback.searchParams.set("code", body.code)
  callback.searchParams.set("device_id", body.deviceId)
  callback.searchParams.set("state", state)
  return { ok: true, callbackUrl: callback.toString() }
}
