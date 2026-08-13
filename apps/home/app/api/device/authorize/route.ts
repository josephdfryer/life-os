import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { createDeviceAuthorization, DeviceAuthError } from "@life-os/access/device"
import { db } from "@life-os/db"

export async function POST(request: Request) {
  const [session, workspaceId] = await Promise.all([auth(), workspaceForHomeRequest()])
  const email = session?.user?.email
  if (!email || !workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
    const user = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (!user) return NextResponse.json({ error: "Account is not provisioned" }, { status: 409 })

    const grant = await createDeviceAuthorization({
      workspaceId,
      userId: user.id,
      platform,
      displayName,
      appVersion,
      redirectUri,
      codeChallenge,
    })
    const callback = new URL(redirectUri)
    callback.searchParams.set("code", grant.code)
    callback.searchParams.set("device_id", grant.deviceId)
    callback.searchParams.set("state", state)
    return NextResponse.redirect(callback, 303)
  } catch (error) {
    if (error instanceof DeviceAuthError) return NextResponse.json({ error: error.message }, { status: 400 })
    console.error("[device/authorize] failed", error)
    return NextResponse.json({ error: "Could not authorize device" }, { status: 500 })
  }
}
