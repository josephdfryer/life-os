import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const denied = request.nextUrl.searchParams.get("error")
  if (denied) return NextResponse.redirect(new URL("/admin/connections?gmail=denied", request.url))

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? ""
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? ""
  if (!code || !state) return NextResponse.redirect(new URL("/admin/connections?gmail=invalid", request.url))

  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    return NextResponse.redirect(new URL("/admin/connections?gmail=not_configured", request.url))
  }

  try {
    const response = await fetch(new URL("/v1/connections/google/gmail/callback", baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ code, state, origin: request.nextUrl.origin }),
      cache: "no-store",
    })
    const body = await response.json() as { returnTo?: string; error?: { message?: string } }
    if (!response.ok) {
      return NextResponse.redirect(new URL("/admin/connections?gmail=callback_failed", request.url))
    }
    const redirect = new URL(body.returnTo || "/admin/connections", request.url)
    redirect.searchParams.set("gmail", "connected")
    return NextResponse.redirect(redirect)
  } catch {
    return NextResponse.redirect(new URL("/admin/connections?gmail=unavailable", request.url))
  }
}
