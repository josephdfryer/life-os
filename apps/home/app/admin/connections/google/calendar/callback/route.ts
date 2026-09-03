import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const denied = request.nextUrl.searchParams.get("error")
  if (denied) return NextResponse.redirect(new URL("/admin/connections?calendar=denied", request.url))

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? ""
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? ""
  if (!code || !state) return NextResponse.redirect(new URL("/admin/connections?calendar=invalid", request.url))

  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    return NextResponse.redirect(new URL("/admin/connections?calendar=not_configured", request.url))
  }

  try {
    const response = await fetch(new URL("/v1/connections/google/calendar/callback", baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ code, state, origin: request.nextUrl.origin }),
      cache: "no-store",
    })
    const body = await response.json() as { returnTo?: string }
    if (!response.ok) {
      return NextResponse.redirect(new URL("/admin/connections?calendar=callback_failed", request.url))
    }
    const redirect = new URL(body.returnTo || "/admin/connections", request.url)
    redirect.searchParams.set("calendar", "connected")
    return NextResponse.redirect(redirect)
  } catch {
    return NextResponse.redirect(new URL("/admin/connections?calendar=unavailable", request.url))
  }
}
