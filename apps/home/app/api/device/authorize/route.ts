import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { authorizeDevice } from "@/lib/device-authorize"

// Kept as a fallback for any client that still posts this form (older
// Companion builds). The /device/authorize page now authorizes inline and
// redirects without ever rendering this form.
export async function POST(request: Request) {
  const session = await auth()
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

    const result = await authorizeDevice({ email, platform, displayName, appVersion, redirectUri, codeChallenge }, state)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
    return NextResponse.redirect(result.callbackUrl, 303)
  } catch (error) {
    console.error("[device/authorize] failed", error)
    return NextResponse.json({ error: "Could not authorize device" }, { status: 500 })
  }
}
