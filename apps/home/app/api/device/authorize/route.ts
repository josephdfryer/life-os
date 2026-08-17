import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { workspaceForHomeRequest } from "@/lib/request-access"

export async function POST(request: Request) {
  const session = await auth()
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.startsWith("application/x-www-form-urlencoded") && !contentType.startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Form submission required" }, { status: 415 })
  }

  try {
    const form = await request.formData()
    const platform = String(form.get("platform") ?? "")
    const displayName = String(form.get("deviceName") ?? "")
    const appVersion = String(form.get("appVersion") ?? "")
    const redirectUri = String(form.get("redirectUri") ?? "")
    const codeChallenge = String(form.get("codeChallenge") ?? "")
    const state = String(form.get("state") ?? "")
    if ((platform !== "macos" && platform !== "ios") || !displayName || !appVersion || state.length < 16 || state.length > 256) {
      return NextResponse.json({ error: "Invalid device authorization request" }, { status: 400 })
    }
    const baseUrl = process.env.LIFE_OS_API_URL?.trim()
    const apiKey = process.env.PERSONS_API_KEY?.trim()
    if (!baseUrl || !apiKey) return NextResponse.json({ error: "Device authorization service is not configured" }, { status: 503 })

    const response = await fetch(new URL("/v1/device/auth/authorize", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "x-workspace-override": workspaceId },
      cache: "no-store",
      body: JSON.stringify({ email, platform, displayName, appVersion, redirectUri, codeChallenge }),
    })
    const body = await response.json().catch(() => null) as { code?: string; deviceId?: string; error?: { message?: string } } | null
    if (!response.ok || !body?.code || !body.deviceId) {
      console.error("[device/authorize] canonical API refused request", { status: response.status, error: body?.error?.message })
      return NextResponse.json({ error: body?.error?.message ?? "Could not authorize device" }, { status: response.status || 502 })
    }
    const callback = new URL(redirectUri)
    callback.searchParams.set("code", body.code)
    callback.searchParams.set("device_id", body.deviceId)
    callback.searchParams.set("state", state)
    return NextResponse.redirect(callback, 303)
  } catch (error) {
    console.error("[device/authorize] failed", error)
    return NextResponse.json({ error: "Could not authorize device" }, { status: 500 })
  }
}
